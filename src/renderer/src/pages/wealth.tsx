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
import { Landmark } from 'lucide-react'
import { EmptyState } from '@/components/shared/empty-state'
import { Pencil, Trash2 } from 'lucide-react'

export function WealthPage(): JSX.Element {
  const { profile, rates } = useAppStore()
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
    { id: number; name: string; purchase_price: number; current_value: number }[]
  >([])
  const [holdings, setHoldings] = useState<
    { id: number; etf_name: string; ticker: string; shares: number; avg_cost: number; current_price: number; current_value: number }[]
  >([])
  const [totalSavings, setTotalSavings] = useState(0)
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
  const [pension, setPension] = useState({
    current: '100000',
    monthly: '5000',
    returnRate: '7',
    retirementAge: '65'
  })

  useEffect(() => {
    load()
  }, [])

  async function load(): Promise<void> {
    setSnapshots(await window.api.wealth.list())
    setInvestments(await window.api.investments.list())
    setHoldings(await window.api.investmentHoldings.list())
    // Load total savings from transactions
    const transactions = await window.api.transactions.list()
    const savingsTotal = transactions
      .filter((t: any) => t.type === 'savings')
      .reduce((sum: number, t: any) => sum + t.amount, 0)
    setTotalSavings(savingsTotal)
  }

  async function addSnapshot(): Promise<void> {
    await window.api.wealth.create({
      date: new Date().toISOString().slice(0, 10),
      assetsSavings: parseFloat(form.savings) || 0,
      assetsInvestments: parseFloat(form.investments) || 0,
      assetsProperty: parseFloat(form.property) || 0,
      liabilitiesLoans: parseFloat(form.loans) || 0,
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
    if (!confirm('Delete this holding?')) return
    await window.api.investmentHoldings.delete(id)
    load()
  }

  const chartData = snapshots.map((s) => ({
    date: s.date.slice(0, 7),
    net:
      s.assets_savings +
      s.assets_investments +
      s.assets_property -
      s.liabilities_loans -
      s.liabilities_credit
  }))

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
        <AskAiButton context="wealth" prefill="How is my net worth trending?" />
      </div>

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
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Monthly snapshot</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg bg-muted p-3">
            <div>
              <p className="text-sm font-medium">Total from savings transactions</p>
              <p className="text-lg font-bold text-info">{formatMoney(totalSavings, profile.displayCurrency, rates)}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setForm({ ...form, savings: String(totalSavings) })}
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
                  value={form[key as keyof typeof form]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
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
        <CardHeader>
          <CardTitle>Legacy Investments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {investments.map((inv) => {
            const gain = ((inv.current_value - inv.purchase_price) / inv.purchase_price) * 100
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
              />
              <Input
                placeholder="Monthly contribution"
                value={pension.monthly}
                onChange={(e) => setPension({ ...pension, monthly: e.target.value })}
              />
              <Input
                placeholder="Return %"
                value={pension.returnRate}
                onChange={(e) => setPension({ ...pension, returnRate: e.target.value })}
              />
              <Input
                placeholder="Retirement age"
                value={pension.retirementAge}
                onChange={(e) => setPension({ ...pension, retirementAge: e.target.value })}
              />
            </div>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={pensionData}>
                  <XAxis dataKey="year" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="balance" stroke="hsl(var(--primary))" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
