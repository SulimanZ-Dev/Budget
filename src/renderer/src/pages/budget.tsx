import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, Plus, TrendingDown, TrendingUp } from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { ProgressRing } from '@/components/shared/progress-ring'
import { AskAiButton } from '@/components/shared/ask-ai-button'
import { CategoryModal } from '@/components/budget/category-modal'
import { CategoryDrawerContent } from '@/components/budget/category-drawer'
import { formatMoney, MONTH_NAMES } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/empty-state'
import { Wallet } from 'lucide-react'

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

  useEffect(() => {
    load()
  }, [profile.year, selectedMonth])

  async function load(): Promise<void> {
    setLoading(true)
    const [budget, txs] = await Promise.all([
      window.api.budget.getMonth(profile.year, selectedMonth),
      window.api.transactions.list({ year: profile.year, month: selectedMonth, type: 'expense' })
    ])
    setEntries(budget as BudgetRow[])
    const map: Record<number, number> = {}
    for (const t of txs as { category_id: number; amount: number }[]) {
      if (t.category_id) map[t.category_id] = (map[t.category_id] || 0) + t.amount
    }
    setSpending(map)
    setLoading(false)
  }

  const cpi = inflationAdjust ? 1 + profile.cpiPercent / 100 : 1
  const visible = profile.autoHideZeroCategories
    ? entries.filter((e) => e.amount > 0 || (spending[e.category_id] || 0) > 0)
    : entries
  const totalBudgeted = visible.reduce((s, e) => s + e.amount * cpi, 0)
  const totalSpent = visible.reduce((s, e) => s + (spending[e.category_id] || 0), 0)

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
            <p className="text-sm text-muted-foreground">Total budget vs spent</p>
            <p className="text-xl font-bold">
              {formatMoney(totalSpent, profile.displayCurrency, rates)} /{' '}
              {formatMoney(totalBudgeted, profile.displayCurrency, rates)}
            </p>
          </div>
          <div
            className={`text-2xl font-bold ${totalSpent <= totalBudgeted ? 'text-success' : 'text-destructive'}`}
          >
            {totalBudgeted > 0 ? ((totalSpent / totalBudgeted) * 100).toFixed(0) : 0}%
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
                transition={{ delay: i * 0.05 }}
                onClick={() => openCategoryDetail(cat)}
                className="rounded-xl border bg-card p-5 text-left transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring"
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
                <p className="mt-3 text-2xl font-bold">{formatMoney(spent, profile.displayCurrency, rates)}</p>
                <p className="text-sm text-muted-foreground">
                  of {formatMoney(budget, profile.displayCurrency, rates)}
                </p>
                <div className="mt-2 flex items-center gap-1 text-xs">
                  {over ? (
                    <TrendingUp className="h-3 w-3 text-destructive" />
                  ) : (
                    <TrendingDown className="h-3 w-3 text-success" />
                  )}
                  <span className={over ? 'text-destructive' : 'text-success'}>
                    {formatMoney(budget - spent, profile.displayCurrency, rates)} left
                  </span>
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
