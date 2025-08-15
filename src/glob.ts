import { type TPatternSegmentStar, type TPatternSegmentRegExp, compilePattern } from './parser.js'
import {
  type RelPath,
  RELPATH_CACHE_TEST_GET,
  RELPATH_CACHE_TEST_SET,
  RELPATH_CACHE_CAN_GET,
  RELPATH_CACHE_CAN_SET,
} from './path.js'
import type { TMatcherOptions } from './matcher.js'

// helper: сдвигает node назад на `count` шагов; возвращает null, если не хватает уровней
function skip (node: RelPath | null, count: number): null | RelPath {
  let cur = node
  for (let i = 0; i < count; i++) {
    if (!cur || cur.level === 0) return null // корень и дальше нельзя
    cur = cur.parent
  }
  return cur
}

function matchRec (
  segments: readonly (TPatternSegmentStar | TPatternSegmentRegExp)[],
  path: RelPath
) {
  // Рекурсивный матч: node - текущая позиция (последний ещё не сопоставленный сегмент),
  // pi - индекс текущего сегмента паттерна (двигаем влево).
  const rec = (node: RelPath | null, pi: number): boolean => {
    // паттерн кончился
    if (pi < 0) {
      return !!node && node.level === 0 // совпадение только если путь тоже полностью съеден
    }

    // если путь исчерпан (root) - проверяем может ли остаток паттерна быть пустым
    // kind:2 схлопывается в один, а значит достаточно проверить не он ли в начале
    if (!node || node.level === 0) {
      return pi > 0 ? false : segments[0]!.kind === 2
    }

    const seg = segments[pi]!
    // попытка взять кеш для текущей пары (node, сегмент)
    const cached = node[RELPATH_CACHE_TEST_GET](seg)
    if (cached) {
      return cached.value
    }

    let res = false

    if (seg.kind === 4) {
      // RegExp - должен совпасть текущий сегмент и двинуться дальше
      if (seg.re.test(node.name)) {
        res = rec(node.parent, pi - 1)
      } else {
        res = false
      }
    }
    else if (seg.kind === 1) {
      // группа одиночных звездочек - ровно seg.depth сегментов
      const after = skip(node, seg.depth)
      if (after) {
        res = rec(after, pi - 1)
      } else {
        res = false
      }
    }
    else if (seg.kind === 2) {
      // pure '**' - >= 0 сегментов
      // Оптимизация: если следующий сегмент RegExp, пробегаем только совпадающие узлы
      const nextSeg = segments[pi - 1]
      if (nextSeg && nextSeg.kind === 4) {
        // ищем в обратной итерации узлы, у которых re совпадает; включаем текущий node (skip 0)
        for (const candidate of node.reverseIterator(false)) {
          if (nextSeg.re.test(candidate.name)) {
            if (rec(candidate, pi - 1)) {
              res = true
              break
            }
          }
        }
      }
      else {
        // обычный перебор: пробуем всякий возможный "skip" от 0 до корня
        for (const cur of node.reverseIterator(true)) {
          if (rec(cur, pi - 1)) {
            res = true
            break
          }
        }
      }
    }
    else if (seg.kind === 3) {
      // комбинация '**' + n * - минимум = seg.depth, максимум - неограниченно
      const minStart = skip(node, seg.depth)
      if (!minStart) {
        res = false
      }
      else {
        const nextSeg = segments[pi - 1]
        if (nextSeg && nextSeg.kind === 4) {
          // оптимизация: ищем только узлы, у которых re совпадает, начиная с minStart
          for (const candidate of minStart.reverseIterator(false)) {
            if (nextSeg.re.test(candidate.name)) {
              if (rec(candidate, pi - 1)) {
                res = true
                break
              }
            }
          }
        }
        else {
          // пробуем все варианты начиная с minStart (включая minStart)
          for (const cur of minStart.reverseIterator(true)) {
            if (rec(cur, pi - 1)) {
              res = true
              break
            }
          }
        }
      }
    }
    else {
      res = false // на случай неизвестного kind
    }

    // записываем кеш для данной пары
    node[RELPATH_CACHE_TEST_SET](seg, res)
    return res
  }

  return rec(path, segments.length - 1)
}

// Универсальный префикс-матч с бектрекингом и кешем (node, segment)
function canRec (
  segments: readonly (TPatternSegmentStar | TPatternSegmentRegExp)[],
  path: RelPath
) {
  const lastIndex = segments.length - 1
  const nodes = path.nodes(false) // nodes[0] - first, nodes[i].name - i-й сегмент (i>=0)
  const pathLen = nodes.length    // число реальных сегментов (без root)

  const rec = (si: number, pi: number): boolean => {
    // si - сколько сегментов пути уже сопоставлено (0..pathLen)
    // pi - индекс сегмента паттерна (0..lastIndex)

    // Если текущий путь целиком покрыт (мы уже в каталоге), дальше можно дорисовать что угодно - OK
    if (si >= pathLen) {
      return true
    }

    // Если паттерн закончился, а в текущем пути ещё есть сегменты - уже ушли влево мимо паттерна
    if (pi > lastIndex) {
      return false
    }

    const seg = segments[pi]!
    // Кешируем по паре (текущий узел-префикс, сегмент паттерна)
    const nodeForCache = nodes[si]!
    const cached = nodeForCache[RELPATH_CACHE_CAN_GET](seg)
    if (cached) {
      return cached.value
    }

    let res = false

    if (seg.kind === 4) {
      // Литерал/RegExp: должен совпасть текущий сегмент пути
      const name = nodes[si]!.name
      if (seg.re.test(name)) {
        res = rec(si + 1, pi + 1)
      } else {
        res = false
      }
    }
    else if (seg.kind === 1) {
      // Группа одиночных '*' - ровно depth сегментов.
      // Если сегментов в текущем пути не хватает - префикс допустим, углубимся позже.
      if (si + seg.depth <= pathLen) {
        res = rec(si + seg.depth, pi + 1)
      } else {
        res = true
      }
    }
    else if (seg.kind === 2) {
      // '**' - съедаем 0..k оставшихся сегментов текущего пути и смотрим, можно ли продолжить
      for (let skip = 0; si + skip <= pathLen; skip++) {
        if (rec(si + skip, pi + 1)) {
          res = true
          break
        }
      }
    }
    else if (seg.kind === 3) {
      // '**/*' - минимум depth сегментов, максимум неограниченно.
      const remain = pathLen - si
      if (remain < seg.depth) {
        // Текущих сегментов меньше минимума - префикс допустим, доберём глубину ниже.
        res = true
      } else {
        for (let skip = seg.depth; si + skip <= pathLen; skip++) {
          if (rec(si + skip, pi + 1)) {
            res = true
            break
          }
        }
      }
    }
    nodeForCache[RELPATH_CACHE_CAN_SET](seg, res)
    return res
  }

  return rec(0, 0)
}

/**
 * Скомпилированный Glob-паттерн с методами подбора пути при обходе дерева каталогов.
 */
class Glob {
  protected readonly _keyDir = Object.create(null)
  protected readonly _keyFile = Object.create(null)
  protected readonly _directoryOnly: boolean
  protected readonly _segments: readonly (TPatternSegmentStar | TPatternSegmentRegExp)[]

  /**
   * @param pattern Непустая строка корректного Glob-паттерна.
   * @param options Опциональные параметры. Две опции: {@link TMatcherOptions.noIgnoreCase},
 *                  {@link TMatcherOptions.experimentalUnicode}.
   */
  constructor(pattern: string, options?: undefined | null | Pick<TMatcherOptions, 'noIgnoreCase' | 'experimentalUnicode'>) {
    const parsed = compilePattern(pattern, options)
    this._directoryOnly = parsed.directoryOnly
    this._segments = parsed.segments
  }

  /**
   * Был ли в конце паттерна определен последний слеш.
   *
   * Такой паттерн подходит только директориям.
   */
  get directoryOnly (): boolean {
    return this._directoryOnly
  }

  /**
   * Массив сегментов Glob-паттерна.
   */
  get segments (): (TPatternSegmentStar | TPatternSegmentRegExp)[] {
    return [...this._segments]
  }

  /**
   * Подходит ли путь текущему паттерну.
   *
   * @param path  Тестируемый путь.
   * @param isDir Путь является каталогом. Этот параметр влияет на конечный слеш паттерна `'foo/'`.
   *              Если аргумент `false` и паттерн имеет последний слеш, проверка не пройдет.
   *              Если {@link directoryOnly}`:false`, то `isDir` не имеет эффекта.
   */
  test (path: RelPath, isDir: boolean): boolean {
    // Выбираем нужный ключ, иначе получим ошибку.
    const key = isDir ? this._keyDir : this._keyFile
    const result = path[RELPATH_CACHE_TEST_GET](key)
    if (result) {
      return result.value
    }
    if ((this._directoryOnly && !isDir) || path.level === 0) {
      path[RELPATH_CACHE_TEST_SET](key, false)
      return false
    }
    const finalRes = matchRec(this._segments, path)
    path[RELPATH_CACHE_TEST_SET](key, finalRes)
    return finalRes
  }

  /**
   * Может ли путь тестируемой директории совпасть с данным паттерном. Применимо только для путей каталогов.
   *
   * **Note:** Для паттернов `exclude` этот метод не применяется.
   *
   * @param path Тестируемый путь.
   */
  can (path: RelPath): boolean {
    // Массив сегментов уникален - будем его использовать как ключ кеша, здесь нет разницы как в test()
    const result = path[RELPATH_CACHE_CAN_GET](this._segments)
    if (result) {
      return result.value
    }
    if (path.level === 0) {
      path[RELPATH_CACHE_CAN_SET](this._segments, false)
      return false
    }
    const finalRes = canRec(this._segments, path)
    path[RELPATH_CACHE_CAN_SET](this._segments, finalRes)
    return finalRes
  }
}

export {
  Glob
}
