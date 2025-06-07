import { data } from '../__mocks__'
import eventJson from '@events/event-subscription.json'
import { logGroupProcessorHandler } from '@handlers/log-group-processor'
import * as queue from '@services/queue'
import { CloudWatchLogsEvent } from '@types'
import * as logging from '@utils/logging'
import * as messageProcessing from '@utils/message-processing'

jest.mock('@services/queue')
jest.mock('@utils/logging')
jest.mock('@utils/message-processing')

describe('log-group-processor', () => {
  beforeAll(() => {
    jest.mocked(logging).log.mockReturnValue(undefined)
    jest.mocked(messageProcessing).getDataFromRecord.mockResolvedValue(data)
    jest.mocked(messageProcessing).extractLevelFromData.mockReturnValue('ERROR')
    jest.mocked(messageProcessing).extractMessageFromData.mockReturnValue('testing!')
  })

  describe('logGroupProcessorHandler', () => {
    const event = eventJson as undefined as CloudWatchLogsEvent
    beforeAll(() => {
      jest.mocked(queue).sendSms.mockResolvedValue(undefined)
    })

    it('should call sendSms for each record', async () => {
      await logGroupProcessorHandler(event, undefined, undefined)

      expect(queue.sendSms).toHaveBeenCalledWith(
        '/aws/lambda/jokes-api-test-GetRandomFunction-PrtSiiAcVAeL ERROR: testing!',
      )
    })

    it('should not fail when sendSms fails', async () => {
      jest.mocked(queue).sendSms.mockRejectedValueOnce('fnord')
      await logGroupProcessorHandler(event, undefined, undefined)

      expect(logging.logError).toHaveBeenCalledWith('fnord')
    })
  })
})
