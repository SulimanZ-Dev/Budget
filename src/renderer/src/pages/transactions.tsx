import React, { useEffect, useState } from 'react'
import { Search, Upload, Calendar, Users, Flag, Repeat } from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { formatMoney } from '@/lib/utils'
import { EmptyState } from '@/components/shared/empty-state'
import { AskAiButton } from '@/components/shared/ask-ai-button'
import { ArrowLeftRight } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import * as LucideIcons from 'lucide-react'
import { TransactionRow, type TransactionRowData } from '@/components/transactions/transaction-row'
import { CsvImportModal } from '@/components/transactions/csv-import-modal'
import { TransactionDetailDrawer } from '@/components/transactions/transaction-detail-drawer'
import { useNavigate } from 'react-router-dom'
import { useDebouncedValue } from '@/hooks/use-debounced-value'

type RecurringFilter = 'all' | 'recurring' | 'oneoff'

export function TransactionsPage(): JSX.Element {
  const { profile, selectedMonth, rates, openAI, openDrawer, closeDrawer } = useAppStore()
  const navigate = useNavigate()
  const [transactions, setTransactions] = useState<TransactionRowData[]>([])
  const [categories, setCategories] = useState<{ id: number; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 300)
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [recurringFilter, setRecurringFilter] = useState<RecurringFilter>('all')
  const [weeklyView, setWeeklyView] = useState(false)
  const [splitView, setSplitView] = useState(false)
  const [calendarView, setCalendarView] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [csvOpen, setCsvOpen] = useState(false)
  const [csvText, setCsvText] = useState('')

  useEffect(() => {
    window.api.categories.list().then((c) => setCategories(c as { id: number; name: string }[]))
  }, [])

  useEffect(() => {
    load()
  }, [profile.year, selectedMonth, debouncedSearch, flaggedOnly, categoryFilter, typeFilter, recurringFilter])

  async function load(): Promise<void> {
    setLoading(true)
    const filters: Record<string, unknown> = {
      year: profile.year,
      month: selectedMonth,
      search: debouncedSearch || undefined,
      flagged: flaggedOnly || undefined
    }
    if (categoryFilter !== 'all') filters.categoryId = parseInt(categoryFilter)
    if (typeFilter !== 'all') filters.type = typeFilter
    if (recurringFilter === 'recurring') filters.recurring = true
    if (recurringFilter === 'oneoff') filters.recurring = false

    const data = await window.api.transactions.list(filters)
    setTransactions(data as TransactionRowData[])
    setLoading(false)
  }

  async function pickCsv(): Promise<void> {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.csv'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      setCsvText(await file.text())
      setCsvOpen(true)
    }
    input.click()
  }

  function getIcon(name?: string): React.ReactElement {
    const key = name
      ? name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()).replace(/^./, (s) => s.toUpperCase())
      : 'Wallet'
    const Icon = (LucideIcons as unknown as Record<string, LucideIcons.LucideIcon>)[key] ?? LucideIcons.Wallet
    return <Icon className="h-5 w-5" />
  }

  function handleSelect(id: number, checked: boolean): void {
    const next = new Set(selected)
    if (checked) next.add(id)
    else next.delete(id)
    setSelected(next)
  }

  function handleEdit(tx: TransactionRowData): void {
    openDrawer(
      <TransactionDetailDrawer
        transaction={tx}
        onSaved={() => {
          closeDrawer()
          load()
        }}
      />
    )
  }

  function renderList(txs: TransactionRowData[], startIndex = 0): JSX.Element {
    return (
      <div className="space-y-2">
        {txs.map((t, i) => (
          <TransactionRow
            key={t.id}
            transaction={t}
            selected={selected.has(t.id)}
            onSelect={handleSelect}
            icon={getIcon(t.category_icon)}
            categories={categories}
            onUpdated={load}
            onEdit={handleEdit}
            onAskAi={(tx) => {
              openAI(`Tell me about this transaction: ${tx.description}`, 'transactions')
              navigate('/ai')
            }}
            index={startIndex + i}
          />
        ))}
      </div>
    )
  }

  const filteredForViews = transactions

  const grouped = weeklyView
    ? filteredForViews.reduce<Record<string, TransactionRowData[]>>((acc, t) => {
        const week = `Week ${Math.ceil(parseInt(t.date.slice(8, 10)) / 7)}`
        if (!acc[week]) acc[week] = []
        acc[week].push(t)
        return acc
      }, {})
    : null

  const calendarDays = calendarView
    ? Array.from({ length: 31 }, (_, i) => {
        const day = String(i + 1).padStart(2, '0')
        const dayTx = filteredForViews.filter((t) => t.date.endsWith(`-${day}`))
        const net = dayTx.reduce((s, t) => s + (t.type === 'income' ? t.amount : -t.amount), 0)
        return { day: i + 1, net, count: dayTx.length }
      })
    : null

  const listContent = loading ? (
    <SkeletonList />
  ) : filteredForViews.length === 0 ? (
    <EmptyState
      icon={ArrowLeftRight}
      title="No transactions yet"
      description="Add your first transaction with the + button or import from your bank CSV."
      actionLabel="Add transaction"
      onAction={() => useAppStore.getState().setTransactionModalOpen(true)}
    />
  ) : splitView && !weeklyView && !calendarView ? (
    Object.entries(
      filteredForViews.reduce<Record<string, TransactionRowData[]>>((acc, t) => {
        const key = t.member_name ?? 'Unassigned'
        if (!acc[key]) acc[key] = []
        acc[key].push(t)
        return acc
      }, {})
    ).map(([member, txs]) => (
      <div key={member} className="mb-6">
        <h3 className="mb-2 font-medium">{member}</h3>
        {renderList(txs)}
      </div>
    ))
  ) : grouped ? (
    Object.entries(grouped).map(([week, txs]) => (
      <div key={week} className="mb-6">
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">{week}</h3>
        {renderList(txs)}
        <p className="mt-2 text-right text-sm font-medium">
          Subtotal:{' '}
          {formatMoney(
            txs.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0),
            profile.displayCurrency,
            rates
          )}
        </p>
      </div>
    ))
  ) : (
    renderList(filteredForViews)
  )

  return (
    <TransactionsShell
      search={search}
      setSearch={setSearch}
      flaggedOnly={flaggedOnly}
      setFlaggedOnly={setFlaggedOnly}
      categoryFilter={categoryFilter}
      setCategoryFilter={setCategoryFilter}
      typeFilter={typeFilter}
      setTypeFilter={setTypeFilter}
      recurringFilter={recurringFilter}
      setRecurringFilter={setRecurringFilter}
      categories={categories}
      weeklyView={weeklyView}
      setWeeklyView={setWeeklyView}
      splitView={splitView}
      setSplitView={setSplitView}
      calendarView={calendarView}
      setCalendarView={setCalendarView}
      pickCsv={pickCsv}
    >
      {calendarView && calendarDays && (
        <div className="mb-6 grid grid-cols-7 gap-1">
          {calendarDays.map((d) => (
            <div
              key={d.day}
              title={`${d.count} transactions`}
              className={`aspect-square rounded-lg p-2 text-xs ${
                d.net > 0
                  ? 'bg-success/20 text-success'
                  : d.net < 0
                    ? 'bg-destructive/20 text-destructive'
                    : 'bg-muted'
              }`}
            >
              <span className="font-medium">{d.day}</span>
            </div>
          ))}
        </div>
      )}
      {listContent}
      <BulkBar selected={selected} categories={categories} onDone={() => { setSelected(new Set()); load() }} />
      <CsvImportModal
        open={csvOpen}
        onOpenChange={setCsvOpen}
        csvText={csvText}
        onImported={() => load()}
      />
    </TransactionsShell>
  )
}

function TransactionsShell({
  children,
  search,
  setSearch,
  flaggedOnly,
  setFlaggedOnly,
  categoryFilter,
  setCategoryFilter,
  typeFilter,
  setTypeFilter,
  recurringFilter,
  setRecurringFilter,
  categories,
  weeklyView,
  setWeeklyView,
  splitView,
  setSplitView,
  calendarView,
  setCalendarView,
  pickCsv
}: {
  children: React.ReactNode
  search: string
  setSearch: (v: string) => void
  flaggedOnly: boolean
  setFlaggedOnly: (v: boolean) => void
  categoryFilter: string
  setCategoryFilter: (v: string) => void
  typeFilter: string
  setTypeFilter: (v: string) => void
  recurringFilter: RecurringFilter
  setRecurringFilter: (v: RecurringFilter) => void
  categories: { id: number; name: string }[]
  weeklyView: boolean
  setWeeklyView: (v: boolean) => void
  splitView: boolean
  setSplitView: (v: boolean) => void
  calendarView: boolean
  setCalendarView: (v: boolean) => void
  pickCsv: () => void
}): JSX.Element {
  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Transactions</h1>
        <div className="flex gap-2">
          <AskAiButton context="transactions" prefill="Analyze my recent spending patterns" />
          <Button variant="outline" size="sm" onClick={pickCsv}>
            <Upload className="h-4 w-4" />
            Import CSV
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-3 rounded-xl border bg-card p-4">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search transactions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="expense">Expense</SelectItem>
            <SelectItem value="income">Income</SelectItem>
          </SelectContent>
        </Select>
        <Select value={recurringFilter} onValueChange={(v) => setRecurringFilter(v as RecurringFilter)}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="recurring">Recurring</SelectItem>
            <SelectItem value="oneoff">One-off</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <div className="flex items-center gap-2">
          <Switch checked={flaggedOnly} onCheckedChange={setFlaggedOnly} id="flagged" />
          <Label htmlFor="flagged">
            <Flag className="inline h-3 w-3" /> Flagged
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={weeklyView} onCheckedChange={setWeeklyView} id="weekly" />
          <Label htmlFor="weekly">Weekly</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={splitView} onCheckedChange={setSplitView} id="split" />
          <Label htmlFor="split">
            <Users className="inline h-3 w-3" /> Per-person
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={calendarView} onCheckedChange={setCalendarView} id="cal" />
          <Label htmlFor="cal">
            <Calendar className="inline h-3 w-3" /> Calendar
          </Label>
        </div>
        <div className="flex items-center gap-1 text-muted-foreground">
          <Repeat className="h-3 w-3" />
          <span>Recurring / one-off via filter above</span>
        </div>
      </div>
      {children}
    </div>
  )
}

function SkeletonList(): JSX.Element {
  return (
    <div className="space-y-2">
      {[1, 2, 3, 4, 5].map((i) => (
        <Skeleton key={i} className="h-16" />
      ))}
    </div>
  )
}

function BulkBar({
  selected,
  categories,
  onDone
}: {
  selected: Set<number>
  categories: { id: number; name: string }[]
  onDone: () => void
}): JSX.Element | null {
  const [recatId, setRecatId] = useState('')
  if (selected.size === 0) return null
  const ids = Array.from(selected)

  return (
    <div className="fixed bottom-24 left-1/2 flex flex-wrap items-center justify-center gap-2 rounded-xl border bg-card px-4 py-2 shadow-lg max-w-lg">
      <Select value={recatId} onValueChange={setRecatId}>
        <SelectTrigger className="h-8 w-36">
          <SelectValue placeholder="Recategorize" />
        </SelectTrigger>
        <SelectContent>
          {categories.map((c) => (
            <SelectItem key={c.id} value={String(c.id)}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        variant="outline"
        disabled={!recatId}
        onClick={async () => {
          await window.api.transactions.bulk('recategorize', ids, { categoryId: parseInt(recatId) })
          onDone()
        }}
      >
        Apply
      </Button>
      <Button size="sm" variant="destructive" onClick={async () => { await window.api.transactions.bulk('delete', ids); onDone() }}>
        Delete ({selected.size})
      </Button>
      <Button size="sm" onClick={async () => { await window.api.transactions.bulk('flag', ids); onDone() }}>
        Flag
      </Button>
    </div>
  )
}
