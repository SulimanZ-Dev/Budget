import { describe, expect, it } from 'vitest'
import {
  detectDelimiter,
  exportTransactionsToCsv,
  guessColumnIndexes,
  importTransactionsFromCsv,
  parseCsvLine,
  parseCsvPreview
} from '../csv-import'
import { parseOfx } from '../ofx-import'

describe('CSV import service', () => {
  it('detects delimiters and parses quoted fields', () => {
    expect(detectDelimiter('Date;Description;Amount')).toBe(';')
    expect(parseCsvLine('2026-01-02,"Coffee, Beans",-42.50', ',')).toEqual([
      '2026-01-02',
      'Coffee, Beans',
      '-42.50'
    ])
  })

  it('guesses common bank column names and previews rows', () => {
    const preview = parseCsvPreview('Bokf datum;Meddelande;Belopp\n2026-01-02;ICA;-123,45')

    expect(preview.delimiter).toBe(';')
    expect(preview.rows).toEqual([['2026-01-02', 'ICA', '-123,45']])
    expect(guessColumnIndexes(preview.headers)).toEqual({
      dateCol: 0,
      descriptionCol: 1,
      amountCol: 2
    })
  })

  it('normalizes dates, Swedish decimal amounts, and transaction type', () => {
    const rows = importTransactionsFromCsv(
      'Datum;Text;Belopp\n02/01/2026;ICA;-123,45 kr\n2026-01-03;Salary;25000',
      { dateCol: 0, descriptionCol: 1, amountCol: 2, delimiter: ';' }
    )

    expect(rows).toEqual([
      { date: '2026-01-02', description: 'ICA', amount: 123.45, type: 'expense' },
      { date: '2026-01-03', description: 'Salary', amount: 25000, type: 'income' }
    ])
  })

  it('exports CSV with quoted descriptions when needed', () => {
    expect(
      exportTransactionsToCsv([
        { description: 'Coffee, Beans', amount: 42.5, date: '2026-01-02', type: 'expense', category_name: 'Food' }
      ])
    ).toBe('Description,Amount,Date,Type,Category\n"Coffee, Beans",42.5,2026-01-02,expense,Food\n')
  })
})

describe('OFX import service', () => {
  it('parses expense and income statement transactions', () => {
    const rows = parseOfx(`
      <STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260102<TRNAMT>-99.95<NAME>Card shop<MEMO>ignored</STMTTRN>
      <STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260103<TRNAMT>1200.00<MEMO>Refund</STMTTRN>
    `)

    expect(rows).toEqual([
      { date: '2026-01-02', description: 'Card shop', amount: 99.95, type: 'expense' },
      { date: '2026-01-03', description: 'Refund', amount: 1200, type: 'income' }
    ])
  })

  it('ignores empty and zero-amount OFX blocks', () => {
    expect(parseOfx('<STMTTRN><TRNAMT>0</STMTTRN><STMTTRN><NAME>No amount</STMTTRN>')).toEqual([])
  })
})
