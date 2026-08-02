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
import { useAppDialog } from '@/components/shared/app-dialog'
import { Save, Trash2 } from 'lucide-react'

interface ImportProfile {
  id: number
  name: string
  account_id: number | null
  mapping: { descriptionCol: number; amountCol: number; dateCol: number; delimiter: string; hasHeader: boolean }
}

interface ImportSession { id: number; profile_name: string | null; source_name: string | null; imported_count: number; duplicate_count: number; error_count: number; created_at: string }

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
  const dialog = useAppDialog()
  const [headers, setHeaders] = useState<string[]>([])
  const [previewRows, setPreviewRows] = useState<string[][]>([])
  const [descCol, setDescCol] = useState('0')
  const [amtCol, setAmtCol] = useState('1')
  const [dateCol, setDateCol] = useState('2')
  const [delimiter, setDelimiter] = useState(',')
  const [accounts, setAccounts] = useState<{ id: number; name: string; is_archived: number }[]>([])
  const [accountId, setAccountId] = useState('')
  const [importing, setImporting] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [analysis, setAnalysis] = useState<{ total: number; duplicates: number; rows: Array<{ description: string; amount: number; date: string; duplicate: boolean }> } | null>(null)
  const [profiles, setProfiles] = useState<ImportProfile[]>([])
  const [history, setHistory] = useState<ImportSession[]>([])
  const [selectedProfile, setSelectedProfile] = useState('')
  const [profileName, setProfileName] = useState('')

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
      window.api.accounts.list().then((rows) => {
        const active = (rows as { id: number; name: string; is_archived: number }[]).filter((account) => account.is_archived !== 1)
        setAccounts(active)
        setAccountId((current) => current || (active[0] ? String(active[0].id) : ''))
      })
      Promise.all([window.api.importProfiles.list(), window.api.importProfiles.history()]).then(([savedProfiles, sessions]) => {
        setProfiles(savedProfiles as ImportProfile[])
        setHistory(sessions as ImportSession[])
      })
    }
    if (!open) setLoaded(false)
  }, [open, csvText])

  useEffect(() => {
    if (!open || !loaded || !headers.length) return
    window.api.transactions.csvAnalyze(csvText, {
      descriptionCol: Number(descCol), amountCol: Number(amtCol), dateCol: Number(dateCol),
      delimiter, hasHeader: true, accountId: accountId ? Number(accountId) : undefined
    }).then((result) => setAnalysis(result as typeof analysis))
  }, [open, loaded, csvText, descCol, amtCol, dateCol, delimiter, accountId, headers.length])

  async function importRows(): Promise<void> {
    setImporting(true)
    try {
      const result = await window.api.transactions.importCsv(csvText, {
        descriptionCol: parseInt(descCol),
        amountCol: parseInt(amtCol),
        dateCol: parseInt(dateCol),
        delimiter,
        hasHeader: true,
        accountId: accountId ? parseInt(accountId) : undefined
      })
      const summary = result as { imported: number; skippedDuplicates?: number }
      await window.api.importProfiles.record({ profileId: selectedProfile ? Number(selectedProfile) : undefined, sourceName: 'CSV import', imported: summary.imported, duplicates: summary.skippedDuplicates ?? 0 })
      onImported(summary.imported)
      onOpenChange(false)
      setLoaded(false)
      if (summary.skippedDuplicates) {
        await dialog.alert(
          `Imported ${summary.imported} transactions and skipped ${summary.skippedDuplicates} duplicate${summary.skippedDuplicates === 1 ? '' : 's'}.`,
          'Import complete'
        )
      }
    } catch (error) {
      await window.api.importProfiles.record({ profileId: selectedProfile ? Number(selectedProfile) : undefined, sourceName: 'CSV import', imported: 0, errors: 1 })
      await dialog.alert(error instanceof Error ? error.message : 'The CSV import failed.', 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  function applyProfile(id: string): void {
    setSelectedProfile(id)
    const profile = profiles.find((item) => String(item.id) === id)
    if (!profile) return
    setProfileName(profile.name)
    setDescCol(String(profile.mapping.descriptionCol))
    setAmtCol(String(profile.mapping.amountCol))
    setDateCol(String(profile.mapping.dateCol))
    setDelimiter(profile.mapping.delimiter)
    if (profile.account_id) setAccountId(String(profile.account_id))
  }

  async function saveProfile(): Promise<void> {
    const saved = await window.api.importProfiles.save({
      id: selectedProfile ? Number(selectedProfile) : undefined,
      name: profileName,
      accountId: accountId ? Number(accountId) : undefined,
      mapping: { descriptionCol: Number(descCol), amountCol: Number(amtCol), dateCol: Number(dateCol), delimiter, hasHeader: true }
    }) as { id: number }
    setProfiles(await window.api.importProfiles.list() as ImportProfile[])
    setSelectedProfile(String(saved.id))
  }

  async function deleteProfile(): Promise<void> {
    if (!selectedProfile) return
    await window.api.importProfiles.delete(Number(selectedProfile))
    setProfiles(await window.api.importProfiles.list() as ImportProfile[])
    setSelectedProfile('')
    setProfileName('')
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
        <div className="rounded-lg border p-3">
          <p className="mb-2 text-sm font-medium">Bank import profile</p>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
            <Select value={selectedProfile} onValueChange={applyProfile}><SelectTrigger><SelectValue placeholder="Load profile" /></SelectTrigger><SelectContent>{profiles.map((profile) => <SelectItem key={profile.id} value={String(profile.id)}>{profile.name}</SelectItem>)}</SelectContent></Select>
            <input className="h-10 rounded-lg border bg-background px-3 text-sm" value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="e.g. Swedbank CSV" />
            <Button size="icon" variant="outline" disabled={!profileName.trim()} onClick={saveProfile} aria-label="Save import profile"><Save className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" disabled={!selectedProfile} onClick={deleteProfile} aria-label="Delete import profile"><Trash2 className="h-4 w-4" /></Button>
          </div>
        </div>
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
        <div className="grid gap-2">
          <Label>Account</Label>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger>
              <SelectValue placeholder="Main" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((account) => (
                <SelectItem key={account.id} value={String(account.id)}>
                  {account.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
        {analysis && (
          <div className="rounded-md border p-3 text-sm">
            <p className="font-medium">{analysis.total} rows ready · {analysis.duplicates} duplicate{analysis.duplicates === 1 ? '' : 's'} will be skipped</p>
            <div className="mt-2 max-h-24 space-y-1 overflow-auto text-xs text-muted-foreground">
              {analysis.rows.slice(0, 8).map((row, index) => (
                <div key={`${row.date}-${row.description}-${index}`} className="flex justify-between gap-2">
                  <span className="truncate">{row.date} · {row.description} · {row.amount}</span>
                  <span className={row.duplicate ? 'text-warning' : 'text-success'}>{row.duplicate ? 'Duplicate' : 'Ready'}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {history.length > 0 && <div className="rounded-lg border p-3"><p className="mb-2 text-sm font-medium">Recent imports</p><div className="max-h-24 space-y-1 overflow-auto text-xs text-muted-foreground">{history.slice(0, 5).map((session) => <div key={session.id} className="flex justify-between gap-2"><span>{session.profile_name ?? session.source_name ?? 'CSV'} · {session.created_at}</span><span>{session.imported_count} imported · {session.duplicate_count} skipped</span></div>)}</div></div>}
        <Button onClick={importRows} disabled={importing || !headers.length} className="w-full">
          {importing ? 'Importing...' : 'Import transactions'}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
