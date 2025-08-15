/**
 * Кешированный результат теста пути.
 *
 * Для удобства, и во избежании путаницы с `undefined|null`, используется константный объект.
 */
type TTestResult = { readonly value: boolean }
const RELPATH_CACHE_TRUE: TTestResult = Object.freeze({ value: true })
const RELPATH_CACHE_FALSE: TTestResult = Object.freeze({ value: false })
const RELPATH_CACHE_TEST_GET = Symbol()
const RELPATH_CACHE_TEST_SET = Symbol()
const RELPATH_CACHE_CAN_GET = Symbol()
const RELPATH_CACHE_CAN_SET = Symbol()

/**
 * Путь относительно корня обхода дерева каталогов.
 *
 * **Warning:** Этот класс имеет приватный конструктор и должен создаваться статическим методом {@link RelPath.root()}.
 */
class RelPath {
  protected readonly _cacheTest = new WeakMap<object, TTestResult>()
  protected readonly _cacheCan = new WeakMap<object, TTestResult>()
  protected readonly _parent: null | RelPath
  protected readonly _level: number
  protected readonly _name: string

  protected constructor(parent: null | RelPath, level: number, name: string) {
    this._parent = parent
    this._level = level
    this._name = name
  }

  [RELPATH_CACHE_TEST_GET] (key: object) {
    return this._cacheTest.get(key)
  }
  [RELPATH_CACHE_TEST_SET] (key: object, result: boolean) {
    return this._cacheTest.set(key, result ? RELPATH_CACHE_TRUE : RELPATH_CACHE_FALSE)
  }
  [RELPATH_CACHE_CAN_GET] (key: object) {
    return this._cacheCan.get(key)
  }
  [RELPATH_CACHE_CAN_SET] (key: object, result: boolean) {
    return this._cacheCan.set(key, result ? RELPATH_CACHE_TRUE : RELPATH_CACHE_FALSE)
  }

  /**
   * Родительский путь или `null`, если это корень.
   */
  get parent (): null | RelPath {
    return this._parent
  }

  /**
   * Уровень. Для корневого пути это всегда `0`. Для любого файла в корневой директории - `1`, и т.д.
   */
  get level (): number {
    return this._level
  }

  /**
   * Имя файла или каталога. Для корневого пути это пустая строка `''`. Определить корень можно по {@link level}`:0`
   * или {@link parent}`:null`.
   */
  get name (): string {
    return this._name
  }

  /**
   * Расширяет путь путем создания нового экземпляра.
   *
   * @param name Непустое имя файла или каталога. Не путать с путем содержащим слеши.
   */
  extends (name: string): RelPath {
    return new RelPath(this, this.level + 1, name)
  }

  /**
   * Альтернатива {@link extends()} с передачей нескольких сегментов пути.
   *
   * Бесполезна для рекурсивного обхода каталога, но может полезной для тестов.
   *
   * @param names имена сегментов пути.
   */
  extendsPath (...names: string[]): RelPath {
    return names.reduce((a, v) => a.extends(v), this as RelPath)
  }

  /**
   * Возвращает итератор в обратном направлении от текущего пути до корня.
   *
   * @param withRoot + Установите `false`, если требуется обойти только реальный путь не включая корень.
   *                 + Установите `true`, если требуется получить корень полученный методом {@link RelPath.root()}.
   */
  * reverseIterator (withRoot: boolean): Generator<RelPath, void, undefined> {
    let cur: null | RelPath = this
    while (cur && (cur.level > 0 || withRoot)) {
      yield cur
      cur = cur.parent
    }
  }

  /**
   * Массив узлов начиная от корня(если `withRoot:true`).
   *
   * @param withRoot + Установите `false`, если требуется обойти только реальный путь не включая корень.
   *                 + Установите `true`, если требуется получить корень полученный методом {@link RelPath.root()}.
   */
  nodes (withRoot: boolean): RelPath[] {
    return [...this.reverseIterator(withRoot)].reverse()
  }

  /**
   * Возвращает путь в виде массива строк.
   */
  segments (): string[] {
    const segments = []
    for (const item of this.reverseIterator(false)) {
      segments.unshift(item.name)
    }
    return segments
  }

  /**
   * Возвращает строку относительного пути с правыми слешами
   */
  toString (): string {
    return this.segments().join('/')
  }

  /**
   * Создает корневой экземпляр {@link RelPath} для обхода корневой директории.
   *
   * Все последующие пути должны расширяться с помощью {@link extends()}.
   */
  static root (): RelPath {
    return new RelPath(null, 0, '')
  }
}

export {
  type TTestResult,
  RELPATH_CACHE_TRUE,
  RELPATH_CACHE_FALSE,
  RELPATH_CACHE_TEST_GET,
  RELPATH_CACHE_TEST_SET,
  RELPATH_CACHE_CAN_GET,
  RELPATH_CACHE_CAN_SET,
  RelPath
}
