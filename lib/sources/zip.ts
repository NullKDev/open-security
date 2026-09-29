import { open, type ZipFile, type Entry } from 'yauzl'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { assertUnder } from '@/lib/security/path-guard'

const DEFAULT_MAX_COMPRESSED_BYTES = 200 * 1024 * 1024 // 200 MB
const DEFAULT_MAX_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024 // 2 GB
const DEFAULT_MAX_ENTRIES = 50_000

export interface ExtractZipOptions {
  /** Maximum compressed ZIP file size (bytes). Default 200 MB. */
  maxCompressedBytes?: number
  /** Maximum total uncompressed size of all entries (bytes). Default 2 GB. */
  maxUncompressedBytes?: number
  /** Maximum number of entries allowed. Default 50,000. */
  maxEntries?: number
}

function isSymlink(entry: Entry): boolean {
  // externalFileAttributes encodes Unix mode in the upper 16 bits.
  // Use Math.floor division to avoid JS signed 32-bit shift overflow.
  // S_IFLNK = 0o120000
  const shifted = Math.floor(entry.externalFileAttributes / 0x10000)
  const mode = shifted & 0o170000
  return mode === 0o120000
}

function openZip(zipPath: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    open(zipPath, { lazyEntries: true, decodeStrings: true, strictFileNames: false }, (err, zipfile) => {
      if (err) return reject(err)
      resolve(zipfile)
    })
  })
}

function readEntryAsync(zipfile: ZipFile): Promise<Entry | null> {
  return new Promise((resolve, reject) => {
    const onEntry = (entry: Entry) => {
      zipfile.removeListener('error', onError)
      resolve(entry)
    }
    const onEnd = () => {
      zipfile.removeListener('error', onError)
      resolve(null)
    }
    const onError = (err: Error) => {
      zipfile.removeListener('entry', onEntry)
      zipfile.removeListener('end', onEnd)
      reject(err)
    }

    zipfile.once('entry', onEntry)
    zipfile.once('end', onEnd)
    zipfile.once('error', onError)
    zipfile.readEntry()
  })
}

function extractEntry(
  zipfile: ZipFile,
  entry: Entry,
  destPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err) return reject(err)
      if (!stream) return reject(new Error(`Failed to open stream for ${entry.fileName}`))

      // Ensure parent directory exists
      const dir = path.dirname(destPath)
      fs.mkdirSync(dir, { recursive: true })

      const writeStream = fs.createWriteStream(destPath)
      stream.pipe(writeStream)

      writeStream.on('finish', resolve)
      writeStream.on('error', reject)
      stream.on('error', reject)
    })
  })
}

async function deleteDir(dirPath: string): Promise<void> {
  try {
    await fs.promises.rm(dirPath, { recursive: true, force: true })
  } catch {
    // best-effort cleanup
  }
}

export async function extractZip(
  zipPath: string,
  destRoot: string,
  opts: ExtractZipOptions = {},
): Promise<void> {
  const maxCompressedBytes = opts.maxCompressedBytes ?? DEFAULT_MAX_COMPRESSED_BYTES
  const maxUncompressedBytes = opts.maxUncompressedBytes ?? DEFAULT_MAX_UNCOMPRESSED_BYTES
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES

  // Check compressed file size before opening
  const stat = fs.statSync(zipPath)
  if (stat.size > maxCompressedBytes) {
    throw new Error(
      `ZIP file size (${stat.size} bytes) exceeds limit (${maxCompressedBytes} bytes)`
    )
  }

  const zipfile = await openZip(zipPath)

  if (zipfile.entryCount > maxEntries) {
    zipfile.close()
    throw new Error(
      `ZIP entry count (${zipfile.entryCount}) exceeds limit (${maxEntries})`
    )
  }

  // Ensure dest root exists
  fs.mkdirSync(destRoot, { recursive: true })

  let totalUncompressed = 0
  let entryIndex = 0

  try {
    while (true) {
      const entry = await readEntryAsync(zipfile)
      if (entry === null) break // end of entries

      entryIndex++

      // Reject directories (yauzl includes them as entries with trailing /)
      const entryName = entry.fileName
      if (entryName.endsWith('/') || entryName.endsWith('\\')) {
        continue
      }

      // Check cumulative uncompressed size
      totalUncompressed += entry.uncompressedSize
      if (totalUncompressed > maxUncompressedBytes) {
        throw new Error(
          `Cumulative uncompressed size (${totalUncompressed} bytes) exceeds limit (${maxUncompressedBytes} bytes)`
        )
      }

      // Reject symlinks
      if (isSymlink(entry)) {
        throw new Error(`Symlink entries are not allowed: ${entryName}`)
      }

      // Validate path is safe under destRoot
      const resolvedEntry = path.resolve(destRoot, entryName)
      assertUnder(destRoot, resolvedEntry)

      // Extract the file
      await extractEntry(zipfile, entry, resolvedEntry)
    }
  } catch (err) {
    // Delete partial extraction on abort/error
    await deleteDir(destRoot)
    throw err
  } finally {
    zipfile.close()
  }
}
