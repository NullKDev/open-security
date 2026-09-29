#!/usr/bin/env bun
/**
 * obt — Open Security Toolbelt CLI
 *
 * Headless CLI for running security scans without the Next.js UI.
 * Uses the same lib/ modules as the web application.
 */
import { Command } from 'commander'
import * as path from 'node:path'
import { getDb } from '@/lib/db/client'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan } from '@/lib/repos/scans.repo'
import { startScan } from '@/lib/pipeline/orchestrator'
import { walkHistory } from '@/lib/git/history-walker'
import { generateJsonReport } from '@/lib/reports/json'
import { generateCsvReport } from '@/lib/reports/csv'
import { generateSarifReport } from '@/lib/reports/sarif'
import { renderReport } from '@/lib/reports/md'
import { resolveOnPath } from '@/lib/providers/cli/resolve'
import { scanDir } from '@/lib/config/workspace'
import { AGENT_DEFS } from '@/lib/providers/cli/agents'
import { eq } from 'drizzle-orm'
import { scans as scanTable, findings as findingsTable } from '@/lib/db/schema'
import type { ScanEvent } from '@/lib/pipeline/events'

/** Build and return a configured Commander program for testing or execution */
export function createProgram(): Command {
  const program = new Command()

  program
    .name('obt')
    .version('0.1.0')
    .description('Open Security Toolbelt — local-first Blue Team workbench')
    .exitOverride()
    .configureOutput({
      writeOut: (str: string) => process.stdout.write(str),
      writeErr: (str: string) => process.stderr.write(str),
    })

  // ── obt scan <source> ──

  program
    .command('scan <source>')
    .description('Scan a source repo for security issues')
    .action(async (source: string) => {
      let sourceKind: string
      let sourceRef: string

      if (/^https?:\/\/github\.com\//.test(source)) {
        sourceKind = 'github'
        sourceRef = source
      } else if (/^https?:\/\/gitlab\.com\//.test(source)) {
        sourceKind = 'gitlab'
        sourceRef = source
      } else if (source.endsWith('.zip')) {
        sourceKind = 'zip'
        sourceRef = source
      } else {
        sourceKind = 'local'
        sourceRef = path.resolve(source)
      }

      const name = sourceRef.split('/').pop()!.replace(/\.git$/, '') || sourceRef

      const db = getDb()
      const project = createProject(db, { name, sourceKind, sourceRef })
      const scan = createScan(db, { projectId: project.id })

      const workspaceRoot = scanDir(project.id, scan.id)
      const handle = startScan({
        db,
        scanId: scan.id,
        projectId: project.id,
        sourceKind,
        sourceRef,
        workspaceRoot,
      })

      console.log(`Scan started: ${scan.id}`)
      console.log(`Project: ${name} (${sourceKind})`)

      let lastStage = ''
      handle.bus.subscribe(scan.id, (event: ScanEvent) => {
        switch (event.type) {
          case 'stage':
            if (event.stage !== lastStage) {
              console.log(`[${event.stage}] starting...`)
              lastStage = event.stage
            }
            break
          case 'finding':
            console.log(
              `  ${event.finding.severity}: ${event.finding.title} (${event.finding.detector})`,
            )
            break
          case 'done':
            console.log(`Scan complete: ${scan.id}`)
            break
          case 'error':
            console.error(`Error: ${event.message}`)
            break
        }
      })

      const abortHandler = () => {
        handle.abort()
      }
      process.on('SIGINT', abortHandler)
      process.on('SIGTERM', abortHandler)

      await handle.done
      process.off('SIGINT', abortHandler)
      process.off('SIGTERM', abortHandler)
    })

  // ── obt history <path> ──

  program
    .command('history <path>')
    .description('Run git history forensics on a local repository')
    .action(async (repoPath: string) => {
      const resolved = path.resolve(repoPath)
      for await (const commit of walkHistory(resolved)) {
        console.log(JSON.stringify(commit))
      }
    })

  // ── obt report --format <f> <scanId> ──

  program
    .command('report <scanId>')
    .description('Export a scan report')
    .option('-f, --format <format>', 'Report format: md, json, sarif, csv', 'json')
    .action(async (scanId: string, opts: { format: string }) => {
      const db = getDb()

      const scanRow = db
        .select()
        .from(scanTable)
        .where(eq(scanTable.id, scanId))
        .get()

      if (!scanRow) {
        console.error(`Scan ${scanId} not found`)
        process.exitCode = 1
        return
      }

      const findingRows = db
        .select()
        .from(findingsTable)
        .where(eq(findingsTable.scanId, scanId))
        .all()

      let output: string
      switch (opts.format) {
        case 'json':
          output = generateJsonReport(scanRow as never, findingRows as never[])
          break
        case 'csv':
          output = generateCsvReport(findingRows as never[])
          break
        case 'sarif':
          output = generateSarifReport(findingRows as never[])
          break
        case 'md':
          output = renderReport(scanId, findingRows as never[])
          break
        default:
          console.error(`Unknown format: ${opts.format}. Supported: md, json, sarif, csv`)
          process.exitCode = 1
          return
      }
      console.log(output)
    })

  // ── obt agents ──

  program
    .command('agents')
    .description('List detected CLI agents on PATH')
    .action(async () => {
      for (const def of AGENT_DEFS) {
        const detected = resolveOnPath(def.bin)
        const status = detected ? 'detected' : 'not found'
        const icon = detected ? '✅' : '❌'
        console.log(
          `${def.id.padEnd(14)} ${def.bin.padEnd(14)} ${icon} ${status}`,
        )
      }
    })

  return program
}

// When run directly (not imported for testing)
const isMain = typeof Bun !== 'undefined'
  ? import.meta.path === Bun.main
  : process.argv[1]?.includes('bin/obt')

if (isMain) {
  createProgram().parse()
}
