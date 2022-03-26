import { mocked } from 'jest-mock'

import * as logging from '@utils/logging'
import * as messageProcessing from '@utils/message-processing'
import * as queue from '@services/queue'
import { CloudWatchLogsEvent } from '@types'
import { data } from '../__mocks__'
import eventJson from '@events/event-subscription.json'
import { logGroupProcessorHandler } from '@handlers/log-group-processor'

jest.mock('@services/queue')
jest.mock('@utils/logging')
jest.mock('@utils/message-processing')

describe('log-group-processor', () => {
  beforeAll(() => {
    mocked(logging).log.mockReturnValue(undefined)
    mocked(messageProcessing).getDataFromRecord.mockResolvedValue(data)
    mocked(messageProcessing).extractLevelFromData.mockReturnValue('ERROR')
    mocked(messageProcessing).extractMessageFromData.mockReturnValue('testing!')
  })

  describe('logGroupProcessorHandler', () => {
    const event = eventJson as undefined as CloudWatchLogsEvent
    beforeAll(() => {
      mocked(queue).sendSms.mockResolvedValue(undefined)
    })

    test('expect sendSms to be called for each record', async () => {
      await logGroupProcessorHandler(event, undefined, undefined)
      expect(mocked(queue).sendSms).toHaveBeenCalledWith(
        '/aws/lambda/jokes-api-test-GetRandomFunction-PrtSiiAcVAeL ERROR: testing!'
      )
    })

    test('expect snsPayloadProcessorHandler to not fail when sendSms fails', async () => {
      mocked(queue).sendSms.mockRejectedValueOnce('fnord')
      await logGroupProcessorHandler(event, undefined, undefined)
      expect(mocked(logging).logError).toHaveBeenCalledWith('fnord')
    })
  })
})
