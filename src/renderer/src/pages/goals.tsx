import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Target, Plus, MoreHorizontal, Trash2, Pencil } from 'lucide-react'
import { InfoTooltip } from '@/components/shared/info-tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { ProgressRing } from '@/components/shared/progress-ring'
import { EmptyState } from '@/components/shared/empty-state'
import { AskAiButton } from '@/components/shared/ask-ai-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatMoney, formatDate } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
import { addMonths } from 'date-fns'
import { useAppDialog } from '@/components/shared/app-dialog'

interface Goal {
  id: number
  name: string
  type: string
  target_amount: number
  current_amount: number
  target_date?: string
  interest_rate?: number
  monthly_payment?: number
  notes?: string
}

interface GoalFeasibility {
  status: string
  detail: string
  requiredMonthly: number
  pacePercent: number
  color: 'success' | 'warning' | 'destructive' | 'info'
}

interface CashFlowForecastRow {
  projectedBalance: number
}

function statusLabel(progress: number): { text: string; color: string } {
  if (progress >= 0.9) return { text: 'Almost there!', color: 'text-success' }
  if (progress >= 0.5) return { text: 'On track', color: 'text-info' }
  return { text: 'Needs attention', color: 'text-warning' }
}

export function GoalsPage(): JSX.Element {
  const { profile, selectedMonth, rates } = useAppStore()
  const dialog = useAppDialog()
  const [goals, setGoals] = useState<Goal[]>([])
  const [monthlySurplus, setMonthlySurplus] = useState(0)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null)
  const [form, setForm] = useState({
    name: '',
    type: 'savings',
    targetAmount: '',
    currentAmount: '',
    targetDate: '',
    interestRate: '',
    monthlyPayment: '',
    notes: ''
  })

  useEffect(() => {
    async function load(): Promise<void> {
      await window.api.goals.autoCreateFromCategories()
      const [goalRows, forecastRows] = await Promise.all([
        window.api.goals.list(),
        window.api.dashboard.cashFlowForecast(profile.year, selectedMonth)
      ])
      setGoals(goalRows)
      const forecast = (forecastRows as CashFlowForecastRow[])[0]
      setMonthlySurplus(Math.max(0, forecast?.projectedBalance ?? 0))
    }
    load()
  }, [profile.year, selectedMonth])

  async function removeGoal(id: number): Promise<void> {
    if (!await dialog.confirm('Delete this goal?', {
      title: 'Delete goal',
      confirmLabel: 'Delete',
      destructive: true
    })) return
    await window.api.goals.delete(id)
    setGoals(await window.api.goals.list())
  }

  function openEditModal(goal: Goal): void {
    setEditingGoal(goal)
    setForm({
      name: goal.name,
      type: goal.type,
      targetAmount: String(goal.target_amount),
      currentAmount: String(goal.current_amount),
      targetDate: goal.target_date ?? '',
      interestRate: goal.interest_rate ? String(goal.interest_rate) : '',
      monthlyPayment: goal.monthly_payment ? String(goal.monthly_payment) : '',
      notes: goal.notes || ''
    })
    setModalOpen(true)
  }

  async function save(): Promise<void> {
    const goalData = {
      name: form.name,
      type: form.type,
      targetAmount: parseFloat(form.targetAmount),
      currentAmount: parseFloat(form.currentAmount) || 0,
      targetDate: form.targetDate || undefined,
      interestRate: form.interestRate ? parseFloat(form.interestRate) : undefined,
      monthlyPayment: form.monthlyPayment ? parseFloat(form.monthlyPayment) : undefined,
      notes: form.notes || undefined
    }
    if (editingGoal) {
      await window.api.goals.update(editingGoal.id, goalData)
    } else {
      await window.api.goals.create(goalData)
    }
    setModalOpen(false)
    setEditingGoal(null)
    setForm({
      name: '',
      type: 'savings',
      targetAmount: '',
      currentAmount: '',
      targetDate: '',
      interestRate: '',
      monthlyPayment: '',
      notes: ''
    })
    setGoals(await window.api.goals.list())
  }

  function closeModal(): void {
    setModalOpen(false)
    setEditingGoal(null)
    setForm({
      name: '',
      type: 'savings',
      targetAmount: '',
      currentAmount: '',
      targetDate: '',
      interestRate: '',
      monthlyPayment: '',
      notes: ''
    })
  }

  function debtPayoffMonths(g: Goal): number | null {
    if (g.type !== 'debt' || !g.monthly_payment || g.monthly_payment <= 0) return null
    const remaining = g.target_amount - g.current_amount
    if (remaining <= 0) return 0
    const rate = (g.interest_rate ?? 0) / 100 / 12
    if (rate === 0) return Math.ceil(remaining / g.monthly_payment)
    let balance = remaining
    let months = 0
    while (balance > 0 && months < 600) {
      balance = balance * (1 + rate) - g.monthly_payment!
      months++
    }
    return months
  }

  function monthsUntil(targetDate?: string): number | null {
    if (!targetDate) return null
    const target = new Date(`${targetDate}T00:00:00`)
    if (Number.isNaN(target.getTime())) return null
    const now = new Date()
    const months = (target.getFullYear() - now.getFullYear()) * 12 + target.getMonth() - now.getMonth()
    return Math.max(1, months + (target.getDate() >= now.getDate() ? 1 : 0))
  }

  function feasibility(g: Goal): GoalFeasibility {
    const remaining = Math.max(0, g.target_amount - g.current_amount)
    if (remaining <= 0) {
      return {
        status: 'Ahead of schedule',
        detail: 'Goal is already funded.',
        requiredMonthly: 0,
        pacePercent: 100,
        color: 'success'
      }
    }
    const months = monthsUntil(g.target_date)
    if (!months) {
      return {
        status: 'Set a deadline',
        detail: 'Add a target date to check feasibility.',
        requiredMonthly: 0,
        pacePercent: 0,
        color: 'info'
      }
    }
    const requiredMonthly = Math.ceil(remaining / months)
    const pacePercent = requiredMonthly > 0 ? Math.min(100, (monthlySurplus / requiredMonthly) * 100) : 100
    if (monthlySurplus >= requiredMonthly * 1.2) {
      return {
        status: 'Ahead of schedule',
        detail: `${formatMoney(requiredMonthly, profile.displayCurrency, rates)}/month needed; current surplus can cover it.`,
        requiredMonthly,
        pacePercent,
        color: 'success'
      }
    }
    if (monthlySurplus >= requiredMonthly) {
      return {
        status: 'On track',
        detail: `${formatMoney(requiredMonthly, profile.displayCurrency, rates)}/month needed; current surplus covers it.`,
        requiredMonthly,
        pacePercent,
        color: 'success'
      }
    }
    const gap = requiredMonthly - monthlySurplus
    return {
      status: `Behind - need ${formatMoney(gap, profile.displayCurrency, rates)}/month more`,
      detail: `${formatMoney(requiredMonthly, profile.displayCurrency, rates)}/month needed by ${formatDate(new Date(`${g.target_date}T00:00:00`), profile.locale)}.`,
      requiredMonthly,
      pacePercent,
      color: 'warning'
    }
  }

  const feasibilityTextClass: Record<GoalFeasibility['color'], string> = {
    success: 'text-success',
    warning: 'text-warning',
    destructive: 'text-destructive',
    info: 'text-info'
  }
  const feasibilityBarClass: Record<GoalFeasibility['color'], string> = {
    success: 'bg-success',
    warning: 'bg-warning',
    destructive: 'bg-destructive',
    info: 'bg-info'
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          Goals
          <InfoTooltip content="FIRE: Financial Independence, Retire Early — set a target of 25× your annual expenses. Emergency fund targets 3× monthly expenses. Debt goals include interest payoff projection." />
        </h1>
        <div className="flex gap-2">
          <AskAiButton context="goals" prefill="Am I on track to hit my savings goals?" />
          <Button onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4" />
            Add goal
          </Button>
        </div>
      </div>

      {goals.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No goals yet"
          description="Set a savings goal, emergency fund target, or FIRE number to stay motivated."
          actionLabel="Add your first goal"
          onAction={() => setModalOpen(true)}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {goals.map((g, i) => {
            const progress = g.target_amount > 0 ? (g.current_amount / g.target_amount) * 100 : 0
            const status = statusLabel(progress / 100)
            const remaining = g.target_amount - g.current_amount
            const monthsLeft =
              g.monthly_payment && g.monthly_payment > 0
                ? Math.ceil(remaining / g.monthly_payment)
                : null
            const projected =
              monthsLeft != null ? formatDate(addMonths(new Date(), monthsLeft), profile.locale) : null
            const plan = feasibility(g)

            return (
              <motion.div
                key={g.id}
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.05 }}
              >
                <Card className="overflow-hidden">
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <span className="text-xs uppercase tracking-wide text-muted-foreground">
                          {g.type.replace('_', ' ')}
                        </span>
                        <h3 className="mt-1 text-lg font-bold">{g.name}</h3>
                        {g.notes && (
                          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{g.notes}</p>
                        )}
                        <p className={`mt-1 text-sm font-medium ${status.color}`}>{status.text}</p>
                      </div>
                      <div className="flex items-start gap-1">
                        <ProgressRing progress={progress} size={72} />
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Goal actions">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEditModal(g)}>
                              <Pencil className="h-4 w-4 mr-2" />
                              Edit goal
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => removeGoal(g.id)} className="text-destructive">
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete goal
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <p className="text-muted-foreground">Current</p>
                        <p className="font-semibold">
                          {formatMoney(g.current_amount, profile.displayCurrency, rates)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Target</p>
                        <p className="font-semibold">
                          {formatMoney(g.target_amount, profile.displayCurrency, rates)}
                        </p>
                      </div>
                    </div>
                    {projected && (
                      <p className="mt-3 text-xs text-muted-foreground">Projected: {projected}</p>
                    )}
                    <div className="mt-3 rounded-lg border bg-muted/30 p-3">
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className={`font-medium ${feasibilityTextClass[plan.color]}`}>{plan.status}</span>
                        {plan.requiredMonthly > 0 && (
                          <span className="text-muted-foreground">
                            {formatMoney(plan.requiredMonthly, profile.displayCurrency, rates)}/mo
                          </span>
                        )}
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full ${feasibilityBarClass[plan.color]}`}
                          style={{ width: `${plan.pacePercent}%` }}
                        />
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">{plan.detail}</p>
                    </div>
                    {g.type === 'debt' && debtPayoffMonths(g) != null && (
                      <p className="mt-2 text-xs text-info">
                        Payoff in ~{debtPayoffMonths(g)} months at current payment rate
                      </p>
                    )}
                    {g.type === 'emergency' && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Target: 3× average monthly expenses • Current: Auto from savings
                      </p>
                    )}
                    {['savings', 'fire'].includes(g.type) && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Current: Auto-calculated from savings transactions
                      </p>
                    )}
                    {g.type === 'fire' && (
                      <p className="mt-2 text-xs text-info">
                        FIRE: 25× annual expenses —{' '}
                        {g.target_amount > 0
                          ? `${Math.ceil(g.target_amount / Math.max(g.current_amount, 1))} years at current pace`
                          : 'set expenses'}
                      </p>
                    )}
                    <div className="mt-3">
                      <AskAiButton
                        context={`goal ${g.name}`}
                        prefill={`How can I reach my ${g.name} goal faster?`}
                        variant="ghost"
                      />
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )
          })}
        </div>
      )}

      <Dialog open={modalOpen} onOpenChange={closeModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingGoal ? 'Edit goal' : 'New goal'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="savings">Savings</SelectItem>
                  <SelectItem value="debt">Debt payoff</SelectItem>
                  <SelectItem value="emergency">Emergency fund</SelectItem>
                  <SelectItem value="fire">FIRE number</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Target (SEK)</Label>
                <Input
                  type="number"
                  value={form.targetAmount}
                  onChange={(e) => setForm({ ...form, targetAmount: e.target.value })}
                />
              </div>
              {['savings', 'emergency', 'fire'].includes(form.type) ? (
                <div className="grid gap-2">
                  <Label>Current (SEK)</Label>
                  <div className="flex h-10 items-center rounded-md border bg-muted px-3 text-sm" tabIndex={-1}>
                    Auto-calculated from savings transactions
                  </div>
                </div>
              ) : (
                <div className="grid gap-2">
                  <Label>Current (SEK)</Label>
                  <Input
                    type="number"
                    value={form.currentAmount}
                    onChange={(e) => setForm({ ...form, currentAmount: e.target.value })}
                  />
                </div>
              )}
            </div>
            <div className="grid gap-2">
              <Label>Target date</Label>
              <Input
                type="date"
                value={form.targetDate}
                onChange={(e) => setForm({ ...form, targetDate: e.target.value })}
              />
            </div>
            {form.type === 'emergency' && (
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  const target = await window.api.goals.emergencyTarget()
                  setForm({ ...form, targetAmount: String(target) })
                }}
              >
                Auto-calculate (3× avg monthly expenses)
              </Button>
            )}
            {form.type === 'debt' && (
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Interest rate %</Label>
                  <Input
                    type="number"
                    value={form.interestRate}
                    onChange={(e) => setForm({ ...form, interestRate: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Monthly payment</Label>
                  <Input
                    type="number"
                    value={form.monthlyPayment}
                    onChange={(e) => setForm({ ...form, monthlyPayment: e.target.value })}
                  />
                </div>
              </div>
            )}
            <div className="grid gap-2">
              <Label>Notes (optional)</Label>
              <Input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Why this goal? Any notes..."
              />
            </div>
            <Button onClick={save}>{editingGoal ? 'Save changes' : 'Create goal'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
