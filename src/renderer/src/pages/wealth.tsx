import { useEffect, useState } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAppStore } from '@/store/app-store'
import { formatMoney } from '@/lib/utils'
import { AskAiButton } from '@/components/shared/ask-ai-button'
import { Camera, Landmark } from 'lucide-react'
import { EmptyState } from '@/components/shared/empty-state'
import { Pencil, Trash2 } from 'lucide-react'
import { useAppDialog } from '@/components/shared/app-dialog'

export function WealthPage(): JSX.Element {
  const { profile, rates, refreshTrigger } = useAppStore()
  const dialog = useAppDialog()
  const [snapshots, setSnapshots] = useState<
    {
      date: string
      assets_savings: number
      assets_investments: number
      assets_property: number
      liabilities_loans: number
      liabilities_credit: number
    }[]
  >([])
  const [investments, setInvestments] = useState<
    { id: number; name: string; purchase_price: number; current_value: number; purchase_date?: string; notes?: string }[]
  >([])
  const [holdings, setHoldings] = useState<
    { id: number; etf_name: string; ticker: string; shares: number; avg_cost: number; current_price: number; current_value: number }[]
  >([])
  const [accounts, setAccounts] = useState<
    { id: number; name: string; type: string; is_archived: number; balance: number; currency: string }[]
  >([])
  const [totalSavings, setTotalSavings] = useState(0)
  const [debtRemaining, setDebtRemaining] = useState(0)
  const [form, setForm] = useState({
    savings: '',
    investments: '',
    property: '',
    loans: '',
    credit: ''
  })
  const [holdingForm, setHoldingForm] = useState({
    etfName: '',
    ticker: '',
    shares: '',
    avgCost: '',
    currentPrice: ''
  })
  const [editingHoldingId, setEditingHoldingId] = useState<number | null>(null)
  const [editingInvestmentId, setEditingInvestmentId] = useState<number | null>(null)
  const [showInvestmentForm, setShowInvestmentForm] = useState(false)
  const [investmentForm, setInvestmentForm] = useState({ name: '', purchasePrice: '', currentValue: '', purchaseDate: '', notes: '' })
  const [pension, setPension] = useState({
    current: '100000',
    monthly: '5000',
    returnRate: '7',
    retirementAge: '65'
  })

  useEffect(() => {
    load()
  }, [refreshTrigger])

  async function load(): Promise<void> {
    const [snapshotRows, investmentRows, holdingRows, accountRows, transactions, saved, debtResult] = await Promise.all([
      window.api.wealth.list(),
      window.api.investments.list(),
      window.api.investmentHoldings.list(),
      window.api.accounts.list(),
      window.api.transactions.list({ type: 'savings' }),
      window.api.pension.get(),
      window.api.goals.debtPlanner(0)
    ])
    setSnapshots(snapshotRows)
    setInvestments(investmentRows)
    setHoldings(holdingRows)
    setAccounts(accountRows as { id: number; name: string; type: string; is_archived: number; balance: number; currency: string }[])
    const today = new Date().toISOString().slice(0, 10)
    const savingsTotal = transactions
      .filter((t: any) => t.type === 'savings' && t.date <= today)
      .reduce((sum: number, t: any) => sum + t.amount, 0)
    setTotalSavings(savingsTotal)
    setDebtRemaining(Number((debtResult as { totals?: { remainingAmount?: number } }).totals?.remainingAmount) || 0)
    if (saved) {
      setPension({
        current: String(saved.current ?? '100000'),
        monthly: String(saved.monthly ?? '5000'),
        returnRate: String(saved.returnRate ?? '7'),
        retirementAge: String(saved.retirementAge ?? '65')
      })
    }
  }

  function savePension(): void {
    window.api.pension.save({
      current: parseFloat(pension.current) || 0,
      monthly: parseFloat(pension.monthly) || 0,
      returnRate: parseFloat(pension.returnRate) || 0,
      retirementAge: parseInt(pension.retirementAge) || 65
    }).catch(() => {})
  }

  async function addSnapshot(): Promise<void> {
    await window.api.wealth.create({
      date: new Date().toISOString().slice(0, 10),
      assetsSavings: parseFloat(form.savings) || 0,
      assetsInvestments: parseFloat(form.investments) || 0,
      assetsProperty: parseFloat(form.property) || 0,
      liabilitiesLoans: debtRemaining,
      liabilitiesCredit: parseFloat(form.credit) || 0
    })
    load()
  }

  async function addHolding(): Promise<void> {
    const shares = parseFloat(holdingForm.shares)
    const avgCost = parseFloat(holdingForm.avgCost)
    const currentPrice = parseFloat(holdingForm.currentPrice)
    if (!holdingForm.etfName.trim() || !Number.isFinite(shares) || !Number.isFinite(avgCost) || !Number.isFinite(currentPrice)) return
    const payload = {
      etfName: holdingForm.etfName,
      ticker: holdingForm.ticker,
      shares,
      avgCost,
      currentPrice,
      currentValue: shares * currentPrice
    }
    if (editingHoldingId) {
      await window.api.investmentHoldings.update(editingHoldingId, payload)
    } else {
      await window.api.investmentHoldings.create(payload)
    }
    setEditingHoldingId(null)
    setHoldingForm({ etfName: '', ticker: '', shares: '', avgCost: '', currentPrice: '' })
    load()
  }

  async function deleteHolding(id: number): Promise<void> {
    if (!await dialog.confirm('Delete this holding?', {
      title: 'Delete holding',
      confirmLabel: 'Delete',
      destructive: true
    })) return
    await window.api.investmentHoldings.delete(id)
    load()
  }

  async function saveLegacyInvestment(): Promise<void> {
    const payload = { name: investmentForm.name.trim(), purchasePrice: Number(investmentForm.purchasePrice) || 0, currentValue: Number(investmentForm.currentValue) || 0, purchaseDate: investmentForm.purchaseDate || null, notes: investmentForm.notes.trim() || null }
    if (!payload.name) return
    if (editingInvestmentId) await window.api.investments.update(editingInvestmentId, payload)
    else await window.api.investments.create(payload)
    setEditingInvestmentId(null)
    setShowInvestmentForm(false)
    setInvestmentForm({ name: '', purchasePrice: '', currentValue: '', purchaseDate: '', notes: '' })
    await load()
  }

  async function deleteLegacyInvestment(id: number): Promise<void> {
    if (!await dialog.confirm('Delete this legacy investment?', { title: 'Delete investment', confirmLabel: 'Delete', destructive: true })) return
    await window.api.investments.delete(id)
    await load()
  }

  // Investment holdings total current value
  const holdingsTotal = holdings.reduce((sum, h) => sum + h.current_value, 0)
  const investmentsTotal = investments.reduce((sum, inv) => sum + inv.current_value, 0)
  const activeAccounts = accounts.filter((account) => account.is_archived !== 1)
  const liquidAccountBalance = activeAccounts
    .filter((account) => ['checking', 'savings', 'cash'].includes(account.type))
    .reduce((sum, account) => sum + account.balance, 0)
  const snapshotSavingsValue = activeAccounts.length > 0 ? liquidAccountBalance : totalSavings

  const chartData = snapshots.map((s) => ({
    date: s.date.slice(0, 7),
    net:
      s.assets_savings +
      s.assets_investments +
      s.assets_property -
      s.liabilities_loans -
      s.liabilities_credit
  }))

  const latestSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null
  const propertyValue = latestSnapshot?.assets_property ?? 0
  const otherCredit = latestSnapshot?.liabilities_credit ?? 0
  const hasLiveData = snapshotSavingsValue !== 0 || holdingsTotal > 0 || investmentsTotal > 0 || propertyValue > 0 || debtRemaining > 0 || otherCredit > 0
  const currentNetWorth = snapshotSavingsValue + holdingsTotal + investmentsTotal + propertyValue - debtRemaining - otherCredit

  const pensionData = Array.from({ length: 30 }, (_, i) => {
    const months = i * 12
    const r = parseFloat(pension.returnRate) / 100 / 12
    const pmt = parseFloat(pension.monthly)
    let balance = parseFloat(pension.current)
    for (let m = 0; m < months; m++) balance = balance * (1 + r) + pmt
    return { year: i, balance }
  })

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Wealth</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={async () => { await window.api.wealth.captureSnapshot(); await load(); await dialog.alert('Current account, investment, and debt values were saved.', 'Snapshot captured') }}><Camera className="h-4 w-4" /> Capture snapshot</Button>
          <AskAiButton context="wealth" prefill="How is my net worth trending?" />
        </div>
      </div>

      {hasLiveData && (
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Current net worth (live assets minus remaining debts)</p>
            <p className="text-3xl font-bold mt-1">{formatMoney(currentNetWorth, profile.displayCurrency, rates)}</p>
            <div className="flex gap-6 mt-3 text-sm text-muted-foreground">
              <span>Accounts: <strong className="text-foreground">{formatMoney(snapshotSavingsValue, profile.displayCurrency, rates)}</strong></span>
              <span>ETFs: <strong className="text-foreground">{formatMoney(holdingsTotal, profile.displayCurrency, rates)}</strong></span>
              <span>Investments: <strong className="text-foreground">{formatMoney(investmentsTotal, profile.displayCurrency, rates)}</strong></span>
              <span>Debts: <strong className="text-warning">−{formatMoney(debtRemaining, profile.displayCurrency, rates)}</strong></span>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Net worth over time</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          {chartData.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="nw" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip formatter={(v: number) => formatMoney(v, profile.displayCurrency, rates)} />
                <Area type="monotone" dataKey="net" stroke="hsl(var(--primary))" fill="url(#nw)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState
              icon={Landmark}
              title="No wealth snapshots"
              description="Add your first monthly snapshot below to track net worth over time."
              actionLabel="Take your first snapshot"
              onAction={() => document.getElementById('snapshot-form')?.scrollIntoView({ behavior: 'smooth' })}
            />
          )}
        </CardContent>
      </Card>

      <Card id="snapshot-form">
        <CardHeader>
          <CardTitle>Monthly snapshot</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg bg-muted p-3">
            <div>
              <p className="text-sm font-medium">Snapshot savings source</p>
              <p className="text-lg font-bold text-info">{formatMoney(snapshotSavingsValue, profile.displayCurrency, rates)}</p>
              {activeAccounts.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  From checking, savings, and cash accounts. Savings transactions total: {formatMoney(totalSavings, profile.displayCurrency, rates)}
                </p>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setForm({ ...form, savings: String(snapshotSavingsValue), investments: String(holdingsTotal + investmentsTotal), loans: String(debtRemaining) })}
            >
              Auto-fill
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {[
              ['savings', 'Savings'],
              ['investments', 'Investments'],
              ['property', 'Property'],
              ['loans', 'Loans'],
              ['credit', 'Credit cards']
            ].map(([key, label]) => (
              <div key={key} className="grid gap-2">
                <Label>{label}</Label>
                <Input
                  type="number"
                  value={key === 'loans' ? String(debtRemaining) : form[key as keyof typeof form]}
                  readOnly={key === 'loans'}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
                {key === 'loans' && <p className="text-xs text-muted-foreground">Updated automatically from Debt payoff.</p>}
              </div>
            ))}
            <Button onClick={addSnapshot} className="md:col-span-3">
              Save snapshot
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Investment Holdings (ETFs)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {holdings.map((h) => {
              const gain = h.current_price > 0 ? ((h.current_price - h.avg_cost) / h.avg_cost) * 100 : 0
              return (
                <div key={h.id} className="rounded-lg border p-4">
                  <div className="flex justify-between">
                    <div>
                      <span className="font-medium">{h.etf_name}</span>
                      {h.ticker && <span className="ml-2 text-xs text-muted-foreground">({h.ticker})</span>}
                    </div>
                    <span className={gain >= 0 ? 'text-success' : 'text-destructive'}>
                      {gain >= 0 ? '+' : ''}
                      {gain.toFixed(1)}%
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <p className="text-muted-foreground">Shares</p>
                      <p className="font-medium">{h.shares}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Value</p>
                      <p className="font-medium">{formatMoney(h.current_value, profile.displayCurrency, rates)}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingHoldingId(h.id)
                        setHoldingForm({
                          etfName: h.etf_name,
                          ticker: h.ticker ?? '',
                          shares: String(h.shares),
                          avgCost: String(h.avg_cost),
                          currentPrice: String(h.current_price ?? 0)
                        })
                      }}
                    >
                      <Pencil className="h-3 w-3" />
                      Edit
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => deleteHolding(h.id)}>
                      <Trash2 className="h-3 w-3" />
                      Delete
                    </Button>
                  </div>
                </div>
              )
            })}
            {holdings.length === 0 && (
              <p className="text-sm text-muted-foreground">No ETF holdings tracked yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{editingHoldingId ? 'Edit ETF Holding' : 'Add ETF Holding'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label>ETF Name</Label>
              <Input
                placeholder="e.g., Vanguard S&P 500 UCITS ETF"
                value={holdingForm.etfName}
                onChange={(e) => setHoldingForm({ ...holdingForm, etfName: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label>Ticker (optional)</Label>
              <Input
                placeholder="e.g., VOO"
                value={holdingForm.ticker}
                onChange={(e) => setHoldingForm({ ...holdingForm, ticker: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="grid gap-2">
                <Label>Shares</Label>
                <Input
                  type="number"
                  value={holdingForm.shares}
                  onChange={(e) => setHoldingForm({ ...holdingForm, shares: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label>Avg Cost</Label>
                <Input
                  type="number"
                  value={holdingForm.avgCost}
                  onChange={(e) => setHoldingForm({ ...holdingForm, avgCost: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label>Current Price</Label>
                <Input
                  type="number"
                  value={holdingForm.currentPrice}
                  onChange={(e) => setHoldingForm({ ...holdingForm, currentPrice: e.target.value })}
                />
              </div>
            </div>
            <Button onClick={addHolding} className="w-full">
              Add Holding
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Legacy Investments</CardTitle>
          <Button size="sm" variant="outline" onClick={() => { setEditingInvestmentId(null); setInvestmentForm({ name: '', purchasePrice: '', currentValue: '', purchaseDate: '', notes: '' }); setShowInvestmentForm(true) }}>Add investment</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {showInvestmentForm && <div className="grid gap-2 rounded-lg border p-3 md:grid-cols-5"><Input value={investmentForm.name} onChange={(event) => setInvestmentForm({ ...investmentForm, name: event.target.value })} placeholder="Name" /><Input type="number" value={investmentForm.purchasePrice} onChange={(event) => setInvestmentForm({ ...investmentForm, purchasePrice: event.target.value })} placeholder="Purchase value" /><Input type="number" value={investmentForm.currentValue} onChange={(event) => setInvestmentForm({ ...investmentForm, currentValue: event.target.value })} placeholder="Current value" /><Input type="date" value={investmentForm.purchaseDate} onChange={(event) => setInvestmentForm({ ...investmentForm, purchaseDate: event.target.value })} /><div className="flex gap-1"><Button onClick={saveLegacyInvestment}>Save</Button><Button variant="ghost" onClick={() => setShowInvestmentForm(false)}>Cancel</Button></div></div>}
          {investments.map((inv) => {
            const gain = inv.purchase_price > 0 ? ((inv.current_value - inv.purchase_price) / inv.purchase_price) * 100 : 0
            return (
              <div key={inv.id} className="rounded-lg border p-4">
                <div className="flex justify-between">
                  <span className="font-medium">{inv.name}</span>
                  <span className={gain >= 0 ? 'text-success' : 'text-destructive'}>
                    {gain >= 0 ? '+' : ''}
                    {gain.toFixed(1)}%
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {formatMoney(inv.current_value, profile.displayCurrency, rates)}
                </p>
                <div className="mt-2 flex gap-2"><Button size="sm" variant="outline" onClick={() => { setEditingInvestmentId(inv.id); setInvestmentForm({ name: inv.name, purchasePrice: String(inv.purchase_price), currentValue: String(inv.current_value), purchaseDate: inv.purchase_date ?? '', notes: inv.notes ?? '' }); setShowInvestmentForm(true) }}><Pencil className="h-3 w-3" />Edit</Button><Button size="sm" variant="destructive" onClick={() => deleteLegacyInvestment(inv.id)}><Trash2 className="h-3 w-3" />Delete</Button></div>
              </div>
            )
          })}
          {investments.length === 0 && (
            <p className="text-sm text-muted-foreground">No legacy holdings tracked yet.</p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Pension projection</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 grid grid-cols-2 gap-2">
              <Input
                placeholder="Current savings"
                value={pension.current}
                onChange={(e) => setPension({ ...pension, current: e.target.value })}
                onBlur={savePension}
              />
              <Input
                placeholder="Monthly contribution"
                value={pension.monthly}
                onChange={(e) => setPension({ ...pension, monthly: e.target.value })}
                onBlur={savePension}
              />
              <Input
                placeholder="Return %"
                value={pension.returnRate}
                onChange={(e) => setPension({ ...pension, returnRate: e.target.value })}
                onBlur={savePension}
              />
              <Input
                placeholder="Retirement age"
                value={pension.retirementAge}
                onChange={(e) => setPension({ ...pension, retirementAge: e.target.value })}
                onBlur={savePension}
              />
            </div>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={pensionData}>
                  <XAxis dataKey="year" fontSize={12} />
                  <YAxis fontSize={12} tickFormatter={(v: number) => formatMoney(v, profile.displayCurrency, rates)} />
                  <Tooltip formatter={(v: number) => formatMoney(v, profile.displayCurrency, rates)} />
                  <Line type="monotone" dataKey="balance" stroke="hsl(var(--primary))" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
