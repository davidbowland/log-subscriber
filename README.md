# Lambdas for CloudWatch Logs

This is a lambda meant to subscribe to CloudWatch Log Groups.

**This project deploys to two regions: `us-east-1` and `us-east-2`.** It is the only repo in the fleet that does. Both the pipeline and `scripts/deploy.sh` run the deploy twice, once per region, against per-region artifact buckets. A change is not fully released until both have succeeded, and the `region` in the credentials boilerplate below only sets a default for ad-hoc CLI calls — it does not determine where this project deploys.

## Setup

The `developer` role is required to deploy this project.

### Node / NPM

1. [Node](https://nodejs.org/en/)
1. [NPM](https://www.npmjs.com/)

### AWS Credentials

To run locally, [AWS CLI](https://aws.amazon.com/cli/) is required in order to assume a role with permission to update resources. Install AWS CLI with:

```brew
brew install awscli
```

If file `~/.aws/credentials` does not exist, create it and add a default profile:

```toml
[default]
aws_access_key_id=<YOUR_ACCESS_KEY_ID>
aws_secret_access_key=<YOUR_SECRET_ACCESS_KEY>
region=us-east-2
```

If necessary, generate a [new access key ID and secret access key](https://docs.aws.amazon.com/general/latest/gr/aws-sec-cred-types.html#access-keys-and-secret-access-keys).

Add a `developer` profile to the same credentials file:

```toml
[developer]
role_arn=arn:aws:iam::<account number>:role/developer
source_profile=default
mfa_serial=<YOUR_MFA_ARN>
region=us-east-2
```

If necessary, retrieve the ARN of the primary MFA device attached to the default profile:

```bash
aws iam list-mfa-devices --query 'MFADevices[].SerialNumber' --output text
```

## Developing Locally

### Unit Tests

[Jest](https://jestjs.io/) tests are run automatically on commit and push. If the test coverage threshold is not met, the push will fail. See `jest.config.ts` for coverage threshold.

Manually run tests with:

```bash
npm run test
```

### Prettier / Linter

Both [Prettier](https://prettier.io/) and [ESLint](https://eslint.org/) are executed on commit. Manually prettify and lint code with:

```bash
npm run lint
```

### Testing the Deployed Subscriber

The stack includes a test emitter lambda whose only job is to write one `ERROR` line. Its log group is
subscribed to the subscriber, so invoking it exercises the whole alert path — subscription filter,
gzipped envelope, rendering, and delivery through `emails-queue-api`.

Invoke it from the AWS console:

| Environment | Function                      |
| ----------- | ----------------------------- |
| prod        | `log-subscriber-emitter`      |
| test        | `log-subscriber-test-emitter` |

The invoke returns the message it logged, e.g. `log-subscriber test alert emitted at 2026-08-07T14:32:07.412Z`.
That same string appears in the subject of the alert email, which should arrive within a minute or two.
Each invocation embeds a fresh timestamp so successive tests do not thread together in the mail client.

Whatever payload you pass is appended to that log line, which is how you force particular content
into the alert — a multi-line stack trace to check `pre-wrap` rendering, a very long string to check
truncation at 4000 characters, or `<script>` to check HTML escaping:

```json
"Error: boom\n    at handler (/var/task/index.js:1:1)\n    at Runtime.handleOnceNonStreaming"
```

If no email arrives, the subscriber's own log group (`/aws/lambda/log-subscriber`) records what it
received and why it stopped.

### Deploying to Production

When a pull request is merged into `master`, the lambda code is transpiled to commonjs and then deployed. Feature branches are also deployed but are given unique resources.

## Additional Documentation

- [AWS Lambda](https://aws.amazon.com/lambda/)

- [ESLint](https://eslint.org/)

- [Jest](https://jestjs.io/)

- [Prettier](https://prettier.io/)
