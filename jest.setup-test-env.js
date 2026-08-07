// AWS

process.env.AWS_REGION = 'us-east-2'

// Emails Queue API

process.env.EMAILS_QUEUE_API_BASE_URL = 'https://emails-queue-api.bowland.link'
process.env.SSM_EMAIL_API_KEY_PATH = '/log-subscriber-test/email-api-key'
process.env.SSM_EMAIL_FROM_ADDRESS_PATH = '/log-subscriber-test/email-from-address'
process.env.SSM_EMAIL_TO_ADDRESS_PATH = '/log-subscriber-test/email-to-address'
