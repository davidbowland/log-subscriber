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

# Only install production modules
export HUSKY=0
export NODE_ENV=production

# Build the project
SAM_TEMPLATE=template.yaml
sam build --template ${SAM_TEMPLATE}

# Start the service locally
export SMS_API_KEY=$(aws apigateway get-api-key --api-key l3q9ffyih6 --include-value --region us-east-1 | jq -r .value)
export SMS_API_URL='https://sms-queue-api.bowland.link/v1'
sam local invoke --event events/event-subscription.json --parameter-overrides "Environment=test PhoneNumber=$PHONE_NUMBER SmsApiKey=$SMS_API_KEY" --log-file local.log
