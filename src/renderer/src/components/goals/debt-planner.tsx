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
import { InfoTooltip } from '@/components/shared/info-tooltip'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface DebtPayment {
  id: number
  amount: number
  payment_date: string
  note?: string | null
  transaction_id?: number | null
  principal_amount?: number | null
  interest_amount?: number
  fee_amount?: number
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
  nextPaymentDate?: string | null
  notes?: string | null
  payments: DebtPayment[]
}

interface PaymentCandidate { id: number; description: string; amount: number; date: string; account_name?: string | null }

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
  const [payment, setPayment] = useState({ amount: '', principal: '', interest: '0', fee: '0', date: localToday(), note: '', transactionId: '' })
  const [candidates, setCandidates] = useState<PaymentCandidate[]>([])
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

  useEffect(() => {
    if (paymentDebt) window.api.goals.paymentCandidates(paymentDebt.id).then((rows) => setCandidates(rows as PaymentCandidate[]))
  }, [paymentDebt])

  if (!result || result.debts.length === 0) return null

  async function addPayment(): Promise<void> {
    if (!paymentDebt) return
    const amount = Number(payment.amount)
    const principal = Number(payment.principal)
    const interest = Number(payment.interest) || 0
    const fee = Number(payment.fee) || 0
    if (!Number.isFinite(amount) || amount <= 0 || principal <= 0 || principal > paymentDebt.balance || Math.abs(principal + interest + fee - amount) > 0.01) {
      await appDialog.alert('Principal must be greater than zero, no more than the remaining debt, and principal + interest + fee must equal the payment.', 'Check payment')
      return
    }
    setSaving(true)
    try {
      await window.api.goals.addDebtPayment(paymentDebt.id, { amount, principalAmount: principal, interestAmount: interest, feeAmount: fee, date: payment.date, note: payment.note, transactionId: payment.transactionId ? Number(payment.transactionId) : undefined })
      setPaymentDebt(null)
      setPayment({ amount: '', principal: '', interest: '0', fee: '0', date: localToday(), note: '', transactionId: '' })
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
              <div className="flex items-center gap-1">
                <Label htmlFor="extra-debt-payment">Extra per month (scenario)</Label>
                <InfoTooltip content="Money you could pay every month on top of all minimum payments. It changes the forecast only and does not record a real payment." />
              </div>
              <Input
                id="extra-debt-payment"
                aria-describedby="extra-debt-payment-help"
                type="number"
                min="0"
                step="100"
                value={extra}
                onChange={(event) => setExtra(event.target.value)}
              />
              <p id="extra-debt-payment-help" className="text-xs text-muted-foreground">
                Added on top of every debt's minimum. Use Add payment below to record money actually paid.
              </p>
            </div>
            {(['avalanche', 'snowball'] as const).map((strategy) => {
              const plan = result[strategy]
              return (
                <div key={strategy} className="border-l pl-4">
                  <p className="font-medium capitalize">{strategy}</p>
                  <p className="text-xs text-muted-foreground">
                    {strategy === 'avalanche' ? 'Highest interest first' : 'Smallest balance first'}
                  </p>
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
                      <Button size="sm" onClick={() => { setPaymentDebt(debt); setPayment({ amount: '', principal: '', interest: '0', fee: '0', date: localToday(), note: '', transactionId: '' }) }}>
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
                {debt.nextPaymentDate && <p className="mt-1 text-xs text-muted-foreground">Next payment due: {formatDate(new Date(`${debt.nextPaymentDate}T00:00:00`), profile.locale)}</p>}
                {(debt.previouslyPaid > 0 || debt.payments.length > 0) && (
                  <div className="mt-4 border-t pt-3">
                    <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Payment history</p>
                    {debt.previouslyPaid > 0 && <p className="mb-2 text-sm">Paid before history: {formatMoney(debt.previouslyPaid, profile.displayCurrency, rates)}</p>}
                    <div className="space-y-1">
                      {debt.payments.slice(0, 5).map((item) => (
                        <div key={item.id} className="flex min-h-9 items-center justify-between gap-3 text-sm">
                          <div className="min-w-0"><span className="font-medium">{formatMoney(item.amount, profile.displayCurrency, rates)}</span><span className="ml-2 text-muted-foreground">{item.payment_date}</span>{item.transaction_id && <span className="ml-2 text-info">linked transaction</span>}{item.principal_amount != null && (item.interest_amount || item.fee_amount) ? <span className="ml-2 text-muted-foreground">principal {formatMoney(item.principal_amount, profile.displayCurrency, rates)} · interest {formatMoney(item.interest_amount ?? 0, profile.displayCurrency, rates)} · fee {formatMoney(item.fee_amount ?? 0, profile.displayCurrency, rates)}</span> : null}{item.note && <span className="ml-2 text-muted-foreground">{item.note}</span>}</div>
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
            <div className="grid gap-2"><Label>Link bank transaction (optional)</Label><Select value={payment.transactionId} onValueChange={(id) => { const candidate = candidates.find((item) => String(item.id) === id); setPayment((current) => candidate ? { ...current, transactionId: id, amount: String(candidate.amount), principal: String(Math.min(candidate.amount, paymentDebt?.balance ?? candidate.amount)), interest: '0', fee: '0', date: candidate.date } : { ...current, transactionId: id }) }}><SelectTrigger><SelectValue placeholder="Record manually" /></SelectTrigger><SelectContent>{candidates.map((candidate) => <SelectItem key={candidate.id} value={String(candidate.id)}>{candidate.date} · {candidate.description} · {candidate.amount} · {candidate.account_name ?? 'Account'}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-2"><Label>Total payment</Label><Input autoFocus type="number" min="0.01" step="0.01" value={payment.amount} onChange={(event) => setPayment((current) => ({ ...current, amount: event.target.value, principal: current.principal || event.target.value }))} disabled={Boolean(payment.transactionId)} /></div>
            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-2"><Label>Principal</Label><Input type="number" min="0" step="0.01" value={payment.principal} onChange={(event) => setPayment((current) => ({ ...current, principal: event.target.value }))} /></div>
              <div className="grid gap-2"><Label>Interest</Label><Input type="number" min="0" step="0.01" value={payment.interest} onChange={(event) => setPayment((current) => ({ ...current, interest: event.target.value }))} /></div>
              <div className="grid gap-2"><Label>Fee</Label><Input type="number" min="0" step="0.01" value={payment.fee} onChange={(event) => setPayment((current) => ({ ...current, fee: event.target.value }))} /></div>
            </div>
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
