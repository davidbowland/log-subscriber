import { data } from '../__mocks__'
import eventJson from '@events/event-subscription.json'
import { CloudWatchLogsEvent } from '@types'
import { extractMessageFromData, getDataFromRecord } from '@utils/message-processing'

describe('message-processing', () => {
  describe('getDataFromRecord', () => {
    const event = eventJson as unknown as CloudWatchLogsEvent

    test('expect data extracted from event', async () => {
      const result = await getDataFromRecord(event)
      expect(result).toEqual(data)
    })

    test('expect exception on failed gzip', async () => {
      const badZip = Buffer.from('this is a bad zip').toString('base64')
      await expect(getDataFromRecord({ awslogs: { data: badZip } })).rejects.toBeDefined()
    })
  })

  describe('extractMessageFromData', () => {
    test('expect message extracted from line', async () => {
      const result = extractMessageFromData(data)
      expect(result).toEqual('testing!')
    })
  })
})
