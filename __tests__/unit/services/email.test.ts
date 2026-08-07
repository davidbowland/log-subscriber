import { http, HttpResponse, server } from '@setup-server'

import { emailsQueueApiBaseUrl, ssmEmailApiKeyPath, ssmEmailFromAddressPath, ssmEmailToAddressPath } from '@config'
import { EmailMessage } from '@types'

const mockSend = jest.fn()
jest.mock('@aws-sdk/client-ssm', () => ({
  GetParameterCommand: jest.fn().mockImplementation((x) => x),
  SSMClient: jest.fn(() => ({
    send: (...args: any[]) => mockSend(...args),
  })),
}))
jest.mock('@utils/logging', () => ({
  log: jest.fn(),
  logError: jest.fn(),
}))

describe('email', () => {
  const apiKey = '3edfgr4ertyjkijhg8'
  const fromAddress = 'do-not-reply@bowland.link'
  const toAddress = 'operator@bowland.link'
  const message: EmailMessage = {
    html: '<p>Something went wrong</p>',
    subject: '/aws/lambda/jokes-api-test — ERROR',
    text: 'Something went wrong',
  }

  const ssmValues: { [key: string]: string } = {
    [ssmEmailApiKeyPath]: apiKey,
    [ssmEmailFromAddressPath]: fromAddress,
    [ssmEmailToAddressPath]: toAddress,
  }

  const postEndpoint = jest.fn().mockReturnValue({ messageId: 'aeb0b45d-a1c9-4b76-b7dd-30e6ea0a3f6c' })

  // The service caches parameters for the life of the container, so each test imports it fresh
  const sendMessage = async (input: EmailMessage = message, times = 1): Promise<void> =>
    jest.isolateModulesAsync(async () => {
      const { sendEmail } = await import('@services/email')
      for (let index = 0; index < times; index++) {
        await sendEmail(input)
      }
    })

  beforeAll(() => {
    mockSend.mockImplementation((command: { Name: string }) =>
      Promise.resolve({ Parameter: { Value: ssmValues[command.Name] } }),
    )

    server.use(
      http.post(`${emailsQueueApiBaseUrl}/v1/emails`, async ({ request }) => {
        if (apiKey != request.headers.get('x-api-key')) {
          return new HttpResponse(JSON.stringify({ message: 'Invalid API key' }), { status: 403 })
        }

        const body = postEndpoint(await request.json())
        return body ? HttpResponse.json(body) : new HttpResponse(null, { status: 400 })
      }),
    )
  })

  describe('sendEmail', () => {
    it('should read the SSM parameters with decryption', async () => {
      await sendMessage()

      expect(mockSend).toHaveBeenCalledWith({ Name: ssmEmailApiKeyPath, WithDecryption: true })
      expect(mockSend).toHaveBeenCalledWith({ Name: ssmEmailFromAddressPath, WithDecryption: true })
      expect(mockSend).toHaveBeenCalledWith({ Name: ssmEmailToAddressPath, WithDecryption: true })
    })

    it('should pass the email to the endpoint', async () => {
      await sendMessage()

      expect(postEndpoint).toHaveBeenCalledWith({
        from: `Log Subscriber <${fromAddress}>`,
        html: message.html,
        replyTo: fromAddress,
        sender: fromAddress,
        subject: message.subject,
        text: message.text,
        to: [toAddress],
      })
    })

    // Wrapping an address that already carries a display name would nest it into something
    // unsendable, which is exactly what a hand-edited SSM parameter would produce
    it('should not double-wrap a from address that already has a display name', async () => {
      const withName = `Alerts <${fromAddress}>`
      mockSend
        .mockResolvedValueOnce({ Parameter: { Value: apiKey } })
        .mockResolvedValueOnce({ Parameter: { Value: withName } })

      await sendMessage()

      expect(postEndpoint).toHaveBeenCalledWith(expect.objectContaining({ from: withName }))
    })

    it('should reject when the api key does not match', async () => {
      mockSend.mockResolvedValueOnce({ Parameter: { Value: 'not-the-api-key' } })

      await expect(sendMessage()).rejects.toBeDefined()
      expect(postEndpoint).toHaveBeenCalledTimes(0)
    })

    it('should read each SSM parameter only once per container', async () => {
      await sendMessage(message, 2)

      expect(mockSend).toHaveBeenCalledTimes(3)
      expect(postEndpoint).toHaveBeenCalledTimes(2)
    })

    it('should throw when the api key parameter has no value', async () => {
      mockSend.mockResolvedValueOnce({ Parameter: {} })

      await expect(sendMessage()).rejects.toThrow(`SSM parameter ${ssmEmailApiKeyPath} has no value`)
      expect(postEndpoint).toHaveBeenCalledTimes(0)
    })

    it('should throw when the from address parameter has no value', async () => {
      mockSend.mockResolvedValueOnce({ Parameter: { Value: apiKey } }).mockResolvedValueOnce({ Parameter: {} })

      await expect(sendMessage()).rejects.toThrow(`SSM parameter ${ssmEmailFromAddressPath} has no value`)
      expect(postEndpoint).toHaveBeenCalledTimes(0)
    })

    it('should throw when the to address parameter has no value', async () => {
      mockSend
        .mockResolvedValueOnce({ Parameter: { Value: apiKey } })
        .mockResolvedValueOnce({ Parameter: { Value: fromAddress } })
        .mockResolvedValueOnce({ Parameter: {} })

      await expect(sendMessage()).rejects.toThrow(`SSM parameter ${ssmEmailToAddressPath} has no value`)
      expect(postEndpoint).toHaveBeenCalledTimes(0)
    })
  })
})
