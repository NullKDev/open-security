/**
 * tests/i18n/catalog.test.ts
 *
 * Validates structural integrity of the i18n message catalogs.
 * Ensures EN and ES catalogs are in sync and contain no empty values.
 *
 * Strategy: read both JSON files from disk, parse them, and compare
 * their key structures recursively. No runtime i18n infra needed.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'fs'
import path from 'path'

const MESSAGES_DIR = path.resolve(__dirname, '../../messages')
const EN_PATH = path.join(MESSAGES_DIR, 'en.json')
const ES_PATH = path.join(MESSAGES_DIR, 'es.json')

type JsonValue = string | number | boolean | null | JsonObject | JsonArray
type JsonObject = { [key: string]: JsonValue }
type JsonArray = JsonValue[]

let en: JsonObject
let es: JsonObject

beforeAll(() => {
  en = JSON.parse(fs.readFileSync(EN_PATH, 'utf-8')) as JsonObject
  es = JSON.parse(fs.readFileSync(ES_PATH, 'utf-8')) as JsonObject
})

/**
 * Collects all leaf key paths from a nested object, e.g. "nav.queue", "common.loading".
 */
function collectLeafPaths(obj: JsonObject, prefix = ''): string[] {
  const paths: string[] = []
  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    const value = obj[key]
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      paths.push(...collectLeafPaths(value as JsonObject, fullKey))
    } else {
      paths.push(fullKey)
    }
  }
  return paths
}

/**
 * Collects all top-level keys from a JSON object.
 */
function topLevelKeys(obj: JsonObject): string[] {
  return Object.keys(obj).sort()
}

describe('i18n catalog — file existence and validity', () => {
  it('messages/en.json exists', () => {
    expect(fs.existsSync(EN_PATH)).toBe(true)
  })

  it('messages/es.json exists', () => {
    expect(fs.existsSync(ES_PATH)).toBe(true)
  })

  it('en.json is valid JSON (parsed without error)', () => {
    expect(() => JSON.parse(fs.readFileSync(EN_PATH, 'utf-8'))).not.toThrow()
  })

  it('es.json is valid JSON (parsed without error)', () => {
    expect(() => JSON.parse(fs.readFileSync(ES_PATH, 'utf-8'))).not.toThrow()
  })
})

describe('i18n catalog — top-level namespace parity', () => {
  it('EN and ES have the same top-level namespaces', () => {
    expect(topLevelKeys(en)).toEqual(topLevelKeys(es))
  })
})

describe('i18n catalog — deep key structure parity', () => {
  it('every leaf key in en.json exists in es.json', () => {
    const enPaths = collectLeafPaths(en).sort()
    const esPaths = collectLeafPaths(es).sort()
    const missingInEs = enPaths.filter((p) => !esPaths.includes(p))
    expect(missingInEs).toEqual([])
  })

  it('every leaf key in es.json exists in en.json', () => {
    const enPaths = collectLeafPaths(en).sort()
    const esPaths = collectLeafPaths(es).sort()
    const missingInEn = esPaths.filter((p) => !enPaths.includes(p))
    expect(missingInEn).toEqual([])
  })

  it('EN and ES have the same total number of leaf keys', () => {
    const enPaths = collectLeafPaths(en)
    const esPaths = collectLeafPaths(es)
    expect(enPaths.length).toBe(esPaths.length)
  })
})

describe('i18n catalog — no empty values', () => {
  it('no key in en.json has an empty string value', () => {
    const enPaths = collectLeafPaths(en)
    const emptyKeys = enPaths.filter((keyPath) => {
      const parts = keyPath.split('.')
      let val: JsonValue = en
      for (const part of parts) {
        val = (val as JsonObject)[part]
      }
      return typeof val === 'string' && val.trim() === ''
    })
    expect(emptyKeys).toEqual([])
  })

  it('no key in es.json has an empty string value', () => {
    const esPaths = collectLeafPaths(es)
    const emptyKeys = esPaths.filter((keyPath) => {
      const parts = keyPath.split('.')
      let val: JsonValue = es
      for (const part of parts) {
        val = (val as JsonObject)[part]
      }
      return typeof val === 'string' && val.trim() === ''
    })
    expect(emptyKeys).toEqual([])
  })
})

describe('i18n catalog — spot checks on known keys', () => {
  it('en nav.queue is "Queue"', () => {
    expect((en.nav as JsonObject).queue).toBe('Queue')
  })

  it('es nav.queue is "Cola"', () => {
    expect((es.nav as JsonObject).queue).toBe('Cola')
  })

  it('en common.loading is non-empty', () => {
    expect(typeof (en.common as JsonObject).loading).toBe('string')
    expect(((en.common as JsonObject).loading as string).length).toBeGreaterThan(0)
  })

  it('es common.loading is non-empty', () => {
    expect(typeof (es.common as JsonObject).loading).toBe('string')
    expect(((es.common as JsonObject).loading as string).length).toBeGreaterThan(0)
  })

  it('en settings.languages.en is "English"', () => {
    const langs = (en.settings as JsonObject).languages as JsonObject
    expect(langs.en).toBe('English')
  })

  it('es settings.languages.es is "Español"', () => {
    const langs = (es.settings as JsonObject).languages as JsonObject
    expect(langs.es).toBe('Español')
  })
})
