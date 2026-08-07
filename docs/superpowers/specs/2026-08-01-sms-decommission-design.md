# SMS Decommission — Design

- **Date:** 2026-08-01 (currency review 2026-08-04; deploy status 2026-08-07)
- **Status:** Implemented in all seven repos. **`emails-queue-api` and `emails-queue-service` are
  deployed as of 2026-08-07**, which carries the `2026-08-01-emails-queue-service-message-loss.md`
  prerequisite with them and removes both send-path subscription filters. The hard ordering
  constraint under Sequencing is therefore **satisfied**: `log-subscriber` is now clear to deploy
  without re-arming either feedback cycle. `log-subscriber` itself, and the remaining four repos, are
  **committed but not yet deployed**.
- **Repos touched:** `log-subscriber`, `emails-queue-api`, `emails-queue-service`, `dbowland-batch`,
  `dbowland-infrastructure`, `dbowland-ui`, `playhouse`

## Context

The `sms-queue-api` and `sms-queue-service` repos are being archived. This spec covers retiring the SMS
consumers and provisioning that can go away now, and cleaning up an unrelated dead Pinpoint analytics app
discovered during the survey.

Archiving the repos does **not** tear down the deployed `sms-queue-*` stacks. Those stay up to serve
`food-api`, whose Cognito OTP flow still sends SMS. That migration is deliberately deferred to the
repo owner and is **out of scope here**.

## Scope

**In scope**

1. `log-subscriber` — migrate error alerts from SMS to email
2. `emails-queue-api` / `emails-queue-service` — remove the two subscription filters that would form a
   feedback loop once log-subscriber sends by email
3. `dbowland-batch` — spin down the zoo tour checker entirely
4. `dbowland-infrastructure` — remove the two archived repos' pipeline IAM users; remove the dead
   Pinpoint analytics app and its IAM grants
5. `dbowland-ui` — correct portfolio copy that is factually wrong post-migration
6. `playhouse` — drop the `sms-queue-*` entries from `cleanup-old-lambdas.ts`

**Out of scope**

- `food-api` / `food-ui` SMS OTP — owner is replacing this separately
- Tearing down the deployed `sms-queue-api` / `sms-queue-service` stacks
- Cognito's own SMS config in `choosee-infrastructure` / `emails-infrastructure`
  (`SmsConfiguration`, `CognitoSmsRole`, `SMS_MFA`) — that path is Cognito→SNS directly, unrelated to
  `sms-queue`, and unaffected by this work

## 1. `log-subscriber` — SMS to email

### Secrets and configuration

Three SSM parameters, following the fleet convention established by `bridge-api` and `choosee-api`:

- `/log-subscriber/email-api-key` (`/log-subscriber-test/email-api-key`)
- `/log-subscriber/email-from-address` (`/log-subscriber-test/email-from-address`)
- `/log-subscriber/email-to-address` (`/log-subscriber-test/email-to-address`)

The alert destination moves into SSM alongside the credentials so no address is committed to the repo.

All three are read with `WithDecryption: true` and cached per warm container, mirroring
`bridge-api/src/services/email.ts`. A missing or valueless parameter throws
`` `SSM parameter ${path} has no value` ``.

Removed:

- `SmsApiKey` and `PhoneNumber` CloudFormation parameters
- `SMS_API_KEY`, `SMS_API_URL`, `SMS_TO_PHONE_NUMBER` environment variables
- `TESTING_SMS_API_KEY`, `PROD_SMS_API_KEY`, `PHONE_NUMBER` GitHub secrets, across all six
  `--parameter-overrides` sites in `.github/workflows/pipeline.yaml`

After this the stack takes only `Environment`, satisfying `01-fleet-standards.md:38` ("no secrets in
CFN parameters").

Added to the template: an inline `ssm:GetParameter` policy scoped to exactly those three parameter ARNs
(the explicit-`Resource` shape used at `bridge-api/template.yaml:285-296`, not a wildcard), plus
`EnvironmentMap` entries:

| Key                     | prod                                    | test                                      |
| ----------------------- | --------------------------------------- | ----------------------------------------- |
| `emailsQueueApiBaseUrl` | `https://emails-queue-api.dbowland.com` | `https://emails-queue-api.bowland.link`   |
| `emailApiKeyPath`       | `/log-subscriber/email-api-key`         | `/log-subscriber-test/email-api-key`      |
| `emailFromAddressPath`  | `/log-subscriber/email-from-address`    | `/log-subscriber-test/email-from-address` |
| `emailToAddressPath`    | `/log-subscriber/email-to-address`      | `/log-subscriber-test/email-to-address`   |

### `src/services/queue.ts` → `src/services/email.ts`

`sendSms` becomes `sendEmail`, POSTing `/v1/emails` on `emails-queue-api` with the payload shape from
`emails-queue-api/endpoints.rest`:

```
{ from, to: [toAddress], replyTo: from, sender: from, subject, text, html }
```

Auth stays `x-api-key`.

**X-Ray (revised 2026-08-04):** an earlier draft of this spec said `xrayCaptureHttps()` would be
preserved for the axios client and the SSM client wrapped in `xrayCapture` per the `bridge-api`
pattern. X-Ray has since been removed from this repo entirely (`5c2ae1b`), so neither applies. Both
clients are constructed bare, `src/utils/logging.ts` exports only `log` and `logError`, and
`Tracing: Active` is gone from the template. This is a log-subscriber-local decision, not a fleet
one — `bridge-api`, `emails-queue-api`, and `emails-queue-service` all still instrument with X-Ray,
so the `bridge-api` SSM-caching pattern referenced elsewhere in this spec still holds; only its
X-Ray wrapping does not.

The `contents.slice(0, 600)` Pinpoint truncation is deleted. It existed only because Pinpoint caps SMS
at 600 non-GSM characters.

### Message content

A CloudWatch console deep link is the primary value-add over the old SMS:

```
https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#logsV2:log-groups/log-group/${enc(logGroup)}/log-events/${enc(logStream)}
```

where `region` is Lambda's `AWS_REGION` and `enc` is the console's double-escaping:

```ts
const enc = (value: string): string => encodeURIComponent(value).replace(/%/g, '$25')
```

(so `/aws/lambda/foo` becomes `$252Faws$252Flambda$252Ffoo`, and a stream containing `[$LATEST]`
escapes correctly).

Revised 2026-08-04 after review; the original shape is noted where it changed.

- **Subject:** `` `${logGroup sans /aws/lambda/} — ${level}: ${first line of message}` ``, with
  ` (${n} events)` appended when `n > 1`. Originally just log group and level — but that made every
  alert from one function byte-identical, so mail clients threaded a new incident into last week's
  collapsed conversation, and a lock screen's ~35 characters showed no level and no error.
- **HTML body:** events first, each with ISO-8601 timestamp, level, an `(i of n)` counter when
  batched, and the message in a `white-space: pre-wrap` block; `<hr />` between events; log group,
  log stream, and the console link last. The pre-wrap block is load-bearing rather than cosmetic — a
  CloudWatch `message` field captures the whole multi-line entry, so a stack trace collapsed into one
  run-on paragraph under default HTML whitespace handling, making the most actionable content in the
  alert the least readable thing in it.
- **Text body:** same ordering. Metadata moved after the events because mail clients build the
  list-view preview from the first ~100 characters of the text part, and leading with the log stream
  and console link made every alert preview as an indistinguishable wall of URL.
- **From:** wrapped with a `Log Subscriber` display name, matching `bridge-api`'s `withDisplayName`,
  including its guard against double-wrapping an address that already carries one.
- **Size bound:** at most 20 events rendered and 4000 characters per message, each overflow reported
  in the body (`… and N more events`, `… truncated N characters`). Deleting the Pinpoint-era
  `slice(0, 600)` removed the only size bound in the system: a crash-looping Lambda can deliver
  hundreds of events with multi-KB stack traces in one gzipped payload, rendering a body past API
  Gateway's 10 MB request limit — a 413 that `retryCondition` does not retry and the handler
  swallows, losing the alert for precisely the incident that most needed one. The console link is
  the escape hatch for anything truncated.
- **HTTP timeout:** 10s on the axios instance. API Gateway's integration timeout is 29s and this
  Lambda's is 60s, so three unbounded retries would outlast the function — and a Lambda killed at its
  timeout never reaches the handler's `catch`, so the asynchronous subscription-filter invocation
  would be retried twice more by Lambda itself.

### The `logEvents[0]` batch bug

`extractLevelFromData` and `extractMessageFromData` currently read only `data.logEvents[0]`, so every
event after the first in a batch is silently dropped. Both are replaced by:

```ts
export interface ExtractedLogEvent {
  id: string
  level: string
  message: string
  timestamp: number
}

export const extractEventsFromData = (data: CloudWatchLogsDecodedData): ExtractedLogEvent[] =>
  data.logEvents.map((event) => ({
    id: event.id,
    level: (event.extractedFields?.level as string) ?? 'ERROR',
    message: (event.extractedFields?.message as string) ?? event.message ?? '',
    timestamp: event.timestamp,
  }))
```

The handler renders all of them into one email. This is the only behavior change beyond transport.

The `??` fallbacks were added in review (2026-08-04). `extractedFields` is populated only when the
subscription filter names fields, and CloudWatch's own `CONTROL_MESSAGE` health checks — emitted
whenever a subscription filter is created, i.e. on every subscribed service's stack update — carry
none, so the original cast rendered an email whose entire body was the literal string `undefined`.
The handler now also skips sending outright for `messageType === 'CONTROL_MESSAGE'` and for an empty
batch, the latter because `buildSubject` reads `events[0]`.

`getDataFromRecord` is unchanged. The handler keeps its existing `try`/`catch` that logs and swallows
send failures, so a delivery problem never fails the invocation.

### Tests

- `__tests__/unit/services/queue.test.ts` → `email.test.ts`, keeping the existing `msw` `http.post`
  interception. SSM is hand-mocked with `jest.mock('@aws-sdk/client-ssm')` rather than
  `aws-sdk-client-mock` — an earlier draft of this spec named that package, but it is not a
  dependency of this repo and was never added
- Coverage for: payload shape, `x-api-key` header, per-container SSM caching (client called once
  across repeated sends), the no-value throw, single- vs multi-event subject and body, and console
  link escaping for a log stream containing `[$LATEST]`
- `jest.setup-test-env.js` swaps the three `SMS_*` vars for `SSM_EMAIL_API_KEY_PATH`,
  `SSM_EMAIL_FROM_ADDRESS_PATH`, `SSM_EMAIL_TO_ADDRESS_PATH`, and `EMAILS_QUEUE_API_BASE_URL`
- `package.json` description updated ("forwards to SMS" → email)

## 2. `emails-queue-api` / `emails-queue-service` — break the feedback loop

Sending alerts by email makes log-subscriber depend on the very pipeline it monitors. Where the SMS
version had no such coupling — `sms-queue-api` and `sms-queue-service` define **zero**
`AWS::Logs::SubscriptionFilter` resources, so their failures were invisible to log-subscriber — the
email pipeline is extensively subscribed. Two of those subscriptions sit directly on log-subscriber's
send path and would form self-sustaining loops.

### The cycles

**Cycle A — enqueue.** `emails-queue-api/template.yaml:134-140` subscribes `PostEmailLogGroup` with
`FilterPattern: '[timestamp, uuid, level="ERROR", message]'`, and `post-email.ts:18` calls
`logError(error)` whenever the S3 upload or SQS enqueue fails. So: log-subscriber POSTs `/v1/emails` →
500 → `ERROR` line → filter matches → invokes log-subscriber → POSTs again → … Ratio is 1:1 per turn.

**Cycle B — delivery.** `emails-queue-service/template.yaml:116-122` subscribes `EmailsToSendLogGroup`.
The enqueue succeeds, then the SES send fails downstream (throttling, suppression list, bad
from-address) → `ERROR` → invokes log-subscriber → enqueues fine → fails again → … Slower, since it
round-trips through SQS, but more likely in practice, and **amplifying** rather than 1:1:
`emails-to-send-processor.ts` catches per record inside the batch loop, so N failing records emit N
`ERROR` lines and therefore N invocations on the next turn.

Neither cycle self-terminates; both run for as long as the underlying fault does.

> **Note (2026-08-02):** the amplification described for Cycle B changes once
> `project-analysis/implementation/specs/2026-08-01-emails-queue-service-message-loss.md` lands. That
> spec replaces the per-record catch with a fail-forward partial batch response, so a failing batch
> emits **one** `ERROR` line per attempt rather than N. It does not remove the cycle — the message now
> retries up to three times instead of being deleted, so one poison message yields up to three turns
> instead of one. The fix below is still required; only the multiplier changes.

### Fix

Delete exactly two resources:

- `emails-queue-api` — the `AWS::Logs::SubscriptionFilter` on `PostEmailLogGroup` (line 134)
- `emails-queue-service` — the `AWS::Logs::SubscriptionFilter` on `EmailsToSendLogGroup` (line 116)

Breaking the cycle at the source is preferred over a deny-list inside log-subscriber: it is structural
rather than runtime configuration, and it cannot drift out of sync with generated log group names.

**All 23 other email-repo subscriptions stay.** Only the outbound send path is circular:

| Log group                                        | Subscribed? | Why                                      |
| ------------------------------------------------ | ----------- | ---------------------------------------- |
| `emails-queue-api` `PostEmailLogGroup`           | **remove**  | log-subscriber POSTs `/v1/emails` here   |
| `emails-queue-service` `EmailsToSendLogGroup`    | **remove**  | SES send for that message                |
| `emails-queue-api` `PostBounceLogGroup`          | keep        | log-subscriber never calls `/v1/bounces` |
| `emails-queue-service` `EmailsToBounceLogGroup`  | keep        | bounce path, not the send path           |
| `emails-email-api` (22 filters)                  | keep        | account/email CRUD, not on the send path |
| `emails-inbound-service` `IncomingEmailLogGroup` | keep        | inbound SES receipt, not outbound        |

Verified no second-order coupling: `emails-to-send-processor.ts` imports only `services/s3` and
`services/ses`, so the send path never re-enters `emails-email-api`.

### The gap, and the alarm that must close it

Those two lambdas lose error alerting entirely, not just the self-referential kind. This is inherent —
an email announcing that email delivery is broken cannot arrive. Removing the subscriptions makes the
gap explicit rather than converting it into a runaway loop.

> **Status (2026-08-07): this prerequisite is deployed.** > `emails-queue-service` now has both FIFO DLQs with `RedrivePolicy` / `maxReceiveCount: 3`,
> `FunctionResponseTypes: [ReportBatchItemFailures]` on both event sources, and fail-forward handlers
> returning `SQSBatchResponse`. The DLQ alarms required below also exist —
> `DeadLetterQueueAlarmTopic` (SNS, direct `email` subscription to `AlertEmailAddress`) plus
> `EmailsToSendDeadLetterQueueAlarm` and `EmailsToBounceDeadLetterQueueAlarm` on
> `ApproximateNumberOfMessagesVisible > 0` (`dd06391`). Both send-path subscription filters are gone:
> `emails-queue-api`'s `PostEmailLogGroup` (`899348e`) and `emails-queue-service`'s
> `EmailsToSendLogGroup`. The bounce-path subscriptions were correctly retained in both repos, as the
> table above specifies. The message-loss spec's own header still reads "not implemented" and is
> stale.
>
> The implementation went beyond what was specified: the alarms use `Maximum` rather than `Sum` or
> `Average` (the metric is a gauge), and `TreatMissingData: ignore` rather than `notBreaching`, so an
> idle DLQ that stops publishing metrics keeps the alarm raised instead of silently clearing it.

**Prerequisite: `2026-08-01-emails-queue-service-message-loss.md` must ship first.** That spec gives
the send path retries and dead-letter queues. Until it does, removing `EmailsToSendLogGroupSubscription`
leaves outbound email with neither alerting _nor_ a failure record: `emails-to-send-processor.ts`
currently catches every error, logs it, and returns success, so SQS deletes the message. Doing this
spec first would move alerting onto a pipeline that silently discards the alerts.

**Required here, not optional later: a DLQ alarm.** The message-loss spec deliberately ships _without_
a CloudWatch alarm, and its stated justification is that `logError` already reaches the operator
through the `EmailsToSendLogGroup` subscription. **This spec deletes that subscription and therefore
invalidates that justification.** The alarm stops being redundant at exactly the moment the
subscription is removed, so closing the gap is this spec's responsibility, not a future nicety.

Add, in the same change that deletes the two subscriptions:

- an SNS topic with a direct email subscription — SNS delivers mail itself and never traverses
  `emails-queue-api`, so the cycle stays broken
- a CloudWatch alarm on `EmailsToSendDeadLetterQueue`'s `ApproximateNumberOfMessagesVisible > 0`,
  targeting that topic
- the same alarm on `EmailsToBounceDeadLetterQueue`, for symmetry

This is the fleet's first `AWS::CloudWatch::Alarm` and its first general-purpose SNS topic. The only
existing topic, `SmsInboundRawTopic` in `sms-queue-service`, routes inbound SMS and is not reusable.

### The inbound path, and why the to-address is load-bearing (added 2026-08-04, found in review)

The subscription table above classifies `emails-inbound-service`'s `IncomingEmailLogGroup` as "inbound
SES receipt, not outbound" and stops there. **That is the wrong axis.** The question is not whether a
log group sits on the _send_ path — it is whether an alert email can reach it, and an alert email is
itself mail addressed into a domain this fleet receives. `emails-inbound-service` takes delivery for
the whole domain (`template.yaml:69-70`), its log group is still subscribed (`:159-165`), and
`services/incoming-email.ts:21` calls `getAccount(defaultAccountId)` _outside_ the per-recipient
`try`, so any `emails-email-api` failure throws for every inbound message and logs `ERROR`.

Had the alert to-address been a mailbox on a fleet domain, that would close a self-sustaining loop:
alert → received inbound → processing throws → `ERROR` → subscribed → new alert.

**It does not, because `/log-subscriber/email-to-address` is an external (Gmail) mailbox.** A
delivered alert never enters `emails-inbound-service` at all. `emails-queue-service/src/services/ses.ts:28`
sends `SendRawEmailCommand` with no `Source` or `ReturnPath`, so a DSN for a bounced alert returns to
the `From` header — a verified fleet domain — and re-enters inbound processing. If that processing is
also failing, it emits one further alert, which goes to Gmail, is delivered, and terminates. One
extra alert per bounce.

**One caveat, and it needs two simultaneous faults** (corrected 2026-08-04 — an earlier revision
called this unconditionally bounded, which is wrong). The termination argument assumes the alert is
_delivered_. If the destination is hard-rejecting or on the SES suppression list at the same time as
inbound processing is erroring, then every alert bounces, every DSN re-enters inbound, and inbound
emits another alert that also bounces. That is a genuine cycle, not a bounded excursion. It requires
both faults at once, so it is a narrow window rather than the standing hazard a fleet-domain
destination would create — but "bounded" was too strong a word for it.

**This makes the to-address a load-bearing invariant, not a preference.** Pointing it at a fleet-domain
mailbox re-arms the loop. If that ever becomes desirable, drop `IncomingEmailLogGroupSubscription` and
set an explicit `Source`/`ReturnPath` on the send in the same change.

The broader lesson: choosing structural removal over a deny-list inside log-subscriber trades runtime
configuration for a static enumeration of every subscribed log group an alert can touch — and that
enumeration was wrong on its first attempt. The comment at `emails-queue-api/template.yaml:142-145`
asserting the send path is de-cycled is accurate only for the outbound direction.

After this, a failed outbound send is still invisible in the logs — by design — but lands in a DLQ that
raises an alarm over a channel independent of the pipeline that failed.

**Deploy checklist — the alarm is inert until these are done.** An SNS email subscription is created in
`PendingConfirmation`, and CloudFormation reports CREATE_COMPLETE regardless. An alarm firing against an
unconfirmed subscription notifies nobody, so skipping these leaves the gap open while looking closed:

1. Create the `ALERT_EMAIL_ADDRESS` repo secret **before** merging. The parameter has no default
   deliberately — an empty endpoint fails at deploy rather than silently deploying a topic that goes
   nowhere — so merging without it breaks the prod deploy.
2. After deploying each environment, click the confirmation link SNS emails to that address. Once per
   topic, so twice: test and prod.
3. Force a message into a DLQ in test and confirm the mail actually arrives.

**Honest limits of this alarm**, so it is not mistaken for a like-for-like replacement of the
subscription it succeeds:

- **Detection is 15–25 minutes, not seconds.** Three receive attempts against a 360s visibility timeout
  before the message dead-letters, plus SQS's 5-minute metric cadence. The log subscription alerted
  almost immediately.
- **It only catches failures that reach a DLQ.** An event source mapping that is disabled, a Lambda that
  fails to invoke at all, or a backlog piling up in the _main_ queue produce no dead-lettered message
  and therefore no alarm. This closes most of the send-path gap, not all of it.
- **Test-environment alarms page the operator too**, since one secret feeds both stacks — the same
  arrangement as log-subscriber's single `PHONE_NUMBER`, and the same human either way.
- **It is effectively one-shot until the DLQ is drained** (added 2026-08-04, found in review). Nothing
  consumes either dead-letter queue, and `TreatMissingData: ignore` deliberately holds the last real
  state, so once the alarm transitions to ALARM it stays there. A second, larger incident while it is
  still raised notifies nobody. `OKActions` now publish the clear to the same topic, so draining the
  queue is an observable act rather than silent housekeeping — but **draining it is load-bearing**,
  not optional tidying.

### Open: log-subscriber itself has no failure signal (raised 2026-08-04, NOT fixed)

The reviewer's strongest finding, left open for a decision rather than fixed unilaterally.

`log-subscriber` swallows every error by design (`log-group-processor.ts`), and its template defines
no alarm, no `OnFailure` destination, no DLQ, and no subscription on its own log group. So every
failure mode this migration introduces collapses to a `console.error` on a **successful** invocation:
Lambda's `Errors` metric stays at zero and nothing changes state anywhere. A missing SSM parameter in
one of the four region/account combinations, a stale or non-usage-plan API key (403, never reaches
the Lambda), or an `AccessDenied` on `ssm:GetParameter` all produce the same outcome — every alert
from that stack dropped indefinitely, silently.

This is not a regression; the SMS path had the same shape. What changed is that this work introduced
the fleet's first `AWS::CloudWatch::Alarm` + SNS pattern, applied it to `emails-queue-service`, and
left it off the service whose entire job is alerting. The runbook now warns about the twelve
parameters, but a runbook is a hope, not a control.

Two ways to close it, if wanted:

1. **Metric filter on its own log group → alarm → the existing SNS topic pattern.** Preferred: catches
   the `logError` output directly, needs no behavior change, and SNS delivers mail itself so it
   cannot re-enter the cycle.
2. **Rethrow after logging, plus an alarm on `Errors > 0`.** Simpler to reason about, but it changes
   the documented "a delivery problem never fails the invocation" guarantee, and subscription filters
   invoke asynchronously — so Lambda would retry the whole invocation twice more on every failure.

Deliberately deferred rather than added late in the review, since it is a new control with its own
failure modes and would ship without the adversarial review the rest of this work received.

### Unrelated finding, deliberately not fixed

`sms-queue-service/src/handlers/sqs-payload-processor.ts` carries the same swallow bug being fixed in
`emails-queue-service`: `catch (error) { logError(error) }` with no rethrow, so a failed alert SMS is
silently dropped today. It is not worth fixing on a path being decommissioned; recorded only so the
current alerting is not mistaken for reliable. Note that `sms-inbound-router.ts` in the same repo
deliberately does _not_ catch, with a comment explaining that errors must propagate for SNS retry and
the DLQ to work — the correct pattern was understood on the inbound side and never applied outbound.

## 3. `dbowland-batch` — zoo tour spin-down

Deleted:

- `src/handlers/zoo-tour-check.ts`, `src/services/sms.ts`, `src/services/zoo.ts`
- `__tests__/handlers/zoo-tour-check.test.ts`, `__tests__/services/sms.test.ts`,
  `__tests__/services/zoo.test.ts`, and the zoo fixtures in `__tests__/__mocks__.ts`
- From `src/services/dynamodb.ts`: `scanZooTours`, `setZooTour`, and the `ZooTour` / `ZooTourSettings`
  types. `scanLambdaCleanupProjects` stays.
- From `src/config.ts`: `zooSmsNumberOfThreads`, `zooStatusCheckNumberOfThreads`, `zooTourTable`,
  `smsApiKey`, `smsApiUrl`

Template: drop the `SmsApiKey` parameter, `ZooTourCheckLambda`, `ZooTourCheckLogGroup`,
`ZooTourCheckLogGroupSubscription`, `ZooTourLambdaInvokePermission`, `ZooTourTable`, and the
`smsApiUrl` / `zooTourSmsNumberOfThreads` / `zooTourStatusNumberOfThreads` / `zooTourTable` entries in
both `EnvironmentMap` branches. Pipeline drops the `SmsApiKey` override.

Two notes:

- **The `Api` resource stays.** `LambdaS3Cleanup` exposes `POST /s3-lambda-cleanup` on it in addition
  to its weekly schedule, so the REST API, custom domain, usage plan, and API key all survive the zoo
  tour removal.
- **`ZooTourTable` is deleted with its data.** `AWS::DynamoDB::Table` defaults to
  `DeletionPolicy: Delete`, so removing the resource drops the table. This is intended and
  irreversible; no `DeletionPolicy` change is made.

## 4. `dbowland-infrastructure`

### Archived repos' pipeline users

Remove `SmsQueueApiUser` (line 570) and `SmsQueueServiceUser` (line 594).

**Consequence this spec creates and should own:** it deliberately leaves the deployed `sms-queue-*`
stacks running to serve `food-api`'s OTP flow, while deleting the IAM users those repos' pipelines
authenticate as. Each user holds only `sts:AssumeRole` on `dbowland-pipeline`, so removing them
invalidates the access keys and the live stacks lose their CI deploy path. In practice archiving the
repos disables Actions anyway, and a manual redeploy can use any credential able to assume the same
role — but an emergency change to those stacks now needs credentials issued by hand. If that is
unwelcome, keep both users until the stacks are actually torn down; nothing else in this spec depends
on their removal.

### The identity pool is now inert

After the Pinpoint removal, `IdentityPool`, `IdentityPoolRoleAttachment`, `AuthenticatedRole` and
`UnauthenticatedRole` grant nothing to anyone. They are deliberately left standing: the evidence that
nothing consumes them is a grep of local checkouts, not of the AWS account, and a deployed client still
assuming the unauthenticated role would fail **silently** — a failed unauthenticated analytics call
produces no user-visible signal. Removing them is the obvious next cleanup, but it should follow an
account-side check rather than a repo-side one.

### Dead Pinpoint analytics

This is a _separate_ Pinpoint app from the one SMS uses — `sms-queue-service` provisions its own
`PinpointApplication` and `PinpointSms` channel in its own template. The app here is analytics-only and
has no consumer: `dbowland-ui` contains no analytics SDK, no Amplify, and no `mobiletargeting` calls.

- `template-east-1.yaml`: remove the `Pinpoint` resource and the `PinpointId` output. That empties
  `Outputs:`, so the block goes too.
- `template.yaml`: remove the `PinpointId` parameter and, from both `AuthenticatedRole` and
  `UnauthenticatedRole`, the `mobiletargeting` statement **and** the `mobileanalytics:PutEvents`
  statement (legacy Mobile Analytics, Pinpoint's deprecated predecessor, equally unused). Each role's
  `Policies` block is then empty and is removed entirely, leaving the trust policy and
  `PermissionsBoundary`. A Cognito identity-pool role with no inline policy is valid.
- `.github/workflows/pipeline.yaml`: delete all three "Query deployed us-east-1 infrastructure" steps
  and their `PINPOINT_ID` plumbing. The test deploys drop to
  `--parameter-overrides 'Environment=test'`; the prod deploy's `--parameter-overrides` becomes empty
  and is removed.

**`template-east-1.yaml` itself is retained.** It also provisions `LambdaBucket`
(`dbowland-lambda-east-1` / `-test`), the SAM artifacts bucket used by `log-subscriber`,
`dbowland-batch`, and the two archived repos' pipelines, and referenced by `dbowland-batch`'s
`S3CrudPolicy` and by `playhouse/cleanup-old-lambdas.ts`.

**Ordering:** `PinpointId` is consumed only as a `!Sub` string inside an IAM `Resource` ARN — there is
no CloudFormation cross-stack import — so the two templates have no deploy-order dependency. But the
template and workflow edits must land in the same commit: if the pipeline still passes
`PinpointId=…` after the parameter is gone, `sam deploy` fails on an unknown parameter.

**Irreversible:** deleting `AWS::Pinpoint::App` discards any collected endpoint/analytics data.
Confirmed intended.

## 5. `dbowland-ui` — portfolio copy

Approach **(a)**: keep the SMS work represented in past tense. Only the present-tense claims that
become false are corrected.

- `src/components/projects-table/index.tsx` "Other" card, Objectives — "…a log subscriber that watches
  CloudWatch for errors and **texts me** when something goes wrong" → emails.
- Same card, Lessons — "AWS Pinpoint **powers** the SMS delivery" → past tense, framing the SMS
  service as built and since retired.

Unchanged: both `sms-queue-api` / `sms-queue-service` source links (archived GitHub repos stay
publicly browsable), `'Pinpoint'` in `src/data/resume.ts:124`, and the Choosee card's mention of SMS
messaging as something the project drew on — all still accurate as history.

## 6. `playhouse`

Remove the four `sms-queue-api` / `sms-queue-api-test` / `sms-queue-service` / `sms-queue-service-test`
prefix blocks from `cleanup-old-lambdas.ts:76-97`.

## Sequencing

No cross-stack imports connect these repos, so most ordering is free. One constraint is **hard**:

1. **`emails-queue-api` and `emails-queue-service` must deploy before log-subscriber cuts over to
   email.** If log-subscriber starts sending email while those two subscription filters are still in
   place, both feedback cycles are live from that moment. Deploying the subscription removals first is
   safe on its own — until log-subscriber switches transports, it changes nothing except that two log
   groups stop alerting. **Done 2026-08-07.**
2. **`log-subscriber` second.** Create the three SSM parameters in both environments before deploying;
   verify a real alert arrives in test before promoting to prod, since error alerting is dark until it
   works.

   Create them as `SecureString` under the **default `alias/aws/ssm` key**. The role grants only
   `ssm:GetParameter`, with no `kms:Decrypt` — that is deliberate and matches `bridge-api`, which runs
   this exact pattern in production, because the AWS-managed key's policy permits decryption when the
   call arrives via SSM. A **customer-managed** key would not, and the role would need an explicit
   `kms:Decrypt`. Get this wrong and nothing tells you: the handler swallows send failures by design,
   so alerting simply stays dark.

3. `dbowland-batch`, `dbowland-infrastructure`, `dbowland-ui`, `playhouse` in any order afterward.

`dbowland-infrastructure`'s template and pipeline edits must be one atomic commit (see above).

## Manual steps outside the repos

Nothing in any repo can do these, and each fails silently or noisily if skipped.

**Before merging**

- **Delete the access keys on `SmsQueueApiUser` and `SmsQueueServiceUser`.** `AWS::IAM::User` deletion
  returns `DeleteConflict: Cannot delete entity, must delete access keys first` for keys
  CloudFormation did not create, and neither template defines a single `AWS::IAM::AccessKey` — every
  pipeline user in the repo holds keys minted by hand and pasted into GitHub secrets. Skipping this
  does not merely fail the deploy: the stack update rolls back, taking the Pinpoint removal and the
  Cognito policy cleanup with it, and **every subsequent deploy of `dbowland-infrastructure` fails the
  same way** until the keys are removed manually. Safe to do at any time before the merge — the two
  archived repos' pipelines lose the ability to deploy, but their stacks stay up untouched and nothing
  redeploys them.

  ```bash
  for u in SmsQueueApiUser SmsQueueServiceUser; do
    aws iam list-access-keys --user-name "$u" \
      --query 'AccessKeyMetadata[].AccessKeyId' --output text \
      | xargs -n1 -I{} aws iam delete-access-key --user-name "$u" --access-key-id {}
  done
  ```

- **Delete the EventBridge rule that drives the zoo tour check** — moved here from "after deploying",
  because after is too late.

  **It is not template-owned, despite appearances.** `ZooTourCheckLambda`'s only `Events` entry was
  `ApiKey: Type: Api`; it never had a `Type: Schedule`. Its sibling `LambdaS3Cleanup`
  (`dbowland-batch/template.yaml:98`) _does_ — SAM generates an implicit `AWS::Events::Rule` for that
  one, which is why the file looks like it owns a schedule. No template in the fleet declares an
  `AWS::Events::Rule`, and `scheduler-service` declares none either. The decisive tell is
  `ZooTourLambdaInvokePermission`'s `SourceArn: arn:aws:events:…:rule/*` — a SAM-generated schedule
  comes with a permission scoped to that rule's ARN, so a hand-written wildcard exists precisely
  because the rule is created outside the template and had no ARN to reference.

  **The consequence depends on what the rule targets, which is account state:**

  - **Target = `scheduler-service`** (generic dispatcher, POSTs the URL in its event payload): after
    `/check-zoo-tour-status` is removed, every tick 403s, exhausts retries, and logs `ERROR`.
    `scheduler-service` is subscribed to `log-subscriber` (`template.yaml:83-89`,
    `src/handlers/scheduled-event.ts:32`), so that **emails a false alert every tick, forever** —
    landing exactly while the new email alerting is being validated.
  - **Target = the zoo Lambda directly** (what the `events.amazonaws.com` invoke permission suggests):
    EventBridge invokes a deleted target, producing a silent `FailedInvocations` metric and no email.

  Delete it either way — a rule firing at a target that no longer exists is junk regardless, and the
  noisier of the two branches is the one that cannot be detected without looking.

  ```bash
  aws events list-rules --query 'Rules[].{Name:Name,Schedule:ScheduleExpression}' --output table
  # confirm which branch applies before deleting:
  aws events list-targets-by-rule --rule <name> --query 'Targets[].Arn'
  aws events remove-targets --rule <name> --ids <target-ids>
  aws events delete-rule --name <name>
  ```

- Create the `ALERT_EMAIL_ADDRESS` repo secret on `emails-queue-service`. The parameter has no default,
  so the prod deploy fails without it.
- **Mint an `emails-queue-api` API key for `log-subscriber` and add it to that API's usage plan**,
  then store it as the `email-api-key` parameter below. No repo in the fleet declares an
  `AWS::ApiGateway::ApiKey` or `UsagePlanKey` resource — every consumer's key is created by hand — so
  nothing in CloudFormation will do this for you. A key that exists but is not a member of the usage
  plan returns 403 from API Gateway, which never reaches the Lambda, produces no `ERROR` log, and is
  therefore invisible.
- **Create twelve `log-subscriber` SSM parameters**, as `SecureString` under the default
  `alias/aws/ssm` key. Not six — the stack deploys to **two regions in two accounts**
  (`pipeline.yaml:87,98,233,244,288,298` and `scripts/deploy.sh:21,32`), SSM parameters are regional,
  and the IAM policy is scoped to `arn:aws:ssm:${AWS::Region}:...`. A missing parameter is not a loud
  failure: `GetParameter` throws, the handler's catch swallows it, and every alert from that region is
  dropped with no signal anywhere. (`bridge-api` is cited as the pattern for the SSM shape but deploys
  to one region only, so the analogy silently drops this dimension.)

  | Account | Region    | Parameters                                                                                                               |
  | ------- | --------- | ------------------------------------------------------------------------------------------------------------------------ |
  | test    | us-east-1 | `/log-subscriber-test/email-api-key`, `/log-subscriber-test/email-from-address`, `/log-subscriber-test/email-to-address` |
  | test    | us-east-2 | same three                                                                                                               |
  | prod    | us-east-1 | `/log-subscriber/email-api-key`, `/log-subscriber/email-from-address`, `/log-subscriber/email-to-address`                |
  | prod    | us-east-2 | same three                                                                                                               |

**After deploying**

- **Confirm the SNS subscription in each environment before proceeding** — this is a gate, not a
  checklist item. CloudFormation reports `CREATE_COMPLETE` while the subscription sits in
  `PendingConfirmation`, so between deploying `emails-queue-service` and clicking the link the send
  path has neither log alerting nor DLQ notification.

**Housekeeping**

- **Keep the alert to-address off any fleet domain.** See "The inbound path" in section 2 — this is a
  correctness invariant, not a preference.
- Old `sms-queue-api` / `sms-queue-service` Lambda artifacts in `dbowland-lambda-east-1{,-test}` no
  longer have a cleaner, since `playhouse` dropped those prefixes while the stacks stay deployed.
  Bounded — the repos are archived, so nothing new is uploaded — and cost noise rather than a defect,
  but it is the one place the "stacks stay deployed" carve-out was not honored. Delete the prefixes by
  hand if it matters.
- Delete the now-unreferenced GitHub secrets: `TESTING_SMS_API_KEY` and `PROD_SMS_API_KEY` on both
  `log-subscriber` and `dbowland-batch`, and `PHONE_NUMBER` on `log-subscriber`.

## Risks

| Risk                                                                | Mitigation                                                                                   |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| SSM parameters not created before deploy → alerting silently broken | Create all three parameters in both environments first; verify in test before prod           |
| Alert feedback loop between log-subscriber and the email pipeline   | Remove the two send-path subscription filters, deployed **before** log-subscriber cuts over  |
| Email-pipeline failures no longer alert                             | DLQ alarm → SNS → direct email, **required in the same change** as the subscription removals |
| `ZooTourTable` data loss                                            | Intended and confirmed                                                                       |
| Pinpoint analytics data loss                                        | Intended and confirmed; app is dead                                                          |
| Pipeline passes a removed CFN parameter                             | Template + workflow land in one commit                                                       |
| `food-api` OTP breakage                                             | Not possible — deployed `sms-queue-*` stacks are untouched, and its Pinpoint app is its own  |
