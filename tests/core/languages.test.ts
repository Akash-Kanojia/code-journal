import { describe, expect, it } from 'vitest';
import { fileExtension, languageDisplayName, normalizeLanguage } from '../../src/core/languages';

describe('language normalization', () => {
  it.each([
    ['javascript', 'js'],
    ['JavaScript', 'js'],
    ['typescript', 'ts'],
    ['python3', 'py'],
    ['Python', 'py'],
    ['java', 'java'],
    ['cpp', 'cpp'],
    ['C++', 'cpp'],
    ['C++ (17)', 'cpp'],
    ['c', 'c'],
    ['csharp', 'cs'],
    ['C#', 'cs'],
    ['golang', 'go'],
    ['rust', 'rs'],
    ['kotlin', 'kt'],
    ['swift', 'swift'],
    ['php', 'php'],
    ['ruby', 'rb'],
    ['mysql', 'sql'],
  ])('%s → .%s', (language, extension) => {
    expect(fileExtension(language)).toBe(extension);
  });

  it('falls back safely for unknown languages', () => {
    expect(normalizeLanguage('brainfuck')).toBeUndefined();
    expect(fileExtension('brainfuck')).toBe('txt');
    expect(languageDisplayName('brainfuck')).toBe('brainfuck');
    expect(languageDisplayName('python3')).toBe('Python');
  });
});
