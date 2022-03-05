
import axios from 'axios'
import axiosRetry from 'axios-retry'

// Axios

axiosRetry(axios, { retries: 3 })

// SMS Queue API

export const smsApiKeyName = process.env.SMS_API_KEY_NAME as string
export const smsApiUrl = process.env.SMS_API_URL as string
export const smsToPhoneNumber = process.env.SMS_TO_PHONE_NUMBER as string
