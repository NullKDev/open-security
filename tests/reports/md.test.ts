import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { generateMarkdownReport } from '@/lib/reports/md'

interface FixtureFinding {
  id: string
  scanId: string
  detector: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  confidence: number
  title: string
  description: string
  locationPath: string
  locationLineStart: number
  locationLineEnd?: number
  locationCommit?: string
  dataFlow?: string
  patchDiff?: string
  patchExplanation?: string
  validationPasses?: boolean
  validationRationale?: string
  fpFiltered?: boolean
  tags?: string
  createdAt?: string
}

function makeFixture(overrides?: Partial<FixtureFinding>): FixtureFinding {
  return {
    id: 'finding-1',
    scanId: 'scan-abc',
    detector: 'gitleaks',
    severity: 'high',
    confidence: 0.95,
    title: 'AWS Key Exposed',
    description: 'An AWS access key was found in source code.',
    locationPath: 'config/secrets.yaml',
    locationLineStart: 42,
    locationLineEnd: 42,
    locationCommit: 'deadbeef',
    patchDiff: '-API_KEY=AKIAIOSFODNN7EXAMPLE\n+API_KEY=<SECRET>',
    validationRationale: 'LLM confirmed this is a real credential.',
    ...overrides,
  }
}

describe('generateMarkdownReport', () => {
  let outputDir: string

  beforeEach(() => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obt-md-test-'))
  })

  afterEach(() => {
    fs.rmSync(outputDir, { recursive: true, force: true })
  })

  it('creates report.md with a 3-row table for 3 findings', async () => {
    const findings: FixtureFinding[] = [
      makeFixture({ id: 'f1', title: 'AWS Key Exposed', severity: 'high' }),
      makeFixture({ id: 'f2', title: 'SQL Injection Risk', severity: 'critical' }),
      makeFixture({ id: 'f3', title: 'XSS Vulnerability', severity: 'medium' }),
    ]

    await generateMarkdownReport('scan-abc', findings, outputDir)

    const reportPath = path.join(outputDir, 'scan-abc', 'report.md')
    expect(fs.existsSync(reportPath)).toBe(true)

    const content = fs.readFileSync(reportPath, 'utf-8')
    // Should have 3 data rows in the findings table — they contain View links
    const dataRows = content
      .split('\n')
      .filter(line => line.startsWith('|') && line.includes('[View](findings/'))
    expect(dataRows.length).toBe(3)
  })

  it('each finding row links to findings/<id>.md', async () => {
    const findings: FixtureFinding[] = [
      makeFixture({ id: 'f1', title: 'AWS Key Exposed', severity: 'high' }),
      makeFixture({ id: 'f2', title: 'SQL Injection', severity: 'critical' }),
      makeFixture({ id: 'f3', title: 'XSS', severity: 'medium' }),
    ]

    await generateMarkdownReport('scan-abc', findings, outputDir)

    const reportPath = path.join(outputDir, 'scan-abc', 'report.md')
    const content = fs.readFileSync(reportPath, 'utf-8')

    expect(content).toContain('findings/f1.md')
    expect(content).toContain('findings/f2.md')
    expect(content).toContain('findings/f3.md')
  })

  it('each findings/<id>.md contains a mermaid block', async () => {
    const findings: FixtureFinding[] = [
      makeFixture({ id: 'f1' }),
    ]

    await generateMarkdownReport('scan-abc', findings, outputDir)

    const detailPath = path.join(outputDir, 'scan-abc', 'findings', 'f1.md')
    expect(fs.existsSync(detailPath)).toBe(true)

    const content = fs.readFileSync(detailPath, 'utf-8')
    expect(content).toContain('```mermaid')
    expect(content).toMatch(/graph (TD|LR|TB)/)
  })

  it('each findings/<id>.md contains a ```diff fenced block when patchDiff is present', async () => {
    const findings: FixtureFinding[] = [
      makeFixture({
        id: 'f1',
        patchDiff: '-API_KEY=AKIAIOSFODNN7EXAMPLE\n+API_KEY=<SECRET>',
      }),
    ]

    await generateMarkdownReport('scan-abc', findings, outputDir)

    const detailPath = path.join(outputDir, 'scan-abc', 'findings', 'f1.md')
    const content = fs.readFileSync(detailPath, 'utf-8')
    expect(content).toContain('```diff')
  })

  it('renders "No findings" message when findings array is empty', async () => {
    await generateMarkdownReport('scan-abc', [], outputDir)

    const reportPath = path.join(outputDir, 'scan-abc', 'report.md')
    const content = fs.readFileSync(reportPath, 'utf-8')
    expect(content).toContain('No findings')
  })

  it('creates meta.json with correct structure', async () => {
    const findings: FixtureFinding[] = [
      makeFixture({ id: 'f1' }),
    ]

    await generateMarkdownReport('scan-abc', findings, outputDir)

    const metaPath = path.join(outputDir, 'scan-abc', 'meta.json')
    expect(fs.existsSync(metaPath)).toBe(true)

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
    expect(meta.scanId).toBe('scan-abc')
    expect(meta.findingCount).toBe(1)
    expect(meta.format).toBe('md')
    expect(typeof meta.generatedAt).toBe('string')
  })

  it('report.md includes severity and title columns', async () => {
    const findings: FixtureFinding[] = [
      makeFixture({ id: 'f1', severity: 'critical', title: 'My Critical Finding' }),
    ]

    await generateMarkdownReport('scan-abc', findings, outputDir)

    const reportPath = path.join(outputDir, 'scan-abc', 'report.md')
    const content = fs.readFileSync(reportPath, 'utf-8')
    expect(content).toContain('critical')
    expect(content).toContain('My Critical Finding')
  })

  it('uses injectable fs option for testing', async () => {
    const written: Record<string, string> = {}
    const createdDirs: string[] = []

    const mockFs = {
      mkdirSync: (p: string) => { createdDirs.push(p) },
      writeFileSync: (p: string, content: string) => { written[p] = content },
    }

    const findings: FixtureFinding[] = [
      makeFixture({ id: 'f1' }),
    ]

    await generateMarkdownReport('scan-abc', findings, '/fake/output', { fs: mockFs })

    const writtenPaths = Object.keys(written)
    expect(writtenPaths.some(p => p.includes('report.md'))).toBe(true)
    expect(writtenPaths.some(p => p.includes('findings/f1.md'))).toBe(true)
    expect(writtenPaths.some(p => p.includes('meta.json'))).toBe(true)
  })

  it('parses dataFlow JSON and renders nodes in mermaid block', async () => {
    const findings: FixtureFinding[] = [
      makeFixture({
        id: 'f1',
        dataFlow: JSON.stringify({
          nodes: ['userInput', 'sqlQuery', 'database'],
          edges: [['userInput', 'sqlQuery'], ['sqlQuery', 'database']],
        }),
      }),
    ]

    await generateMarkdownReport('scan-abc', findings, outputDir)

    const detailPath = path.join(outputDir, 'scan-abc', 'findings', 'f1.md')
    const content = fs.readFileSync(detailPath, 'utf-8')
    expect(content).toContain('userInput')
    expect(content).toContain('database')
  })
})
