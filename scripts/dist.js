import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync, writeFileSync, copyFileSync, readdirSync, mkdirSync, rmSync, lstatSync } from 'node:fs'

const projectDir = dirname(dirname(fileURLToPath(import.meta.url)))
const distDir = join(projectDir, 'dist')

function clearDir (path) {
  try {
    const stats = lstatSync(path)
    if (!stats.isDirectory()) {
      rmSync(path)
      throw 0
    }
  } catch (_) {
    mkdirSync(path)
    return
  }
  const files = readdirSync(path, { encoding: 'utf8', withFileTypes: false })
  for (const name of files) {
    rmSync(join(path, name), { force: true, maxRetries: 5, retryDelay: 100 })
  }
}

void function () {
  clearDir(distDir)

  const jsonMap = new Map(Object.entries(
    JSON.parse(readFileSync(join(projectDir, 'package.json'), { encoding: 'utf8' }))
  ))

  const json = {}
  for (const key of ['name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'type']) {
    json[key] = jsonMap.get(key)
  }
  json.main = './index.js'
  json.types = './index.d.ts'
  json.exports = {
    '.': {
      import: './index.js',
      types: './index.d.ts'
    }
  }
  writeFileSync(join(distDir, 'package.json'), JSON.stringify(json, null, 2), { encoding: 'utf8' })

  for (const name of ['LICENSE.md', 'README.md']) {
    copyFileSync(join(projectDir, name), join(distDir, name))
  }
}()
