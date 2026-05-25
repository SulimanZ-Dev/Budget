export interface CsvMapping {
  descriptionCol: number
  amountCol: number
  dateCol: number
  delimiter?: string
  hasHeader?: boolean
}

export interface ParsedCsvRow {
  description: string
  amount: number
  date: string
}

export function detectDelimiter(firstLine: string): string {
  const semicolons = (firstLine.match(/;/g) || []).length
  const commas = (firstLine.match(/,/g) || []).length
  return semicolons > commas ? ';' : ','
}

export function parseCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (ch === delimiter && !inQuotes) {
      result.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  result.push(current.trim())
  return result
}

export function parseCsvPreview(
  csv: string,
  maxRows = 5
): { headers: string[]; rows: string[][]; delimiter: string } {
  const lines = csv.trim().split(/\r?\n/).filter(Boolean)
  if (!lines.length) return { headers: [], rows: [], delimiter: ',' }
  const delimiter = detectDelimiter(lines[0])
  const headers = parseCsvLine(lines[0], delimiter)
  const rows = lines.slice(1, 1 + maxRows).map((l) => parseCsvLine(l, delimiter))
  return { headers, rows, delimiter }
}

export function guessColumnIndexes(headers: string[]): {
  descriptionCol: number
  amountCol: number
  dateCol: number
} {
  const lower = headers.map((h) => h.toLowerCase())
  const descriptionCol = lower.findIndex(
    (h) => h.includes('desc') || h.includes('text') || h.includes('meddelande') || h.includes('name')
  )
  const amountCol = lower.findIndex(
    (h) =>
      h.includes('amount') ||
      h.includes('belopp') ||
      h.includes('sum') ||
      h === 'debit' ||
      h === 'credit'
  )
  const dateCol = lower.findIndex(
    (h) => h.includes('date') || h.includes('datum') || h.includes('bokf')
  )
  return {
    descriptionCol: descriptionCol >= 0 ? descriptionCol : 0,
    amountCol: amountCol >= 0 ? amountCol : 1,
    dateCol: dateCol >= 0 ? dateCol : 2
  }
}

function normalizeDate(raw: string): string {
  const trimmed = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  const dmy = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/)
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
  }
  const ymd = trimmed.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/)
  if (ymd) {
    return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`
  }
  return new Date().toISOString().slice(0, 10)
}

function parseAmount(raw: string): number {
  let s = raw.replace(/\s/g, '').replace(/kr/gi, '')
  if (s.includes(',') && s.includes('.')) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (s.includes(',')) {
    s = s.replace(',', '.')
  }
  return Math.abs(parseFloat(s.replace(/[^\d.-]/g, '')) || 0)
}

export function importTransactionsFromCsv(csv: string, mapping: CsvMapping): ParsedCsvRow[] {
  const lines = csv.trim().split(/\r?\n/).filter(Boolean)
  if (!lines.length) return []
  const delimiter = mapping.delimiter || detectDelimiter(lines[0])
  const startIdx = mapping.hasHeader !== false ? 1 : 0
  const result: ParsedCsvRow[] = []

  for (let i = startIdx; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i], delimiter)
    if (cols.length < 2) continue
    const amount = parseAmount(cols[mapping.amountCol] ?? '0')
    const description = (cols[mapping.descriptionCol] ?? 'Imported').trim() || 'Imported'
    const date = normalizeDate(cols[mapping.dateCol] ?? '')
    if (amount > 0) result.push({ description, amount, date })
  }
  return result
}
