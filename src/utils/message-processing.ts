import { CloudWatchLogsDecodedData, CloudWatchLogsEvent } from '../types'
import { gunzip } from 'zlib'

/* Body */

export const getDataFromRecord = (event: CloudWatchLogsEvent): Promise<CloudWatchLogsDecodedData> => {
  const payload = Buffer.from(event.awslogs.data, 'base64')
  return new Promise((resolve, reject) =>
    gunzip(payload, (err, data) => (err ? reject(err) : resolve(JSON.parse(data.toString()))))
  )
}

export const extractMessageFromData = (data: CloudWatchLogsDecodedData): string =>
  data.logEvents[0].extractedFields.message
