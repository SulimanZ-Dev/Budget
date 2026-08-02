import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, HelpCircle, Plus, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { ProgressRing } from '@/components/shared/progress-ring'
import { AskAiButton } from '@/components/shared/ask-ai-button'
import { CategoryModal } from '@/components/budget/category-modal'
import { CategoryDrawerContent } from '@/components/budget/category-drawer'
import { formatMoney, MONTH_NAMES, cn } from '@/lib/utils'
import { frequencyToMonthly, monthlySubscriptionCost, netFromGross, type IncomeSourceRow } from '@/lib/finance'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/empty-state'
import { cardHoverVariants } from '@/lib/motion'
import { CategorySparkline } from '@/components/budget/category-sparkline'
import { BudgetPlanningTools } from '@/components/budget/budget-planning-tools'

interface BudgetRow {
  category_id: number
  name: string
  icon: string
  color: string
  is_fixed: number
  amount: number
  base_amount?: number
  rollover?: number
  rollover_enabled?: number
  spent?: number
}

interface CategoryVariance {
  currentTotal: number
  previousTotal: number
  delta: number
  changePercent: number
  direction: 'up' | 'down' | 'flat'
  explanation: string
  drivers: string[]
}

interface CategoryBaseline {
  lower: number
  upper: number
  average: number
  status: 'below' | 'normal' | 'above'
  markerPercent: number
  lowerPercent: number
  upperPercent: number
}

function roundedCurrency(value: number): number {
  return Math.round(value * 100) / 100
}

function categoryBaseline(trend: { month: number; spent: number }[] | undefined, currentSpent: number): CategoryBaseline | null {
  if (!trend || trend.length < 4) return null
  const history = trend.slice(0, -1).map((point) => point.spent)
  if (history.length < 3 || history.every((value) => value === 0)) return null

  const average = history.reduce((sum, value) => sum + value, 0) / history.length
  const lower = Math.max(0, average * 0.65)
  const upper = Math.max(average * 1.35, 1)
  const maxScale = Math.max(upper, currentSpent, 1)
  const status = currentSpent > upper ? 'above' : currentSpent < lower ? 'below' : 'normal'

  return {
    lower: roundedCurrency(lower),
    upper: roundedCurrency(upper),
    average: roundedCurrency(average),
    status,
    markerPercent: Math.min(99, Math.max(1, (currentSpent / maxScale) * 100)),
    lowerPercent: Math.min(100, (lower / maxScale) * 100),
    upperPercent: Math.min(100, (upper / maxScale) * 100)
  }
}

const baselineLabelClass: Record<CategoryBaseline['status'], string> = {
  below: 'text-info',
  normal: 'text-success',
  above: 'text-warning'
}

const baselineLabel: Record<CategoryBaseline['status'], string> = {
  below: 'Below usual',
  normal: 'In usual range',
  above: 'Above usual'
}

export function BudgetPage(): JSX.Element {
  const {
    profile,
    selectedMonth,
    setSelectedMonth,
    rates,
    inflationAdjust,
    setInflationAdjust,
    openDrawer,
    refreshTrigger
  } = useAppStore()
  const [entries, setEntries] = useState<BudgetRow[]>([])
  const [spending, setSpending] = useState<Record<number, number>>({})
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [monthlyIncome, setMonthlyIncome] = useState(0)
  const [subscriptionMonthly, setSubscriptionMonthly] = useState(0)
  const [savingsAndTransfersOutflow, setSavingsAndTransfersOutflow] = useState(0)
  const [trends, setTrends] = useState<Record<number, { month: number; spent: number }[]>>({})
  const [variances, setVariances] = useState<Record<number, CategoryVariance>>({})
  const [expandedVariance, setExpandedVariance] = useState<Set<number>>(new Set())

  useEffect(() => {
    load()
  }, [profile.year, selectedMonth, refreshTrigger])

  async function load(): Promise<void> {
    setLoading(true)
    try {
      const [budget, txs, incomeEntries, incomeSources, subscriptions] = await Promise.all([
        window.api.budget.getMonth(profile.year, selectedMonth),
        window.api.transactions.list({ year: profile.year, month: selectedMonth }),
        window.api.income.entries(profile.year),
        window.api.income.sources(),
        window.api.subscriptions.list()
      ])
      const loadedEntries = (budget as BudgetRow[]) ?? []
      setEntries(loadedEntries)
      const map: Record<number, number> = Object.fromEntries(loadedEntries.map((entry) => [entry.category_id, Number(entry.spent) || 0]))
      for (const t of (txs as { category_id: number; amount: number; type: string }[]) ?? []) {
        if (t.type === 'savings' && t.category_id) {
          map[t.category_id] = (map[t.category_id] || 0) + t.amount
        }
      }
      setSpending(map)
      const outflow = ((txs as { amount: number; type: string }[]) ?? []).reduce((sum, t) => {
        if (t.type === 'transfer') return sum + t.amount
        return sum
      }, 0)
      setSavingsAndTransfersOutflow(outflow)
      
      // Budget always uses net take-home, adjusted to monthly baseline.
      const sources = (incomeSources as IncomeSourceRow[]) ?? []
      const monthEntries = (incomeEntries as { source_id: number; month: number; amount: number }[]) ?? []
      const monthIncome = sources.reduce((sum, src) => {
        const entry = monthEntries.find((e) => e.source_id === src.id && e.month === selectedMonth)
        const rawAmount =
          entry?.amount ??
          (src.is_recurring === 1 ? src.amount : 0)
        const normalized = frequencyToMonthly(rawAmount, src.frequency ?? 'monthly')
        if ((src.gross_or_net ?? (src.is_gross ? 'gross' : 'net')) === 'gross') {
          return sum + netFromGross(normalized, profile.taxWithheldPercent)
        }
        return sum + normalized
      }, 0)
      setMonthlyIncome(monthIncome)
      const monthlySubs = ((subscriptions as { amount: number; frequency: string; transaction_id?: number | null }[]) ?? []).reduce(
        (sum, sub) => sub.transaction_id ? sum : sum + monthlySubscriptionCost(sub.amount, sub.frequency),
        0
      )
      setSubscriptionMonthly(monthlySubs)

      // Load one extra month so the current month can be compared against a prior-month baseline.
      const loadedVisible = profile.autoHideZeroCategories
        ? loadedEntries.filter((e) => e.amount > 0 || (map[e.category_id] || 0) > 0)
        : loadedEntries
      const trendRequests = loadedVisible.map(cat =>
        window.api.transactions.categoryTrend(cat.category_id, profile.year, selectedMonth, 7)
      )
      const varianceRequests = loadedVisible.map(cat =>
        window.api.transactions.categoryVariance(cat.category_id, profile.year, selectedMonth)
      )
      const [trendResults, varianceResults] = await Promise.all([
        Promise.all(trendRequests),
        Promise.all(varianceRequests)
      ])
      const trendMap: Record<number, { month: number; spent: number }[]> = {}
      const varianceMap: Record<number, CategoryVariance> = {}
      loadedVisible.forEach((cat, idx) => {
        trendMap[cat.category_id] = trendResults[idx] ?? []
        varianceMap[cat.category_id] = varianceResults[idx] as CategoryVariance
      })
      setTrends(trendMap)
      setVariances(varianceMap)
    } catch (error) {
      console.error('Failed to load budget page:', error)
    }
    setLoading(false)
  }

  const cpi = inflationAdjust ? 1 + profile.cpiPercent / 100 : 1
  const visible = profile.autoHideZeroCategories
    ? entries.filter((e) => e.amount > 0 || (spending[e.category_id] || 0) > 0)
    : entries
  const totalSpent = visible.reduce((s, e) => s + (spending[e.category_id] || 0), 0)
  const allOutflows = Object.values(spending).reduce((sum, value) => sum + value, 0)
  const remainingBalance = monthlyIncome - allOutflows - subscriptionMonthly - savingsAndTransfersOutflow

  function openCategoryDetail(cat: BudgetRow): void {
    const spent = spending[cat.category_id] || 0
    openDrawer(
      <CategoryDrawerContent
        categoryId={cat.category_id}
        categoryName={cat.name}
        color={cat.color}
        budgetAmount={cat.amount}
        spent={spent}
        cpi={cpi}
        onRefresh={load}
      />
    )
  }

  function toggleVariance(categoryId: number): void {
    setExpandedVariance((current) => {
      const next = new Set(current)
      if (next.has(categoryId)) next.delete(categoryId)
      else next.add(categoryId)
      return next
    })
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Budget</h1>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch checked={inflationAdjust} onCheckedChange={setInflationAdjust} id="cpi" />
            <Label htmlFor="cpi">Inflation adjust ({profile.cpiPercent}%)</Label>
          </div>
          <AskAiButton context="budget" />
        </div>
      </div>

      <div className="flex items-center justify-between rounded-xl border bg-card p-4">
        <Button variant="ghost" size="icon" aria-label="Previous month" onClick={() => setSelectedMonth(Math.max(1, selectedMonth - 1))}>
          <ChevronLeft />
        </Button>
        <span className="text-lg font-semibold">
          {MONTH_NAMES[selectedMonth - 1]} {profile.year}
        </span>
        <Button variant="ghost" size="icon" aria-label="Next month" onClick={() => setSelectedMonth(Math.min(12, selectedMonth + 1))}>
          <ChevronRight />
        </Button>
      </div>

      <Card>
        <CardContent className="flex items-center justify-between p-4">
          <div>
            <p className="text-sm text-muted-foreground">Monthly balance</p>
            <p className="text-xl font-bold">
              {formatMoney(remainingBalance, profile.displayCurrency, rates)}
            </p>
            <p className="text-xs text-muted-foreground">
              Income: {formatMoney(monthlyIncome, profile.displayCurrency, rates)} - Spent: {formatMoney(totalSpent, profile.displayCurrency, rates)} - Transfers: {formatMoney(savingsAndTransfersOutflow, profile.displayCurrency, rates)} - Subs: {formatMoney(subscriptionMonthly, profile.displayCurrency, rates)}
            </p>
          </div>
          <div
            className={`text-2xl font-bold ${remainingBalance >= 0 ? 'text-success' : 'text-destructive'}`}
          >
            {monthlyIncome > 0 ? ((remainingBalance / monthlyIncome) * 100).toFixed(0) : 0}%
          </div>
        </CardContent>
      </Card>

      <BudgetPlanningTools onRefresh={load} />

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No budget categories"
          description="Add your first category to start tracking spending against a plan."
          actionLabel="Add category"
          onAction={() => setModalOpen(true)}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {visible.map((cat, i) => {
            const spent = spending[cat.category_id] || 0
            const budget = cat.amount * cpi
            const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0
            const over = budget > 0 && spent > budget
            const baseline = categoryBaseline(trends[cat.category_id], spent)
            
            return (
              <motion.div
                key={cat.category_id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                whileHover="hover"
                whileTap="tap"
                variants={cardHoverVariants}
                transition={{ delay: i * 0.05 }}
                onClick={() => openCategoryDetail(cat)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    openCategoryDetail(cat)
                  }
                }}
                role="button"
                tabIndex={0}
                className={cn(
                  'cursor-pointer rounded-xl border p-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  over ? 'glass-card border-destructive/30 bg-destructive/5' : 'bg-card'
                )}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <span
                      className="inline-block rounded-full px-2 py-0.5 text-xs"
                      style={{ backgroundColor: `${cat.color}22`, color: cat.color }}
                    >
                      {cat.is_fixed ? 'Fixed' : 'Variable'}
                    </span>
                    <h3 className="mt-2 font-semibold">{cat.name}</h3>
                  </div>
                  <ProgressRing progress={pct} color={over ? 'hsl(var(--destructive))' : cat.color} />
                </div>
                <p className={cn('mt-3 text-2xl font-bold', over && 'text-destructive')}>
                  {formatMoney(spent, profile.displayCurrency, rates)}
                </p>
                <p className="text-sm text-muted-foreground">
                  of {formatMoney(budget, profile.displayCurrency, rates)}
                </p>
                <div className="mt-2 flex items-center gap-1 text-xs">
                  {over ? (
                    <>
                      <TrendingUp className="h-3 w-3 text-destructive" />
                      <span className="font-medium text-destructive">
                        {formatMoney(spent - budget, profile.displayCurrency, rates)} over budget
                      </span>
                    </>
                  ) : (
                    <>
                      <TrendingDown className="h-3 w-3 text-success" />
                      <span className="text-success">
                        {formatMoney(budget - spent, profile.displayCurrency, rates)} left
                      </span>
                    </>
                  )}
                </div>
                {trends[cat.category_id]?.length ? (
                  <div className="mt-3">
                    <CategorySparkline
                      data={trends[cat.category_id] ?? []}
                      currency={profile.displayCurrency}
                      rates={rates}
                    />
                  </div>
                ) : null}
                {baseline && (
                  <div className="mt-3 rounded-md border bg-muted/20 p-3">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className={`font-medium ${baselineLabelClass[baseline.status]}`}>
                        {baselineLabel[baseline.status]}
                      </span>
                      <span className="text-muted-foreground">
                        Normal {formatMoney(baseline.lower, profile.displayCurrency, rates)} - {formatMoney(baseline.upper, profile.displayCurrency, rates)}
                      </span>
                    </div>
                    <div className="relative mt-2 h-2 rounded-full bg-muted">
                      <div
                        className="absolute top-0 h-2 rounded-full bg-primary/30"
                        style={{
                          left: `${baseline.lowerPercent}%`,
                          width: `${Math.max(2, baseline.upperPercent - baseline.lowerPercent)}%`
                        }}
                      />
                      <div
                        className="absolute top-1/2 h-4 w-1 -translate-y-1/2 rounded-full bg-foreground"
                        style={{ left: `${baseline.markerPercent}%` }}
                      />
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Trailing average: {formatMoney(baseline.average, profile.displayCurrency, rates)}
                    </p>
                  </div>
                )}
                {variances[cat.category_id] && (
                  <div
                    className="mt-3 border-t pt-3"
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs"
                      onClick={() => toggleVariance(cat.category_id)}
                    >
                      <HelpCircle className="h-3 w-3" />
                      Why?
                    </Button>
                    {expandedVariance.has(cat.category_id) && (
                      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                        {variances[cat.category_id].explanation}
                      </p>
                    )}
                  </div>
                )}
              </motion.div>
            )
          })}
        </div>
      )}

      <Button variant="outline" className="gap-2" onClick={() => setModalOpen(true)}>
        <Plus className="h-4 w-4" />
        Add category
      </Button>

      <CategoryModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        onSaved={load}
        year={profile.year}
        month={selectedMonth}
      />
    </div>
  )
}
