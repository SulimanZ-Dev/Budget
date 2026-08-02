import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, CheckCircle2, Inbox, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAppStore } from '@/store/app-store'

interface ReviewItem {
  key: string
  kind: string
  severity: 'info' | 'warning' | 'critical'
  title: string
  detail: string
  transactionIds?: number[]
}

const KIND_LABELS: Record<string, string> = {
  duplicate: 'Duplicates',
  uncategorized: 'Uncategorized',
  transfer: 'Transfers & refunds',
  refund: 'Transfers & refunds',
  unusual: 'Unusual activity',
  subscription: 'Upcoming payments',
  debt: 'Upcoming payments',
  reconciliation: 'Reconciliation',
  quality: 'Data quality'
}

export function ReviewInboxPage(): JSX.Element {
  const navigate = useNavigate()
  const { refreshTrigger } = useAppStore()
  const [items, setItems] = useState<ReviewItem[]>([])
  const [loading, setLoading] = useState(true)

  async function load(): Promise<void> {
    setLoading(true)
    try {
      setItems(await window.api.review.inbox() as ReviewItem[])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [refreshTrigger])

  const groups = useMemo(() => {
    const result = new Map<string, ReviewItem[]>()
    for (const item of items) {
      const label = KIND_LABELS[item.kind] ?? 'Other'
      result.set(label, [...(result.get(label) ?? []), item])
    }
    return [...result.entries()]
  }, [items])

  async function dismiss(item: ReviewItem): Promise<void> {
    await window.api.review.dismiss(item.key)
    setItems((current) => current.filter((row) => row.key !== item.key))
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><Inbox className="h-6 w-6" /> Review Inbox</h1>
          <p className="text-sm text-muted-foreground">One place for transactions, due dates, reconciliation, and data issues that need attention.</p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Open items</p><p className="text-2xl font-semibold">{items.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Critical</p><p className="text-2xl font-semibold text-destructive">{items.filter((item) => item.severity === 'critical').length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Warnings</p><p className="text-2xl font-semibold text-warning">{items.filter((item) => item.severity === 'warning').length}</p></CardContent></Card>
      </div>

      {!loading && items.length === 0 && (
        <Card><CardContent className="flex flex-col items-center gap-2 p-10 text-center"><CheckCircle2 className="h-10 w-10 text-success" /><p className="font-medium">Everything is reviewed</p><p className="text-sm text-muted-foreground">New items will appear automatically when something needs attention.</p></CardContent></Card>
      )}

      {groups.map(([label, rows]) => (
        <Card key={label}>
          <CardHeader><CardTitle className="text-base">{label} <span className="text-muted-foreground">({rows.length})</span></CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {rows.map((item) => (
              <div key={item.key} className={`flex items-start justify-between gap-3 rounded-lg border p-3 ${item.severity === 'critical' ? 'border-destructive/40 bg-destructive/5' : item.severity === 'warning' ? 'border-warning/40 bg-warning/5' : ''}`}>
                <div className="flex min-w-0 gap-3">
                  <AlertCircle className={`mt-0.5 h-4 w-4 shrink-0 ${item.severity === 'critical' ? 'text-destructive' : item.severity === 'warning' ? 'text-warning' : 'text-muted-foreground'}`} />
                  <div><p className="text-sm font-medium">{item.title}</p><p className="text-xs text-muted-foreground">{item.detail}</p></div>
                </div>
                <div className="flex shrink-0 gap-1">
                  {item.transactionIds?.length ? <Button size="sm" variant="outline" onClick={() => navigate('/transactions')}>Open</Button> : null}
                  <Button size="icon" variant="ghost" aria-label="Dismiss review item" onClick={() => dismiss(item)}><X className="h-4 w-4" /></Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
