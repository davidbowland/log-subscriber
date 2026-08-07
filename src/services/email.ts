import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm'
import axios, { AxiosError, AxiosResponse } from 'axios'
import axiosRetry, { exponentialDelay, isNetworkError } from 'axios-retry'

import { emailsQueueApiBaseUrl, ssmEmailApiKeyPath, ssmEmailFromAddressPath, ssmEmailToAddressPath } from '../config'
import { EmailMessage } from '../types'

// API Gateway's integration timeout is 29s and this Lambda's is 60s, so three unbounded retries
// would outlast the function. A Lambda killed at its timeout never reaches the handler's catch, and
// subscription filters invoke asynchronously -- so Lambda would then retry the whole invocation
// twice more, turning one hung request into three minutes of blocked compute and a possible
// duplicate alert. Ten seconds keeps the entire retry budget inside the function timeout.
const REQUEST_TIMEOUT_MS = 10000

const api = axios.create({
  baseURL: emailsQueueApiBaseUrl,
  timeout: REQUEST_TIMEOUT_MS,
})

// Retries must be attached to THIS instance. axios-retry registers interceptors on whatever it is
// handed, and an instance from axios.create() does not inherit those registered on the default
// export -- configuring the default here would silently do nothing.
axiosRetry(api, {
  retries: 3,
  // The stock retryCondition treats POST as non-idempotent and refuses to retry it, so one
  // transient 502 or throttle would drop an alert for good. Delivering the same alert twice is
  // harmless; losing the only notice of a production error is not.
  retryCondition: (error: AxiosError): boolean =>
    isNetworkError(error) ||
    error.response === undefined ||
    error.response.status >= 500 ||
    error.response.status === 429,
  retryDelay: exponentialDelay,
})

const ssm = new SSMClient({})

/* SSM */

// Cached per container so each parameter is read at most once per warm Lambda
const parameterCache = new Map<string, string>()

const getParameter = async (path: string): Promise<string> => {
  const cached = parameterCache.get(path)
  if (cached !== undefined) {
    return cached
  }

  const response = await ssm.send(new GetParameterCommand({ Name: path, WithDecryption: true }))
  const value = response.Parameter?.Value
  if (value === undefined) {
    throw new Error(`SSM parameter ${path} has no value`)
  }
  parameterCache.set(path, value)
  return value
}

/* Emails */

const DISPLAY_NAME = 'Log Subscriber'

// The SSM parameter holds a bare address, so the display name lives here rather than in ops config.
// A value that already carries one (`Name <addr>`) is passed through untouched -- wrapping it again
// would produce a nested, unsendable address the moment someone edits the parameter by hand.
const withDisplayName = (address: string): string => (address.includes('<') ? address : `${DISPLAY_NAME} <${address}>`)

// INVARIANT: the address in ssmEmailToAddressPath must NOT be on a domain this fleet receives mail
// for. emails-inbound-service takes delivery for the whole domain and its log group is subscribed to
// this very function, so a fleet-domain destination closes a self-sustaining loop: alert -> received
// inbound -> inbound processing throws -> ERROR -> subscription -> alert. An external mailbox breaks
// it, because a delivered alert never re-enters the fleet at all. See section 2 of
// docs/superpowers/specs/2026-08-01-sms-decommission-design.md.
export const sendEmail = async (message: EmailMessage): Promise<AxiosResponse> => {
  const [apiKey, fromAddress, toAddress] = await Promise.all([
    getParameter(ssmEmailApiKeyPath),
    getParameter(ssmEmailFromAddressPath),
    getParameter(ssmEmailToAddressPath),
  ])

  return api.post(
    '/v1/emails',
    {
      from: withDisplayName(fromAddress),
      html: message.html,
      replyTo: fromAddress,
      sender: fromAddress,
      subject: message.subject,
      text: message.text,
      to: [toAddress],
    },
    { headers: { 'x-api-key': apiKey } },
  )
}
