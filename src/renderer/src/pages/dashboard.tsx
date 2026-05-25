import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts'
import { Flame, TrendingUp, Sparkles } from 'lucide-react'
import { StatTile } from '@/components/shared/stat-tile'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AskAiButton } from '@/components/shared/ask-ai-button'
import { useAppStore } from '@/store/app-store'
import { formatMoney, MONTH_NAMES } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface DashboardStats {
  netWorth: number
  spending: number
  income: number
  savings: number
  savingsRate: number
  streak: { current: number; longest: number }
  categoryMonth: { name: string; color: string; value: number }[]
  monthlyTrend: { month: string; expenses: number; income: number; savings: number }[]
  savingsByMonth: { month: string; rate: number }[]
  budgetHealth: number
  insights: { content: string }[]
}

export function DashboardPage(): JSX.Element {
  const { profile, selectedMonth, rates, loading: appLoading } = useAppStore()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [weeklyTip, setWeeklyTip] = useState('')
  const [generatingInsight, setGeneratingInsight] = useState(false)

  useEffect(() => {
    async function load(): Promise<void> {
      setLoading(true)
      const data = await window.api.dashboard.stats(profile.year, selectedMonth)
      setStats(data as DashboardStats)
      const tip = await window.api.ai.weeklyTip()
      setWeeklyTip(tip)
      setLoading(false)
    }
    if (!appLoading) load()
  }, [profile.year, selectedMonth, appLoading])

  async function refreshInsight(): Promise<void> {
    setGeneratingInsight(true)
    try {
      const insight = await window.api.ai.insight()
      await window.api.ai.saveInsight(insight, profile.year, selectedMonth)
      const data = await window.api.dashboard.stats(profile.year, selectedMonth)
      setStats(data as DashboardStats)
    } finally {
      setGeneratingInsight(false)
    }
  }

  if (loading || !stats) {
    return (
      <div className="space-y-6 p-6">
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    )
  }

  const pieData = stats.categoryMonth.map((c) => ({ name: c.name, value: c.value, fill: c.color }))
  const barData = stats.monthlyTrend.map((m) => ({
    month: MONTH_NAMES[parseInt(m.month, 10) - 1]?.slice(0, 3) ?? m.month,
    income: m.income,
    expenses: m.expenses,
    savings: m.savings
  }))

  const bestMonth = [...stats.savingsByMonth].sort((a, b) => b.rate - a.rate)[0]
  const worstMonth = [...stats.savingsByMonth].sort((a, b) => a.rate - b.rate)[0]

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            {profile.name ? `Hello, ${profile.name}` : 'Dashboard'}
          </h1>
          <p className="text-muted-foreground">
            {MONTH_NAMES[selectedMonth - 1]} {profile.year}
          </p>
        </div>
        <AskAiButton context="dashboard" prefill="Summarize my financial situation this month" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Net worth" value={stats.netWorth} delay={0} color="info" />
        <StatTile label="This month spending" value={stats.spending} delay={0.05} />
        <StatTile label="This month savings" value={stats.savings} delay={0.1} color="success" />
        <StatTile
          label="Savings rate"
          value={stats.savingsRate}
          format="percent"
          delay={0.15}
          color={stats.savingsRate >= 15 ? 'success' : stats.savingsRate >= 0 ? 'warning' : 'destructive'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Income, expenses & savings</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData}>
                <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <Tooltip
                  formatter={(v: number) => formatMoney(v, profile.displayCurrency, rates)}
                  contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                />
                <Legend />
                <Bar dataKey="income" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expenses" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
                <Bar dataKey="savings" fill="hsl(var(--info))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Budget health</CardTitle>
            <span
              className={`text-3xl font-bold ${
                stats.budgetHealth >= 70
                  ? 'text-success'
                  : stats.budgetHealth >= 40
                    ? 'text-warning'
                    : 'text-destructive'
              }`}
            >
              {stats.budgetHealth}
            </span>
          </CardHeader>
          <CardContent>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <motion.div
                className="h-full bg-primary"
                initial={{ width: 0 }}
                animate={{ width: `${stats.budgetHealth}%` }}
                transition={{ duration: 1, ease: 'easeOut' }}
              />
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              Based on savings rate, goal progress, and budget adherence.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Savings rate trend</CardTitle>
          </CardHeader>
          <CardContent className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={stats.savingsByMonth.map((s) => ({
                month: MONTH_NAMES[parseInt(s.month, 10) - 1]?.slice(0, 3),
                rate: s.rate
              }))}>
                <XAxis dataKey="month" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
                <Line type="monotone" dataKey="rate" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Spending by category</CardTitle>
          </CardHeader>
          <CardContent className="h-56">
            {pieData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" innerRadius={50} outerRadius={80} paddingAngle={2}>
                    {pieData.map((e, i) => (
                      <Cell key={i} fill={e.fill} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatMoney(v, profile.displayCurrency, rates)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">No spending data yet</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {bestMonth && (
          <Card className="border-success/30 bg-success/5">
            <CardContent className="flex items-center gap-4 p-6">
              <TrendingUp className="h-8 w-8 text-success" />
              <div>
                <p className="text-sm text-muted-foreground">Best savings month</p>
                <p className="font-semibold">
                  {MONTH_NAMES[parseInt(bestMonth.month, 10) - 1]} — {bestMonth.rate.toFixed(1)}% saved
                </p>
              </div>
            </CardContent>
          </Card>
        )}
        {worstMonth && worstMonth !== bestMonth && (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="flex items-center gap-4 p-6">
              <TrendingUp className="h-8 w-8 rotate-180 text-destructive" />
              <div>
                <p className="text-sm text-muted-foreground">Needs attention</p>
                <p className="font-semibold">
                  {MONTH_NAMES[parseInt(worstMonth.month, 10) - 1]} — {worstMonth.rate.toFixed(1)}% saved
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            AI insights
          </h2>
          <Button variant="outline" size="sm" onClick={refreshInsight} disabled={generatingInsight}>
            Refresh insights
          </Button>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {(stats.insights.length ? stats.insights : [{ content: weeklyTip }]).slice(0, 3).map((ins, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
            >
              <Card className="bg-primary/5">
                <CardContent className="p-4 text-sm">{ins.content}</CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>

      {weeklyTip && (
        <Card className="border-primary/20">
          <CardHeader>
            <CardTitle className="text-base">Weekly budget coach</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{weeklyTip}</CardContent>
        </Card>
      )}
    </div>
  )
}
