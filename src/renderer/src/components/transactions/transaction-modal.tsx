import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useAppStore } from '@/store/app-store'
import { Sparkles } from 'lucide-react'

interface Category {
  id: number
  name: string
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
  const [categories, setCategories] = useState<Category[]>([])
  const [members, setMembers] = useState<{ id: number; name: string }[]>([])
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [type, setType] = useState<'expense' | 'income' | 'savings' | 'transfer'>('expense')
  const [categoryId, setCategoryId] = useState<string>('')
  const [memberId, setMemberId] = useState<string>('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [isRecurring, setIsRecurring] = useState(false)
  const [isUnnecessary, setIsUnnecessary] = useState(false)
  const [suggesting, setSuggesting] = useState(false)

  useEffect(() => {
    if (open) {
      window.api.categories.list().then(setCategories)
      window.api.members.list().then(setMembers)
    }
  }, [open])

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

  async function save(): Promise<void> {
    const amt = parseFloat(amount)
    if (!description || isNaN(amt)) return
    await window.api.transactions.create({
      description,
      amount: amt,
      type,
      categoryId: categoryId ? parseInt(categoryId) : null,
      date,
      isRecurring,
      isUnnecessary,
      memberId: memberId ? parseInt(memberId) : null,
      notes: notes || null
    })
    setDescription('')
    setAmount('')
    setNotes('')
    onOpenChange(false)
    onSaved?.()
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
              <Button variant="outline" size="icon" onClick={suggestCategory} disabled={suggesting} title="AI categorize">
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
          <Button onClick={save} className="w-full">
            Save transaction
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
