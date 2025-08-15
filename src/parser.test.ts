/* eslint-disable no-useless-escape */
import { describe, test, expect } from 'vitest'
import {
  re_,
  splitByComma_,
  findClosingBrace_,
  compileRegExp_,
  // type TPatternSegmentKind,
  // type TPatternSegmentStar,
  // type TPatternSegmentRegExp,
  // type TCompiledPattern,
  compileRegExp,
  compilePattern
} from './parser.js'

describe('parser', () => {
  test('re', () => {
    // Очистка до последнего разделителя
    expect('foo / \\ '.replace(re_.trimEndBackSlashes, '')).toBe('foo /')
    // Очистка всех последних незначимых символов до имени файла
    expect('/ foo / \\ '.replace(re_.trimEndSlashes, '')).toBe('/ foo')
    // Очиска до первого значимого экранирования
    expect('\\ // foo /'.replace(re_.trimStartSlashes, '')).toBe('foo /')
    expect('\\ // \\ foo'.replace(re_.trimStartSlashes, '')).toBe('\\ foo')
    expect('\\ x // \\ foo'.replace(re_.trimStartSlashes, '')).toBe('\\ x // \\ foo')
    // Очистка бесполезного экранирования крайних пробелов - файлы не могут иметь пробелы по краям
    expect('\\ \\ \\ foo\\ bar \\ \\'.replace(re_.trimEscapeSpace, '')).toBe('foo\\ bar')
    // Проверки
    expect(re_.hasSlash.test('foo/bar')).toBe(true)
    expect(re_.hasSlash.test('foo\\bar')).toBe(false)
    expect(re_.hasEndSlash.test('foo/bar/')).toBe(true)
    expect(re_.hasEndSlash.test('foo/bar')).toBe(false)
    expect(re_.hasEndSlash.test('foo\\bar\\')).toBe(false)
    // Простейшие нормализации
    expect('foo\\\\bar\\\\box'.replace(re_.allBackSlashes, '\\')).toBe('foo\\bar\\box')
    expect('foo/***/bar***box'.replace(re_.dblStar, '**')).toBe('foo/**/bar**box')
    // Сплит по правому слешу, до первого значимого экранирования
    expect('foo // // \\ // \\ bar'.split(re_.split)).toStrictEqual(['foo', '\\ bar'])
  })

  test('splitByComma_', () => {
    expect(splitByComma_([])).toStrictEqual([])
    // Пустая строка считается паттерном и будет преобразована к /(|...)/
    expect(splitByComma_([','])).toStrictEqual([[]])
    expect(splitByComma_([',', ','])).toStrictEqual([[]])
    expect(splitByComma_([...'ab,c'])).toStrictEqual([
      ['a', 'b'],
      ['c']
    ])
    expect(splitByComma_([...',a\\b,,\\,cd,'])).toStrictEqual([
      [], // <- первая пустая строка, остальные отфильтрованы
      ['a', '\\', 'b'],
      ['\\', ',', 'c', 'd']
    ])
  })

  test('findClosingBrace_', () => {
    expect(findClosingBrace_([...'{}'], 0)).toBe(1)
    expect(findClosingBrace_([...'{foo{bar}}'], 0)).toBe(9)
    expect(findClosingBrace_([...'{foo{bar\\}}}'], 0)).toBe(11)
    expect(findClosingBrace_([...'{foo'], 0)).toBe(-1)
    expect(findClosingBrace_([...'{{bar}'], 0)).toBe(-1)
    expect(findClosingBrace_([...'{foo\\}'], 0)).toBe(-1)
    expect(findClosingBrace_([...'a}{b}'], 2)).toBe(4)
  })

  test('compileRegExp_', () => {
    expect(compileRegExp_('?*.{js,ts}', false, false)).toStrictEqual(/^..*\.(js|ts)$/i)
    expect(compileRegExp_('*.test.ts', false, false)).toStrictEqual(/.*\.test\.ts$/i)
    const cases: [string, string][] = [
      ['*', '.*'],
      ['abc', '^abc$'],
      ['a?c', '^a.c$'],
      ['a*c', '^a.*c$'],
      ['file.name', '^file\\.name$'],
      ['{a,b,c}', '^(a|b|c)$'],
      ['{a,*,c}', '^(a|.*|c)$'],
      ['\\{a,b\\}', '^\\{a\\,b\\}$'], // экранированные скобки
      ['{a\\,b,c}', '^(a\\,b|c)$'],
      ['{a,b}', '^(a|b)$'],
      ['{\\,a,b}', '^(\\,a|b)$'],
      ['**', '.*'], // двойные звёздочки уже нормализованы
      ['?*', '^..*'],
    ]
    for (const [pattern, re] of cases) {
      expect(compileRegExp_(pattern, false, false)).toStrictEqual(new RegExp(re, 'i'))
    }
    // Символы вне диапазона /^[a-z_0-9]$/ экранируются явно, а специальные *? трансформируются
    expect(compileRegExp_('!@#$%^&()-+:}{|,[]', false, false)).toStrictEqual(/^\!\@\#\$\%\^\&\(\)\-\+\:\}\{\|\,\[\]$/i)
  })

  test('compileRegExp error pattern', () => {
    // @ts-expect-error
    expect(() => compileRegExp(1)).toThrow('[compileRegExp]')
    expect(() => compileRegExp('')).toThrow('[compileRegExp]')
    expect(() => compileRegExp('\\')).toThrow('[compileRegExp]')
    expect(() => compileRegExp('*')).toThrow('[compileRegExp]')
    expect(() => compileRegExp('**')).toThrow('[compileRegExp]')
    expect(() => compileRegExp('/ ** /')).toThrow('[compileRegExp]')
    expect(() => compileRegExp('/\\ /')).toThrow('[compileRegExp]')
    expect(() => compileRegExp('/\\ */')).toThrow('[compileRegExp]')
    expect(() => compileRegExp('foo/bar')).toThrow('[compileRegExp]')
    expect(() => compileRegExp('/foo/')).not.toThrow('[compileRegExp]')
  })

  test('compilePattern', () => {
    expect(() => compilePattern('')).toThrow('[compilePattern]')
    expect(() => compilePattern('//  \\  //')).toThrow('непустой строкой и состоять хотя бы')

    expect(compilePattern('src/**/?*.{js,ts}').segments).toStrictEqual([
      { kind: 4, depth: 1, re: /^src$/i },
      { kind: 2, depth: 0, re: null },
      { kind: 4, depth: 1, re: /^..*\.(js|ts)$/i }
    ])
    expect(compilePattern('/**/*/*.test.ts').segments).toStrictEqual([
      { kind: 3, depth: 1, re: null },
      { kind: 4, depth: 1, re: /.*\.test\.ts$/i }
    ])
    // Несколько вложенностей noIgnoreCase = true
    expect(compilePattern('*/*/*/**/file-*.ts', { noIgnoreCase: true }).segments).toStrictEqual([
      { kind: 3, depth: 3, re: null },
      { kind: 4, depth: 1, re: /^file\-.*\.ts$/ }
    ])
    //
    expect(compilePattern('**/srs/*/*/?/**/*/*/*.{js,ts}').segments).toStrictEqual([
      { kind: 2, depth: 0, re: null },
      { kind: 4, depth: 1, re: /^srs$/i },
      { kind: 1, depth: 2, re: null },
      { kind: 4, depth: 1, re: /^.$/i },
      { kind: 3, depth: 2, re: null },
      { kind: 4, depth: 1, re: /.*\.(js|ts)$/i },
    ])
  })
})
