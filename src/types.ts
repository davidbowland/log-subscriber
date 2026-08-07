export * from 'aws-lambda'

export interface EmailMessage {
  subject: string
  text: string
  html: string
}
