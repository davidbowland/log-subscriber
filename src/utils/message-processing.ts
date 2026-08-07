import { gunzip } from 'zlib'

import { CloudWatchLogsDecodedData, CloudWatchLogsEvent } from '../types'

/* Body */

export const getDataFromRecord = (event: CloudWatchLogsEvent): Promise<CloudWatchLogsDecodedData> => {
  const payload = Buffer.from(event.awslogs.data, 'base64')
  return new Promise((resolve, reject) =>
    gunzip(payload, (err, data) => (err ? reject(err) : resolve(JSON.parse(data.toString())))),
  )
}

/* Log events */

export interface ExtractedLogEvent {
  id: string
  level: string
  message: string
  timestamp: number
}

// extractedFields is only populated when the subscription filter names fields, and CloudWatch's own
// CONTROL_MESSAGE health checks (emitted whenever a subscription filter is created) carry none at
// all. Falling back to the raw message keeps those from rendering as the literal string "undefined".
export const extractEventsFromData = (data: CloudWatchLogsDecodedData): ExtractedLogEvent[] =>
  data.logEvents.map((event) => ({
    id: event.id,
    level: (event.extractedFields?.level as string) ?? 'ERROR',
    message: (event.extractedFields?.message as string) ?? event.message ?? '',
    timestamp: event.timestamp,
  }))
