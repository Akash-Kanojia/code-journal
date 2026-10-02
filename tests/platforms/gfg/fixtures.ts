import nextData from './fixtures/next-data.json';
import problemResponse from './fixtures/problem-response.json';
import accepted from './fixtures/result-accepted.json';
import compileError from './fixtures/result-compile-error.json';
import failed from './fixtures/result-failed.json';
import optimize from './fixtures/result-optimize.json';
import picked from './fixtures/result-picked.json';
import queued from './fixtures/result-queued.json';
import runtimeError from './fixtures/result-runtime-error.json';
import timeLimitExceeded from './fixtures/result-time-limit-exceeded.json';
import unknown from './fixtures/result-unknown.json';
import wrongAnswer from './fixtures/result-wrong-answer.json';
import submitError from './fixtures/submit-error.json';
import submitRequest from './fixtures/submit-request.json';
import submitResponse from './fixtures/submit-response.json';

/** Response fixtures as raw text; the submit request as the form fields the observer forwards. */
export const gfgFixtures = {
  problemResponse: JSON.stringify(problemResponse),
  nextData: JSON.stringify(nextData),
  submitForm: submitRequest as Record<string, string>,
  submitResponse: JSON.stringify(submitResponse),
  submitError: JSON.stringify(submitError),
  resultQueued: JSON.stringify(queued),
  resultPicked: JSON.stringify(picked),
  resultFailed: JSON.stringify(failed),
  finalResults: {
    accepted: JSON.stringify(accepted),
    wrongAnswer: JSON.stringify(wrongAnswer),
    compileError: JSON.stringify(compileError),
    runtimeError: JSON.stringify(runtimeError),
    timeLimitExceeded: JSON.stringify(timeLimitExceeded),
    optimize: JSON.stringify(optimize),
    unknown: JSON.stringify(unknown),
  },
} as const;

export const GFG_SUBMISSION_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
export const GFG_SUBMIT_URL =
  'https://practiceapiorigin.geeksforgeeks.org/api/latest/problems/key-pair5616/submit/compile/';
export const GFG_RESULT_URL =
  'https://practiceapiorigin.geeksforgeeks.org/api/latest/problems/submission/submit/result/';
