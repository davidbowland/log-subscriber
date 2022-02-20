import axios, { AxiosResponse } from 'axios'

import { smsApiKeyName, smsApiUrl, smsToPhoneNumber } from '../config'
import { getApiKey } from '../services/api-keys'
import { SMSMessage } from '../types'

const api = axios.create({
  baseURL: smsApiUrl,
})

/* Emails */

const convertContentsToJson = (contents: string): SMSMessage => ({
  to: smsToPhoneNumber,
  contents,
  messageType: 'TRANSACTIONAL',
})

export const sendSms = (contents: string): Promise<AxiosResponse> =>
  Promise.resolve(convertContentsToJson(contents)).then(exports.sendRawSms)

export const sendRawSms = (body: SMSMessage): Promise<AxiosResponse> =>
  getApiKey(smsApiKeyName).then((queueApiKey) =>
    api.post('/messages', body, {
      headers: {
        'x-api-key': queueApiKey,
      },
    })
  )
