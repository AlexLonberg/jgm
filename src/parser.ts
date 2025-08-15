import type { TMatcherOptions } from './matcher.js'
import { isNonemptyString, safeToString } from './utils.js'

const _trimEndBackSlashes = /[\s\\]*$/g
const _trimStartSlashes = /^[\s\\/]*\/\s*/
const _trimEndSlashes = /[\s\\/]*$/
const _trimEscapeSpace = /(^[\s\\]*\\\s+)|([\s\\]*$)/g
const _hasSlash = /\//
const _hasEndSlash = /\/$/
const _split = /[\s\\/]*\/\s*/g
const _allBackSlashes = /\\+/g
const _dblStar = /\*{2,}/g
const _letters = /^[a-z_0-9]$/i
const re = Object.freeze({
  get trimStartSlashes () {
    _trimStartSlashes.lastIndex = 0
    return _trimStartSlashes
  },
  get trimEndSlashes () {
    _trimEndSlashes.lastIndex = 0
    return _trimEndSlashes
  },
  get trimEndBackSlashes () {
    _trimEndBackSlashes.lastIndex = 0
    return _trimEndBackSlashes
  },
  get hasSlash () {
    _hasSlash.lastIndex = 0
    return _hasSlash
  },
  get hasEndSlash () {
    _hasEndSlash.lastIndex = 0
    return _hasEndSlash
  },
  get allBackSlashes () {
    _allBackSlashes.lastIndex = 0
    return _allBackSlashes
  },
  get split () {
    _split.lastIndex = 0
    return _split
  },
  get trimEscapeSpace () {
    _trimEscapeSpace.lastIndex = 0
    return _trimEscapeSpace
  },
  get dblStar () {
    _dblStar.lastIndex = 0
    return _dblStar
  },
  get letters () {
    _letters.lastIndex = 0
    return _letters
  }
})

/**
 * Подтип сегмента паттерна:
 *
 *  + `1` - Только одинарные звездочки - путь ограничен глубиной. Пример: `\/*\/*\/`.
 *  + `2` - Только двойная звездочка - любая глубина пути. Пример: `\/**\/foo\/`.
 *  + `3` - Свернутая комбинация одинарных и двойных звездочек - путь ограничен минимальной глубиной. Пример: `**\/*\/`.
 *  + `4` - Литерал конвертированный к регулярному выражению. Пример: `'' -> //i`.
 */
type TPatternSegmentKind = 1 | 2 | 3 | 4

/**
 * Один из подтипов сегмента паттерна со звездочками.
 */
type TPatternSegmentStar = {
  readonly kind: 1 | 2 | 3
  readonly depth: number
  readonly re: null
}

/**
 * Сегмент конвертированный к `RegExp`.
 */
type TPatternSegmentRegExp = {
  readonly kind: 4
  readonly depth: 0
  readonly re: RegExp
}

type _TSegmentRaw = {
  kind: TPatternSegmentKind,
  depth: number
  re: null | RegExp
}

function _defaultSegment (kind: TPatternSegmentKind): _TSegmentRaw {
  return {
    kind,
    depth: 0,
    re: null
  }
}

/**
 * Структура с результатом разбора Glob-паттерна.
 */
type TCompiledPattern = {
  /**
   * В конце паттерна присутствовал завершающий слеш. Пример: `src/test/`.
   */
  directoryOnly: boolean
  /**
   * Массив сегментов. Каждый сегмент заморожен и не может быть изменен.
   */
  segments: (TPatternSegmentStar | TPatternSegmentRegExp)[]
}

/**
 * Разбивает массив по запятой, если она не экранирована.
 */
function splitByComma_ (chars: readonly string[]): string[][] {
  const temp = [...chars]
  const arrays = []
  let i = 0
  for (; i < temp.length; ++i) {
    const char = temp[i]!
    if (char === '\\') {
      // Пропускаем экранированную запятую
      if (i + 1 < temp.length && temp[i + 1] === ',') {
        i++
      }
      continue
    }
    if (char === ',') {
      arrays.push(temp.splice(0, i))
      temp.splice(0, 1)
      i = temp.length > 0 ? -1 : 0
    }
  }
  if (temp.length > 0) {
    arrays.push(temp)
  }
  const uniq = new Set()
  const filtered = []
  for (const item of arrays) {
    const str = item.join('')
    if (!uniq.has(str)) {
      uniq.add(str)
      filtered.push(item)
    }
  }
  return filtered
}

/**
 * Поиск парной скобки.
 *
 * @param chars Массив для поиска
 * @param idx   Индекс скобки `{`
 */
function findClosingBrace_ (chars: string[], idx: number): -1 | number {
  // 1 - это уровень уже найденной скобки '{'
  let depth = 1
  // idx + 1 - пропускаем скобку '{'
  for (let i = idx + 1; i < chars.length; ++i) {
    const char = chars[i]!
    if (char === '\\') {
      i++
      continue
    }
    if (char === '}') {
      if ((--depth) === 0) {
        return i
      }
      continue
    }
    if (char === '{') {
      depth++
    }
  }
  return -1
}

/**
 * Внутренняя функция принимающая один из сегментов паттерна.
 * Вызывающие функции должны гарантировать:
 *
 *  + непустую строку '...'
 *  + не равную '\' | '*' | '**'
 *  + двойные звездочки '***' нормализованы строго к двум '**'
 *  + без правых слешей '/'
 *  + обрезаны любые пробельные символы и конечные экранирующие символы
 *  + экранирующие символы в теле приведены к одному '\\\\' -> '\'
 *  + начальный экранирующий символ не может экранировать пробел '\ xxx'
 */
function compileRegExp_ (segment: string, noIgnoreCase: boolean, experimentalUnicode: boolean): RegExp {
  let allowBrace = true
  const rec = (chars: string[]) => {
    const chunks: string[] = []
    let esc = false
    for (let i = 0; i < chars.length; ++i) {
      const char = chars[i]!
      if (char === '\\') {
        esc = true
        continue
      }
      if (esc) {
        esc = false
        // TODO experimentalUnicode
        if (experimentalUnicode) {
          if (/^[\p{L}\p{N}_ -]$/u.test(char)) {
            chunks.push(char)
          }
        }
        else if (re.letters.test(char)) {
          chunks.push(char)
        }
        else {
          chunks.push(`\\${char}`)
        }
        continue
      }
      if (char === '*') {
        if (chunks.length === 0 || chunks[chunks.length - 1] !== '.*') {
          chunks.push('.*')
        }
        continue
      }
      if (char === '?') {
        chunks.push('.')
        continue
      }
      // TODO experimentalUnicode
      if (experimentalUnicode) {
        if (/^[\p{L}\p{N}_ -]$/u.test(char)) {
          chunks.push(char)
          continue
        }
      }
      else if (re.letters.test(char)) {
        chunks.push(char)
        continue
      }
      if (char === '{' && allowBrace) {
        const idx = findClosingBrace_(chars, i)
        if (idx !== -1) {
          allowBrace = false
          // Разбиваем по запятой все что между скобками {<...>}
          const subs = splitByComma_(chars.slice(i + 1, idx))
          if (subs.length > 0) {
            chunks.push('(')
            for (const sub of subs) {
              chunks.push(...rec(sub), '|')
            }
            chunks[chunks.length - 1] = ')'
          }
          i = idx
          allowBrace = true
          continue
        }
      }
      // Неизвестный символ просто экранируем
      chunks.push(`\\${char}`)
    }
    return chunks
  }
  const chunks = rec([...segment])
  if (chunks[0] !== '.*') {
    chunks.unshift('^')
  }
  if (chunks[chunks.length - 1] !== '.*') {
    chunks.push('$')
  }
  // TODO experimentalUnicode
  const flags = (!noIgnoreCase && experimentalUnicode) ? 'iu' : !noIgnoreCase ? 'i' : experimentalUnicode ? 'u' : undefined
  return new RegExp(chunks.join(''), flags)
}

/**
 * Разбирает строку и конвертирует к регулярному выражению.
 *
 * @param segment Сегмент между слешами Glob-паттерна исключая звездочки `*` или `**`. Строка не должна иметь слешей,
 *                кроме экранирующих.
 * @param options Опциональные параметры. Две опции: {@link TMatcherOptions.noIgnoreCase},
 *                {@link TMatcherOptions.experimentalUnicode}.
 */
function compileRegExp (segment: string, options?: undefined | null | Pick<TMatcherOptions, 'noIgnoreCase' | 'experimentalUnicode'>): RegExp {
  if (!isNonemptyString(segment)) {
    throw new Error(`[compileRegExp] Glob-паттерн должен быть непустой строкой. Получено ${safeToString(segment)}.`)
  }
  const pat = segment
    .replace(re.trimStartSlashes, '')
    .replace(re.trimEndSlashes, '')
    .replace(re.dblStar, '**')
    .replace(re.allBackSlashes, '\\')
    .replace(re.trimEscapeSpace, '')
  if (pat === '' || pat === '*' || pat === '**' || pat === '\\' || re.hasSlash.test(pat)) {
    throw new Error(`[compileRegExp] Тело сегмента Glob-паттерна должно быть непустой строкой с допустимыми символами и не может содержать разделителя пути или только звездочки, получено: "${safeToString(segment)}".`)
  }
  return compileRegExp_(pat, !!options?.noIgnoreCase, !!options?.experimentalUnicode)
}

/**
 * Разбирает строку Glob-паттерна.
 *
 * @param pattern Непустая строка корректного Glob-паттерна.
 * @param options Опциональные параметры. Две опции: {@link TMatcherOptions.noIgnoreCase},
 *                {@link TMatcherOptions.experimentalUnicode}.
 */
function compilePattern (pattern: string, options?: undefined | null | Pick<TMatcherOptions, 'noIgnoreCase' | 'experimentalUnicode'>): TCompiledPattern {
  if (!isNonemptyString(pattern)) {
    throw new Error(`[compilePattern] Glob-паттерн должен быть непустой строкой. Получено ${safeToString(pattern)}.`)
  }
  // Удалим последние экранирующие слеши и пробелы - foo/\\ -> foo/
  let pat = pattern.replace(re.trimEndBackSlashes, '')
  // Смотрим есть ли правый конечный слеш - foo/,
  const directoryOnly = re.hasEndSlash.test(pat)
  // ... после чего очищаем крайние слеши \\/\\foo\\/\\ -> \\foo, но не перед телом паттерна
  // ... заодно нормализуем звездочки
  pat = pat.replace(re.trimStartSlashes, '').replace(re.trimEndSlashes, '').replace(re.dblStar, '**')
  // Разбиваем на сегменты удаляя все экранирующие символы перед разделителем - 'foo \\/\\bar' -> ['foo', '\\bar']
  const splitted = pat.split(re.split)

  const segments: _TSegmentRaw[] = []
  let seg: _TSegmentRaw = _defaultSegment(0 as any)
  const ensureLevel = (kind: TPatternSegmentKind) => {
    if (seg.kind !== kind) {
      // Пустой и пока неопределенной сегмент выше установлен в 0
      if (seg.kind === 0 as any) {
        seg.kind = kind
      }
      else {
        seg = _defaultSegment(kind)
      }
      segments.push(seg)
    }
  }

  for (let item of splitted) {
    // Контрольный для каждого сегмента
    //  + полностью чистим хвост от слешей и пробелов
    //  + сворачиваем экранирующие символы до одного
    //  + тримим передние экранирующие пробелы - имя файла не может начинаться и заканчиваться пробелами
    item = item.trimStart().replace(re.trimEndSlashes, '').replace(re.allBackSlashes, '\\').replace(re.trimEscapeSpace, '')
    if (item === '*') {
      if (seg.kind === 1 || seg.kind === 3) {
        seg.depth += 1
      }
      else if (seg.kind === 2) {
        seg.depth = 1
        seg.kind = 3
      }
      else {
        ensureLevel(1)
        seg.depth = 1
      }
    }
    else if (item === '**') {
      if (seg.kind !== 2 && seg.kind !== 3) {
        if (seg.kind === 1) {
          seg.kind = 3
        }
        else {
          ensureLevel(2)
        }
      }
    }
    else if (item !== '' && item !== '\\') {
      // Здесь при любом раскладе нужно создать сегмент
      if (seg.kind === 0 as any) {
        seg.kind = 4
      }
      else {
        seg = _defaultSegment(4)
      }
      seg.depth = 1
      seg.re = compileRegExp_(item, !!options?.noIgnoreCase, !!options?.experimentalUnicode)
      segments.push(seg)
    }
  }

  if (segments.length === 0) {
    throw new Error(`[compilePattern] Glob-паттерн должен быть непустой строкой и состоять хотя бы из одного допустимого символа, получено: "${safeToString(pattern)}".`)
  }

  return {
    directoryOnly,
    segments: segments.map((s) => Object.freeze(s)) as (TPatternSegmentStar | TPatternSegmentRegExp)[]
  }
}

export {
  re as re_,
  splitByComma_,
  compileRegExp_,
  findClosingBrace_,
  //
  type TPatternSegmentKind,
  type TPatternSegmentStar,
  type TPatternSegmentRegExp,
  type TCompiledPattern,
  compileRegExp,
  compilePattern
}
