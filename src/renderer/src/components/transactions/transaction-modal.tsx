import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useAppDialog } from '@/components/shared/app-dialog'
import { Plus, Sparkles, Trash2 } from 'lucide-react'

interface Category {
  id: number
  name: string
}

interface Account {
  id: number
  name: string
  is_archived: number
}

export function TransactionModal({
  open,
  onOpenChange,
  onSaved
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onSaved?: () => void
}): JSX.Element {
  const dialog = useAppDialog()
  const [categories, setCategories] = useState<Category[]>([])
  const [members, setMembers] = useState<{ id: number; name: string }[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [type, setType] = useState<'expense' | 'income' | 'savings' | 'transfer'>('expense')
  const [categoryId, setCategoryId] = useState<string>('')
  const [accountId, setAccountId] = useState<string>('')
  const [transferAccountId, setTransferAccountId] = useState<string>('')
  const [memberId, setMemberId] = useState<string>('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [isRecurring, setIsRecurring] = useState(false)
  const [isUnnecessary, setIsUnnecessary] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [splitEnabled, setSplitEnabled] = useState(false)
  const [splits, setSplits] = useState<Array<{ categoryId: string; amount: string }>>([
    { categoryId: '', amount: '' },
    { categoryId: '', amount: '' }
  ])

  useEffect(() => {
    if (open) {
      window.api.categories.list().then(setCategories)
      window.api.members.list().then(setMembers)
      window.api.accounts.list().then((rows) => {
        const active = (rows as Account[]).filter((account) => account.is_archived !== 1)
        setAccounts(active)
        setAccountId((current) => current || (active[0] ? String(active[0].id) : ''))
        setTransferAccountId((current) => current || (active[1] ? String(active[1].id) : ''))
      })
    }
  }, [open])

  useEffect(() => {
    if (type !== 'transfer') return
    if (!transferAccountId || transferAccountId === accountId) {
      const next = accounts.find((account) => String(account.id) !== accountId)
      setTransferAccountId(next ? String(next.id) : '')
    }
  }, [accountId, accounts, transferAccountId, type])

  async function suggestCategory(): Promise<void> {
    if (!description.trim()) return
    setSuggesting(true)
    try {
      const name = await window.api.ai.suggestCategory(description)
      if (name) {
        const match = categories.find((c) => c.name.toLowerCase() === name.toLowerCase())
        if (match) setCategoryId(String(match.id))
      }
    } finally {
      setSuggesting(false)
    }
  }

  async function save(allowDuplicate = false): Promise<void> {
    const amt = parseFloat(amount)
    if (!description || isNaN(amt)) return
    if (type === 'transfer' && transferAccountId && transferAccountId === accountId) {
      await dialog.alert('Choose a different destination account for this transfer.', 'Transfer account')
      return
    }
    const splitRows = splitEnabled
      ? splits.filter((split) => split.categoryId && Number(split.amount) > 0).map((split) => ({ categoryId: Number(split.categoryId), amount: Number(split.amount) }))
      : []
    if (splitEnabled && (splitRows.length < 2 || Math.abs(splitRows.reduce((sum, split) => sum + split.amount, 0) - amt) > 0.01)) {
      await dialog.alert(`Split amounts must use at least two categories and total ${amt}.`, 'Check split')
      return
    }
    try {
      const payload = {
        description,
        amount: amt,
        type,
        accountId: accountId ? parseInt(accountId) : undefined,
        transferAccountId: type === 'transfer' && transferAccountId ? parseInt(transferAccountId) : null,
        categoryId: splitRows.length > 0 ? null : (categoryId ? parseInt(categoryId) : null),
        date,
        isRecurring,
        isUnnecessary,
        memberId: memberId ? parseInt(memberId) : null,
        notes: notes || null,
        allowDuplicate,
        splits: splitRows
      }
      const result = await window.api.transactions.create(payload)
      if ((result as { duplicate?: boolean } | null)?.duplicate) {
        const confirmed = await dialog.confirm(
          'A transaction with the same date, amount, description, account, and type already exists. Save it anyway?',
          {
            title: 'Possible duplicate',
            confirmLabel: 'Save anyway',
            cancelLabel: 'Review'
          }
        )
        if (confirmed) await save(true)
        return
      }
      setDescription('')
      setAmount('')
      setNotes('')
      setAccountId(accounts[0] ? String(accounts[0].id) : '')
      setTransferAccountId(accounts[1] ? String(accounts[1].id) : '')
      setSplitEnabled(false)
      setSplits([{ categoryId: '', amount: '' }, { categoryId: '', amount: '' }])
      onOpenChange(false)
      onSaved?.()
    } catch (error) {
      await dialog.alert(error instanceof Error ? error.message : 'Transaction could not be saved.', 'Save failed')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add transaction</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>Description</Label>
            <div className="flex gap-2">
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={suggestCategory}
                placeholder="Coffee at Espresso House"
              />
              <Button variant="outline" size="icon" onClick={suggestCategory} disabled={suggesting} aria-label="AI categorize" title="AI categorize">
                <Sparkles className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Amount (SEK)</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as 'expense' | 'income' | 'savings' | 'transfer')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="expense">Expense</SelectItem>
                <SelectItem value="income">Income</SelectItem>
                <SelectItem value="savings">Savings</SelectItem>
                <SelectItem value="transfer">Transfer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {type === 'expense' && (
            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <Label>Split across categories</Label>
                <Switch checked={splitEnabled} onCheckedChange={setSplitEnabled} />
              </div>
              {splitEnabled && (
                <div className="space-y-2">
                  {splits.map((split, index) => (
                    <div key={index} className="grid grid-cols-[1fr_110px_36px] gap-2">
                      <Select value={split.categoryId} onValueChange={(value) => setSplits((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, categoryId: value } : item))}>
                        <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
                        <SelectContent>
                          {categories.map((category) => <SelectItem key={category.id} value={String(category.id)}>{category.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Input type="number" min="0" value={split.amount} onChange={(event) => setSplits((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, amount: event.target.value } : item))} placeholder="Amount" />
                      <Button variant="ghost" size="icon" aria-label="Remove split" disabled={splits.length <= 2} onClick={() => setSplits((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => setSplits((current) => [...current, { categoryId: '', amount: '' }])}>
                    <Plus className="h-4 w-4" /> Add split
                  </Button>
                </div>
              )}
            </div>
          )}
          <div className="grid gap-2">
            <Label>{type === 'transfer' ? 'From account' : 'Account'}</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="Main" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={String(account.id)}>
                    {account.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {type === 'transfer' && (
            <div className="grid gap-2">
              <Label>To account</Label>
              <Select value={transferAccountId || 'none'} onValueChange={(v) => setTransferAccountId(v === 'none' ? '' : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="No internal destination" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No internal destination</SelectItem>
                  {accounts
                    .filter((account) => String(account.id) !== accountId)
                    .map((account) => (
                      <SelectItem key={account.id} value={String(account.id)}>
                        {account.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {!splitEnabled && (
            <div className="grid gap-2">
              <Label>Category</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {members.length > 0 && (
            <div className="grid gap-2">
              <Label>Household member</Label>
              <Select value={memberId || 'none'} onValueChange={(v) => setMemberId(v === 'none' ? '' : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-2">
            <Label>Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </div>
          <div className="flex items-center justify-between">
            <Label>Recurring</Label>
            <Switch checked={isRecurring} onCheckedChange={setIsRecurring} />
          </div>
          <div className="flex items-center justify-between">
            <Label>Unnecessary spend</Label>
            <Switch checked={isUnnecessary} onCheckedChange={setIsUnnecessary} />
          </div>
          <Button onClick={() => save()} className="w-full">
            Save transaction
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
