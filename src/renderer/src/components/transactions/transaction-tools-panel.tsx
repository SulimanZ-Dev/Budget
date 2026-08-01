import { useEffect, useState } from 'react'
import { ArrowLeftRight, History, Save, Trash2, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAppDialog } from '@/components/shared/app-dialog'

export interface AdvancedTransactionFilters {
  minAmount: string
  maxAmount: string
  dateFrom: string
  dateTo: string
  reconciled: 'all' | 'yes' | 'no'
}

interface SavedFilter { id: number; name: string; filters: AdvancedTransactionFilters }
interface TransferCandidate { expense_id: number; income_id: number; description: string; amount: number; expense_date: string; from_account: string; to_account: string }
interface HistoryEvent { event_id: number; transaction_id: number; action: string; timestamp: string; current_description?: string; payload?: { description?: string } }

export function TransactionToolsPanel({ value, onChange, onRefresh }: {
  value: AdvancedTransactionFilters
  onChange: (value: AdvancedTransactionFilters) => void
  onRefresh: () => void
}): JSX.Element {
  const dialog = useAppDialog()
  const [saved, setSaved] = useState<SavedFilter[]>([])
  const [filterName, setFilterName] = useState('')
  const [selectedFilter, setSelectedFilter] = useState('')
  const [transfers, setTransfers] = useState<TransferCandidate[]>([])
  const [history, setHistory] = useState<HistoryEvent[]>([])
  const [showHistory, setShowHistory] = useState(false)

  async function loadTools(): Promise<void> {
    const [filters, candidates] = await Promise.all([window.api.filters.list(), window.api.transactions.transferCandidates()])
    setSaved(filters as SavedFilter[])
    setTransfers(candidates as TransferCandidate[])
  }

  useEffect(() => { loadTools() }, [])

  async function saveFilter(): Promise<void> {
    if (!filterName.trim()) return
    await window.api.filters.save(filterName.trim(), { ...value })
    setFilterName('')
    await loadTools()
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Transaction tools</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 md:grid-cols-5">
          <div className="grid gap-1"><Label>Minimum</Label><Input type="number" value={value.minAmount} onChange={(event) => onChange({ ...value, minAmount: event.target.value })} /></div>
          <div className="grid gap-1"><Label>Maximum</Label><Input type="number" value={value.maxAmount} onChange={(event) => onChange({ ...value, maxAmount: event.target.value })} /></div>
          <div className="grid gap-1"><Label>From date</Label><Input type="date" value={value.dateFrom} onChange={(event) => onChange({ ...value, dateFrom: event.target.value })} /></div>
          <div className="grid gap-1"><Label>To date</Label><Input type="date" value={value.dateTo} onChange={(event) => onChange({ ...value, dateTo: event.target.value })} /></div>
          <div className="grid gap-1"><Label>Bank status</Label><Select value={value.reconciled} onValueChange={(reconciled) => onChange({ ...value, reconciled: reconciled as AdvancedTransactionFilters['reconciled'] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="yes">Verified</SelectItem><SelectItem value="no">Unverified</SelectItem></SelectContent></Select></div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Input className="max-w-48" value={filterName} onChange={(event) => setFilterName(event.target.value)} placeholder="Saved filter name" />
          <Button variant="outline" onClick={saveFilter} disabled={!filterName.trim()}><Save className="h-4 w-4" /> Save filter</Button>
          {saved.length > 0 && <Select value={selectedFilter} onValueChange={(id) => { setSelectedFilter(id); const match = saved.find((item) => String(item.id) === id); if (match) onChange(match.filters) }}><SelectTrigger className="w-48"><SelectValue placeholder="Load saved filter" /></SelectTrigger><SelectContent>{saved.map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}</SelectContent></Select>}
          {selectedFilter && <Button variant="ghost" size="icon" aria-label="Delete saved filter" onClick={async () => { await window.api.filters.delete(Number(selectedFilter)); setSelectedFilter(''); await loadTools() }}><Trash2 className="h-4 w-4" /></Button>}
          <Button variant="ghost" onClick={() => onChange({ minAmount: '', maxAmount: '', dateFrom: '', dateTo: '', reconciled: 'all' })}>Clear</Button>
        </div>

        {transfers.length > 0 && <div className="space-y-2 border-t pt-4"><p className="flex items-center gap-2 text-sm font-medium"><ArrowLeftRight className="h-4 w-4" /> Possible transfers</p>{transfers.slice(0, 5).map((candidate) => <div key={`${candidate.expense_id}-${candidate.income_id}`} className="flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2 text-sm"><span>{candidate.description} · {candidate.amount} · {candidate.from_account} → {candidate.to_account}</span><Button size="sm" variant="outline" onClick={async () => { await window.api.transactions.convertTransferPair(candidate.expense_id, candidate.income_id); await loadTools(); onRefresh() }}>Convert</Button></div>)}</div>}

        <div className="border-t pt-4">
          <Button variant="outline" size="sm" onClick={async () => { const next = !showHistory; setShowHistory(next); if (next) setHistory(await window.api.transactions.globalHistory(30) as HistoryEvent[]) }}><History className="h-4 w-4" /> {showHistory ? 'Hide change history' : 'Show change history'}</Button>
          {showHistory && <div className="mt-3 max-h-64 space-y-2 overflow-auto">{history.map((event) => <div key={event.event_id} className="flex items-center justify-between gap-2 rounded border px-3 py-2 text-sm"><div className="min-w-0"><p className="truncate font-medium">{event.current_description || event.payload?.description || `Transaction #${event.transaction_id}`}</p><p className="text-xs text-muted-foreground">{event.action} · {new Date(event.timestamp).toLocaleString()}</p></div><Button variant="ghost" size="icon" aria-label="Restore this version" onClick={async () => { if (!await dialog.confirm('Restore this transaction to the selected history point?', { title: 'Restore version', confirmLabel: 'Restore' })) return; await window.api.transactions.restoreEvent(event.transaction_id, event.event_id); setHistory(await window.api.transactions.globalHistory(30) as HistoryEvent[]); onRefresh() }}><Undo2 className="h-4 w-4" /></Button></div>)}</div>}
        </div>
      </CardContent>
    </Card>
  )
}
