import { describe, expect, it } from 'vitest'
import { gcsOpClass, gcsOpsByClass } from '../src/main/config/gcsOps'

// Los métodos son los que la métrica de GCS reporta de verdad en el
// proyecto (verificados contra api/request_count), clasificados como los
// agrupa la página de pricing.

describe('gcsOpClass', () => {
  it('escrituras, listados, updates y rewrites son clase A', () => {
    for (const method of [
      'WriteObject',
      'ListObjects',
      'MoveObject',
      'RewriteObject.To',
      'ComposeObject',
      'UpdateBucketMetadata',
      'UpdateObjectMetadata',
      'SetIamPolicy',
    ]) {
      expect(gcsOpClass(method), method).toBe('a')
    }
  })

  it('las lecturas son clase B', () => {
    for (const method of [
      'ReadObject',
      'GetObjectMetadata',
      'GetBucketMetadata',
      'GetBucketStorageLayout',
      'GetIamPolicy',
      'TestIamPermissions',
    ]) {
      expect(gcsOpClass(method), method).toBe('b')
    }
  })

  it('los borrados son gratis y no se cuentan', () => {
    expect(gcsOpClass('DeleteObject')).toBe('skip')
    expect(gcsOpClass('CancelResumableWrite')).toBe('skip')
  })

  it('un rewrite se cuenta UNA vez: el lado .From se descarta', () => {
    expect(gcsOpClass('RewriteObject.From')).toBe('skip')
    expect(gcsOpClass('RewriteObject.To')).toBe('a')
  })

  it('un método desconocido cae en clase A: cota superior, no gratis inventado', () => {
    expect(gcsOpClass('FrobnicateObject')).toBe('a')
  })
})

describe('gcsOpsByClass', () => {
  it('suma cada clase y descarta lo gratis', () => {
    const byMethod = new Map([
      ['WriteObject', 35],
      ['ListObjects', 71],
      ['ReadObject', 29],
      ['GetObjectMetadata', 49],
      ['DeleteObject', 3],
      ['RewriteObject.From', 2],
      ['RewriteObject.To', 2],
    ])
    expect(gcsOpsByClass(byMethod)).toEqual({ a: 108, b: 78 })
  })
})
