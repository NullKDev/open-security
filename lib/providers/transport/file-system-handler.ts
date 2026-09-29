import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  ReadTextFileRequest,
  ReadTextFileResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from '@agentclientprotocol/sdk'

/**
 * Handles ACP file-system requests from the agent (client-side implementation).
 *
 * The agent sends `fs/read_text_file` and `fs/write_text_file` requests, and the
 * client (this handler) satisfies them using the real file system via Node's
 * `fs/promises` — NO VS Code dependencies.
 *
 * Only available when the client advertises `fs.readTextFile` and `fs.writeTextFile`
 * capabilities respectively.
 */
export class FileSystemHandler {
  /**
   * Read content from a text file with optional line slicing.
   *
   * - `params.line` (1-based): start reading from this line number.
   * - `params.limit`: maximum number of lines to return.
   *
   * If neither `line` nor `limit` is provided, the full file content is returned.
   */
  async readTextFile(params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    const content = await readFile(params.path, 'utf-8')

    const line = params.line ?? null
    const limit = params.limit ?? null

    if (line === null && limit === null) {
      return { content }
    }

    const lines = content.split('\n')
    const start = line !== null ? Math.max(0, line - 1) : 0
    const end = limit !== null ? start + limit : lines.length
    const sliced = lines.slice(start, end)

    return { content: sliced.join('\n') }
  }

  /**
   * Write text content to a file, creating parent directories as needed.
   *
   * Creates all intermediate directories via `mkdir(dirname(path), { recursive: true })`
   * before writing the content.
   */
  async writeTextFile(params: WriteTextFileRequest): Promise<WriteTextFileResponse> {
    await mkdir(dirname(params.path), { recursive: true })
    await writeFile(params.path, params.content, 'utf-8')
    return {}
  }
}
