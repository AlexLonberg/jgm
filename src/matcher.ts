import { Glob } from './glob.js'
import type { RelPath } from './path.js'
import { isNullish, isString, ensureMaxDepth, safeToString } from './utils.js'

/**
 * Опциональные параметры {@link CompiledMatcher}.
 */
type TMatcherOptions = {
  /**
   * Паттерны для включения.
   *
   * Пути паттернов должны быть относительны корневой директории. Начальные слеши игнорируются и обрезаются.
   *
   * **Warning:** Пустой массив недопустим и бросит исключение.
   *
   * Паттерном может быть скомпилированный {@link Glob}.
   */
  include?: undefined | null | string | Glob | (string | Glob)[]
  /**
   * Паттерны для исключения. Этот параметр имеет приоритет и тестируется в первую очередь.
   *
   * Пути паттернов должны быть относительны корневой директории. Начальные слеши игнорируются и обрезаются.
   *
   * **Warning:** Пустой массив недопустим и бросит исключение.
   *
   * Паттерном может быть скомпилированный {@link Glob}.
   */
  exclude?: undefined | null | string | Glob | (string | Glob)[]
  /**
   * Положительное число `>= 1` максимально допустимой длины сегментов пути. По умолчанию `64`.
   *
   * Защищает от случайных непреднамеренных ошибках в паттернах и предотвращает глубокий обход каталогов.
   *
   * Округляется в меньшую сторону до целого `Math.floor(2.0001) -> 2`. Любое значение `x < 1` приводится к `1`.
   */
  maxDepth?: undefined | null | number
  /**
   * По умолчанию конструктору регулярного выражения передается флаг `'i'`. Такое поведение ожидаемо для Glob - паттернов.
   * Чтобы избежать установки этого флага - передайте`true`.
   */
  noIgnoreCase?: undefined | null | boolean
  /**
   * Игнорировать ошибки при разборе Glob-паттернов. По умолчанию любая ошибка бросит исключение.
   *
   * Узнать об ошибках можно предварительно подготовив массивы паттернов при помощи конструктора {@link Glob()}.
   */
  ignoreError?: undefined | null | boolean
  // TODO experimentalUnicode
  /**
   * Компилировать регулярные выражения с поддержкой Unicode(флаг `u`). По умолчанию `false`.
   *
   * **Warning:** Работоспособность этой опции не гарантируется - нет достаточных тестов. Проверка символов которые
   * нельзя экранировать проводится выражением `/^[\p{L}\p{N}_ -]$/u`.
   */
  experimentalUnicode?: undefined | null | boolean
}

/**
 * Основной интерфейс с набором скомпилированных паттернов {@link Glob} для подбора пути.
 */
abstract class Matcher {
  /**
   * Положительное число `>= 1` максимально допустимой длины сегментов пути.
   */
  abstract readonly maxDepth: 1 | number
  /**
   * Паттерны для включения. Гарантируется что массив никогда не пуст.
   */
  abstract readonly include: null | (readonly Glob[])
  /**
   * Паттерны для исключения. Гарантируется что массив никогда не пуст.
   */
  abstract readonly exclude: null | (readonly Glob[])
  /**
   * Подходит ли путь тестируемого файла одному из паттернов.
   *
   * **Note:** Применяйте этот метод только к файлам. Возможность входа в каталог определяется методом {@link can()}.
   *
   * @param path  Тестируемый путь файла.
   */
  abstract test (path: RelPath): boolean
  /**
   * Может ли путь тестируемой директории подойти одному из паттернов. Применимо только для путей каталогов.
   *
   * **Note:** Метод сопоставляет путь директории с началом путей патернов.
   *
   * @param path Тестируемый путь.
   */
  abstract can (path: RelPath): boolean
}

/**
 * Реализация {@link Matcher} без паттернов - может применяться как заглушка.
 */
class NoopMatcher extends Matcher {
  get maxDepth (): 1 { return 1 }
  get include (): null { return null }
  get exclude (): null { return null }
  test (_path: RelPath): true { return true }
  can (_path: RelPath): true { return true }
}

/**
 * Собирает массив скомпилированных {@link Glob}.
 *
 * Функция гарантирует непустой массив или `null`.
 *
 * @param patterns     Один из допустимых вариантов - может быть строкой, {@link Glob} или массивом. Недопустимые типы
 *                     или пустые строки бросают исключение.
 * @param options      Опциональные параметры. Три опции: {@link TMatcherOptions.noIgnoreCase},
 *                     {@link TMatcherOptions.ignoreError}, {@link TMatcherOptions.experimentalUnicode}.
 */
function buildPatterns (
  patterns: undefined | null | string | Glob | (readonly (string | Glob)[]),
  options?: undefined | null | Pick<TMatcherOptions, 'noIgnoreCase' | 'ignoreError' | 'experimentalUnicode'>
): null | Glob[] {
  if (isNullish(patterns)) {
    return null
  }
  const arr: (string | Glob)[] = (isString(patterns) || (patterns instanceof Glob))
    ? [patterns]
    : (Array.isArray(patterns) ? patterns : [])

  const globs: Glob[] = []
  for (const item of arr) {
    if (item instanceof Glob) {
      globs.push(item)
      continue
    }
    try {
      const glob = new Glob(item, options)
      globs.push(glob)
    } catch (e) {
      if (!options?.ignoreError) {
        throw e
      }
    }
  }

  if (globs.length > 0) {
    return globs
  }
  /* v8 ignore next 4 */
  if (options?.ignoreError) {
    return null
  }
  throw new Error(`[buildPatterns] Некорректный типа параметра 'patterns', ожидается 'undefined|null|string|Glob' или непустой массив '(string|Glob)[]'. Получено: ${safeToString(patterns, true)}.`)
}

/**
 * Реализация {@link Matcher} с набором скомпилированных паттернов {@link Glob} для подбора пути.
 */
class CompiledMatcher extends Matcher {
  protected readonly _maxDepth: number
  protected readonly _include: null | readonly Glob[]
  protected readonly _exclude: null | readonly Glob[]

  /**
   * Создает сопоставитель подбора путей.
   *
   * @param options Опциональные параметры должны иметь хотя бы один набор паттернов, в противном случае, использовать
   * класс не имеет смысла. Для пустой заглушки используйте {@link NoopMatcher}.
   *  + Пустой массив `include/exclude` расценивается как ошибка и конструктор завершится ошибкой. Исключить все файлы
   *    можно явным `exclude:"**\/*"`.
   *  + Пути паттернов должны быть относительны корневой директории. Начальные слеши игнорируются и обрезаются.
   *  + Опция {@link TMatcherOptions.ignoreError} может оказать негативный эффект - если все паттерны некорректны, то
   *    массив окажется пуст и будет проигнорирован. В результате сопоставитель пропустит все файлы.
   */
  constructor(options: TMatcherOptions) {
    super()
    this._maxDepth = ensureMaxDepth(options.maxDepth)
    this._include = buildPatterns(options.include, options)
    this._exclude = buildPatterns(options.exclude, options)
  }
  /* v8 ignore next 3 */
  get maxDepth (): number {
    return this._maxDepth
  }
  /* v8 ignore next 3 */
  get include (): null | Glob[] {
    return this._include ? [...this._include] : null
  }
  /* v8 ignore next 3 */
  get exclude (): null | Glob[] {
    return this._exclude ? [...this._exclude] : null
  }

  test (path: RelPath): boolean {
    return path.level > this._maxDepth
      ? false
      : this._exclude?.some((p) => p.test(path, false))
        ? false
        : (this._include?.some((p) => p.test(path, false)) ?? true)
  }

  can (path: RelPath): boolean {
    return path.level > this._maxDepth
      ? false
      : this._exclude?.some((p) => p.test(path, true))
        ? false
        : (this._include?.some((p) => p.can(path)) ?? true)
  }
}

export {
  type TMatcherOptions,
  Matcher,
  NoopMatcher,
  CompiledMatcher,
  buildPatterns
}
