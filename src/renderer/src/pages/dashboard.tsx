import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts'
import { Flame, TrendingUp, Sparkles, CreditCard, AlertTriangle } from 'lucide-react'
import { StatTile } from '@/components/shared/stat-tile'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AskAiButton } from '@/components/shared/ask-ai-button'
import { useAppStore } from '@/store/app-store'
import { formatMoney, MONTH_NAMES, COLORBLIND_PALETTE } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { cardHoverVariants } from '@/lib/motion'

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

interface CashFlowForecastRow {
  year: number
  month: number
  projectedIncome: number
  variableOutflow: number
  subscriptionOutflow: number
  savingsOutflow: number
  projectedOutflow: number
  projectedBalance: number
  balancePercent: number
  tier: 'success' | 'warning' | 'destructive'
}

interface RecurringMerchantPattern {
  key: string
  merchant: string
  categoryName: string
  count: number
  total: number
  average: number
  firstDate: string
  lastDate: string
}

export function DashboardPage(): JSX.Element {
  const { profile, selectedMonth, rates, loading: appLoading, refreshTrigger } = useAppStore()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [forecast, setForecast] = useState<CashFlowForecastRow[]>([])
  const [loading, setLoading] = useState(true)
  const [weeklyTip, setWeeklyTip] = useState('')
  const [generatingInsight, setGeneratingInsight] = useState(false)
  const [anomalies, setAnomalies] = useState<{ category: string; current: number; avg: number; stddev: number; severity: string }[]>([])
  const [recurringPatterns, setRecurringPatterns] = useState<RecurringMerchantPattern[]>([])
  const [upcomingSubs, setUpcomingSubs] = useState<
    { id: number; name: string; amount: number; frequency: string; next_billing_date?: string }[]
  >([])

  useEffect(() => {
    async function load(): Promise<void> {
      setLoading(true)
      const [data, forecastData] = await Promise.all([
        window.api.dashboard.stats(profile.year, selectedMonth),
        window.api.dashboard.cashFlowForecast(profile.year, selectedMonth)
      ])
      setStats(data as DashboardStats)
      setForecast(forecastData as CashFlowForecastRow[])
      const tip = await window.api.ai.weeklyTip()
      setWeeklyTip(tip)
      setLoading(false)
    }
        if (!appLoading) {
          load()
          window.api.subscriptions.checkBilling().catch(() => {})
          window.api.savings.checkBilling().catch(() => {})
          window.api.income.checkBilling().catch(() => {})
          window.api.ai.detectAnomalies().then(setAnomalies).catch(() => {})
          window.api.transactions.recurringMerchantPatterns(profile.year, selectedMonth).then((patterns) => {
            setRecurringPatterns(patterns as RecurringMerchantPattern[])
          }).catch(() => {})
          window.api.subscriptions.upcoming().then((u) => setUpcomingSubs(u as typeof upcomingSubs)).catch(() => {})
        }
      }, [profile.year, selectedMonth, appLoading, refreshTrigger])

  async function dismissRecurringPattern(key: string): Promise<void> {
    await window.api.transactions.dismissRecurringMerchantPattern(key)
    setRecurringPatterns((current) => current.filter((pattern) => pattern.key !== key))
  }

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

  const pieData = stats.categoryMonth.map((c, i) => ({
    name: c.name,
    value: c.value,
    fill: profile.colorBlindMode ? COLORBLIND_PALETTE[i % COLORBLIND_PALETTE.length] : c.color
  }))
  const barData = stats.monthlyTrend.map((m) => ({
    month: MONTH_NAMES[parseInt(m.month, 10) - 1]?.slice(0, 3) ?? m.month,
    income: m.income,
    expenses: m.expenses,
    savings: m.savings
  }))

  const bestMonth = [...stats.savingsByMonth].sort((a, b) => b.rate - a.rate)[0]
  const worstMonth = [...stats.savingsByMonth].sort((a, b) => a.rate - b.rate)[0]
  const firstForecast = forecast[0]
  const tierClass: Record<CashFlowForecastRow['tier'], string> = {
    success: 'text-success',
    warning: 'text-warning',
    destructive: 'text-destructive'
  }
  const tierBorderClass: Record<CashFlowForecastRow['tier'], string> = {
    success: 'border-success/30 bg-success/5',
    warning: 'border-warning/30 bg-warning/5',
    destructive: 'border-destructive/30 bg-destructive/5'
  }

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
          label={`Savings rate (target ${profile.savingsRateTarget}%)`}
          value={stats.savingsRate}
          format="percent"
          delay={0.15}
          color={stats.savingsRate >= profile.savingsRateTarget ? 'success' : stats.savingsRate >= 0 ? 'warning' : 'destructive'}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Tracking streak" value={stats.streak.current} delay={0.2} format="number" color="info" />
        <StatTile label="Longest streak" value={stats.streak.longest} delay={0.25} format="number" color="info" />
      </div>

      {anomalies.length > 0 && (
        <div className="space-y-2">
          {anomalies.map((a) => (
            <Card key={a.category} className={a.severity === 'high' ? 'border-destructive/50 bg-destructive/5' : 'border-warning/50 bg-warning/5'}>
              <CardContent className="flex items-start gap-4 p-4">
                <AlertTriangle className={`h-5 w-5 shrink-0 mt-0.5 ${a.severity === 'high' ? 'text-destructive' : 'text-warning'}`} />
                <div className="text-sm">
                  <p className="font-medium">{a.category}</p>
                  <p className="text-muted-foreground">
                    {formatMoney(a.current, profile.displayCurrency, rates)} this month vs
                    avg {formatMoney(a.avg, profile.displayCurrency, rates)} —
                    {(a.severity === 'high' ? 'Critical spike' : 'Unusual activity')}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {recurringPatterns.length > 0 && (
        <div className="space-y-2">
          {recurringPatterns.map((pattern) => (
            <Card key={pattern.key} className="border-info/40 bg-info/5">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="flex items-start gap-3 text-sm">
                  <CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-info" />
                  <div>
                    <p className="font-medium">{pattern.merchant}</p>
                    <p className="text-muted-foreground">
                      {pattern.count} times in {pattern.categoryName} since {pattern.firstDate} - avg {formatMoney(pattern.average, profile.displayCurrency, rates)}
                    </p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => dismissRecurringPattern(pattern.key)}>
                  Dismiss
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <motion.div
          className="lg:col-span-2"
          whileHover="hover"
          variants={cardHoverVariants}
        >
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Income, expenses & savings</CardTitle>
            </CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData}>
                  <defs>
                    <linearGradient id="incomeGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--success))" stopOpacity={0.8} />
                      <stop offset="100%" stopColor="hsl(var(--success))" stopOpacity={0.3} />
                    </linearGradient>
                    <linearGradient id="expensesGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--destructive))" stopOpacity={0.8} />
                      <stop offset="100%" stopColor="hsl(var(--destructive))" stopOpacity={0.3} />
                    </linearGradient>
                    <linearGradient id="savingsGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--info))" stopOpacity={0.8} />
                      <stop offset="100%" stopColor="hsl(var(--info))" stopOpacity={0.3} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(v: number) => formatMoney(v, profile.displayCurrency, rates)} />
                  <Tooltip
                    formatter={(v: number) => formatMoney(v, profile.displayCurrency, rates)}
                    contentStyle={{
                      background: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px'
                    }}
                  />
                  <Legend />
                  <Bar
                    dataKey="income"
                    fill="url(#incomeGradient)"
                    radius={[4, 4, 0, 0]}
                    animationDuration={800}
                    animationBegin={0}
                  />
                  <Bar
                    dataKey="expenses"
                    fill="url(#expensesGradient)"
                    radius={[4, 4, 0, 0]}
                    animationDuration={800}
                    animationBegin={100}
                  />
                  <Bar
                    dataKey="savings"
                    fill="url(#savingsGradient)"
                    radius={[4, 4, 0, 0]}
                    animationDuration={800}
                    animationBegin={200}
                  />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          whileHover="hover"
          variants={cardHoverVariants}
        >
          <Card className="glass-card">
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
        </motion.div>
      </div>

      {forecast.length > 0 && (
        <Card className={firstForecast ? tierBorderClass[firstForecast.tier] : 'bg-card'}>
          <CardHeader>
            <CardTitle>Cash-flow forecast</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {firstForecast && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-muted-foreground">
                    Next month projected balance
                  </p>
                  <p className={`text-2xl font-bold ${tierClass[firstForecast.tier]}`}>
                    {formatMoney(firstForecast.projectedBalance, profile.displayCurrency, rates)}
                  </p>
                </div>
                <div className={`text-right text-sm font-medium ${tierClass[firstForecast.tier]}`}>
                  {firstForecast.balancePercent}% of income
                </div>
              </div>
            )}
            <div className="grid gap-2 md:grid-cols-3">
              {forecast.map((row) => (
                <div key={`${row.year}-${row.month}`} className="rounded-lg border bg-card/60 p-3 text-sm">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-medium">{MONTH_NAMES[row.month - 1]?.slice(0, 3)} {row.year}</span>
                    <span className={tierClass[row.tier]}>{row.balancePercent}%</span>
                  </div>
                  <p className="text-muted-foreground">
                    Income {formatMoney(row.projectedIncome, profile.displayCurrency, rates)}
                  </p>
                  <p className="text-muted-foreground">
                    Outflow {formatMoney(row.projectedOutflow, profile.displayCurrency, rates)}
                  </p>
                  <p className={`mt-1 font-semibold ${tierClass[row.tier]}`}>
                    {formatMoney(row.projectedBalance, profile.displayCurrency, rates)}
                  </p>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Uses recurring income, subscriptions, savings sources, planned budgets, and recent variable spending.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <motion.div
          whileHover="hover"
          variants={cardHoverVariants}
        >
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Savings rate trend</CardTitle>
            </CardHeader>
            <CardContent className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={stats.savingsByMonth.map((s) => ({
                  month: MONTH_NAMES[parseInt(s.month, 10) - 1]?.slice(0, 3),
                  rate: s.rate
                }))}>
                  <defs>
                    <linearGradient id="savingsRateGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="month"
                    fontSize={12}
                    stroke="hsl(var(--muted-foreground))"
                  />
                  <YAxis
                    fontSize={12}
                    stroke="hsl(var(--muted-foreground))"
                    tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                  />
                  <Tooltip
                    formatter={(v: number) => `${v.toFixed(1)}%`}
                    contentStyle={{
                      background: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px'
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="rate"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    fill="url(#savingsRateGradient)"
                    animationDuration={1000}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          whileHover="hover"
          variants={cardHoverVariants}
        >
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Spending by category</CardTitle>
            </CardHeader>
            <CardContent className="h-56">
              {pieData.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                      animationDuration={800}
                      animationBegin={0}
                    >
                      {pieData.map((e, i) => (
                        <Cell key={i} fill={e.fill} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number) => formatMoney(v, profile.displayCurrency, rates)}
                      contentStyle={{
                        background: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px'
                      }}
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="py-12 text-center text-sm text-muted-foreground">No spending data yet</p>
              )}
            </CardContent>
          </Card>
        </motion.div>
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

      {upcomingSubs.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <CreditCard className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Upcoming payments</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {upcomingSubs.map((sub) => {
              const daysUntil = sub.next_billing_date
                ? Math.ceil((new Date(sub.next_billing_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                : null
              return (
                <div key={sub.id} className="flex items-center justify-between text-sm">
                  <span className="font-medium">{sub.name}</span>
                  <span className="tabular-nums">
                    {formatMoney(sub.amount, profile.displayCurrency, rates)}
                    {daysUntil !== null && (
                      <span className={`ml-2 text-xs ${daysUntil <= 3 ? 'text-destructive' : 'text-muted-foreground'}`}>
                        {daysUntil <= 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : `${daysUntil}d`}
                      </span>
                    )}
                  </span>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

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
