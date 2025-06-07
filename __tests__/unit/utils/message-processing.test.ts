import { data } from '../__mocks__'
import eventJson from '@events/event-subscription.json'
import { CloudWatchLogsEvent } from '@types'
import { extractLevelFromData, extractMessageFromData, getDataFromRecord } from '@utils/message-processing'

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

  describe('extractLevelFromData', () => {
    it('should extract level from data', async () => {
      const result = extractLevelFromData(data)

      expect(result).toEqual('ERROR')
    })
  })

  describe('extractMessageFromData', () => {
    it('should extract message from data', async () => {
      const result = extractMessageFromData(data)

      expect(result).toEqual('testing!')
    })
  })
})
