// Emails Queue API

export const emailsQueueApiBaseUrl = process.env.EMAILS_QUEUE_API_BASE_URL as string
export const ssmEmailApiKeyPath = process.env.SSM_EMAIL_API_KEY_PATH as string
export const ssmEmailFromAddressPath = process.env.SSM_EMAIL_FROM_ADDRESS_PATH as string
export const ssmEmailToAddressPath = process.env.SSM_EMAIL_TO_ADDRESS_PATH as string

// AWS

export const region = process.env.AWS_REGION as string
