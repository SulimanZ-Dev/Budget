import { useEffect, useState } from 'react'
import { Wallet, Plus, Pencil, Archive, Landmark, PiggyBank, ReceiptText, Scale } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAppStore } from '@/store/app-store'
import { formatMoney } from '@/lib/utils'
import { useAppDialog } from '@/components/shared/app-dialog'

type Account = {
  id: number
  name: string
  type: 'checking' | 'savings' | 'cash' | 'other'
  currency: 'SEK' | 'EUR' | 'USD'
  opening_balance: number
  is_archived: number
  balance: number
  activity_balance: number
  income_total: number
  expense_total: number
  savings_total: number
  transaction_count: number
}

type BalanceExplanation = {
  account: { id: number; name: string; opening_balance: number }
  openingBalance: number
  activityBalance: number
  balance: number
  totals: { income: number; expenses: number; savings: number; transfers: number }
  transactions: { id: number; description: string; amount: number; type: string; date: string; category_name?: string | null }[]
}

const accountTypes = ['checking', 'savings', 'cash', 'other'] as const
const currencies = ['SEK', 'EUR', 'USD'] as const

export function AccountsPage(): JSX.Element {
  const { profile, rates, triggerRefresh, refreshTrigger } = useAppStore()
  const appDialog = useAppDialog()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Account | null>(null)
  const [explanation, setExplanation] = useState<BalanceExplanation | null>(null)
  const [reconciliation, setReconciliation] = useState<{ account: Account; date: string; balance: string; preview?: { calculatedBalance: number; statementBalance: number; difference: number }; history: Array<{ id: number; statement_date: string; difference: number }> } | null>(null)
  const [form, setForm] = useState({
    name: '',
    type: 'checking' as Account['type'],
    currency: 'SEK' as Account['currency'],
    openingBalance: ''
  })

  useEffect(() => {
    load()
  }, [refreshTrigger])

  async function load(): Promise<void> {
    setAccounts((await window.api.accounts.list()) as Account[])
  }

  function openCreate(): void {
    setEditing(null)
    setForm({ name: '', type: 'checking', currency: profile.baseCurrency, openingBalance: '' })
    setOpen(true)
  }

  function openEdit(account: Account): void {
    setEditing(account)
    setForm({
      name: account.name,
      type: account.type,
      currency: account.currency,
      openingBalance: String(account.opening_balance ?? 0)
    })
    setOpen(true)
  }

  async function save(): Promise<void> {
    if (!form.name.trim()) return
    if (editing) {
      await window.api.accounts.update(editing.id, form)
    } else {
      await window.api.accounts.create(form)
    }
    setOpen(false)
    await load()
    triggerRefresh()
  }

  async function archive(account: Account): Promise<void> {
    if (!await appDialog.confirm(`Archive ${account.name}? Existing transactions will keep their account assignment.`, {
      title: 'Archive account',
      confirmLabel: 'Archive'
    })) return
    await window.api.accounts.archive(account.id)
    await load()
    triggerRefresh()
  }

  async function explain(account: Account): Promise<void> {
    setExplanation(await window.api.accounts.explainBalance(account.id) as BalanceExplanation)
  }

  async function openReconciliation(account: Account): Promise<void> {
    const history = await window.api.reconciliation.history(account.id) as Array<{ id: number; statement_date: string; difference: number }>
    setReconciliation({ account, date: new Date().toISOString().slice(0, 10), balance: String(account.balance), history })
  }

  const activeAccounts = accounts.filter((account) => account.is_archived !== 1)
  const archivedAccounts = accounts.filter((account) => account.is_archived === 1)
  const totalBalance = activeAccounts.reduce((sum, account) => sum + account.balance, 0)
  const everydayBalance = activeAccounts
    .filter((account) => account.type !== 'savings')
    .reduce((sum, account) => sum + account.balance, 0)
  const savingsBalance = activeAccounts
    .filter((account) => account.type === 'savings')
    .reduce((sum, account) => sum + account.balance, 0)

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Wallet className="h-6 w-6" />
          Accounts
        </h1>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Add account
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-6">
            <Wallet className="mb-3 h-5 w-5 text-primary" />
            <p className="text-sm text-muted-foreground">Total active balance</p>
            <p className="text-3xl font-bold">{formatMoney(totalBalance, profile.displayCurrency, rates)}</p>
            <p className="mt-1 text-xs text-muted-foreground">Starting balances plus account activity.</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <Landmark className="mb-3 h-5 w-5 text-primary" />
            <p className="text-sm text-muted-foreground">Everyday accounts</p>
            <p className="text-3xl font-bold">{formatMoney(everydayBalance, profile.displayCurrency, rates)}</p>
            <p className="mt-1 text-xs text-muted-foreground">Checking, cash, and other spendable accounts.</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <PiggyBank className="mb-3 h-5 w-5 text-primary" />
            <p className="text-sm text-muted-foreground">Savings accounts</p>
            <p className="text-3xl font-bold">{formatMoney(savingsBalance, profile.displayCurrency, rates)}</p>
            <p className="mt-1 text-xs text-muted-foreground">Savings transactions add here when assigned to savings.</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {activeAccounts.map((account) => (
          <Card key={account.id}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                <span>{account.name}</span>
                <span className="rounded bg-muted px-2 py-0.5 text-xs font-normal capitalize text-muted-foreground">
                  {account.type}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-2xl font-bold">{formatMoney(account.balance, profile.displayCurrency, rates)}</p>
                <p className="text-xs text-muted-foreground">
                  {account.transaction_count} transactions - {account.currency}
                </p>
              </div>
              <div className="grid gap-2 rounded-md bg-muted/40 p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Starting balance</span>
                  <span>{formatMoney(account.opening_balance ?? 0, profile.displayCurrency, rates)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Activity</span>
                  <span>{formatMoney(account.activity_balance ?? 0, profile.displayCurrency, rates)}</span>
                </div>
                {account.savings_total > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Savings activity</span>
                    <span>{formatMoney(account.savings_total, profile.displayCurrency, rates)}</span>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => openEdit(account)}>
                  <Pencil className="h-3 w-3" />
                  Edit
                </Button>
                <Button variant="outline" size="sm" onClick={() => explain(account)}>
                  <ReceiptText className="h-3 w-3" />
                  Explain
                </Button>
                <Button variant="outline" size="sm" onClick={() => openReconciliation(account)}>
                  <Scale className="h-3 w-3" />
                  Reconcile
                </Button>
                <Button variant="outline" size="sm" onClick={() => archive(account)}>
                  <Archive className="h-3 w-3" />
                  Archive
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {archivedAccounts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Archived</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {archivedAccounts.map((account) => (
              <div key={account.id} className="flex items-center justify-between rounded border p-3 text-sm text-muted-foreground">
                <span>{account.name}</span>
                <span>{formatMoney(account.balance, profile.displayCurrency, rates)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit account' : 'Add account'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>Type</Label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as Account['type'] })}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                {accountTypes.map((type) => (
                  <option key={type} value={type}>
                    {type[0].toUpperCase() + type.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label>Currency</Label>
              <select
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value as Account['currency'] })}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                {currencies.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label>Starting balance</Label>
              <div className="relative">
                <ReceiptText className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={form.openingBalance}
                  onChange={(e) => setForm({ ...form, openingBalance: e.target.value })}
                  className="pl-9"
                  placeholder="0.00"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Use the real bank balance from before this app's transaction history starts.
              </p>
            </div>
            <Button onClick={save}>{editing ? 'Save changes' : 'Create account'}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!explanation} onOpenChange={(isOpen) => !isOpen && setExplanation(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{explanation?.account.name} balance</DialogTitle>
          </DialogHeader>
          {explanation && (
            <div className="space-y-4">
              <div className="grid gap-2 rounded-md bg-muted/40 p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Starting balance</span>
                  <span>{formatMoney(explanation.openingBalance, profile.displayCurrency, rates)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Income</span>
                  <span className="text-success">{formatMoney(explanation.totals.income, profile.displayCurrency, rates)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Expenses</span>
                  <span className="text-destructive">-{formatMoney(explanation.totals.expenses, profile.displayCurrency, rates)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Savings</span>
                  <span>{formatMoney(explanation.totals.savings, profile.displayCurrency, rates)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Transfers</span>
                  <span>{formatMoney(explanation.totals.transfers, profile.displayCurrency, rates)}</span>
                </div>
                <div className="flex justify-between border-t pt-2 font-semibold">
                  <span>Current balance</span>
                  <span>{formatMoney(explanation.balance, profile.displayCurrency, rates)}</span>
                </div>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">Recent activity</p>
                <div className="max-h-72 space-y-2 overflow-auto">
                  {explanation.transactions.map((tx) => (
                    <div key={tx.id} className="flex items-center justify-between gap-3 rounded border p-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{tx.description}</p>
                        <p className="text-xs text-muted-foreground">{tx.date} - {tx.category_name ?? tx.type}</p>
                      </div>
                      <span>{formatMoney(tx.amount, profile.displayCurrency, rates)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!reconciliation} onOpenChange={(isOpen) => !isOpen && setReconciliation(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reconcile {reconciliation?.account.name}</DialogTitle></DialogHeader>
          {reconciliation && <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2"><Label>Statement date</Label><Input type="date" value={reconciliation.date} onChange={(event) => setReconciliation({ ...reconciliation, date: event.target.value, preview: undefined })} /></div>
              <div className="grid gap-2"><Label>Bank statement balance</Label><Input type="number" value={reconciliation.balance} onChange={(event) => setReconciliation({ ...reconciliation, balance: event.target.value, preview: undefined })} /></div>
            </div>
            <Button variant="outline" onClick={async () => setReconciliation({ ...reconciliation, preview: await window.api.reconciliation.preview(reconciliation.account.id, reconciliation.date, Number(reconciliation.balance)) as { calculatedBalance: number; statementBalance: number; difference: number } })}>Compare balance</Button>
            {reconciliation.preview && <div className="rounded border p-3 text-sm"><div className="flex justify-between"><span>App balance</span><span>{formatMoney(reconciliation.preview.calculatedBalance, profile.displayCurrency, rates)}</span></div><div className="flex justify-between"><span>Bank balance</span><span>{formatMoney(reconciliation.preview.statementBalance, profile.displayCurrency, rates)}</span></div><div className="mt-2 flex justify-between border-t pt-2 font-medium"><span>Difference</span><span className={Math.abs(reconciliation.preview.difference) <= 0.01 ? 'text-success' : 'text-destructive'}>{formatMoney(reconciliation.preview.difference, profile.displayCurrency, rates)}</span></div></div>}
            <Button disabled={!reconciliation.preview} onClick={async () => { await window.api.reconciliation.complete(reconciliation.account.id, reconciliation.date, Number(reconciliation.balance)); setReconciliation(null); await load(); triggerRefresh() }}>Complete reconciliation</Button>
            {reconciliation.history.length > 0 && <div className="border-t pt-3"><p className="mb-2 text-sm font-medium">Previous reconciliations</p>{reconciliation.history.slice(0, 5).map((item) => <div key={item.id} className="flex justify-between text-xs text-muted-foreground"><span>{item.statement_date}</span><span>Difference {formatMoney(item.difference, profile.displayCurrency, rates)}</span></div>)}</div>}
          </div>}
        </DialogContent>
      </Dialog>
    </div>
  )
}
