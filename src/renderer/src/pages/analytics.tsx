import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAppStore } from '@/store/app-store'
import { formatMoney, formatPercent, MONTH_NAMES } from '@/lib/utils'
import { AskAiButton } from '@/components/shared/ask-ai-button'
import { Skeleton } from '@/components/ui/skeleton'
import { SpendingHeatmap } from '@/components/shared/spending-heatmap'
import { cardHoverVariants } from '@/lib/motion'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine
} from 'recharts'

export function AnalyticsPage(): JSX.Element {
  const { profile, rates, selectedMonth } = useAppStore()
  const [summary, setSummary] = useState<{
    monthly: { month: string; expenses: number; income: number; savings: number }[]
    byCategory: { name: string; color: string; total: number }[]
  } | null>(null)
  const [mom, setMom] = useState<
    { name: string; color: string; total: number; change: number }[]
  >([])
  const [heatmap, setHeatmap] = useState<{
    categories: string[]
    months: number[]
    cells: Record<string, Record<number, number>>
    max: number
  } | null>(null)
  const [dailySpending, setDailySpending] = useState<{ date: string; amount: number }[]>([])
  const [breakEven, setBreakEven] = useState<{
    timeline: { month: number; cumulative: number; net: number }[]
    breakEvenMonth: number | null
    irregularMonths: number[]
  } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      window.api.analytics.summary(profile.year),
      window.api.analytics.mom(profile.year, selectedMonth),
      window.api.analytics.heatmap(profile.year),
      window.api.analytics.breakEven(profile.year),
      window.api.transactions.list({ year: profile.year, month: selectedMonth })
    ]).then(([s, m, h, b, txs]) => {
      setSummary(s as typeof summary)
      setMom(m as typeof mom)
      setHeatmap(h as typeof heatmap)
      setBreakEven(b as typeof breakEven)
      
      // Process daily spending for heatmap
      const dailyMap = new Map<string, number>()
      for (const tx of txs as { date: string; amount: number; type: string }[]) {
        if (tx.type === 'expense') {
          const dateStr = tx.date.split('T')[0]
          dailyMap.set(dateStr, (dailyMap.get(dateStr) || 0) + tx.amount)
        }
      }
      setDailySpending(Array.from(dailyMap.entries()).map(([date, amount]) => ({ date, amount })))
      
      setLoading(false)
    })
  }, [profile.year, selectedMonth])

  if (loading || !summary) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-24" />
        <div className="grid gap-3 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      </div>
    )
  }

  const biggestMover = [...mom].sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0]

  const quarters = [1, 2, 3, 4].map((q) => {
    const months = summary.monthly.filter((m) => {
      const mi = parseInt(m.month, 10)
      return mi >= (q - 1) * 3 + 1 && mi <= q * 3
    })
    return {
      quarter: `Q${q}`,
      expenses: months.reduce((s, m) => s + m.expenses, 0),
      income: months.reduce((s, m) => s + m.income, 0),
      savings: months.reduce((s, m) => s + m.savings, 0)
    }
  })

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Month-over-month for {MONTH_NAMES[selectedMonth - 1]} {profile.year}
          </p>
        </div>
        <AskAiButton context="analytics" prefill="What are my biggest spending trends this year?" />
      </div>

      {biggestMover && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex items-center gap-4 p-6">
            {biggestMover.change > 0 ? (
              <TrendingUp className="h-10 w-10 text-destructive" />
            ) : (
              <TrendingDown className="h-10 w-10 text-success" />
            )}
            <div>
              <p className="text-lg font-bold">
                {biggestMover.name} {biggestMover.change > 0 ? 'increased' : 'decreased'}{' '}
                {Math.abs(biggestMover.change).toFixed(0)}% vs last month
              </p>
              <p className="text-sm text-muted-foreground">Biggest expense mover</p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
        {mom.map((c, i) => (
          <motion.div
            key={c.name}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03 }}
          >
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">{c.name}</p>
                <p className="text-xl font-bold">{formatMoney(c.total, profile.displayCurrency, rates)}</p>
                <p className={`text-sm font-medium ${c.change >= 0 ? 'text-destructive' : 'text-success'}`}>
                  {formatPercent(c.change)} MoM
                </p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {breakEven && (
        <Card>
          <CardHeader>
            <CardTitle>YTD savings timeline</CardTitle>
            {breakEven.breakEvenMonth && (
              <p className="text-sm text-warning">
                Break-even pressure around {MONTH_NAMES[breakEven.breakEvenMonth - 1]}
              </p>
            )}
          </CardHeader>
          <CardContent className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={breakEven.timeline.map((t) => ({
                  month: MONTH_NAMES[t.month - 1]?.slice(0, 3),
                  cumulative: t.cumulative,
                  irregular: breakEven.irregularMonths.includes(t.month)
                }))}
              >
                <XAxis dataKey="month" fontSize={11} />
                <YAxis fontSize={11} tickFormatter={(v: number) => formatMoney(v, profile.displayCurrency, rates)} />
                <Tooltip formatter={(v: number) => formatMoney(v, profile.displayCurrency, rates)} />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
                <Bar dataKey="cumulative" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Expense as % of income</CardTitle>
        </CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={summary.byCategory.map((c) => {
                const totalIncome = summary.monthly.reduce((s, m) => s + m.income, 0) || 1
                return { name: c.name, pct: (c.total / totalIncome) * 100 }
              })}
              layout="vertical"
            >
              <XAxis type="number" unit="%" />
              <YAxis type="category" dataKey="name" width={80} fontSize={11} />
              <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
              <Bar dataKey="pct" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <motion.div
        whileHover="hover"
        variants={cardHoverVariants}
      >
        <Card className="glass-card">
          <CardHeader>
            <CardTitle>Daily spending calendar</CardTitle>
            <p className="text-sm text-muted-foreground">
              {MONTH_NAMES[selectedMonth - 1]} {profile.year}
            </p>
          </CardHeader>
          <CardContent>
            <SpendingHeatmap
              data={dailySpending}
              year={profile.year}
              month={selectedMonth}
            />
          </CardContent>
        </Card>
      </motion.div>

      {heatmap && heatmap.categories.length > 0 && (
        <motion.div
          whileHover="hover"
          variants={cardHoverVariants}
        >
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Category spending heatmap</CardTitle>
            </CardHeader>
            <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-1 text-xs">
                <thead>
                  <tr>
                    <th className="p-2 text-left text-muted-foreground sticky left-0 bg-card" />
                    {heatmap.months.map((m) => (
                      <th key={m} className="p-2 text-muted-foreground min-w-[3rem]">
                        {MONTH_NAMES[m - 1]?.slice(0, 3)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {heatmap.categories.map((cat) => (
                    <tr key={cat}>
                      <td className="p-2 font-medium sticky left-0 bg-card">{cat}</td>
                      {heatmap.months.map((m) => {
                        const val = heatmap.cells[cat]?.[m] ?? 0
                        const intensity = heatmap.max > 0 ? val / heatmap.max : 0
                        return (
                          <td
                            key={m}
                            title={formatMoney(val, profile.displayCurrency, rates)}
                            className="rounded p-2 text-center tabular-nums"
                            style={{
                              backgroundColor: `hsl(var(--primary) / ${0.08 + intensity * 0.85})`,
                              color: intensity > 0.5 ? 'hsl(var(--primary-foreground))' : 'inherit'
                            }}
                          >
                            {val > 0 ? (val >= 1000 ? `${(val / 1000).toFixed(1)}k` : Math.round(val)) : ''}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
        </motion.div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        {quarters.map((q) => (
          <Card key={q.quarter}>
            <CardHeader>
              <CardTitle className="text-base">{q.quarter}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Expenses</p>
              <p className="font-bold">{formatMoney(q.expenses, profile.displayCurrency, rates)}</p>
              <p className="mt-2 text-sm text-muted-foreground">Income</p>
              <p className="font-bold text-success">
                {formatMoney(q.income, profile.displayCurrency, rates)}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">Savings</p>
              <p className="font-bold text-info">
                {formatMoney(q.savings, profile.displayCurrency, rates)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
