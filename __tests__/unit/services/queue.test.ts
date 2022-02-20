import { smsApiKeyName, smsApiUrl, smsToPhoneNumber } from '@config'
import { mocked } from 'jest-mock'
import * as apiKeys from '@services/api-keys'
import { sendSms } from '@services/queue'
import { rest, server } from '@setup-server'

jest.mock('@services/api-keys')

describe('queue', () => {
  describe('sendSms', () => {
    const contents = 'Hello, Goodbye!'
    const postEndpoint = jest.fn().mockReturnValue(200)
    const queueApiKey = '23efvb67yujkm'

    beforeAll(() => {
      server.use(
        rest.post(`${smsApiUrl}/messages`, async (req, res, ctx) => {
          if (queueApiKey != req.headers.get('x-api-key')) {
            return res(ctx.status(403))
          }

          const body = postEndpoint(req.body)
          return res(body ? ctx.json(body) : ctx.status(400))
        })
      )
      mocked(apiKeys).getApiKey.mockResolvedValue(queueApiKey)
    })

    test('expect API key fetched', async () => {
      await sendSms(contents)
      expect(mocked(apiKeys).getApiKey).toHaveBeenCalledWith(smsApiKeyName)
    })

    test('expect sms contents to be passed to the endpoint', async () => {
      await sendSms(contents)
      expect(postEndpoint).toHaveBeenCalledWith({
        to: smsToPhoneNumber,
        contents,
        messageType: 'TRANSACTIONAL',
      })
    })
  })
})
