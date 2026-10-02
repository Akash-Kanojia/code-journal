import accepted from './fixtures/check-accepted.json';
import compileError from './fixtures/check-compile-error.json';
import pending from './fixtures/check-pending.json';
import runningTests from './fixtures/check-running-tests.json';
import runtimeError from './fixtures/check-runtime-error.json';
import timeLimitExceeded from './fixtures/check-time-limit-exceeded.json';
import wrongAnswer from './fixtures/check-wrong-answer.json';
import graphqlQuestion from './fixtures/graphql-question.json';
import interpretResponse from './fixtures/interpret-response.json';
import memoryLimitExceeded from './fixtures/check-memory-limit-exceeded.json';
import unknownStatus from './fixtures/check-unknown-status.json';
import submissionDetails from './fixtures/submission-details.json';
import nextData from './fixtures/next-data.json';
import submitRequest from './fixtures/submit-request.json';
import submitResponse from './fixtures/submit-response.json';

/** Fixtures as the raw response text the parsers receive. */
export const fixtures = {
  submitRequest: JSON.stringify(submitRequest),
  submitResponse: JSON.stringify(submitResponse),
  interpretResponse: JSON.stringify(interpretResponse),
  checkPending: JSON.stringify(pending),
  checkRunningTests: JSON.stringify(runningTests),
  graphqlQuestion: JSON.stringify(graphqlQuestion),
  nextData: JSON.stringify(nextData),
  submissionDetails: JSON.stringify(submissionDetails),
  checkUnknownStatus: JSON.stringify(unknownStatus),
  finalChecks: {
    accepted: JSON.stringify(accepted),
    compileError: JSON.stringify(compileError),
    runtimeError: JSON.stringify(runtimeError),
    timeLimitExceeded: JSON.stringify(timeLimitExceeded),
    wrongAnswer: JSON.stringify(wrongAnswer),
    memoryLimitExceeded: JSON.stringify(memoryLimitExceeded),
  },
} as const;

export const SLUG_1477 = 'find-two-non-overlapping-sub-arrays-each-with-target-sum';
