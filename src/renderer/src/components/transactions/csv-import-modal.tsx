import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

interface CsvImportModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  csvText: string
  onImported: (count: number) => void
}

export function CsvImportModal({
  open,
  onOpenChange,
  csvText,
  onImported
}: CsvImportModalProps): JSX.Element {
  const [headers, setHeaders] = useState<string[]>([])
  const [previewRows, setPreviewRows] = useState<string[][]>([])
  const [descCol, setDescCol] = useState('0')
  const [amtCol, setAmtCol] = useState('1')
  const [dateCol, setDateCol] = useState('2')
  const [delimiter, setDelimiter] = useState(',')
  const [importing, setImporting] = useState(false)
  const [loaded, setLoaded] = useState(false)

  async function loadPreview(): Promise<void> {
    const data = await window.api.transactions.csvPreview(csvText)
    const p = data as {
      headers: string[]
      rows: string[][]
      delimiter: string
      guessed: { descriptionCol: number; amountCol: number; dateCol: number }
    }
    setHeaders(p.headers)
    setPreviewRows(p.rows)
    setDelimiter(p.delimiter)
    setDescCol(String(p.guessed.descriptionCol))
    setAmtCol(String(p.guessed.amountCol))
    setDateCol(String(p.guessed.dateCol))
    setLoaded(true)
  }

  useEffect(() => {
    if (open && csvText && !loaded) {
      loadPreview()
    }
    if (!open) setLoaded(false)
  }, [open, csvText])

  async function importRows(): Promise<void> {
    setImporting(true)
    try {
      const result = await window.api.transactions.importCsv(csvText, {
        descriptionCol: parseInt(descCol),
        amountCol: parseInt(amtCol),
        dateCol: parseInt(dateCol),
        delimiter,
        hasHeader: true
      })
      onImported((result as { imported: number }).imported)
      onOpenChange(false)
      setLoaded(false)
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setLoaded(false)
        onOpenChange(v)
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import CSV — map columns</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Match your bank export columns. Supports comma or semicolon delimiters.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-2">
            <Label>Description</Label>
            <Select value={descCol} onValueChange={setDescCol}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {headers.map((h, i) => (
                  <SelectItem key={i} value={String(i)}>
                    {h || `Column ${i + 1}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Amount</Label>
            <Select value={amtCol} onValueChange={setAmtCol}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {headers.map((h, i) => (
                  <SelectItem key={i} value={String(i)}>
                    {h || `Column ${i + 1}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Date</Label>
            <Select value={dateCol} onValueChange={setDateCol}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {headers.map((h, i) => (
                  <SelectItem key={i} value={String(i)}>
                    {h || `Column ${i + 1}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {previewRows.length > 0 && (
          <div className="max-h-32 overflow-auto rounded-lg border text-xs">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  {headers.map((h, i) => (
                    <th key={i} className="p-2 text-left font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, ri) => (
                  <tr key={ri} className="border-b">
                    {row.map((cell, ci) => (
                      <td key={ci} className="p-2 truncate max-w-[120px]">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Button onClick={importRows} disabled={importing || !headers.length} className="w-full">
          {importing ? 'Importing...' : 'Import transactions'}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
