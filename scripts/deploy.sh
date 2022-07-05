#!/usr/bin/env bash

# Stop immediately on error
set -e

if [[ -z "$1" ]]; then
  $(./scripts/assumeDeveloperRole.sh)
fi

if [[ -z "$PHONE_NUMBER" ]]; then
  echo "Variable PHONE_NUMBER not defined"
  exit 1
fi

# Build from template

SAM_TEMPLATE=template.yaml
sam build --template ${SAM_TEMPLATE} --use-container -e NODE_ENV=production

# Deploy build lambda to east-1

SMS_API_KEY=$(aws apigateway get-api-key --api-key l3q9ffyih6 --include-value --region us-east-1 | jq -r .value)
TESTING_CLOUDFORMATION_EXECUTION_ROLE="arn:aws:iam::$AWS_ACCOUNT_ID:role/dbowland-cloudformation-test"
TESTING_STACK_NAME=log-subscriber-test
sam deploy --stack-name ${TESTING_STACK_NAME} \
           --capabilities CAPABILITY_IAM \
           --region us-east-1 \
           --s3-bucket dbowland-lambda-east-1-test \
           --s3-prefix log-subscriber-test \
           --no-fail-on-empty-changeset \
           --role-arn ${TESTING_CLOUDFORMATION_EXECUTION_ROLE} \
           --parameter-overrides "Environment=test PhoneNumber=$PHONE_NUMBER SmsApiKey=$SMS_API_KEY"

# Deploy to east-2

sam deploy --stack-name ${TESTING_STACK_NAME} \
           --capabilities CAPABILITY_IAM \
           --region us-east-2 \
           --s3-bucket dbowland-lambda-east-2-test \
           --s3-prefix log-subscriber-test \
           --no-fail-on-empty-changeset \
           --role-arn ${TESTING_CLOUDFORMATION_EXECUTION_ROLE} \
           --parameter-overrides "Environment=test PhoneNumber=$PHONE_NUMBER"
