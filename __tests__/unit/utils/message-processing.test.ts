import { data, extractedEvents, multiEventData, multipleExtractedEvents } from '../__mocks__'
import eventJson from '@events/event-subscription.json'
import { CloudWatchLogsEvent } from '@types'
import { extractEventsFromData, getDataFromRecord } from '@utils/message-processing'

describe('message-processing', () => {
  describe('getDataFromRecord', () => {
    const event = eventJson as unknown as CloudWatchLogsEvent

    it('should extract data from event', async () => {
      const result = await getDataFromRecord(event)

      expect(result).toEqual(data)
    })

    it('should throw exception on failed gzip', async () => {
      const badZip = Buffer.from('this is a bad zip').toString('base64')

      await expect(getDataFromRecord({ awslogs: { data: badZip } })).rejects.toBeDefined()
    })
  })

  describe('extractEventsFromData', () => {
    it('should extract the event from data', async () => {
      const result = extractEventsFromData(data)

      expect(result).toEqual(extractedEvents)
    })

    it('should extract every event in a batch', async () => {
      const result = extractEventsFromData(multiEventData)

      expect(result).toEqual(multipleExtractedEvents)
    })

    // CloudWatch emits these whenever a subscription filter is created. They carry no
    // extractedFields, and without the fallback the alert body rendered the string "undefined".
    it('should fall back to the raw message when extractedFields is absent', () => {
      const result = extractEventsFromData({
        ...data,
        logEvents: [{ id: 'fnord', message: 'CWL CONTROL MESSAGE: Checking health', timestamp: 1645345279884 }],
      } as unknown as typeof data)

      expect(result).toEqual([
        { id: 'fnord', level: 'ERROR', message: 'CWL CONTROL MESSAGE: Checking health', timestamp: 1645345279884 },
      ])
    })

    it('should fall back to an empty message when neither extractedFields nor message is present', () => {
      const result = extractEventsFromData({
        ...data,
        logEvents: [{ id: 'fnord', timestamp: 1645345279884 }],
      } as unknown as typeof data)

      expect(result).toEqual([{ id: 'fnord', level: 'ERROR', message: '', timestamp: 1645345279884 }])
    })
  })
})
