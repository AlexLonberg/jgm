/* eslint-disable no-useless-escape */
import { describe, test, expect } from 'vitest'
import { RelPath } from './path.js'
import { Glob } from './glob.js'

describe('Glob', () => {
  test('Совпадение имени файла', () => {
    const root = RelPath.root()
    const path = (rel: string): RelPath => {
      return root.extendsPath(...rel.split('/'))
    }

    const cases: [Glob, ...[string, boolean][]][] = [
      // Любой файл первого уровня
      [new Glob('*'), ['1', true], ['1/2', false]],
      // Любой файл второго уровня
      [new Glob('*/*'), ['1', false], ['1/2', true], ['1/2/3', false]],
      // Не менее двух уровней
      [new Glob('**/*/*'), ['1', false], ['1/2', true], ['1/2/3', true]],
      // Глубина не ограничена
      [new Glob('**/file'), ['file', true], ['1/file', true], ['1/2/file', true]],
      // ⚠️ Литерал так же считается уровнем
      [new Glob('**/*/file'), ['file', false], ['1/file', true], ['1/2/file', true]],
      // Строго 2 симола
      [new Glob('??'), ['1', false], ['12', true]],
      // Не менее 2-х символов
      [new Glob('?*?'), ['1', false], ['12', true], ['123', true]],
      // Один из вариантов. ⚠️ Пробел и пустота - учитываются
      [new Glob('s{,1,2, }e'), ['s1e', true], ['s2e', true], ['s3e', false], ['s e', true], ['se', true]],
      // Чувствительность к регистру
      [new Glob('**/file'), ['FILE', true], ['file', true]],
      [new Glob('**/file', { noIgnoreCase: true }), ['FILE', false], ['file', true]],
    ]

    for (const [gl, ...cs] of cases) {
      for (const [rel, result] of cs) {
        expect(gl.test(path(rel), false)).toBe(result)
      }
    }

    // Наглядное представление группы
    const glob = new Glob('s{,1,2, }e')
    expect(glob.segments).toStrictEqual([
      { kind: 4, depth: 1, re: /^s(|1|2|\ )e$/i }
    ])
    for (const [rel, result] of [['s1e', true], ['s2e', true], ['s3e', false], ['s e', true], ['se', true]] as const) {
      expect(glob.test(path(rel), false)).toBe(result)
    }
  })

  test('Подходящие пути каталогов', () => {
    // Подходит ли начало пути к паттернам определяется методом can()
    const root = RelPath.root()
    const path = (rel: string): RelPath => root.extendsPath(...rel.split('/'))

    const glob = new Glob('src/**/*')
    // тест пути бы провалился
    expect(glob.test(path('src'), true)).toBe(false)
    // ... но не тест входа в каталог
    expect(glob.can(path('src'))).toBe(true)
    expect(glob.can(path('src/bar'))).toBe(true)
    expect(glob.can(path('source'))).toBe(false)

    const cases: [string, ...[string, boolean][]][] = [
      // Три уровня, где foo на втором
      ['*/foo/*', ['bar', true], ['bar/foo', true], ['bar/box/foo', false], ['bar/foo/box', true], ['bar/foo/box/foo', false]],
      // Пропустит только одну из директорий
      ['{src,source}', ['src', true], ['source', true], ['dist', false], ['src/utils', false]],
    ]

    for (const [pat, ...cs] of cases) {
      const gl = new Glob(pat)
      for (const [rel, result] of cs) {
        expect(gl.can(path(rel))).toBe(result)
      }
    }
  })

  test('Неожиданное поведение', () => {
    const root = RelPath.root()
    const path = (rel: string): RelPath => {
      return root.extendsPath(...rel.split('/'))
    }
    // Неожиданное поведение.
    // Любой паттерн разбивается по разделителям пути, пробелам и лишним экранирующим символам
    // Имя с начальными и конечными пробелами "foo  " не имеет смысла и никогда не совпадет с
    // именем файла/каталога. Но тело {<...>} остается нетронутым
    const gl = new Glob('/foo \\ /bar{ } ')
    expect(gl.segments).toStrictEqual([
      { kind: 4, depth: 1, re: /^foo$/i },
      { kind: 4, depth: 1, re: /^bar(\ )$/i }
    ])
    expect(gl.test(path('foo/bar '), false)).toBe(true)
    expect(gl.test(path('foo /bar'), false)).toBe(false)
  })

  test('Неподдерживаемое экранирование обратных слешей', () => {
    // Любой обратный слеш не может экранировать сам себя и разделитель
    // Такие слеши сливаются в один и применяются к следующему символу
    // Символы /^[a-z_0-9]$/i никогда не экранируются
    const gl = new Glob('foo \\/ \\1 \\\\2')
    //           игнорируется ^
    expect(gl.segments).toStrictEqual([
      { kind: 4, depth: 1, re: /^foo$/i },
      { kind: 4, depth: 1, re: /^1\ 2$/i }
    ])

    // Экранирование UUID
    const root = RelPath.root()
    const uuid = new Glob('**/\\{????????-????-?????????-????????????\\}')
    expect(uuid.test(root.extends('{e799f7ea-80ed-49c7-b9f1-f78c6d2210af}'), false)).toBe(true)
  })

  test('Экспериментальная поддержка Unicode', () => {
    const root = RelPath.root()
    const gl = new Glob('Не/en-Us/путь*')
    expect(gl.segments).toStrictEqual([
      { kind: 4, depth: 1, re: /^\Н\е$/i },
      { kind: 4, depth: 1, re: /^en\-Us$/i },
      { kind: 4, depth: 1, re: /^\п\у\т\ь.*/i },
    ])
    expect(gl.test(root.extendsPath('Не', 'en-Us', 'путь .рф'), false)).toBe(true)

    // Для emoji, без флага 'u' нужно два символа. Поддержка юникода требует детального изучения синтаксиса,
    // и правильного экранирования символов. Иначе RegExp(,'u') ломается на первой же ошибке с обратным слешем.
    const emoji = new Glob('Не/🤔/??/путь')
    expect(emoji.test(root.extendsPath('Не', '🤔', 'ФЩ', 'путь'), false)).toBe(true)
    expect(emoji.test(root.extendsPath('Не', '🤔', '🤔', 'путь'), false)).toBe(true)

    // Поддержка Unicode включается опцией, но чтобы предоставить паттерну символ '🤗', нужны дополнительные \p{Emoji}
    // В этом варианте для emoji требуется один '?'(выше два)
    const glu = new Glob('?/?{рф,com}*', { experimentalUnicode: true })
    expect(glu.segments).toStrictEqual([
      { kind: 4, depth: 1, re: /^.$/iu },
      { kind: 4, depth: 1, re: /^.(рф|com).*/iu },
    ])
    expect(glu.test(root.extendsPath('🤗', '🤗рф'), false)).toBe(true)
    expect(glu.test(root.extendsPath('🤗', '🤗com'), false)).toBe(true)

    // Категории Unicode
    // https://www.fileformat.info/info/unicode/category/index.htm
    // https://www.regular-expressions.info/unicode.html#category
    // Для поддержки emoji можно добавить /^[\p{L}\p{N}\p{Emoji}_ -]$/u.test(char)
    //   new Glob('your/🤗/path', ...)
    // ... но лучше этого избегать
    const re1 = /\p{Emoji}/u
    expect(re1.test('🤗')).toBe(true)
    const re2 = new RegExp('.../🤗/...', 'ui')
    expect(re2.test('foo/🤗/bar')).toBe(true)
  })
})
