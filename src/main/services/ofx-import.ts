import type { ParsedCsvRow } from './csv-import'

function normalizeDate(raw: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  if (raw.length === 8 && /^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
  }
  return new Date().toISOString().slice(0, 10)
}

interface OfxTransaction {
  trntype: string
  dtposted: string
  trnamt: string
  memo: string
  name: string
}

export function parseOfx(content: string): ParsedCsvRow[] {
  const transactions: ParsedCsvRow[] = []
  const blocks = content.split('</STMTTRN>')

  for (const block of blocks) {
    const tx = extractFields(block)
    if (!tx || !tx.trnamt) continue

    const amount = parseFloat(tx.trnamt) || 0
    if (amount === 0) continue

    const date = normalizeDate(tx.dtposted)
    const description = (tx.name || tx.memo || 'Imported').trim()
    const type = amount < 0 ? 'expense' : 'income'

    transactions.push({ description, amount: Math.abs(amount), date, type })
  }

  return transactions
}

function extractFields(block: string): OfxTransaction | null {
  const get = (tag: string): string => {
    const re = new RegExp(`<${tag}>([^<]*)`, 'i')
    const m = block.match(re)
    return m ? m[1].trim() : ''
  }

  const trntype = get('TRNTYPE')
  const dtposted = get('DTPOSTED')
  const trnamt = get('TRNAMT')
  const memo = get('MEMO')
  const name = get('NAME')

  if (!trntype && !trnamt) return null

  return { trntype, dtposted, trnamt, memo, name }
}
