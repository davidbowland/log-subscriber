import { rest, server } from '@setup-server'
import { smsApiKey, smsApiUrl, smsToPhoneNumber } from '@config'
import { sendSms } from '@services/queue'

describe('queue', () => {
  describe('sendSms', () => {
    const contents = 'Hello, Goodbye!'
    const postEndpoint = jest.fn().mockReturnValue(200)

    beforeAll(() => {
      server.use(
        rest.post(`${smsApiUrl}/messages`, async (req, res, ctx) => {
          if (smsApiKey != req.headers.get('x-api-key')) {
            return res(ctx.status(403))
          }

          const body = postEndpoint(req.body)
          return res(body ? ctx.json(body) : ctx.status(400))
        })
      )
    })

    test('expect sms contents to be passed to the endpoint', async () => {
      await sendSms(contents)
      expect(postEndpoint).toHaveBeenCalledWith({
        contents,
        messageType: 'TRANSACTIONAL',
        to: smsToPhoneNumber,
      })
    })
  })
})
