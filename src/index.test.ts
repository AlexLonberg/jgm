import { test, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readdir } from 'node:fs/promises'

import {
  type TMatcherOptions,
  type Matcher,
  RelPath,
  CompiledMatcher,
} from './index.js'

const workDir = dirname(dirname(fileURLToPath(import.meta.url)))

test('Quick start', async () => {

  async function walkAsync (root: string, matcher: Matcher): Promise<string[]> {
    const files: string[] = []

    const rec = async (rel: RelPath) => {
      const entries = await readdir(join(root, rel.toString()), {
        encoding: 'utf8',
        recursive: false,
        withFileTypes: true
      })

      for (const item of entries) {
        // Расширяем корневой путь
        const relPath = rel.extends(item.name)
        if (item.isDirectory()) {
          // Для каталогов вызывается can() - Определяет возможность входа в каталог.
          if (matcher.can(relPath)) {
            await rec(relPath)
          }
        }
        else if (item.isFile()) {
          // Тестирование пути к файлу - Определяем подходит ли путь паттерну.
          if (matcher.test(relPath)) {
            files.push(relPath.toString())
          }
        }
        else {
          console.warn(`unsupported file of symlink path: "${relPath.toString()}"`)
        }
      }
    }
    // Корневой путь создается статическим методом и не имеет имени.
    await rec(RelPath.root())

    return files
  }

  const options: TMatcherOptions = {
    include: ['src/**/*?.ts', 'package.json', 'lic*.md', 'readme.md'],
    exclude: ['**/*.test.ts', '**/node_modules/**'],
    maxDepth: 4 // максимально допустимая глубина обхода
  }
  const matcher = new CompiledMatcher(options)

  const files = await walkAsync(workDir, matcher)
  expect(files.length).toBe(9)
  expect(files).toEqual(expect.arrayContaining([
    'src/glob.ts',
    'src/index.ts',
    'src/matcher.ts',
    'src/parser.ts',
    'src/path.ts',
    'package.json',
    'LICENSE.md',
    'README.md'
  ]))
})
