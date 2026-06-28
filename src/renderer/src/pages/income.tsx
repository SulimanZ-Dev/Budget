import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useAppStore } from '@/store/app-store'
import { formatMoney } from '@/lib/utils'
import { frequencyToMonthly, grossFromNet, netFromGross, roundCurrency, type IncomeSourceRow } from '@/lib/finance'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts'
import { MONTH_NAMES } from '@/lib/utils'
import { AskAiButton } from '@/components/shared/ask-ai-button'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { InfoTooltip } from '@/components/shared/info-tooltip'

export function IncomePage(): JSX.Element {
  const { profile, rates, setProfile, refreshTrigger, triggerRefresh } = useAppStore()
  const [sources, setSources] = useState<
    (IncomeSourceRow & { name: string; color: string; is_gross: number; is_recurring: number })[]
  >([])
  const [entries, setEntries] = useState<
    { source_id: number; source_name: string; month: number; amount: number; is_irregular: number; color: string; is_gross: number }[]
  >([])
  const [txIncomeTotal, setTxIncomeTotal] = useState(0)
  const [txIncomeByMonth, setTxIncomeByMonth] = useState<Record<number, number>>({})
  const [modalOpen, setModalOpen] = useState(false)
  const [editingSource, setEditingSource] = useState<{
    id: number
    name: string
    amount: number
    color: string
    is_gross: number
    is_recurring: number
    gross_or_net?: 'gross' | 'net'
    frequency?: 'weekly' | 'fortnightly' | 'monthly' | 'yearly'
  } | null>(null)
  const [form, setForm] = useState({
    name: '',
    amount: '',
    isGross: false,
    isRecurring: true,
    frequency: 'monthly' as 'weekly' | 'fortnightly' | 'monthly' | 'yearly',
    color: '#22c55e'
  })

  useEffect(() => {
    load().catch(console.error)
  }, [profile.year, refreshTrigger])

  async function load(): Promise<void> {
    try {
      setSources(await window.api.income.sources())
      setEntries(await window.api.income.entries(profile.year))
      const txs = (await window.api.transactions.list({ year: profile.year })) as { amount: number; type: string; date: string; notes?: string }[]
      // Exclude linked transactions (created alongside non-recurring income sources)
      // to avoid double-counting — those amounts are already in income_entries
      const incomeTxs = txs.filter((t) => t.type === 'income' && !t.notes?.startsWith('income_source:'))
      setTxIncomeTotal(incomeTxs.reduce((s, t) => s + t.amount, 0))
      const monthly: Record<number, number> = {}
      for (const tx of incomeTxs) {
        const m = new Date(tx.date).getMonth() + 1
        monthly[m] = (monthly[m] ?? 0) + tx.amount
      }
      setTxIncomeByMonth(monthly)
    } catch (error) {
      console.error('Failed to load income data:', error)
    }
  }

  async function saveSource(): Promise<void> {
    const parsedAmount = parseFloat(form.amount)
    if (!form.name.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0) return
    try {
      if (editingSource) {
        await window.api.income.updateSource({
          id: editingSource.id,
          name: form.name,
          amount: parsedAmount,
          isGross: form.isGross,
          isRecurring: form.isRecurring,
          grossOrNet: form.isGross ? 'gross' : 'net',
          frequency: form.frequency,
          color: form.color
        })
      } else {
        await window.api.income.createSource({
          name: form.name,
          amount: parsedAmount,
          isGross: form.isGross,
          isRecurring: form.isRecurring,
          grossOrNet: form.isGross ? 'gross' : 'net',
          frequency: form.frequency,
          color: form.color
        })
      }
      setModalOpen(false)
      setEditingSource(null)
      setForm({
        name: '',
        amount: '',
        isGross: false,
        isRecurring: true,
        frequency: 'monthly',
        color: '#22c55e'
      })
      await load()
      triggerRefresh()
    } catch (error) {
      console.error('Failed to save income source:', error)
    }
  }

  async function deleteSource(id: number): Promise<void> {
    if (!confirm('Delete this income source?')) return
    try {
      await window.api.income.deleteSource(id)
      await load()
      triggerRefresh()
    } catch (error) {
      console.error('Failed to delete income source:', error)
    }
  }

  function openEditModal(src: typeof sources[0]): void {
    setEditingSource(src)
    setForm({
      name: src.name,
      amount: String(src.amount),
      isGross: src.is_gross === 1,
      isRecurring: src.is_recurring !== 0,
      frequency: src.frequency ?? 'monthly',
      color: src.color
    })
    setModalOpen(true)
  }

  function closeModal(): void {
    setModalOpen(false)
    setEditingSource(null)
    setForm({
      name: '',
      amount: '',
      isGross: false,
      isRecurring: true,
      frequency: 'monthly',
      color: '#22c55e'
    })
  }

  const shouldShowGross = profile.grossIncomeToggle

  function toNetMonthly(entryAmount: number, source: (typeof sources)[number] | undefined): number {
    if (!source) return 0
    const monthly = frequencyToMonthly(entryAmount, source.frequency ?? 'monthly')
    const mode = source.gross_or_net ?? (source.is_gross === 1 ? 'gross' : 'net')
    return mode === 'gross' ? netFromGross(monthly, profile.taxWithheldPercent) : roundCurrency(monthly)
  }

  const chartData = MONTH_NAMES.map((name, i) => {
    const month = i + 1
    const row: Record<string, string | number> = { month: name.slice(0, 3) }
    for (const src of sources) {
      const e = entries.find((en) => en.source_id === src.id && en.month === month)
      const amountForMonth = e?.amount ?? (src.is_recurring === 1 ? src.amount : 0)
      const netAmount = toNetMonthly(amountForMonth, src)
      const viewAmount = shouldShowGross ? grossFromNet(netAmount, profile.taxWithheldPercent) : netAmount
      row[src.name] = Number.isFinite(viewAmount) ? Math.max(0, viewAmount) : 0
    }
    const monthTxTotal = txIncomeByMonth[month] ?? 0
    if (monthTxTotal > 0) {
      row['Transactions'] = shouldShowGross ? grossFromNet(monthTxTotal, profile.taxWithheldPercent) : monthTxTotal
    }
    return row
  })

  const totalAnnualNet = MONTH_NAMES.reduce((sum, _, i) => {
    const month = i + 1
    const monthTotal = sources.reduce((monthSum, src) => {
      const e = entries.find((en) => en.source_id === src.id && en.month === month)
      const amountForMonth = e?.amount ?? (src.is_recurring === 1 ? src.amount : 0)
      return monthSum + toNetMonthly(amountForMonth, src)
    }, 0)
    return sum + monthTotal
  }, 0) + txIncomeTotal
  const totalAnnualGross = grossFromNet(totalAnnualNet, profile.taxWithheldPercent)
  const totalView = shouldShowGross ? totalAnnualGross : totalAnnualNet
  const estimatedTax = Math.max(0, totalAnnualGross - totalAnnualNet)
  const takeHome = totalAnnualNet

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Income</h1>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              checked={profile.grossIncomeToggle}
              onCheckedChange={(v) => {
                setProfile({ grossIncomeToggle: v })
                window.api.settings.setProfile({ ...profile, grossIncomeToggle: v })
              }}
            />
            <Label>{shouldShowGross ? 'Gross' : 'Net'} view</Label>
            <InfoTooltip content="Toggle between gross (pre-tax) and net (after-tax) income display. Your tax withheld % is configured in Settings." />
          </div>
          <Button onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add income source
          </Button>
          <AskAiButton context="income" />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Total income ({profile.year})</p>
            <p className="text-2xl font-bold">
              {formatMoney(totalView, profile.displayCurrency, rates)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tax estimator</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <p>
              Withheld ({profile.taxWithheldPercent}%):{' '}
              <span className="font-medium">{formatMoney(estimatedTax, profile.displayCurrency, rates)}</span>
            </p>
            <p>
              Take-home:{' '}
              <span className="font-medium text-success">
                {formatMoney(takeHome, profile.displayCurrency, rates)}
              </span>
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Income by stream</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {sources.map((src) => {
            const total = entries
              .filter((e) => e.source_id === src.id)
              .reduce((sum, e) => sum + toNetMonthly(e.amount, src), 0) +
              (src.is_recurring === 1
                ? MONTH_NAMES.reduce((recurringMonths, _, i) => {
                    const month = i + 1
                    const hasEntry = entries.some((e) => e.source_id === src.id && e.month === month)
                    if (hasEntry) return recurringMonths
                    return recurringMonths + toNetMonthly(src.amount, src)
                  }, 0)
                : 0)
            const pct = totalAnnualNet > 0 ? (total / totalAnnualNet) * 100 : 0
            return (
              <div key={src.id} className="flex items-center justify-between rounded-lg border p-4">
                <div className="flex items-center gap-3">
                  <div className="h-3 w-3 rounded-full" style={{ backgroundColor: src.color }} />
                  <div>
                    <span className="font-medium">{src.name}</span>
                    <p className="text-xs text-muted-foreground">
                      {src.is_recurring === 1 ? 'Recurring' : 'One-time'} • {(src.gross_or_net ?? (src.is_gross === 1 ? 'gross' : 'net')).toUpperCase()} • {(src.frequency ?? 'monthly').toUpperCase()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="font-bold">
                      {formatMoney(
                        shouldShowGross ? grossFromNet(total, profile.taxWithheldPercent) : total,
                        profile.displayCurrency,
                        rates
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{pct.toFixed(0)}% of total</p>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditModal(src)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deleteSource(src.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}
          {txIncomeTotal > 0 && (
            <div className="flex items-center justify-between rounded-lg border p-4 border-dashed border-info/30">
              <div className="flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-info" />
                <div>
                  <span className="font-medium">Transaction income (one-time)</span>
                  <p className="text-xs text-muted-foreground">Entered via transaction modal</p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-bold">
                  {formatMoney(
                    shouldShowGross ? grossFromNet(txIncomeTotal, profile.taxWithheldPercent) : txIncomeTotal,
                    profile.displayCurrency,
                    rates
                  )}
                </p>
                <p className="text-xs text-muted-foreground">{totalAnnualNet > 0 ? ((txIncomeTotal / totalAnnualNet) * 100).toFixed(0) : 0}% of total</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Monthly income trend</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <XAxis dataKey="month" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip />
              <Legend />
              {sources.map((s) => (
                <Bar key={s.id} dataKey={s.name} stackId="a" fill={s.color} radius={[0, 0, 0, 0]} />
              ))}
              {txIncomeTotal > 0 && <Bar dataKey="Transactions" stackId="a" fill="hsl(var(--info))" radius={[0, 0, 0, 0]} />}
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Dialog open={modalOpen} onOpenChange={closeModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingSource ? 'Edit income source' : 'Add income source'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g., Salary, Freelance" />
            </div>
            <div className="grid gap-2">
              <Label>Amount</Label>
              <Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="e.g., 50000" />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.isGross} onCheckedChange={(v) => setForm({ ...form, isGross: v })} />
              <Label>Gross income</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.isRecurring} onCheckedChange={(v) => setForm({ ...form, isRecurring: v })} />
              <Label>Recurring (monthly)</Label>
            </div>
            {form.isRecurring && (
              <div className="grid gap-2">
                <Label>Frequency</Label>
                <div className="flex flex-wrap gap-2">
                  {(['weekly', 'fortnightly', 'monthly', 'yearly'] as const).map((frequency) => (
                    <Button
                      key={frequency}
                      type="button"
                      size="sm"
                      variant={form.frequency === frequency ? 'default' : 'outline'}
                      onClick={() => setForm({ ...form, frequency })}
                    >
                      {frequency[0].toUpperCase() + frequency.slice(1)}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            <Button onClick={saveSource}>{editingSource ? 'Save changes' : 'Add source'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
