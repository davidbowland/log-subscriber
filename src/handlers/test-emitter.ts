import { logError } from '../utils/logging'

// This function exists only to exercise the deployed alert path end to end -- subscription filter,
// gzipped envelope, render, delivery -- without waiting for a real service to fail. Invoke it from
// the AWS console; an alert email should arrive.
//
// The timestamp in the message is load-bearing. buildSubject derives the subject from the message,
// and mail clients thread on identical subjects, so a constant string would fold every test run
// into one collapsed conversation -- hiding the newly arrived alert, which is the only thing this
// test is trying to observe.
//
// The invoke payload is appended to the same log line so a tester can force chosen content into the
// alert -- a stack trace to check pre-wrap rendering, an oversized string to check truncation, HTML
// to check escaping. console.error joins its arguments, so the payload lands inside the `message`
// field the subscription filter extracts rather than in a separate log event.
export const testEmitterHandler = async (event: unknown): Promise<{ message: string }> => {
  const message = `log-subscriber test alert emitted at ${new Date().toISOString()}`
  logError(message, event)
  return { message }
}
