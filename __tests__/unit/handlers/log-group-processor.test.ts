import { AxiosResponse } from 'axios'

import { data, extractedEvents, multipleExtractedEvents } from '../__mocks__'
import eventJson from '@events/event-subscription.json'
import { logGroupProcessorHandler } from '@handlers/log-group-processor'
import * as email from '@services/email'
import { CloudWatchLogsEvent } from '@types'
import * as logging from '@utils/logging'
import * as messageProcessing from '@utils/message-processing'

jest.mock('@services/email')
jest.mock('@utils/logging')
jest.mock('@utils/message-processing')

describe('log-group-processor', () => {
  // Doubly escaped because the CloudWatch console decodes the fragment a second time
  const consoleLink =
    'https://us-east-2.console.aws.amazon.com/cloudwatch/home?region=us-east-2#logsV2:log-groups/log-group/$252Faws$252Flambda$252Fjokes-api-test-GetRandomFunction-PrtSiiAcVAeL/log-events/2022$252F02$252F20$252F$255B$2524LATEST$255Db7042e80c91145c388058828d969dd54'

  beforeAll(() => {
    jest.mocked(logging).log.mockReturnValue(undefined)
    jest.mocked(messageProcessing).getDataFromRecord.mockResolvedValue(data)
    jest.mocked(messageProcessing).extractEventsFromData.mockReturnValue(extractedEvents)
  })

  describe('logGroupProcessorHandler', () => {
    const event = eventJson as undefined as CloudWatchLogsEvent
    beforeAll(() => {
      jest.mocked(email).sendEmail.mockResolvedValue(undefined as unknown as AxiosResponse)
    })

    it('should send an email for the log event', async () => {
      await logGroupProcessorHandler(event, undefined, undefined)

      expect(email.sendEmail).toHaveBeenCalledWith({
        html: [
          '<p><strong>2022-02-20T08:21:19.884Z ERROR</strong></p>',
          '<pre style="white-space: pre-wrap; font-family: monospace; margin: 0">testing!</pre>',
          '<hr />',
          '<p>',
          '<strong>Log group:</strong> /aws/lambda/jokes-api-test-GetRandomFunction-PrtSiiAcVAeL<br />',
          '<strong>Log stream:</strong> 2022/02/20/[$LATEST]b7042e80c91145c388058828d969dd54<br />',
          `<a href="${consoleLink}">View in the CloudWatch console</a>`,
          '</p>',
        ].join('\n'),
        subject: 'jokes-api-test-GetRandomFunction-PrtSiiAcVAeL — ERROR: testing!',
        text: [
          '2022-02-20T08:21:19.884Z ERROR',
          'testing!',
          '',
          'Log group: /aws/lambda/jokes-api-test-GetRandomFunction-PrtSiiAcVAeL',
          'Log stream: 2022/02/20/[$LATEST]b7042e80c91145c388058828d969dd54',
          consoleLink,
        ].join('\n'),
      })
    })

    it('should render every event in a batch', async () => {
      jest.mocked(messageProcessing).extractEventsFromData.mockReturnValueOnce(multipleExtractedEvents)
      await logGroupProcessorHandler(event, undefined, undefined)

      const message = jest.mocked(email).sendEmail.mock.calls[0][0]
      expect(message.subject).toEqual('jokes-api-test-GetRandomFunction-PrtSiiAcVAeL — ERROR: testing! (2 events)')
      expect(message.html).toEqual(expect.stringContaining('<strong>2022-02-20T08:21:19.884Z ERROR</strong> (1 of 2)'))
      expect(message.html).toEqual(expect.stringContaining('<strong>2022-02-20T08:21:20.884Z ERROR</strong> (2 of 2)'))
      expect(message.html).toEqual(expect.stringContaining('<hr />'))
      expect(message.text).toEqual(
        expect.stringContaining('2022-02-20T08:21:20.884Z ERROR (2 of 2)\ntesting again! <script>'),
      )
    })

    // A stack trace arrives as one multi-line `message` field. Default HTML whitespace handling
    // collapses it into an unreadable run-on paragraph, so the pre-wrap block is load-bearing.
    it('should preserve newlines in multi-line messages', async () => {
      jest
        .mocked(messageProcessing)
        .extractEventsFromData.mockReturnValueOnce([
          { ...extractedEvents[0], message: 'Error: boom\n    at handler (/var/task/index.js:1:1)' },
        ])
      await logGroupProcessorHandler(event, undefined, undefined)

      const message = jest.mocked(email).sendEmail.mock.calls[0][0]
      expect(message.html).toEqual(
        expect.stringContaining('<pre style="white-space: pre-wrap; font-family: monospace; margin: 0">Error: boom\n'),
      )
      // Only the first line reaches the subject, so a trace cannot blow out the header
      expect(message.subject).toEqual('jokes-api-test-GetRandomFunction-PrtSiiAcVAeL — ERROR: Error: boom')
    })

    // A crash-looping Lambda can deliver hundreds of events with multi-KB traces in one gzipped
    // payload. Unbounded, that renders past API Gateway's 10 MB limit -- a 413 the retry condition
    // does not retry and the handler swallows, losing the alert for the worst possible incident.
    it('should cap the number of rendered events and say how many were dropped', async () => {
      const many = Array.from({ length: 25 }, (_, index) => ({ ...extractedEvents[0], id: `event-${index}` }))
      jest.mocked(messageProcessing).extractEventsFromData.mockReturnValueOnce(many)
      await logGroupProcessorHandler(event, undefined, undefined)

      const message = jest.mocked(email).sendEmail.mock.calls[0][0]
      expect(message.html).toEqual(expect.stringContaining('… and 5 more events'))
      expect(message.text).toEqual(expect.stringContaining('… and 5 more events'))
      // 20 rendered, so the 20th carries a counter and the 21st never appears
      expect(message.html).toEqual(expect.stringContaining('(20 of 25)'))
      expect(message.html).toEqual(expect.not.stringContaining('(21 of 25)'))
    })

    it('should truncate an oversized message and report the dropped length', async () => {
      const message = 'x'.repeat(4500)
      jest.mocked(messageProcessing).extractEventsFromData.mockReturnValueOnce([{ ...extractedEvents[0], message }])
      await logGroupProcessorHandler(event, undefined, undefined)

      const sent = jest.mocked(email).sendEmail.mock.calls[0][0]
      expect(sent.html).toEqual(expect.stringContaining('… truncated 500 characters'))
      expect(sent.text).toEqual(expect.stringContaining('… truncated 500 characters'))
      expect(sent.html).toEqual(expect.not.stringContaining('x'.repeat(4001)))
    })

    it('should leave a message at the size limit untouched', async () => {
      const message = 'x'.repeat(4000)
      jest.mocked(messageProcessing).extractEventsFromData.mockReturnValueOnce([{ ...extractedEvents[0], message }])
      await logGroupProcessorHandler(event, undefined, undefined)

      const sent = jest.mocked(email).sendEmail.mock.calls[0][0]
      expect(sent.html).toEqual(expect.not.stringContaining('truncated'))
      expect(sent.html).toEqual(expect.stringContaining('x'.repeat(4000)))
    })

    it('should not send an email for a CONTROL_MESSAGE health check', async () => {
      jest.mocked(messageProcessing).getDataFromRecord.mockResolvedValueOnce({
        ...data,
        messageType: 'CONTROL_MESSAGE',
      })
      await logGroupProcessorHandler(event, undefined, undefined)

      expect(email.sendEmail).not.toHaveBeenCalled()
    })

    it('should not send an email when the batch has no events', async () => {
      jest.mocked(messageProcessing).extractEventsFromData.mockReturnValueOnce([])
      await logGroupProcessorHandler(event, undefined, undefined)

      expect(email.sendEmail).not.toHaveBeenCalled()
    })

    it('should escape HTML in event messages', async () => {
      jest.mocked(messageProcessing).extractEventsFromData.mockReturnValueOnce(multipleExtractedEvents)
      await logGroupProcessorHandler(event, undefined, undefined)

      const message = jest.mocked(email).sendEmail.mock.calls[0][0]
      expect(message.html).toEqual(expect.stringContaining('testing again! &lt;script&gt;'))
      expect(message.html).toEqual(expect.not.stringContaining('<script>'))
    })

    it('should not fail when sendEmail fails', async () => {
      jest.mocked(email).sendEmail.mockRejectedValueOnce('fnord')
      await logGroupProcessorHandler(event, undefined, undefined)

      expect(logging.logError).toHaveBeenCalledWith('fnord')
    })
  })
})
