import axios, { AxiosResponse } from 'axios'

import { smsApiKey, smsApiUrl, smsToPhoneNumber } from '../config'
import { SMSMessage } from '../types'
import { xrayCaptureHttps } from '../utils/logging'

xrayCaptureHttps()
const api = axios.create({
  baseURL: smsApiUrl,
  headers: { 'x-api-key': smsApiKey },
})

/* Emails */

const convertContentsToJson = (contents: string): SMSMessage => ({
  contents: contents.slice(0, 600), // Pinpoint restricts SMS to 600 non-GSM characters and we have to make assumptions
  messageType: 'TRANSACTIONAL',
  to: smsToPhoneNumber,
})

const sendRawSms = (body: SMSMessage): Promise<AxiosResponse> => api.post('/messages', body, {})

export const sendSms = (contents: string): Promise<AxiosResponse> => sendRawSms(convertContentsToJson(contents))
