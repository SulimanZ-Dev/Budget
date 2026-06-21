import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, Plus, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
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

interface BudgetRow {
  category_id: number
  name: string
  icon: string
  color: string
  is_fixed: number
  amount: number
}

export function BudgetPage(): JSX.Element {
  const {
    profile,
    selectedMonth,
    setSelectedMonth,
    rates,
    inflationAdjust,
    setInflationAdjust,
    openDrawer
  } = useAppStore()
  const [entries, setEntries] = useState<BudgetRow[]>([])
  const [spending, setSpending] = useState<Record<number, number>>({})
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [monthlyIncome, setMonthlyIncome] = useState(0)
  const [subscriptionMonthly, setSubscriptionMonthly] = useState(0)
  const [savingsAndTransfersOutflow, setSavingsAndTransfersOutflow] = useState(0)

  useEffect(() => {
    load()
  }, [profile.year, selectedMonth])

  async function load(): Promise<void> {
    setLoading(true)
    const [budget, txs, incomeEntries, incomeSources, subscriptions] = await Promise.all([
      window.api.budget.getMonth(profile.year, selectedMonth),
      window.api.transactions.list({ year: profile.year, month: selectedMonth }),
      window.api.income.entries(profile.year),
      window.api.income.sources(),
      window.api.subscriptions.list()
    ])
    setEntries(budget as BudgetRow[])
    const map: Record<number, number> = {}
    for (const t of txs as { category_id: number; amount: number; type: string }[]) {
      if (t.type === 'expense' && t.category_id) {
        map[t.category_id] = (map[t.category_id] || 0) + t.amount
      }
    }
    setSpending(map)
    const outflow = (txs as { amount: number; type: string }[]).reduce((sum, t) => {
      if (t.type === 'savings' || t.type === 'transfer') return sum + t.amount
      return sum
    }, 0)
    setSavingsAndTransfersOutflow(outflow)
    
    // Budget always uses net take-home, adjusted to monthly baseline.
    const sources = incomeSources as IncomeSourceRow[]
    const monthEntries = incomeEntries as { source_id: number; month: number; amount: number }[]
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
    const monthlySubs = (subscriptions as { amount: number; frequency: string }[]).reduce(
      (sum, sub) => sum + monthlySubscriptionCost(sub.amount, sub.frequency),
      0
    )
    setSubscriptionMonthly(monthlySubs)
    
    setLoading(false)
  }

  const cpi = inflationAdjust ? 1 + profile.cpiPercent / 100 : 1
  const visible = profile.autoHideZeroCategories
    ? entries.filter((e) => e.amount > 0 || (spending[e.category_id] || 0) > 0)
    : entries
  const totalBudgeted = visible.reduce((s, e) => s + e.amount * cpi, 0)
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
        <Button variant="ghost" size="icon" onClick={() => setSelectedMonth(Math.max(1, selectedMonth - 1))}>
          <ChevronLeft />
        </Button>
        <span className="text-lg font-semibold">
          {MONTH_NAMES[selectedMonth - 1]} {profile.year}
        </span>
        <Button variant="ghost" size="icon" onClick={() => setSelectedMonth(Math.min(12, selectedMonth + 1))}>
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
              Income: {formatMoney(monthlyIncome, profile.displayCurrency, rates)} - Spent: {formatMoney(totalSpent, profile.displayCurrency, rates)} - Saved/Transfers: {formatMoney(savingsAndTransfersOutflow, profile.displayCurrency, rates)} - Subs: {formatMoney(subscriptionMonthly, profile.displayCurrency, rates)}
            </p>
          </div>
          <div
            className={`text-2xl font-bold ${remainingBalance >= 0 ? 'text-success' : 'text-destructive'}`}
          >
            {monthlyIncome > 0 ? ((remainingBalance / monthlyIncome) * 100).toFixed(0) : 0}%
          </div>
        </CardContent>
      </Card>

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
            
            return (
              <motion.button
                key={cat.category_id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                whileHover="hover"
                whileTap="tap"
                variants={cardHoverVariants}
                transition={{ delay: i * 0.05 }}
                onClick={() => openCategoryDetail(cat)}
                className={cn(
                  'rounded-xl border p-5 text-left focus-visible:ring-2 focus-visible:ring-ring',
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
              </motion.button>
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
