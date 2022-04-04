import axios, { AxiosResponse } from 'axios'

import { smsApiKey, smsApiUrl, smsToPhoneNumber } from '../config'
import { SMSMessage } from '../types'

const api = axios.create({
  baseURL: smsApiUrl,
  headers: { 'x-api-key': smsApiKey },
})

/* Emails */

const convertContentsToJson = (contents: string): SMSMessage => ({
  contents,
  messageType: 'TRANSACTIONAL',
  to: smsToPhoneNumber,
})

export const sendSms = (contents: string): Promise<AxiosResponse> => exports.sendRawSms(convertContentsToJson(contents))

export const sendRawSms = (body: SMSMessage): Promise<AxiosResponse> => api.post('/messages', body, {})
