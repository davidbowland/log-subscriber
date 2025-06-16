import { http, HttpResponse, server } from '@setup-server'

import { smsApiKey, smsApiUrl, smsToPhoneNumber } from '@config'
import { sendSms } from '@services/queue'

jest.mock('@utils/logging')

describe('queue', () => {
  describe('sendSms', () => {
    const contents = 'Hello, Goodbye!'
    const postEndpoint = jest.fn().mockReturnValue(200)

    beforeAll(() => {
      server.use(
        http.post(`${smsApiUrl}/messages`, async ({ request }) => {
          if (smsApiKey != request.headers.get('x-api-key')) {
            return new HttpResponse(JSON.stringify({ message: 'Invalid API key' }), { status: 403 })
          }

          const body = postEndpoint(await request.json())
          return body ? HttpResponse.json(body) : new HttpResponse(null, { status: 400 })
        }),
      )
    })

    it('should pass sms contents to the endpoint', async () => {
      await sendSms(contents)

      expect(postEndpoint).toHaveBeenCalledWith({
        contents,
        messageType: 'TRANSACTIONAL',
        to: smsToPhoneNumber,
      })
    })

    it('truncates contents to 600 characters', async () => {
      const longContents = 'a'.repeat(1000)
      await sendSms(longContents)

      expect(postEndpoint).toHaveBeenCalledWith({
        contents: longContents.slice(0, 600),
        messageType: 'TRANSACTIONAL',
        to: smsToPhoneNumber,
      })
    })
  })
})
