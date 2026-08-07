# Test Emitter — Design

- **Date:** 2026-08-07
- **Status:** Design approved; implementing
- **Repos touched:** `log-subscriber`

## Context

`log-subscriber` has unit tests, but nothing exercises the deployed system: gzip decode →
subscription filter field extraction → email render → `emails-queue-api` delivery. Verifying the
alert path today means waiting for a real error in some other service, which is both slow and a bad
time to discover that alerting is broken.

The path is also newly rewritten. The SMS-to-email migration
(`2026-08-01-sms-decommission-design.md`) replaced the delivery mechanism, the subject format, and
the message body wholesale. That change is committed but not deployed anywhere, so the first
production error after deploy is currently the first end-to-end test.

## Goal

An on-demand way to prove the whole chain works, in whichever environment it is pointed at, without
waiting for a real failure.

## Approach

Add a second Lambda to this repo's stack whose entire job is to emit one `ERROR` log line, and
subscribe `LogGroupSubscriber` to its log group using the same subscription filter every other repo
uses. Invoking it from the AWS console should produce an alert email.

The emitter lives in `log-subscriber` rather than in a sibling repo because the thing under test is
this repo's stack; a test fixture that ships and versions with its subject cannot drift away from it.

### Not chosen

- **A `sam local invoke` harness.** Exercises the handler but not the subscription filter, the
  gzipped CloudWatch envelope, or IAM — which is where the interesting failures live.
- **Deliberately breaking a real service to generate an error.** Obviously worse.

## Components

### `src/handlers/test-emitter.ts`

Exports `testEmitterHandler`. No endpoints. It calls `logError` once and returns the emitted string
so the console's invoke output shows exactly what to expect in the mail.

The message embeds an ISO timestamp. This is load-bearing, not decoration: `buildSubject` derives
the subject line from the first 80 characters of the message, and mail clients thread on identical
subjects. A constant message would collapse every test run into one thread, hiding the newly arrived
alert inside a folded conversation — the precise thing the test needs to observe.

The invoke payload is appended to that same log line, letting a tester drive chosen content into the
alert rather than only checking that one arrives: a multi-line stack trace exercises the `pre-wrap`
rendering, a long string exercises `MAX_MESSAGE_LENGTH` truncation, `<script>` exercises
`escapeHtml`. It goes to `console.error` as a second argument rather than being concatenated, so the
runtime's own formatting applies and the payload still lands inside the single `message` field the
subscription filter extracts — not in a separate log event that the filter would treat as an
unrelated alert.

### `template.yaml`

Three resources:

| Resource                          | Purpose                                                                                                                                                                                                     |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TestEmitter`                     | `AWS::Serverless::Function`, no events. Named `${project}-emitter`, so `log-subscriber-emitter` in prod and `log-subscriber-test-emitter` in test. `AWSLambdaBasicExecutionRole` only — it touches nothing. |
| `TestEmitterLogGroup`             | 30-day retention, matching `LogGroupLambdaLogGroup`.                                                                                                                                                        |
| `TestEmitterLogGroupSubscription` | `AWS::Logs::SubscriptionFilter` with `FilterPattern: '[timestamp, uuid, level="ERROR", message]'`, destination `LogGroupSubscriber`.                                                                        |

The filter pattern is copied verbatim from the sibling repos (`scheduler-service`, `jokes-api`, et
al.). That matters: matching their pattern is what makes this a test of the real configuration
rather than of a bespoke one. It parses the Node.js text-format log line
`<timestamp>\t<requestId>\tERROR\t<message>` into the `extractedFields` that
`extractEventsFromData` reads.

`TestEmitterLogGroupSubscription` declares `DependsOn: CloudWatchLambdaInvokePermission`. The
existing permission already covers `log-group:*:*`, but nothing in the subscription's properties
references it, so without the explicit dependency CloudFormation is free to create the filter first
and fail.

## Environments

The emitter deploys in both `prod` and `test` — no CloudFormation condition. The prod path is the
one worth smoke-testing, since prod has its own SSM parameters and its own `emails-queue-api` base
URL; a test-only emitter can verify neither. An idle Lambda and one log group per region cost
effectively nothing.

Consequence to accept: invoking the prod emitter sends a real alert to the real alert address. That
is the feature.

## Feedback loop safety

`LogGroupSubscriber`'s own log group (`LogGroupLambdaLogGroup`) has no subscription filter, so an
alert generated about the emitter cannot generate an alert about itself. The emitter's log group is
the only new subscribed group, and the emitter logs nothing when idle.

Creating the subscription filter causes CloudWatch to deliver one `CONTROL_MESSAGE`. The handler
already skips those, so the deploy itself does not send mail.

## Testing

A unit test for `testEmitterHandler` under `__tests__/unit/handlers/`, with the system clock frozen
so the emitted string is asserted exactly. It verifies `logError` is called once, that the returned
message matches what was logged, that successive invocations produce distinct messages, and that
object, string, array, and absent payloads all reach the log line unchanged.

The real verification is manual and is what the whole change exists for: invoke the function in the
console, confirm the email arrives, confirm its console link opens the right log stream.

## Documentation

A short section in `README.md` under Developing Locally recording the function names and what a
successful test looks like.
