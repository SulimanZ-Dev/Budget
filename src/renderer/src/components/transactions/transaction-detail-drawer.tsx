import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { TransactionHistory } from './transaction-history'
import type { TransactionRowData } from './transaction-row'
import { TransactionExtras } from './transaction-extras'

interface TransactionDetailDrawerProps {
  transaction: TransactionRowData
  onSaved: () => void
}

export function TransactionDetailDrawer({
  transaction: t,
  onSaved
}: TransactionDetailDrawerProps): JSX.Element {
  const [description, setDescription] = useState(t.description)
  const [amount, setAmount] = useState(String(t.amount))
  const [date, setDate] = useState(t.date)
  const [notes, setNotes] = useState(t.notes ?? '')
  const [categoryId, setCategoryId] = useState(String(t.category_id ?? ''))
  const [accountId, setAccountId] = useState(String(t.account_id ?? ''))
  const [transferAccountId, setTransferAccountId] = useState(String(t.transfer_account_id ?? ''))
  const [memberId, setMemberId] = useState(String(t.member_id ?? ''))
  const [isRecurring, setIsRecurring] = useState(!!t.is_recurring)
  const [categories, setCategories] = useState<{ id: number; name: string }[]>([])
  const [accounts, setAccounts] = useState<{ id: number; name: string; is_archived: number }[]>([])
  const [members, setMembers] = useState<{ id: number; name: string }[]>([])
  const [showHistory, setShowHistory] = useState(false)

  useEffect(() => {
    window.api.categories.list().then((c) => setCategories(c as { id: number; name: string }[]))
    window.api.accounts.list().then((rows) => {
      const active = (rows as { id: number; name: string; is_archived: number }[]).filter((account) => account.is_archived !== 1)
      setAccounts(active)
      setAccountId((current) => current || (active[0] ? String(active[0].id) : ''))
      setTransferAccountId((current) => current || (active[1] ? String(active[1].id) : ''))
    })
    window.api.members.list().then((m) => setMembers(m as { id: number; name: string }[]))
  }, [])

  useEffect(() => {
    if (t.type !== 'transfer') return
    if (!transferAccountId || transferAccountId === accountId) {
      const next = accounts.find((account) => String(account.id) !== accountId)
      setTransferAccountId(next ? String(next.id) : '')
    }
  }, [accountId, accounts, t.type, transferAccountId])

  async function save(): Promise<void> {
    if (!description.trim()) return
    const numAmount = parseFloat(amount)
    if (!Number.isFinite(numAmount) || numAmount <= 0) return
    try {
      await window.api.transactions.update(t.id, {
        description,
        amount: numAmount,
        type: t.type,
        accountId: accountId ? parseInt(accountId) : undefined,
        transferAccountId: t.type === 'transfer' && transferAccountId ? parseInt(transferAccountId) : null,
        categoryId: categoryId ? parseInt(categoryId) : null,
        date,
        isRecurring,
        isUnnecessary: !!t.is_unnecessary,
        memberId: memberId && memberId !== 'none' ? parseInt(memberId) : null,
        notes: notes || null
      })
      onSaved()
    } catch {
      // Silently fail
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Edit transaction</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowHistory(!showHistory)}
        >
          {showHistory ? 'Edit' : 'History'}
        </Button>
      </div>

      {showHistory ? (
        <TransactionHistory transactionId={t.id} onUndo={onSaved} />
      ) : (
        <>
      <div className="grid gap-2">
        <Label>Description</Label>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="grid gap-2">
        <Label>Amount (SEK)</Label>
        <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <div className="grid gap-2">
        <Label>Date</Label>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="grid gap-2">
        <Label>{t.type === 'transfer' ? 'From account' : 'Account'}</Label>
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
      {t.type === 'transfer' && (
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
      <div className="grid gap-2">
        <Label>Category</Label>
        <Select value={categoryId} onValueChange={setCategoryId}>
          <SelectTrigger>
            <SelectValue placeholder="Category" />
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
      {members.length > 0 && (
        <div className="grid gap-2">
          <Label>Household member</Label>
          <Select value={memberId || 'none'} onValueChange={setMemberId}>
            <SelectTrigger>
              <SelectValue />
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
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional note" />
      </div>
      <div className="flex items-center justify-between">
        <Label>Recurring</Label>
        <Switch checked={isRecurring} onCheckedChange={setIsRecurring} />
      </div>
          <Button onClick={save} className="w-full">
            Save changes
          </Button>
          <TransactionExtras transactionId={t.id} amount={Number(amount) || t.amount} type={t.type} onChanged={() => {}} />
        </>
      )}
    </div>
  )
}
