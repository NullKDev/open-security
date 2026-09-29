/**
 * tests/security/malicious-zip.test.ts
 *
 * End-to-end security tests for ZIP extraction.
 * Tests malicious ZIP scenarios: zip-slip, symlink, deep nesting, oversized.
 * Uses binary ZIP construction for edge cases yazl won't create.
 *
 * Strict TDD: RED → GREEN → TRIANGULATE → REFACTOR
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as yazl from 'yazl'
import { extractZip } from '@/lib/sources/zip'

/**
 * Write a yazl ZipFile to disk and wait for flush.
 */
function writeZip(zip: yazl.ZipFile, zipPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(zipPath)
    zip.outputStream.pipe(ws)
    ws.on('finish', resolve)
    ws.on('error', reject)
    zip.end()
  })
}

/**
 * Create a raw binary ZIP with a single file entry.
 * Uses ZIP-32 spec: [local file header] [file data] [central directory] [EOCD]
 */
function createRawZip(
  zipPath: string,
  fileName: string,
  data: Buffer,
  externalAttrs?: number,
) {
  const nameBuf = Buffer.from(fileName, 'utf-8')
  const dataLen = data.length
  const nameLen = nameBuf.length

  // CRC-32 placeholder (0 for stored/uncompressed)
  const crc32 = 0

  // Local file header (stored, no compression)
  const localHeaderSig = Buffer.from([0x50, 0x4b, 0x03, 0x04])
  const version = Buffer.alloc(2, 0)
  version.writeUInt16LE(20, 0)
  const gpFlag = Buffer.alloc(2, 0)
  const method = Buffer.alloc(2, 0)
  const modTime = Buffer.alloc(2, 0)
  const modDate = Buffer.alloc(2, 0)
  const crcBuf = Buffer.alloc(4, 0)
  const compSize = Buffer.alloc(4, 0)
  const uncompSize = Buffer.alloc(4, 0)
  compSize.writeUInt32LE(dataLen, 0)
  uncompSize.writeUInt32LE(dataLen, 0)
  const nameLenBuf = Buffer.alloc(2, 0)
  nameLenBuf.writeUInt16LE(nameLen, 0)
  const extraLenBuf = Buffer.alloc(2, 0)

  const localHeader = Buffer.concat([
    localHeaderSig, version, gpFlag, method,
    modTime, modDate, crcBuf, compSize, uncompSize,
    nameLenBuf, extraLenBuf, nameBuf, data,
  ])

  // Central directory entry
  const centralSig = Buffer.from([0x50, 0x4b, 0x01, 0x02])
  const versionMadeBy = Buffer.alloc(2, 0)
  versionMadeBy.writeUInt16LE(20, 0)
  const versionNeeded = Buffer.alloc(2, 0)
  versionNeeded.writeUInt16LE(20, 0)
  const diskStart = Buffer.alloc(2, 0)
  const internalAttrs = Buffer.alloc(2, 0)
  const extAttrs = Buffer.alloc(4, 0)
  if (externalAttrs !== undefined) {
    extAttrs.writeUInt32LE(externalAttrs, 0)
  }
  const localOffset = Buffer.alloc(4, 0)
  const commentLen = Buffer.alloc(2, 0)

  const centralEntry = Buffer.concat([
    centralSig, versionMadeBy, versionNeeded, gpFlag, method,
    modTime, modDate, crcBuf, compSize, uncompSize,
    nameLenBuf, extraLenBuf, commentLen, diskStart,
    internalAttrs, extAttrs, localOffset, nameBuf,
  ])

  // End of central directory
  const eocdSig = Buffer.from([0x50, 0x4b, 0x05, 0x06])
  const diskNum = Buffer.alloc(2, 0)
  const centralDisk = Buffer.alloc(2, 0)
  const centralCount = Buffer.alloc(2, 0)
  centralCount.writeUInt16LE(1, 0)
  const centralTotal = Buffer.alloc(2, 0)
  centralTotal.writeUInt16LE(1, 0)
  const centralSize = Buffer.alloc(4, 0)
  centralSize.writeUInt32LE(centralEntry.length, 0)
  const centralOffset = Buffer.alloc(4, 0)
  centralOffset.writeUInt32LE(localHeader.length, 0)
  const zipCommentLen = Buffer.alloc(2, 0)

  const eocd = Buffer.concat([
    eocdSig, diskNum, centralDisk, centralCount, centralTotal,
    centralSize, centralOffset, zipCommentLen,
  ])

  const zipBytes = Buffer.concat([localHeader, centralEntry, eocd])
  fs.writeFileSync(zipPath, zipBytes)
}

/**
 * Create a multi-entry ZIP by concatenating raw entries.
 */
function createMultiEntryZip(zipPath: string, entries: Array<{ name: string; data: Buffer }>) {
  // Construct each local entry + central entry, then join with EOCD
  const localEntries: Buffer[] = []
  const centralEntries: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf-8')
    const data = entry.data
    const dataLen = data.length
    const nameLen = nameBuf.length

    // Local file header
    const localHeaderSig = Buffer.from([0x50, 0x4b, 0x03, 0x04])
    const version = Buffer.alloc(2, 0)
    version.writeUInt16LE(20, 0)
    const gpFlag = Buffer.alloc(2, 0)
    const method = Buffer.alloc(2, 0)
    const modTime = Buffer.alloc(2, 0)
    const modDate = Buffer.alloc(2, 0)
    const crcBuf = Buffer.alloc(4, 0)
    const compSize = Buffer.alloc(4, 0)
    const uncompSize = Buffer.alloc(4, 0)
    compSize.writeUInt32LE(dataLen, 0)
    uncompSize.writeUInt32LE(dataLen, 0)
    const nameLenBuf = Buffer.alloc(2, 0)
    nameLenBuf.writeUInt16LE(nameLen, 0)
    const extraLenBuf = Buffer.alloc(2, 0)

    const localHeader = Buffer.concat([
      localHeaderSig, version, gpFlag, method,
      modTime, modDate, crcBuf, compSize, uncompSize,
      nameLenBuf, extraLenBuf, nameBuf, data,
    ])

    const entrySize = localHeader.length

    // Central directory entry
    const centralSig = Buffer.from([0x50, 0x4b, 0x01, 0x02])
    const versionMadeBy = Buffer.alloc(2, 0)
    versionMadeBy.writeUInt16LE(20, 0)
    const versionNeeded = Buffer.alloc(2, 0)
    versionNeeded.writeUInt16LE(20, 0)
    const diskStart = Buffer.alloc(2, 0)
    const internalAttrs = Buffer.alloc(2, 0)
    const externalAttrs = Buffer.alloc(4, 0)
    const localOffsetBuf = Buffer.alloc(4, 0)
    localOffsetBuf.writeUInt32LE(offset, 0)
    const commentLen = Buffer.alloc(2, 0)

    const centralEntry = Buffer.concat([
      centralSig, versionMadeBy, versionNeeded, gpFlag, method,
      modTime, modDate, crcBuf, compSize, uncompSize,
      nameLenBuf, extraLenBuf, commentLen, diskStart,
      internalAttrs, externalAttrs, localOffsetBuf, nameBuf,
    ])

    localEntries.push(localHeader)
    centralEntries.push(centralEntry)
    offset += entrySize
  }

  const allLocals = Buffer.concat(localEntries)
  const allCentrals = Buffer.concat(centralEntries)

  // EOCD
  const eocdSig = Buffer.from([0x50, 0x4b, 0x05, 0x06])
  const diskNum = Buffer.alloc(2, 0)
  const centralDisk = Buffer.alloc(2, 0)
  const centralCount = Buffer.alloc(2, 0)
  centralCount.writeUInt16LE(entries.length, 0)
  const centralTotal = Buffer.alloc(2, 0)
  centralTotal.writeUInt16LE(entries.length, 0)
  const centralSize = Buffer.alloc(4, 0)
  centralSize.writeUInt32LE(allCentrals.length, 0)
  const centralOffsetBuf = Buffer.alloc(4, 0)
  centralOffsetBuf.writeUInt32LE(allLocals.length, 0)
  const zipCommentLen = Buffer.alloc(2, 0)

  const eocd = Buffer.concat([
    eocdSig, diskNum, centralDisk, centralCount, centralTotal,
    centralSize, centralOffsetBuf, zipCommentLen,
  ])

  const zipBytes = Buffer.concat([allLocals, allCentrals, eocd])
  fs.writeFileSync(zipPath, zipBytes)
}

describe('extractZip — malicious ZIP scenarios', () => {
  let tmpDir: string
  let destDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obt-malzip-'))
    destDir = path.join(tmpDir, 'dest')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('zip-slip attacks', () => {
    it('rejects ../etc/passwd traversal in raw ZIP', async () => {
      const zipPath = path.join(tmpDir, 'slip1.zip')
      createRawZip(zipPath, '../etc/passwd', Buffer.from('root:x:0:0:root:/root:/bin/bash\n'))

      await expect(
        extractZip(zipPath, destDir),
      ).rejects.toThrow(/invalid relative path|path traversal|entry name/i)
    })

    it('rejects absolute /etc/passwd in raw ZIP', async () => {
      const zipPath = path.join(tmpDir, 'slip2.zip')
      createRawZip(zipPath, '/etc/passwd', Buffer.from('malicious'))

      await expect(
        extractZip(zipPath, destDir),
      ).rejects.toThrow(/absolute path|path traversal|entry name/i)
    })

    it('rejects deeply nested traversal ../../../../etc/shadow', async () => {
      const zipPath = path.join(tmpDir, 'slip3.zip')
      createRawZip(zipPath, '../../../../etc/shadow', Buffer.from('bad'))

      await expect(
        extractZip(zipPath, destDir),
      ).rejects.toThrow(/invalid relative path|path traversal|entry name/i)
    })

    it('cleanup after failed extraction (dest dir removed)', async () => {
      const zipPath = path.join(tmpDir, 'slip-cleanup.zip')
      createRawZip(zipPath, '../escape.txt', Buffer.from('bad'))

      // Before extraction, ensure destDir exists test
      await expect(
        extractZip(zipPath, destDir),
      ).rejects.toThrow()

      // Dest should be cleaned up
      expect(fs.existsSync(destDir)).toBe(false)
    })
  })

  describe('symlink in ZIP', () => {
    it('rejects symlink entry in raw ZIP with S_IFLNK mode bits', async () => {
      const zipPath = path.join(tmpDir, 'symlink.zip')
      // S_IFLNK = 0o120000, in external attrs (upper 16 bits): 0o120000 * 0x10000
      const symlinkMode = 0o120000 * 0x10000
      createRawZip(zipPath, 'link.txt', Buffer.from('/etc/passwd'), symlinkMode)

      await expect(
        extractZip(zipPath, destDir),
      ).rejects.toThrow(/symlink/i)
    })

    it('rejects symlink entry pointing to sensitive file', async () => {
      const zipPath = path.join(tmpDir, 'symlink2.zip')
      const symlinkMode = 0o120000 * 0x10000
      createRawZip(zipPath, 'safe-looking.js', Buffer.from('/root/.ssh/id_rsa'), symlinkMode)

      await expect(
        extractZip(zipPath, destDir),
      ).rejects.toThrow(/symlink/i)
    })
  })

  describe('deeply nested ZIP (10k entries)', () => {
    it('rejects ZIPs with entry count exceeding maxEntries', async () => {
      const zipPath = path.join(tmpDir, 'deep.zip')

      // Create 100 entries and set maxEntries to 10
      const entries = Array.from({ length: 100 }, (_, i) => ({
        name: `folder-${Math.floor(i / 10)}/file-${i}.txt`,
        data: Buffer.from(`content-${i}`),
      }))

      // Use yazl to create a valid multi-entry ZIP
      const zip = new yazl.ZipFile()
      for (const e of entries) {
        zip.addBuffer(e.data, e.name)
      }
      await writeZip(zip, zipPath)

      await expect(
        extractZip(zipPath, destDir, { maxEntries: 10 }),
      ).rejects.toThrow(/entry/i)
    })

    it('handles yazl-generated deeply nested directory structure', async () => {
      const zipPath = path.join(tmpDir, 'nested.zip')
      const zip = new yazl.ZipFile()

      // 50 files in 10-level deep directory structure
      for (let i = 0; i < 50; i++) {
        const depth = Math.floor(i / 5)
        const dirParts = Array.from({ length: depth }, (_, d) => `level-${d}`)
        const name = [...dirParts, `file-${i}.txt`].join('/')
        zip.addBuffer(Buffer.from(`data-${i}`), name)
      }

      await writeZip(zip, zipPath)

      await extractZip(zipPath, destDir)

      // Verify all files were extracted
      for (let i = 0; i < 50; i++) {
        const depth = Math.floor(i / 5)
        const dirParts = Array.from({ length: depth }, (_, d) => `level-${d}`)
        const relPath = [...dirParts, `file-${i}.txt`].join('/')
        expect(fs.existsSync(path.join(destDir, relPath))).toBe(true)
      }
    })
  })

  describe('oversized ZIP', () => {
    it('rejects uncompressed size exceeding maxUncompressedBytes', async () => {
      const zipPath = path.join(tmpDir, 'oversized.zip')
      const zip = new yazl.ZipFile()
      // Add two entries, each 100 bytes
      zip.addBuffer(Buffer.from('x'.repeat(100)), 'a.txt')
      zip.addBuffer(Buffer.from('y'.repeat(100)), 'b.txt')
      await writeZip(zip, zipPath)

      // Set max to 150 bytes — second entry should push over limit
      await expect(
        extractZip(zipPath, destDir, { maxUncompressedBytes: 150 }),
      ).rejects.toThrow(/size/i)
    })

    it('rejects compressed size exceeding maxCompressedBytes', async () => {
      const zipPath = path.join(tmpDir, 'compressed-oversized.zip')
      const zip = new yazl.ZipFile()
      zip.addBuffer(Buffer.from('x'.repeat(5000)), 'big.txt')
      await writeZip(zip, zipPath)

      await expect(
        extractZip(zipPath, destDir, { maxCompressedBytes: 10 }),
      ).rejects.toThrow(/size/i)
    })

    it('cleans up after oversized rejection', async () => {
      const zipPath = path.join(tmpDir, 'oversized-cleanup.zip')
      const zip = new yazl.ZipFile()
      zip.addBuffer(Buffer.from('x'.repeat(100)), 'a.txt')
      zip.addBuffer(Buffer.from('y'.repeat(100)), 'b.txt')
      await writeZip(zip, zipPath)

      await expect(
        extractZip(zipPath, destDir, { maxUncompressedBytes: 150 }),
      ).rejects.toThrow()

      // Dest should be cleaned up
      expect(fs.existsSync(destDir)).toBe(false)
    })
  })

  describe('mixed safe+malicious entries', () => {
    it('cleanup after one malicious entry in multi-file ZIP', async () => {
      const zipPath = path.join(tmpDir, 'mixed.zip')
      const entries = [
        { name: 'safe.txt', data: Buffer.from('hello') },
        { name: '../evil.txt', data: Buffer.from('danger') },
      ]
      createMultiEntryZip(zipPath, entries)

      await expect(
        extractZip(zipPath, destDir),
      ).rejects.toThrow()

      // Dest should be cleaned up because a malicious entry was found
      expect(fs.existsSync(destDir)).toBe(false)
    })
  })

  describe('valid extraction (safety net)', () => {
    it('still works for normal valid ZIPs', async () => {
      const zipPath = path.join(tmpDir, 'valid.zip')
      const zip = new yazl.ZipFile()
      zip.addBuffer(Buffer.from('hello'), 'readme.md')
      zip.addBuffer(Buffer.from('const x = 1;'), 'src/index.ts')
      zip.addBuffer(Buffer.from('test'), 'tests/test.ts')
      await writeZip(zip, zipPath)

      await extractZip(zipPath, destDir)

      expect(fs.existsSync(path.join(destDir, 'readme.md'))).toBe(true)
      expect(fs.existsSync(path.join(destDir, 'src', 'index.ts'))).toBe(true)
      expect(fs.existsSync(path.join(destDir, 'tests', 'test.ts'))).toBe(true)
      expect(fs.readFileSync(path.join(destDir, 'readme.md'), 'utf-8')).toBe('hello')
    })
  })
})
