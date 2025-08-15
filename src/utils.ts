/**
 * Максимально допустимая длина сегментов пути.
 */
const DEFAULT_MAX_DEPTH = 64

/**
 * Является ли значение типом `undefined` или `null`.
 */
function isNullish (value: any): value is (undefined | null) {
  return typeof value === 'undefined' || value === null
}

/**
 * Является ли значение строкой.
 */
function isString (value: any): value is string {
  return typeof value === 'string'
}

/**
 * Является ли значение непустой строкой. Под непустой строкой следует понимать, в том числе, любой набор символов
 * включая пробельные.
 */
function isNonemptyString (value: any): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * Обеспечивает корректное значение `number(int) > 0` или возвращает значение по умолчанию {@link DEFAULT_MAX_DEPTH}.
 */
function ensureMaxDepth (maxDepth: any | number): number {
  if (Number.isFinite(maxDepth)) {
    const value = Math.floor(maxDepth)
    if (value > 0) {
      return value
    }
  }
  return DEFAULT_MAX_DEPTH
}

/**
 * Пытается привести значение к строке. В основном это для ошибок.
 *
 * @param value Любое значение для которого вызывается `toString()` и, в случае ошибки, `JSON.stringify()`.
 * @param useJson Использовать только `JSON.stringify()`.
 * @returns Всегда возвращает строку, даже если она пуста.
 */
function safeToString (value: any, useJson?: boolean): string {
  try {
    if (!useJson) {
      return value.toString()
    }
  } catch (_) { /**/ }
  try {
    return JSON.stringify(value)
  } catch (_) { /**/ }
  return ''
}

export {
  DEFAULT_MAX_DEPTH,
  isNullish,
  isString,
  isNonemptyString,
  ensureMaxDepth,
  safeToString
}
