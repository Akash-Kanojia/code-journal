import type { Platform } from './types/platform';

export interface PlatformInfo {
  /** Human-readable name used in commit messages and the UI. */
  displayName: string;
  /** Short name for commit messages. */
  shortName: string;
  /**
   * How a problem is referred to in commit messages and directory names:
   * - "number": by its number, e.g. "LeetCode #1477", directory "1477-two-sum"
   * - "title": by its title, e.g. "GFG - Two Sum", directory "<slug>"
   */
  problemReference: 'number' | 'title';
}

/** Presentation data only; platform behaviour lives in the adapters. */
export const PLATFORM_INFO: Readonly<Record<Platform, PlatformInfo>> = {
  leetcode: { displayName: 'LeetCode', shortName: 'LeetCode', problemReference: 'number' },
  gfg: { displayName: 'GeeksforGeeks', shortName: 'GFG', problemReference: 'title' },
};
