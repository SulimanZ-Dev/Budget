import { useEffect, useState } from 'react'
import { Calculator, CheckCircle2, Pencil, Plus, Trash2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { useAppDialog } from '@/components/shared/app-dialog'
import { useAppStore } from '@/store/app-store'
import { formatDate, formatMoney } from '@/lib/utils'

interface DebtPayment {
  id: number
  amount: number
  payment_date: string
  note?: string | null
}

interface DebtItem {
  id: number
  name: string
  creditor: string
  originalAmount: number
  paidAmount: number
  previouslyPaid: number
  balance: number
  interestRate: number
  minimum: number
  targetDate?: string | null
  notes?: string | null
  payments: DebtPayment[]
}

interface Plan {
  months: number | null
  totalInterest: number
  payoffDate: string | null
  payoffOrder: Array<{ id: number; name: string; month: number; payoffDate: string }>
}

interface DebtResult {
  debts: DebtItem[]
  totals: { originalAmount: number; paidAmount: number; remainingAmount: number; monthlyMinimum: number }
  snowball: Plan
  avalanche: Plan
}

interface DebtPlannerProps {
  onEditDebt: (id: number) => void
  onDeleteDebt: (id: number) => void
}

function localToday(): string {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

export function DebtPlanner({ onEditDebt, onDeleteDebt }: DebtPlannerProps): JSX.Element | null {
  const { profile, rates, refreshTrigger, triggerRefresh } = useAppStore()
  const appDialog = useAppDialog()
  const [extra, setExtra] = useState('0')
  const [result, setResult] = useState<DebtResult | null>(null)
  const [paymentDebt, setPaymentDebt] = useState<DebtItem | null>(null)
  const [payment, setPayment] = useState({ amount: '', date: localToday(), note: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    const timeout = setTimeout(async () => {
      try {
        const value = await window.api.goals.debtPlanner(Number(extra) || 0) as DebtResult
        if (!cancelled) setResult(value)
      } catch (error) {
        console.error('Failed to load debt payoff plan:', error)
      }
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [extra, refreshTrigger])

  if (!result || result.debts.length === 0) return null

  async function addPayment(): Promise<void> {
    if (!paymentDebt) return
    const amount = Number(payment.amount)
    if (!Number.isFinite(amount) || amount <= 0 || amount > paymentDebt.balance) {
      await appDialog.alert('Enter a payment greater than zero and no more than the remaining debt.', 'Check payment')
      return
    }
    setSaving(true)
    try {
      await window.api.goals.addDebtPayment(paymentDebt.id, { amount, date: payment.date, note: payment.note })
      setPaymentDebt(null)
      setPayment({ amount: '', date: localToday(), note: '' })
      triggerRefresh()
    } catch (error) {
      await appDialog.alert(error instanceof Error ? error.message : 'The debt payment could not be saved.', 'Payment failed')
    } finally {
      setSaving(false)
    }
  }

  async function deletePayment(item: DebtPayment): Promise<void> {
    if (!await appDialog.confirm('Remove this debt payment and add the amount back to the remaining balance?', {
      title: 'Remove payment',
      confirmLabel: 'Remove',
      destructive: true
    })) return
    try {
      await window.api.goals.deleteDebtPayment(item.id)
      triggerRefresh()
    } catch (error) {
      await appDialog.alert(error instanceof Error ? error.message : 'The debt payment could not be removed.', 'Removal failed')
    }
  }

  return (
    <Card>
      <CardHeader className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Calculator className="h-4 w-4" /> Debt payoff
          </CardTitle>
          <div className="grid w-full grid-cols-2 gap-3 text-sm sm:w-auto sm:grid-cols-4">
            <div><p className="text-muted-foreground">Original</p><p className="font-semibold">{formatMoney(result.totals.originalAmount, profile.displayCurrency, rates)}</p></div>
            <div><p className="text-muted-foreground">Paid</p><p className="font-semibold text-success">{formatMoney(result.totals.paidAmount, profile.displayCurrency, rates)}</p></div>
            <div><p className="text-muted-foreground">Remaining</p><p className="font-semibold text-warning">{formatMoney(result.totals.remainingAmount, profile.displayCurrency, rates)}</p></div>
            <div><p className="text-muted-foreground">Monthly minimum</p><p className="font-semibold">{formatMoney(result.totals.monthlyMinimum, profile.displayCurrency, rates)}</p></div>
          </div>
        </div>
        <Progress value={result.totals.originalAmount > 0 ? result.totals.paidAmount / result.totals.originalAmount * 100 : 100} />
      </CardHeader>
      <CardContent className="space-y-5">
        {result.totals.remainingAmount > 0 && (
          <div className="grid gap-3 border-y py-4 md:grid-cols-[220px_1fr_1fr]">
            <div className="grid gap-1">
              <Label htmlFor="extra-debt-payment">Extra monthly payment</Label>
              <Input id="extra-debt-payment" type="number" min="0" value={extra} onChange={(event) => setExtra(event.target.value)} />
            </div>
            {(['avalanche', 'snowball'] as const).map((strategy) => {
              const plan = result[strategy]
              return (
                <div key={strategy} className="border-l pl-4">
                  <p className="font-medium capitalize">{strategy}</p>
                  <p className="text-sm text-muted-foreground">
                    {plan.months == null ? 'Payment is too low to finish.' : `${plan.months} ${plan.months === 1 ? 'month' : 'months'} · ${plan.payoffDate}`}
                  </p>
                  <p className="text-sm">Interest: {formatMoney(plan.totalInterest, profile.displayCurrency, rates)}</p>
                  {plan.payoffOrder.length > 0 && <p className="mt-1 text-xs text-muted-foreground">Order: {plan.payoffOrder.map((item) => item.name).join(' → ')}</p>}
                </div>
              )
            })}
          </div>
        )}

        <div className="space-y-3">
          {result.debts.map((debt) => {
            const progress = debt.originalAmount > 0 ? debt.paidAmount / debt.originalAmount * 100 : 100
            return (
              <section key={debt.id} className="rounded-md border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{debt.creditor}</h3>
                      {debt.balance <= 0 && <CheckCircle2 className="h-4 w-4 text-success" aria-label="Paid off" />}
                    </div>
                    {debt.name !== debt.creditor && <p className="text-sm text-muted-foreground">{debt.name}</p>}
                  </div>
                  <div className="flex gap-1">
                    {debt.balance > 0 && (
                      <Button size="sm" onClick={() => { setPaymentDebt(debt); setPayment({ amount: '', date: localToday(), note: '' }) }}>
                        <Plus className="h-4 w-4" /> Add payment
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" aria-label="Edit debt" title="Edit debt" onClick={() => onEditDebt(debt.id)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" aria-label="Delete debt" title="Delete debt" onClick={() => onDeleteDebt(debt.id)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div><p className="text-muted-foreground">Original debt</p><p className="font-medium">{formatMoney(debt.originalAmount, profile.displayCurrency, rates)}</p></div>
                  <div><p className="text-muted-foreground">Paid so far</p><p className="font-medium text-success">{formatMoney(debt.paidAmount, profile.displayCurrency, rates)}</p></div>
                  <div><p className="text-muted-foreground">Remaining</p><p className="font-medium text-warning">{formatMoney(debt.balance, profile.displayCurrency, rates)}</p></div>
                  <div><p className="text-muted-foreground">Terms</p><p className="font-medium">{debt.interestRate}% · {formatMoney(debt.minimum, profile.displayCurrency, rates)}/mo</p></div>
                </div>
                <Progress className="mt-3" value={progress} />
                {debt.targetDate && <p className="mt-2 text-xs text-muted-foreground">Target payoff: {formatDate(new Date(`${debt.targetDate}T00:00:00`), profile.locale)}</p>}
                {(debt.previouslyPaid > 0 || debt.payments.length > 0) && (
                  <div className="mt-4 border-t pt-3">
                    <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Payment history</p>
                    {debt.previouslyPaid > 0 && <p className="mb-2 text-sm">Paid before history: {formatMoney(debt.previouslyPaid, profile.displayCurrency, rates)}</p>}
                    <div className="space-y-1">
                      {debt.payments.slice(0, 5).map((item) => (
                        <div key={item.id} className="flex min-h-9 items-center justify-between gap-3 text-sm">
                          <div className="min-w-0"><span className="font-medium">{formatMoney(item.amount, profile.displayCurrency, rates)}</span><span className="ml-2 text-muted-foreground">{item.payment_date}</span>{item.note && <span className="ml-2 text-muted-foreground">{item.note}</span>}</div>
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Remove payment" title="Remove payment" onClick={() => deletePayment(item)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )
          })}
        </div>
      </CardContent>

      <Dialog open={paymentDebt !== null} onOpenChange={(open) => { if (!open) setPaymentDebt(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add payment to {paymentDebt?.creditor}</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2"><Label>Amount</Label><Input autoFocus type="number" min="0.01" max={paymentDebt?.balance} step="0.01" value={payment.amount} onChange={(event) => setPayment((current) => ({ ...current, amount: event.target.value }))} /></div>
            <div className="grid gap-2"><Label>Date</Label><Input type="date" value={payment.date} onChange={(event) => setPayment((current) => ({ ...current, date: event.target.value }))} /></div>
            <div className="grid gap-2"><Label>Note (optional)</Label><Input value={payment.note} onChange={(event) => setPayment((current) => ({ ...current, note: event.target.value }))} placeholder="Bank transfer, invoice, etc." /></div>
            <p className="text-sm text-muted-foreground">Remaining before payment: {formatMoney(paymentDebt?.balance ?? 0, profile.displayCurrency, rates)}</p>
            <Button disabled={saving || !payment.amount || !payment.date} onClick={addPayment}>{saving ? 'Saving...' : 'Record payment'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
