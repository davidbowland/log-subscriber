import { sendSms } from '../services/queue'
import { CloudWatchLogsEvent, CloudWatchLogsHandler } from '../types'
import { log, logError } from '../utils/logging'
import { extractLevelFromData, extractMessageFromData, getDataFromRecord } from '../utils/message-processing'

/* Log group subscription processing */

export const logGroupProcessorHandler: CloudWatchLogsHandler = async (event: CloudWatchLogsEvent): Promise<void> => {
  try {
    const data = await getDataFromRecord(event)
    log('Received data', data)
    const contents = `${data.logGroup} ${extractLevelFromData(data)}: ${extractMessageFromData(data)}`
    log('Sending SMS', contents)
    await sendSms(contents)
  } catch (error) {
    logError(error)
  }
}
