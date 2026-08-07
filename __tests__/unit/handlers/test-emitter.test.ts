import { testEmitterHandler } from '@handlers/test-emitter'
import * as logging from '@utils/logging'

jest.mock('@utils/logging')

describe('test-emitter', () => {
  const emittedAt = '2026-08-07T14:32:07.412Z'
  const expectedMessage = `log-subscriber test alert emitted at ${emittedAt}`

  beforeAll(() => {
    jest.useFakeTimers()
    jest.mocked(logging).logError.mockReturnValue(undefined)
  })

  // Per test, not once: the distinctness test advances the clock, and that would otherwise leak
  // into every test after it
  beforeEach(() => {
    jest.setSystemTime(new Date(emittedAt))
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  describe('testEmitterHandler', () => {
    it('should log a single error', async () => {
      await testEmitterHandler({})

      expect(logging.logError).toHaveBeenCalledTimes(1)
      expect(logging.logError).toHaveBeenCalledWith(expectedMessage, {})
    })

    // The console's invoke output is how the tester knows which subject line to look for in the mail
    it('should return the message it logged', async () => {
      const result = await testEmitterHandler({})

      expect(result).toEqual({ message: expectedMessage })
    })

    // Successive runs must not share a subject, or mail clients collapse them into one thread and
    // the newly arrived alert is hidden inside it
    it('should emit a distinct message on each invocation', async () => {
      const first = await testEmitterHandler({})
      jest.advanceTimersByTime(1000)
      const second = await testEmitterHandler({})

      expect(second.message).not.toEqual(first.message)
    })

    // The invoke payload is how a tester forces specific content into the alert -- a stack trace to
    // check pre-wrap rendering, an oversized string to check truncation, HTML to check escaping
    it.each([
      { name: 'an object', payload: { detail: { nested: true }, reason: 'checking escaping' } },
      { name: 'a string', payload: 'Error: boom\n    at handler (/var/task/index.js:1:1)' },
      { name: 'an array', payload: [1, 2, 3] },
      { name: 'no payload', payload: undefined },
    ])('should pass $name through to the log line', async ({ payload }) => {
      await testEmitterHandler(payload)

      expect(logging.logError).toHaveBeenCalledWith(expectedMessage, payload)
    })
  })
})
