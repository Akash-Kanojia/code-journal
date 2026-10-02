export interface LanguageInfo {
  /** Display name, e.g. "C++". */
  name: string;
  /** File extension without the dot. */
  extension: string;
}

/**
 * Centralised language table, keyed by normalised identifier. Platform language ids
 * (LeetCode `lang`, GFG `language`) and display names both resolve through `ALIASES`.
 */
const LANGUAGES: Readonly<Record<string, LanguageInfo>> = {
  javascript: { name: 'JavaScript', extension: 'js' },
  typescript: { name: 'TypeScript', extension: 'ts' },
  python: { name: 'Python', extension: 'py' },
  java: { name: 'Java', extension: 'java' },
  cpp: { name: 'C++', extension: 'cpp' },
  c: { name: 'C', extension: 'c' },
  csharp: { name: 'C#', extension: 'cs' },
  go: { name: 'Go', extension: 'go' },
  rust: { name: 'Rust', extension: 'rs' },
  kotlin: { name: 'Kotlin', extension: 'kt' },
  swift: { name: 'Swift', extension: 'swift' },
  php: { name: 'PHP', extension: 'php' },
  ruby: { name: 'Ruby', extension: 'rb' },
  scala: { name: 'Scala', extension: 'scala' },
  dart: { name: 'Dart', extension: 'dart' },
  racket: { name: 'Racket', extension: 'rkt' },
  erlang: { name: 'Erlang', extension: 'erl' },
  elixir: { name: 'Elixir', extension: 'ex' },
  sql: { name: 'SQL', extension: 'sql' },
  bash: { name: 'Bash', extension: 'sh' },
  r: { name: 'R', extension: 'r' },
  perl: { name: 'Perl', extension: 'pl' },
};

const ALIASES: Readonly<Record<string, string>> = {
  js: 'javascript',
  node: 'javascript',
  nodejs: 'javascript',
  ts: 'typescript',
  python2: 'python',
  python3: 'python',
  py: 'python',
  py3: 'python',
  pythondata: 'python',
  pandas: 'python',
  'c++': 'cpp',
  cplusplus: 'cpp',
  cpp14: 'cpp',
  cpp17: 'cpp',
  cpp20: 'cpp',
  gcc: 'c',
  'c#': 'csharp',
  cs: 'csharp',
  golang: 'go',
  rs: 'rust',
  kt: 'kotlin',
  rb: 'ruby',
  mysql: 'sql',
  mssql: 'sql',
  oraclesql: 'sql',
  postgresql: 'sql',
  shell: 'bash',
  sh: 'bash',
};

/** Normalises a platform language id or display name to a key of the language table. */
export function normalizeLanguage(language: string): string | undefined {
  const key = language.trim().toLowerCase().replace(/\s+/g, '');
  const withoutVersion = key.replace(/\(.*\)$/, '');
  for (const candidate of [key, withoutVersion]) {
    if (candidate in LANGUAGES) return candidate;
    const alias = ALIASES[candidate];
    if (alias !== undefined) return alias;
  }
  return undefined;
}

export function languageInfo(language: string): LanguageInfo | undefined {
  const key = normalizeLanguage(language);
  return key === undefined ? undefined : LANGUAGES[key];
}

/** File extension for a language; unknown languages fall back to "txt" rather than failing. */
export function fileExtension(language: string): string {
  return languageInfo(language)?.extension ?? 'txt';
}

export function languageDisplayName(language: string): string {
  return languageInfo(language)?.name ?? language;
}
