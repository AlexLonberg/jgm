import { describe, test, expect } from 'vitest'
import { Glob } from './glob.js'
import { RelPath } from './path.js'
import {
  type TMatcherOptions,
  type Matcher,
  // NoopMatcher,
  CompiledMatcher,
  buildPatterns
} from './matcher.js'

// Простая структура для имитации дерева каталогов
type TDir = {
  n: string // имя каталога
  children?: TEntry[]
}
type TEntry = string | TDir

// Рекурсивно обходит тестовое дерево и возвращает список нормализованных путей
function walk (tree: TEntry[], matcher: Matcher): string[] {
  const list: string[] = []
  const rec = (entries: TEntry[], relPath: RelPath) => {
    const names = new Set<string>()
    const verify = (n: string) => {
      const lower = n.trim().toLowerCase()
      if (names.has(lower)) {
        throw new Error(`Дубликат имени в тестовом дереве "${n}"`)
      }
      names.add(lower)
    }
    for (const item of entries) {
      if (typeof item === 'string') {
        verify(item)
        const rel = relPath.extends(item)
        if (matcher.test(rel)) {
          list.push(rel.toString())
        }
        continue
      }
      verify(item.n)
      const rel = relPath.extends(item.n)
      if (item.children && matcher.can(rel)) {
        rec(item.children, rel)
      }
    }
  }
  rec(tree, RelPath.root())
  return list
}

describe('CompiledMatcher', () => {
  test('Базовое использование CompiledMatcher', () => {
    const tree: TEntry[] = [
      { n: '.git', children: ['file'] },
      { n: 'node_modules', children: ['file'] },
      {
        n: 'src',
        children: [
          { n: '.git', children: ['file'] },
          { n: 'node_modules', children: ['file'] },
          { n: 'system', children: ['core.ts'] },
          'docs.md',
          'index.ts',
          'index.test.ts'
        ]
      },
      'package.json',
      'tsconfig.json',
      'README.md'
    ]
    const options: TMatcherOptions = {
      // Регистр символов не имеет значения и игнорируется, стартовые слеши обрезаются
      include: ['SRC/**/*.ts', '/PACkage.JSON'],
      // Звездочки нормализуются к '**** -> **'
      exclude: ['***/.*', '**/node_modules/**', '****/*.test.ts']
    }
    const matcher = new CompiledMatcher(options)
    const result = walk(tree, matcher)
    expect(result).toStrictEqual([
      'src/system/core.ts',
      'src/index.ts',
      'package.json'
    ])
  })

  test('Precision depth', () => {
    const tree: TEntry[] = ['file',
      {
        n: 'foo', children: ['file',
          {
            n: '2', children: ['file',
              {
                n: '3', children: ['file',
                  {
                    n: '4', children: ['file']
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        n: 'bar', children: ['file',
          {
            n: '2', children: ['file',
              {
                n: '3', children: ['file',
                  {
                    n: '4', children: ['file']
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
    const matcher = new CompiledMatcher({
      // Третий уровень файлов
      include: '*/*/*e',
      maxDepth: 12 //
    })
    const result = walk(tree, matcher)
    expect(result).toStrictEqual([
      'foo/2/file',
      'bar/2/file'
    ])

    const matcher2 = new CompiledMatcher({
      maxDepth: 2
    })
    const result2 = walk(tree, matcher2)
    expect(result2).toStrictEqual([
      'file',
      'foo/file',
      'bar/file'
    ])
  })

  test('Конечный слеш <*>/ и однозначение определение директории', () => {
    const tree: TEntry[] = [
      {
        n: 'dist',
        children: [
          {
            // Файлы этого каталога не пройдут
            n: 'build', children: ['app', 'build']
          },
          'core' // пройдет
        ]
      },
      'index',
      'build', // Файл, который мы хотим сохранить
    ]
    const matcher = new CompiledMatcher({
      include: ['**/*'],
      // Явно устанавливаем последний слеш
      exclude: ['**/build/']
    })

    const result = walk(tree, matcher)
    expect(result).toStrictEqual([
      'dist/core',
      'index',
      'build'
    ])
  })

  test('Пользовательский Glob', () => {
    const tree: TEntry[] = [
      'file.1.txt',
      'file.23.txt',
      'file.456.txt',
      { n: 'folder', children: ['file.02.txt', 'file.789.txt'] }
    ]
    // Неподдерживаемые паттерны не являются помехой для сложных подборов путей.
    // Но это потребует некоторого вмешательства в Glob.
    class CustomGlob extends Glob {
      constructor() {
        // Паттерн {kind: 2, depth: 0, re: null}
        super('**')
        // @ts-expect-error Сегменты заморожены, но элемент можно по тихому добавить или подменить
        this._segments.push({ kind: 4, depth: 1, re: /^file\.[0-9]{3}\.txt$/ })
      }
    }

    // Мы получим нечто подобное '**/file.[0-9]{3}.txt'
    const matcher = new CompiledMatcher({ include: new CustomGlob() })
    // Подберет файлы только с тремя цифровыми счетчиками
    const result = walk(tree, matcher)
    expect(result).toStrictEqual([
      'file.456.txt',
      'folder/file.789.txt'
    ])
  })

  test('Case sensitive', () => {
    const tree: TEntry[] = ['File1', 'file2', 'file3', 'filE4']
    // Glob можно передавать явно, и установить noIgnoreCase не для всех паттернов, а только для конкретных
    const matcher = new CompiledMatcher({ include: [new Glob('**/F*', { noIgnoreCase: true }), '*e{3,4}'], noIgnoreCase: false })
    const result = walk(tree, matcher)
    expect(result).toStrictEqual(['File1', 'file3', 'filE4'])
  })

  test('buildPatterns error', () => {
    // @ts-expect-error
    expect(() => buildPatterns(1)).toThrow('[buildPatterns]')
    expect(() => buildPatterns([])).toThrow('[buildPatterns]')
    // @ts-expect-error
    expect(() => buildPatterns([1])).toThrow('[compilePattern]')
    expect(() => buildPatterns(['////'])).toThrow('[compilePattern]')
  })
})
