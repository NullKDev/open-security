import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as yazl from 'yazl'
import { extractZip } from '@/lib/sources/zip'

/** Write a yazl ZipFile and wait for the file to be fully flushed */
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
 * Create a ZIP with an arbitrary filename that yazl would reject.
 * Builds the binary ZIP manually with the ZIP-32 spec:
 *   [local file header] [file data] [central directory] [end of central directory]
 */
function createRawZip(zipPath: string, fileName: string, data: Buffer) {
  const nameBuf = Buffer.from(fileName, 'utf-8')
  const dataLen = data.length
  const nameLen = nameBuf.length

  // CRC-32 placeholder (0 for uncompressed/stored)
  const crc32 = 0

  // Local file header (stored, no compression)
  const localHeaderSig = Buffer.from([0x50, 0x4b, 0x03, 0x04]) // PK\x03\x04
  const version = Buffer.alloc(2, 0) // 20 = 2.0
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
  const externalAttrs = Buffer.alloc(4, 0)
  const localOffset = Buffer.alloc(4, 0)
  const commentLen = Buffer.alloc(2, 0)

  const centralEntry = Buffer.concat([
    centralSig, versionMadeBy, versionNeeded, gpFlag, method,
    modTime, modDate, crcBuf, compSize, uncompSize,
    nameLenBuf, extraLenBuf, commentLen, diskStart,
    internalAttrs, externalAttrs, localOffset, nameBuf,
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
 * Create a ZIP with a symlink entry.
 */
function createSymlinkZip(zipPath: string, linkName: string, linkTarget: string) {
  const nameBuf = Buffer.from(linkName, 'utf-8')
  const data = Buffer.from(linkTarget, 'utf-8')
  const dataLen = data.length
  const nameLen = nameBuf.length

  // Local file header
  const localHeaderSig = Buffer.from([0x50, 0x4b, 0x03, 0x04])
  const version = Buffer.from([20, 0])
  const gpFlag = Buffer.alloc(2, 0)
  const method = Buffer.alloc(2, 0)
  const modTime = Buffer.alloc(2, 0)
  const modDate = Buffer.alloc(2, 0)
  const crcBuf = Buffer.alloc(4, 0)
  const compSize = Buffer.from([dataLen & 0xff, (dataLen >> 8) & 0xff, (dataLen >> 16) & 0xff, (dataLen >> 24) & 0xff])
  const uncompSize = Buffer.from([dataLen & 0xff, (dataLen >> 8) & 0xff, (dataLen >> 16) & 0xff, (dataLen >> 24) & 0xff])
  const nameLenBuf = Buffer.from([nameLen & 0xff, (nameLen >> 8) & 0xff])
  const extraLenBuf = Buffer.alloc(2, 0)

  const localHeader = Buffer.concat([
    localHeaderSig, version, gpFlag, method,
    modTime, modDate, crcBuf, compSize, uncompSize,
    nameLenBuf, extraLenBuf, nameBuf, data,
  ])

  // Central directory with symlink external attributes
  const centralSig = Buffer.from([0x50, 0x4b, 0x01, 0x02])
  const versionMadeBy = Buffer.from([20, 0])
  const versionNeeded = Buffer.from([20, 0])
  const diskStart = Buffer.alloc(2, 0)
  const internalAttrs = Buffer.alloc(2, 0)

  // externalFileAttributes: (S_IFLNK << 16) = 0o120000 * 0x10000 (avoid JS signed shift)
  const symlinkMode = 0o120000 * 0x10000
  const extAttrs = Buffer.alloc(4, 0)
  extAttrs.writeUInt32LE(symlinkMode, 0)

  const localOffset = Buffer.alloc(4, 0)
  const commentLen = Buffer.alloc(2, 0)

  const centralEntry = Buffer.concat([
    centralSig, versionMadeBy, versionNeeded, gpFlag, method,
    modTime, modDate, crcBuf, compSize, uncompSize,
    nameLenBuf, extraLenBuf, commentLen, diskStart,
    internalAttrs, extAttrs, localOffset, nameBuf,
  ])

  // EOCD
  const eocdSig = Buffer.from([0x50, 0x4b, 0x05, 0x06])
  const diskNum = Buffer.alloc(2, 0)
  const centralDisk = Buffer.alloc(2, 0)
  const centralCount = Buffer.from([1, 0])
  const centralTotal = Buffer.from([1, 0])
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

describe('extractZip', () => {
  let tmpDir: string
  let destDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obt-zip-test-'))
    destDir = path.join(tmpDir, 'dest')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('happy path — valid ZIP extraction', () => {
    it('extracts a valid ZIP with multiple files and directories', async () => {
      const zipPath = path.join(tmpDir, 'valid.zip')
      const zip = new yazl.ZipFile()
      zip.addBuffer(Buffer.from('hello'), 'readme.txt')
      zip.addBuffer(Buffer.from('world'), 'subdir/data.txt')
      await writeZip(zip, zipPath)

      await extractZip(zipPath, destDir)

      expect(fs.existsSync(path.join(destDir, 'readme.txt'))).toBe(true)
      expect(fs.existsSync(path.join(destDir, 'subdir', 'data.txt'))).toBe(true)
      expect(fs.readFileSync(path.join(destDir, 'readme.txt'), 'utf-8')).toBe('hello')
      expect(fs.readFileSync(path.join(destDir, 'subdir', 'data.txt'), 'utf-8')).toBe('world')
    })

    it('creates destination directory if it does not exist', async () => {
      // destDir does NOT exist for this test (don't create it in beforeEach)
      const zipPath = path.join(tmpDir, 'simple.zip')
      const zip = new yazl.ZipFile()
      zip.addBuffer(Buffer.from('hello'), 'file.txt')
      await writeZip(zip, zipPath)

      // Remove the destDir to prove it's recreated
      if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true })

      await extractZip(zipPath, destDir)
      expect(fs.existsSync(destDir)).toBe(true)
      expect(fs.existsSync(path.join(destDir, 'file.txt'))).toBe(true)
    })
  })

  describe('partial cleanup on abort', () => {
    it('deletes destination directory when extraction fails', async () => {
      const zipPath = path.join(tmpDir, 'bad.zip')
      createRawZip(zipPath, '../escape.txt', Buffer.from('bad'))

      await expect(
        extractZip(zipPath, destDir)
      ).rejects.toThrow()

      // Dest should be cleaned up after error
      expect(fs.existsSync(destDir)).toBe(false)
    })
  })

  describe('zip-slip rejection', () => {
    it('throws on entry with path traversal (../ escape)', async () => {
      const zipPath = path.join(tmpDir, 'slip.zip')
      // yauzl's own validateFileName catches ../ entries before our path-guard runs.
      // Our implementation MUST propagate yauzl's error (defense-in-depth layer 1 is yauzl).
      createRawZip(zipPath, '../escape.txt', Buffer.from('malicious'))

      await expect(extractZip(zipPath, destDir)).rejects.toThrow(/invalid relative path|path traversal/i)
    })

    it('throws on entry with absolute path', async () => {
      const zipPath = path.join(tmpDir, 'abs.zip')
      // yauzl catches absolute paths. Our code propagates the error.
      createRawZip(zipPath, '/etc/passwd', Buffer.from('bad'))

      await expect(extractZip(zipPath, destDir)).rejects.toThrow(/absolute path|path traversal/i)
    })
  })

  describe('symlink rejection', () => {
    it('throws on symlink entry', async () => {
      const zipPath = path.join(tmpDir, 'symlink.zip')
      createSymlinkZip(zipPath, 'link.txt', '/etc/passwd')

      await expect(extractZip(zipPath, destDir)).rejects.toThrow(/symlink/i)
    })
  })

  describe('oversized rejection', () => {
    it('throws when uncompressed size exceeds limit', async () => {
      const zipPath = path.join(tmpDir, 'big.zip')
      const zip = new yazl.ZipFile()
      zip.addBuffer(Buffer.from('hello'), 'data.txt')
      await writeZip(zip, zipPath)

      await expect(
        extractZip(zipPath, destDir, { maxUncompressedBytes: 1 })
      ).rejects.toThrow(/size/i)
    })

    it('throws when compressed size exceeds limit', async () => {
      const zipPath = path.join(tmpDir, 'compressed-big.zip')
      const zip = new yazl.ZipFile()
      zip.addBuffer(Buffer.from('x'.repeat(200)), 'data.txt')
      await writeZip(zip, zipPath)

      await expect(
        extractZip(zipPath, destDir, { maxCompressedBytes: 5 })
      ).rejects.toThrow(/size/i)
    })

    it('throws when entry count exceeds limit', async () => {
      const zipPath = path.join(tmpDir, 'many.zip')
      const zip = new yazl.ZipFile()
      for (let i = 0; i < 5; i++) {
        zip.addBuffer(Buffer.from(`data-${i}`), `file-${i}.txt`)
      }
      await writeZip(zip, zipPath)

      await expect(
        extractZip(zipPath, destDir, { maxEntries: 2 })
      ).rejects.toThrow(/entry/i)
    })
  })
})
