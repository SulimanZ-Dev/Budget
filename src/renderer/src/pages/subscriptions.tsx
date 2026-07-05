import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { CreditCard, Plus, ExternalLink, PiggyBank, ArrowUpCircle, ArrowDownCircle } from 'lucide-react'
import { InfoTooltip } from '@/components/shared/info-tooltip'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAppStore } from '@/store/app-store'
import { formatMoney } from '@/lib/utils'
import { AskAiButton } from '@/components/shared/ask-ai-button'
import { EmptyState } from '@/components/shared/empty-state'
import { Pencil, Trash2 } from 'lucide-react'

type RecurringItem = {
  type: 'subscription' | 'income' | 'savings'
  id: number
  name: string
  amount: number
  frequency: string
  color: string
  next_billing_date?: string
  website_url?: string
  transaction_id?: number | null
  transaction_description?: string | null
  tax_deductible?: number
}

export function SubscriptionsPage(): JSX.Element {
  const { profile, rates } = useAppStore()
  const [items, setItems] = useState<RecurringItem[]>([])
  const [subs, setSubs] = useState<Sub[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingType, setEditingType] = useState<'subscription' | 'income' | 'savings'>('subscription')
  const [form, setForm] = useState({ name: '', amount: '', url: '', date: '', taxDeductible: false })
  const [filter, setFilter] = useState<'all' | 'subscription' | 'income' | 'savings'>('all')
  const [sort, setSort] = useState<'name' | 'amount' | 'date'>('amount')

  useEffect(() => {
    load()
  }, [])

  async function load(): Promise<void> {
    try {
      window.api.subscriptions.checkBilling().catch(() => {})
      window.api.savings.checkBilling().catch(() => {})
      window.api.income.checkBilling().catch(() => {})
      const subscriptionList = await window.api.subscriptions.list()
      setSubs(subscriptionList as Sub[])
      const incomeSources = await window.api.income.sources()
      const savingsSources = await window.api.savings.sources()

      const allItems: RecurringItem[] = [
        ...(subscriptionList as Sub[]).map((sub) => ({
          type: 'subscription' as const,
          id: sub.id,
          name: sub.name,
          amount: sub.amount,
          frequency: sub.frequency,
          color: sub.color,
          next_billing_date: sub.next_billing_date,
          website_url: sub.website_url,
          transaction_id: sub.transaction_id,
          transaction_description: sub.transaction_description,
          tax_deductible: sub.tax_deductible
        })),
        ...(incomeSources as IncomeSource[]).map((src) => ({
          type: 'income' as const,
          id: src.id,
          name: src.name,
          amount: src.amount,
          frequency: src.frequency ?? 'monthly',
          color: src.color ?? '#22c55e',
          next_billing_date: undefined,
          website_url: undefined,
          transaction_id: null,
          transaction_description: null
        })),
        ...(savingsSources as SavingsSource[]).map((src) => ({
          type: 'savings' as const,
          id: src.id,
          name: src.description,
          amount: src.amount,
          frequency: src.frequency ?? 'monthly',
          color: '#3b82f6',
          next_billing_date: undefined,
          website_url: undefined,
          transaction_id: src.transaction_id,
          transaction_description: null
        }))
      ]
      setItems(allItems)
    } catch {
      // Silently fail
    }
  }

  const filtered = items.filter((item) => {
    if (filter === 'subscription') return item.type === 'subscription'
    if (filter === 'income') return item.type === 'income'
    if (filter === 'savings') return item.type === 'savings'
    return true
  })

  const sorted = [...filtered].sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name)
    if (sort === 'amount') return b.amount - a.amount
    if (sort === 'date') return (a.next_billing_date ?? '').localeCompare(b.next_billing_date ?? '')
    return 0
  })

  const monthlyExpenses = items
    .filter((i) => i.type === 'subscription')
    .reduce((s, i) => s + (i.frequency === 'annual' || i.frequency === 'yearly' ? i.amount / 12 : i.amount), 0)
  const monthlyIncome = items
    .filter((i) => i.type === 'income')
    .reduce((s, i) => s + (i.frequency === 'annual' || i.frequency === 'yearly' ? i.amount / 12 : i.amount), 0)
  const monthlySavings = items
    .filter((i) => i.type === 'savings')
    .reduce((s, i) => s + (i.frequency === 'annual' || i.frequency === 'yearly' ? i.amount / 12 : i.amount), 0)
  const annualExpenses = monthlyExpenses * 12
  const annualIncome = monthlyIncome * 12
  const annualSavings = monthlySavings * 12

  async function save(): Promise<void> {
    const amount = parseFloat(form.amount)
    if (!form.name.trim() || !Number.isFinite(amount) || amount <= 0) return
    try {
      if (editingType === 'subscription') {
        if (editingId) {
          await window.api.subscriptions.update(editingId, {
            name: form.name,
            amount,
            frequency: 'monthly',
            websiteUrl: form.url,
            nextBillingDate: form.date || undefined,
            taxDeductible: form.taxDeductible
          })
        } else {
          await window.api.subscriptions.create({
            name: form.name,
            amount,
            frequency: 'monthly',
            websiteUrl: form.url,
            nextBillingDate: form.date || undefined,
            taxDeductible: form.taxDeductible
          })
        }
      }
      setEditingId(null)
      setEditingType('subscription')
      setForm({ name: '', amount: '', url: '', date: '', taxDeductible: false })
      setModalOpen(false)
      load()
    } catch {
      // Silently fail
    }
  }

  async function remove(id: number, type: string): Promise<void> {
    if (!confirm(`Delete this ${type}?`)) return
    try {
      if (type === 'subscription') {
        await window.api.subscriptions.delete(id)
      } else if (type === 'savings') {
        await window.api.savings.deleteSource(id)
        // Also trigger refresh so budget/savings pages update
      }
      load()
    } catch {
      // Silently fail
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          Recurring
          <InfoTooltip content="Expenses in red, income in green, savings in blue. All amounts are converted to a monthly equivalent." />
        </h1>
        <div className="flex gap-2">
          <AskAiButton
            context="subscriptions"
            prefill="Which subscriptions should I cancel based on my spending habits?"
          />
          <Button onClick={() => {
            setEditingId(null)
            setEditingType('subscription')
            setForm({ name: '', amount: '', url: '', date: '' })
            setModalOpen(true)
          }}>
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Monthly expenses</p>
            <p className="text-3xl font-bold text-destructive">-{formatMoney(monthlyExpenses, profile.displayCurrency, rates)}</p>
            <p className="text-xs text-muted-foreground mt-1">Annual: -{formatMoney(annualExpenses, profile.displayCurrency, rates)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Monthly income</p>
            <p className="text-3xl font-bold text-success">+{formatMoney(monthlyIncome, profile.displayCurrency, rates)}</p>
            <p className="text-xs text-muted-foreground mt-1">Annual: +{formatMoney(annualIncome, profile.displayCurrency, rates)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Monthly savings</p>
            <p className="text-3xl font-bold text-info">{formatMoney(monthlySavings, profile.displayCurrency, rates)}</p>
            <p className="text-xs text-muted-foreground mt-1">Annual: {formatMoney(annualSavings, profile.displayCurrency, rates)}</p>
          </CardContent>
        </Card>
      </div>

      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border bg-card p-1">
            {(['all', 'subscription', 'income', 'savings'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  filter === f ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {f === 'all' ? 'All' : f === 'subscription' ? 'Expenses' : f === 'income' ? 'Income' : 'Savings'}
              </button>
            ))}
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as 'name' | 'amount' | 'date')}
            className="h-8 rounded-lg border bg-card px-2 text-xs"
          >
            <option value="amount">By amount</option>
            <option value="name">By name</option>
            <option value="date">By billing date</option>
          </select>
        </div>
      )}

      {sorted.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title={items.length === 0 ? 'No recurring items' : 'No matching items'}
          description="Add subscriptions, income sources, or set up recurring savings to track your recurring finances."
          actionLabel="Add subscription"
          onAction={() => {
            setEditingId(null)
            setEditingType('subscription')
            setForm({ name: '', amount: '', url: '', date: '' })
            setModalOpen(true)
          }}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sorted.map((item, i) => {
            const monthly = item.frequency === 'annual' || item.frequency === 'yearly' ? item.amount / 12 : item.amount
            let borderStyle: string
            let iconEl: JSX.Element
            let sign: string
            let amountStyle: string
            if (item.type === 'subscription') {
              borderStyle = 'border-destructive/30 bg-destructive/5'
              iconEl = <ArrowDownCircle className="h-5 w-5 text-destructive" />
              sign = '-'
              amountStyle = 'text-destructive'
            } else if (item.type === 'income') {
              borderStyle = 'border-success/30 bg-success/5'
              iconEl = <ArrowUpCircle className="h-5 w-5 text-success" />
              sign = '+'
              amountStyle = 'text-success'
            } else {
              borderStyle = 'border-info/30 bg-info/5'
              iconEl = <PiggyBank className="h-5 w-5 text-info" />
              sign = ''
              amountStyle = 'text-info'
            }
            return (
              <motion.div
                key={`${item.type}-${item.id}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <Card className={borderStyle}>
                  <CardContent className="p-5">
                      <div className="flex items-start justify-between">
                        <div
                          className="flex h-10 w-10 items-center justify-center rounded-lg"
                          style={{ backgroundColor: `${item.color}33` }}
                        >
                          {iconEl}
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span className="text-xs text-muted-foreground capitalize">{item.frequency}</span>
                          {item.transaction_id && (
                            <span className="text-[10px] text-muted-foreground/60 bg-muted/50 px-1.5 py-0.5 rounded">
                              Linked
                            </span>
                          )}
                          {item.tax_deductible ? (
                            <span className="text-[10px] text-success/80 bg-success/10 px-1.5 py-0.5 rounded">
                              Tax deductible
                            </span>
                          ) : null}
                        </div>
                      </div>
                    <h3 className="mt-3 font-semibold">{item.name}</h3>
                    <p className={`text-2xl font-bold ${amountStyle}`}>
                      {sign}{formatMoney(item.amount, profile.displayCurrency, rates)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {sign}{formatMoney(monthly, profile.displayCurrency, rates)}/mo
                    </p>
                    {item.type === 'subscription' && item.next_billing_date && (
                      <p className="mt-1 text-xs text-muted-foreground">Next: {item.next_billing_date}</p>
                    )}
                    {item.website_url && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-3 gap-1"
                        onClick={() => window.api.openExternal(item.website_url!)}
                      >
                        <ExternalLink className="h-3 w-3" />
                        Open website
                      </Button>
                    )}
                    {item.type === 'subscription' && (
                      <div className="mt-3 flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditingId(item.id)
                            setEditingType('subscription')
                            setForm({ name: item.name, amount: String(item.amount), url: item.website_url ?? '', date: item.next_billing_date ?? '', taxDeductible: !!item.tax_deductible })
                            setModalOpen(true)
                          }}
                        >
                          <Pencil className="h-3 w-3" />
                          Edit
                        </Button>
                        {item.transaction_id && (
                          <Button variant="secondary" size="sm" onClick={async () => {
                            if (!confirm('Unlink this subscription and make the transaction non-recurring?')) return
                            await window.api.subscriptions.unlink(item.id)
                            load()
                          }}>
                            Unlink
                          </Button>
                        )}
                        <Button variant="destructive" size="sm" onClick={() => remove(item.id, 'subscription')}>
                          <Trash2 className="h-3 w-3" />
                          Delete
                        </Button>
                      </div>
                    )}
                    {item.type === 'savings' && (
                      <div className="mt-3 flex gap-2">
                        <Button variant="destructive" size="sm" onClick={() => remove(item.id, 'savings')}>
                          <Trash2 className="h-3 w-3" />
                          Delete
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            )
          })}
        </div>
      )}

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit subscription' : 'Add subscription'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Service name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>Amount (SEK/mo)</Label>
              <Input
                type="number"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label>Website URL</Label>
              <Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>Next billing date</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="taxDeductible"
                checked={form.taxDeductible}
                onChange={(e) => setForm({ ...form, taxDeductible: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300"
              />
              <Label htmlFor="taxDeductible">Tax deductible</Label>
            </div>
            <Button onClick={save}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

interface Sub {
  id: number
  name: string
  amount: number
  frequency: string
  next_billing_date?: string
  website_url?: string
  color: string
  transaction_id?: number | null
  transaction_description?: string | null
  tax_deductible?: number
}

interface IncomeSource {
  id: number
  name: string
  amount: number
  is_gross?: number
  gross_or_net?: string
  is_recurring?: number
  frequency?: string
  color?: string
}

interface SavingsSource {
  id: number
  description: string
  amount: number
  frequency: string
  category_id?: number | null
  transaction_id?: number | null
}