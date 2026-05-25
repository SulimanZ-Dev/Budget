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
import type { TransactionRowData } from './transaction-row'

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
  const [notes, setNotes] = useState(t.notes ?? '')
  const [categoryId, setCategoryId] = useState(String(t.category_id ?? ''))
  const [memberId, setMemberId] = useState(String(t.member_id ?? ''))
  const [isRecurring, setIsRecurring] = useState(!!t.is_recurring)
  const [categories, setCategories] = useState<{ id: number; name: string }[]>([])
  const [members, setMembers] = useState<{ id: number; name: string }[]>([])

  useEffect(() => {
    window.api.categories.list().then((c) => setCategories(c as { id: number; name: string }[]))
    window.api.members.list().then((m) => setMembers(m as { id: number; name: string }[]))
  }, [])

  async function save(): Promise<void> {
    await window.api.transactions.update(t.id, {
      description,
      amount: parseFloat(amount),
      type: t.type,
      categoryId: categoryId ? parseInt(categoryId) : null,
      date: t.date,
      isRecurring,
      isUnnecessary: !!t.is_unnecessary,
      memberId: memberId && memberId !== 'none' ? parseInt(memberId) : null,
      notes: notes || null
    })
    onSaved()
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">Edit transaction</h2>
      <div className="grid gap-2">
        <Label>Description</Label>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="grid gap-2">
        <Label>Amount (SEK)</Label>
        <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
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
    </div>
  )
}
