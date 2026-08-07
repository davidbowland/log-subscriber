import { region } from '../config'
import { sendEmail } from '../services/email'
import { CloudWatchLogsDecodedData, CloudWatchLogsEvent, CloudWatchLogsHandler, EmailMessage } from '../types'
import { log, logError } from '../utils/logging'
import { ExtractedLogEvent, extractEventsFromData, getDataFromRecord } from '../utils/message-processing'

/* CloudWatch console link */

// The console escapes the fragment a second time when it parses the URL, so every `%` produced by
// encodeURIComponent has to arrive already encoded as `$25` -- `/aws/lambda/foo` becomes
// `$252Faws$252Flambda$252Ffoo`. Encoding only once lands on the log group list instead of the stream.
const encodeForConsole = (value: string): string => encodeURIComponent(value).replace(/%/g, '$25')

const buildConsoleLink = (logGroup: string, logStream: string): string =>
  `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#logsV2:log-groups/log-group/${encodeForConsole(logGroup)}/log-events/${encodeForConsole(logStream)}`

/* Message rendering */

const HTML_ESCAPES: { [key: string]: string } = {
  '"': '&quot;',
  '&': '&amp;',
  "'": '&#39;',
  '<': '&lt;',
  '>': '&gt;',
}

const escapeHtml = (value: string): string => `${value}`.replace(/["&'<>]/g, (character) => HTML_ESCAPES[character])

// Mail clients thread messages with identical subjects, so a subject of only the log group would
// bury a new 3am incident inside last week's collapsed conversation. The first line of the message
// makes each alert distinct and survives the ~35 characters a lock screen shows, which is also why
// the redundant `/aws/lambda/` prefix goes.
const SUBJECT_MESSAGE_LENGTH = 80

const firstLine = (message: string): string => message.split('\n')[0].trim()

const buildSubject = (logGroup: string, events: ExtractedLogEvent[]): string => {
  const summary = firstLine(events[0].message).slice(0, SUBJECT_MESSAGE_LENGTH)
  const count = events.length > 1 ? ` (${events.length} events)` : ''
  return `${logGroup.replace(/^\/aws\/lambda\//, '')} — ${events[0].level}${summary ? `: ${summary}` : ''}${count}`
}

// pre-wrap, because a CloudWatch `message` field captures the whole multi-line entry -- a stack
// trace collapses into one run-on paragraph under default HTML whitespace handling, making the most
// actionable content in the alert the least readable thing in it.
const MESSAGE_STYLE = 'white-space: pre-wrap; font-family: monospace; margin: 0'

const counter = (index: number, total: number): string => (total > 1 ? ` (${index + 1} of ${total})` : '')

// Deleting the old `contents.slice(0, 600)` removed the only size bound in the system along with the
// Pinpoint limit that motivated it. A Lambda in a crash loop can deliver hundreds of events with
// multi-KB stack traces in one gzipped payload, which would render into a body past API Gateway's
// 10 MB request limit -- a 413 that retryCondition does not retry and the handler swallows, losing
// the alert for exactly the incident that most needed one. The console link is the escape hatch for
// anything truncated here.
const MAX_EVENTS = 20
const MAX_MESSAGE_LENGTH = 4000

const truncateMessage = (message: string): string =>
  message.length > MAX_MESSAGE_LENGTH
    ? `${message.slice(0, MAX_MESSAGE_LENGTH)}\n… truncated ${message.length - MAX_MESSAGE_LENGTH} characters`
    : message

const overflowNote = (total: number): string => (total > MAX_EVENTS ? `… and ${total - MAX_EVENTS} more events` : '')

const buildHtml = (data: CloudWatchLogsDecodedData, events: ExtractedLogEvent[], consoleLink: string): string => {
  const shown = events.slice(0, MAX_EVENTS)
  const overflow = overflowNote(events.length)
  return [
    ...shown.flatMap((event, index) => [
      index > 0 ? '<hr />' : '',
      `<p><strong>${new Date(event.timestamp).toISOString()} ${escapeHtml(event.level)}</strong>${counter(index, events.length)}</p>`,
      `<pre style="${MESSAGE_STYLE}">${escapeHtml(truncateMessage(event.message))}</pre>`,
    ]),
    overflow ? `<p><em>${escapeHtml(overflow)}</em></p>` : '',
    '<hr />',
    '<p>',
    `<strong>Log group:</strong> ${escapeHtml(data.logGroup)}<br />`,
    `<strong>Log stream:</strong> ${escapeHtml(data.logStream)}<br />`,
    `<a href="${escapeHtml(consoleLink)}">View in the CloudWatch console</a>`,
    '</p>',
  ]
    .filter(Boolean)
    .join('\n')
}

// Events first, metadata last: mail clients build the list-view preview from the first ~100
// characters of the text part, and leading with the log stream and console link made every alert
// preview as an indistinguishable wall of URL.
const buildText = (data: CloudWatchLogsDecodedData, events: ExtractedLogEvent[], consoleLink: string): string =>
  [
    ...events
      .slice(0, MAX_EVENTS)
      .map(
        (event, index) =>
          `${new Date(event.timestamp).toISOString()} ${event.level}${counter(index, events.length)}\n${truncateMessage(event.message)}\n`,
      ),
    overflowNote(events.length),
    `Log group: ${data.logGroup}`,
    `Log stream: ${data.logStream}`,
    consoleLink,
  ]
    .filter(Boolean)
    .join('\n')

const buildEmailMessage = (data: CloudWatchLogsDecodedData, events: ExtractedLogEvent[]): EmailMessage => {
  const consoleLink = buildConsoleLink(data.logGroup, data.logStream)
  return {
    html: buildHtml(data, events, consoleLink),
    subject: buildSubject(data.logGroup, events),
    text: buildText(data, events, consoleLink),
  }
}

/* Log group subscription processing */

export const logGroupProcessorHandler: CloudWatchLogsHandler = async (event: CloudWatchLogsEvent): Promise<void> => {
  try {
    const data = await getDataFromRecord(event)
    log('Received data', data)

    // CONTROL_MESSAGE is CloudWatch's own health check, delivered whenever a subscription filter is
    // created -- it carries no real log events and must not page anyone. An empty batch is guarded
    // alongside it because buildSubject reads events[0].
    const events = extractEventsFromData(data)
    if (data.messageType === 'CONTROL_MESSAGE' || events.length === 0) {
      log('Skipping non-alerting payload', data.messageType)
      return
    }

    const message = buildEmailMessage(data, events)
    log('Sending email', message.subject)
    await sendEmail(message)
  } catch (error) {
    logError(error)
  }
}
