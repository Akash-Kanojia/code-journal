import { attemptFileName, commitMessage, METADATA_FILE, problemDirectory } from '../journal/layout';
import {
  attemptMetadata,
  findAttempt,
  nextAttemptNumber,
  parseProblemMetadata,
  serializeMetadata,
  withAttempt,
} from '../journal/metadata';
import type { Logger } from '../logger';
import type { CodingSubmission } from '../models/coding-submission';
import { GitProviderError, type GitProvider, type Repository } from './git-provider';

export interface JournalTarget {
  repository: Pick<Repository, 'owner' | 'name'>;
  branch: string;
  /** Base directory inside the repository; "" for the root. */
  directory: string;
}

export interface JournalWriteResult {
  attempt: number;
  path: string;
  /** Undefined when the attempt was already in the repository (nothing committed). */
  commitSha?: string;
}

const MAX_CONFLICT_RETRIES = 3;

const INITIAL_README = `# Code Journal

Coding submissions recorded by the Code Journal browser extension.
Each attempt is a separate file and a separate commit; \`metadata.json\` in each problem
directory describes every attempt.
`;

/**
 * Writes one submission as one commit: `<dir>/<platform>/<problem>/NNN.<ext>` plus the
 * problem's metadata.json. Idempotent: if metadata.json already lists the submission,
 * nothing is committed. This protects against duplicates after a crash between
 * committing and recording success locally.
 */
export class JournalWriter {
  constructor(
    private readonly provider: GitProvider,
    private readonly logger: Logger,
  ) {}

  async write(target: JournalTarget, submission: CodingSubmission): Promise<JournalWriteResult> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.writeOnce(target, submission);
      } catch (error) {
        if (
          error instanceof GitProviderError &&
          error.kind === 'conflict' &&
          attempt < MAX_CONFLICT_RETRIES
        ) {
          this.logger.info('Branch moved during commit; retrying on the new head', {
            branch: target.branch,
          });
          continue;
        }
        throw error;
      }
    }
  }

  private async writeOnce(
    target: JournalTarget,
    submission: CodingSubmission,
  ): Promise<JournalWriteResult> {
    const { repository, branch } = target;
    let head = await this.provider.getBranchHead(repository, branch);
    if (head === undefined) {
      this.logger.info('Repository is empty; creating an initial commit', { branch });
      await this.provider.createOrUpdateFile(
        repository,
        branch,
        { path: 'README.md', content: INITIAL_README },
        'Initialize Code Journal',
      );
      head = await this.provider.getBranchHead(repository, branch);
      if (head === undefined) {
        throw new GitProviderError('server', 'Repository is still empty after initialization');
      }
    }

    const directory = problemDirectory(target.directory, submission.problem);
    const metadataPath = `${directory}/${METADATA_FILE}`;
    const existingText = await this.provider.readFile(repository, head.commitSha, metadataPath);
    const existing = existingText === undefined ? undefined : parseProblemMetadata(existingText);

    const already = findAttempt(existing, submission);
    if (already !== undefined) {
      return { attempt: already.attempt, path: `${directory}/${already.file}` };
    }

    const attempt = nextAttemptNumber(existing);
    const file = attemptFileName(attempt, submission.language);
    const path = `${directory}/${file}`;
    const metadata = withAttempt(existing, submission, attemptMetadata(submission, attempt, file));

    const commitSha = await this.provider.createCommit({
      repository,
      branch,
      parent: head,
      message: commitMessage(submission, attempt),
      files: [
        { path, content: submission.code },
        { path: metadataPath, content: serializeMetadata(metadata) },
      ],
    });
    return { attempt, path, commitSha };
  }
}
