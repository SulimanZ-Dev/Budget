import { useEffect, useState } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer
} from 'recharts'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { AskAiButton } from '@/components/shared/ask-ai-button'
import { formatMoney, formatPercent, MONTH_NAMES } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
import { Skeleton } from '@/components/ui/skeleton'
import { Trash2, Pencil } from 'lucide-react'

interface CategoryDrawerProps {
  categoryId: number
  categoryName: string
  color: string
  budgetAmount: number
  spent: number
  cpi: number
  onRefresh: () => void
}

export function CategoryDrawerContent({
  categoryId,
  categoryName,
  color,
  budgetAmount,
  spent,
  cpi,
  onRefresh
}: CategoryDrawerProps): JSX.Element {
  const { profile, selectedMonth, rates, closeDrawer } = useAppStore()
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<{
    history: { month: number; spent: number }[]
    momChange: number
    ytdAverage: number
    prevYearTotal: number
    transactions: { id: number; description: string; amount: number; date: string }[]
    notes: string
    category?: { id: number; name: string; icon: string; color: string; is_fixed: number }
  } | null>(null)
  const [notes, setNotes] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [editAmount, setEditAmount] = useState('')

  useEffect(() => {
    setLoading(true)
    window.api.budget
      .categoryDetail(categoryId, profile.year, selectedMonth)
      .then((d) => {
        setDetail(d as typeof detail)
        setNotes((d as { notes: string }).notes ?? '')
        setLoading(false)
      })
  }, [categoryId, profile.year, selectedMonth])

  async function saveNotes(): Promise<void> {
    await window.api.budget.setEntry({
      categoryId,
      year: profile.year,
      month: selectedMonth,
      amount: budgetAmount,
      notes
    })
  }

  async function deleteCategory(): Promise<void> {
    if (!confirm(`Delete category "${categoryName}"? This will also remove all budget entries for this category.`)) return
    await window.api.categories.delete(categoryId)
    closeDrawer()
    onRefresh()
  }

  async function saveBudgetAmount(): Promise<void> {
    await window.api.budget.setEntry({
      categoryId,
      year: profile.year,
      month: selectedMonth,
      amount: parseFloat(editAmount) || 0,
      notes
    })
    setIsEditing(false)
    onRefresh()
  }

  if (loading || !detail) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32" />
        <Skeleton className="h-24" />
      </div>
    )
  }

  const budget = budgetAmount * cpi
  const category = detail?.category
  const remaining = budget - spent
  const chartData = detail.history.map((h) => ({
    month: MONTH_NAMES[h.month - 1]?.slice(0, 3) ?? String(h.month),
    spent: h.spent
  }))

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold" style={{ color }}>
          {categoryName}
        </h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => {
            setIsEditing(true)
            setEditAmount(String(budgetAmount))
          }}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={deleteCategory} className="text-destructive hover:text-destructive">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-muted-foreground">Budgeted</p>
          {isEditing ? (
            <Input
              type="number"
              value={editAmount}
              onChange={(e) => setEditAmount(e.target.value)}
              onBlur={saveBudgetAmount}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveBudgetAmount()
                if (e.key === 'Escape') setIsEditing(false)
              }}
              className="h-8"
              autoFocus
            />
          ) : (
            <p className="font-semibold">{formatMoney(budget, profile.displayCurrency, rates)}</p>
          )}
        </div>
        <div>
          <p className="text-muted-foreground">Spent</p>
          <p className="font-semibold">{formatMoney(spent, profile.displayCurrency, rates)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Remaining</p>
          <p className={remaining >= 0 ? 'font-semibold text-success' : 'font-semibold text-destructive'}>
            {formatMoney(remaining, profile.displayCurrency, rates)}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">MoM change</p>
          <p className={detail.momChange >= 0 ? 'text-destructive font-semibold' : 'text-success font-semibold'}>
            {formatPercent(detail.momChange)}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">YTD average</p>
          <p className="font-semibold">{formatMoney(detail.ytdAverage, profile.displayCurrency, rates)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Last year total</p>
          <p className="font-semibold">{formatMoney(detail.prevYearTotal, profile.displayCurrency, rates)}</p>
        </div>
      </div>

      <div className="h-44">
        <p className="mb-2 text-sm font-medium">Monthly history</p>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData}>
            <XAxis dataKey="month" fontSize={11} />
            <YAxis fontSize={11} />
            <Tooltip formatter={(v: number) => formatMoney(v, profile.displayCurrency, rates)} />
            <Bar dataKey="spent" fill={color} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid gap-2">
        <Label>Notes</Label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={saveNotes} />
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">Transactions this month</p>
        {detail.transactions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No transactions in this category.</p>
        ) : (
          <ul className="space-y-2">
            {detail.transactions.map((t) => (
              <li key={t.id} className="flex justify-between rounded-lg border px-3 py-2 text-sm">
                <span className="truncate">{t.description}</span>
                <span className="font-medium tabular-nums">
                  {formatMoney(t.amount, profile.displayCurrency, rates)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AskAiButton
        context={`budget category ${categoryName}`}
        prefill={`How am I doing on ${categoryName} this month?`}
      />
    </div>
  )
}
