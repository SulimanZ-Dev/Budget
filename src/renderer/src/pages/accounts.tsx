import { useEffect, useState } from 'react'
import { Wallet, Plus, Pencil, Archive } from 'lucide-react'
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
  is_archived: number
  balance: number
  transaction_count: number
}

const accountTypes = ['checking', 'savings', 'cash', 'other'] as const
const currencies = ['SEK', 'EUR', 'USD'] as const

export function AccountsPage(): JSX.Element {
  const { profile, rates, triggerRefresh } = useAppStore()
  const appDialog = useAppDialog()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Account | null>(null)
  const [form, setForm] = useState({
    name: '',
    type: 'checking' as Account['type'],
    currency: 'SEK' as Account['currency']
  })

  useEffect(() => {
    load()
  }, [])

  async function load(): Promise<void> {
    setAccounts((await window.api.accounts.list()) as Account[])
  }

  function openCreate(): void {
    setEditing(null)
    setForm({ name: '', type: 'checking', currency: profile.baseCurrency })
    setOpen(true)
  }

  function openEdit(account: Account): void {
    setEditing(account)
    setForm({ name: account.name, type: account.type, currency: account.currency })
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

  const activeAccounts = accounts.filter((account) => account.is_archived !== 1)
  const archivedAccounts = accounts.filter((account) => account.is_archived === 1)
  const totalBalance = activeAccounts.reduce((sum, account) => sum + account.balance, 0)

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

      <Card>
        <CardContent className="p-6">
          <p className="text-sm text-muted-foreground">Total active balance</p>
          <p className="text-3xl font-bold">{formatMoney(totalBalance, profile.displayCurrency, rates)}</p>
          <p className="mt-1 text-xs text-muted-foreground">Computed from transaction history across active accounts.</p>
        </CardContent>
      </Card>

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
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => openEdit(account)}>
                  <Pencil className="h-3 w-3" />
                  Edit
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
            <Button onClick={save}>{editing ? 'Save changes' : 'Create account'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
