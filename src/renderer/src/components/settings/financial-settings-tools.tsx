import { useEffect, useState } from 'react'
import { Download, ShieldCheck, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useAppStore } from '@/store/app-store'
import { useAppDialog } from '@/components/shared/app-dialog'
import { MONTH_NAMES } from '@/lib/utils'

interface Alias { id: number; pattern: string; merchant_name: string }
interface Quality { uncategorized: number; missingAccounts: number; duplicateCandidates: number; missingAttachments: number; unreconciled: number; unnormalizedMerchants: number }

export function FinancialSettingsTools(): JSX.Element {
  const { profile, selectedMonth, triggerRefresh } = useAppStore()
  const dialog = useAppDialog()
  const [closed, setClosed] = useState(false)
  const [aliases, setAliases] = useState<Alias[]>([])
  const [pattern, setPattern] = useState('')
  const [merchantName, setMerchantName] = useState('')
  const [quality, setQuality] = useState<Quality | null>(null)

  async function load(): Promise<void> {
    const [closedRows, aliasRows, status] = await Promise.all([
      window.api.months.listClosed(), window.api.merchants.listAliases(), window.api.data.qualityStatus()
    ])
    setClosed((closedRows as Array<{ year: number; month: number }>).some((item) => item.year === profile.year && item.month === selectedMonth))
    setAliases(aliasRows as Alias[])
    setQuality(status as Quality)
  }

  useEffect(() => { load() }, [profile.year, selectedMonth])

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Month lock and merchant names</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium">Lock {MONTH_NAMES[selectedMonth - 1]} {profile.year}</p><p className="text-xs text-muted-foreground">Closed months reject transaction edits, deletion, imports, and undo.</p></div><Switch checked={closed} onCheckedChange={async (next) => { if (next && !await dialog.confirm('Lock this month against all transaction changes?', { title: 'Lock month', confirmLabel: 'Lock' })) return; await window.api.months.setClosed(profile.year, selectedMonth, next); setClosed(next) }} /></div>
          <div className="border-t pt-4"><p className="mb-2 text-sm font-medium">Merchant normalization</p><div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><Input value={pattern} onChange={(event) => setPattern(event.target.value)} placeholder="ICA" /><Input value={merchantName} onChange={(event) => setMerchantName(event.target.value)} placeholder="ICA" /><Button disabled={!pattern.trim() || !merchantName.trim()} onClick={async () => { await window.api.merchants.saveAlias(pattern, merchantName); setPattern(''); setMerchantName(''); await load(); triggerRefresh() }}>Save</Button></div></div>
          <div className="max-h-36 space-y-2 overflow-auto">{aliases.map((alias) => <div key={alias.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm"><span>Contains “{alias.pattern}” → {alias.merchant_name}</span><Button variant="ghost" size="icon" aria-label="Delete merchant alias" onClick={async () => { await window.api.merchants.deleteAlias(alias.id); await load() }}><Trash2 className="h-4 w-4" /></Button></div>)}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Data quality and reports</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {quality && <div className="grid grid-cols-2 gap-2 text-sm">{Object.entries(quality).map(([key, count]) => <div key={key} className="rounded border p-2"><p className="text-xs capitalize text-muted-foreground">{key.replace(/([A-Z])/g, ' $1')}</p><p className="text-lg font-semibold">{count}</p></div>)}</div>}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={async () => { const result = await window.api.data.verifyBackup() as { valid: boolean; tables: number; transactions: number; filePath: string } | null; if (result) await dialog.alert(result.valid ? `Backup is readable: ${result.tables} tables and ${result.transactions} transactions.` : 'Backup failed its integrity check.', 'Backup verification') }}><ShieldCheck className="h-4 w-4" /> Verify backup</Button>
            <Button variant="outline" size="sm" onClick={() => window.api.reports.exportFinanceCsv(profile.year, selectedMonth)}><Download className="h-4 w-4" /> Month CSV</Button>
            <Button variant="outline" size="sm" onClick={() => window.api.reports.exportFinancePdf(profile.year, selectedMonth)}><Download className="h-4 w-4" /> Month PDF</Button>
            <Button variant="outline" size="sm" onClick={() => window.api.reports.exportFinanceCsv(profile.year)}><Download className="h-4 w-4" /> Year CSV</Button>
            <Button variant="outline" size="sm" onClick={() => window.api.reports.exportFinancePdf(profile.year)}><Download className="h-4 w-4" /> Year PDF</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
