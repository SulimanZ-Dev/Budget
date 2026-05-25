import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { MoreHorizontal, Sparkles, Trash2, Flag, Pencil } from 'lucide-react'
import { formatMoney } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'

export interface TransactionRowData {
  id: number
  description: string
  amount: number
  type: string
  date: string
  category_id?: number
  category_name?: string
  category_color?: string
  category_icon?: string
  is_recurring: number
  is_unnecessary: number
  member_id?: number
  member_name?: string
  notes?: string
}

interface Category {
  id: number
  name: string
}

interface TransactionRowProps {
  transaction: TransactionRowData
  selected: boolean
  onSelect: (id: number, checked: boolean) => void
  icon: React.ReactElement
  categories: Category[]
  onUpdated: () => void
  onAskAi: (tx: TransactionRowData) => void
  onEdit: (tx: TransactionRowData) => void
  index: number
}

export function TransactionRow({
  transaction: t,
  selected,
  onSelect,
  icon,
  categories,
  onUpdated,
  onAskAi,
  onEdit,
  index
}: TransactionRowProps): JSX.Element {
  const { profile, rates } = useAppStore()
  const [editingAmount, setEditingAmount] = useState(false)
  const [editingCategory, setEditingCategory] = useState(false)
  const [amount, setAmount] = useState(String(t.amount))

  async function saveAmount(): Promise<void> {
    const val = parseFloat(amount)
    if (isNaN(val)) return
    await window.api.transactions.update(t.id, {
      description: t.description,
      amount: val,
      type: t.type,
      categoryId: t.category_id,
      date: t.date,
      isRecurring: !!t.is_recurring,
      isUnnecessary: !!t.is_unnecessary,
      memberId: null,
      notes: t.notes
    })
    setEditingAmount(false)
    onUpdated()
  }

  async function saveCategory(catId: string): Promise<void> {
    await window.api.transactions.update(t.id, {
      description: t.description,
      amount: t.amount,
      type: t.type,
      categoryId: parseInt(catId),
      date: t.date,
      isRecurring: !!t.is_recurring,
      isUnnecessary: !!t.is_unnecessary,
      memberId: null,
      notes: t.notes
    })
    setEditingCategory(false)
    onUpdated()
  }

  async function flagUnnecessary(): Promise<void> {
    await window.api.transactions.update(t.id, {
      description: t.description,
      amount: t.amount,
      type: t.type,
      categoryId: t.category_id,
      date: t.date,
      isRecurring: !!t.is_recurring,
      isUnnecessary: true,
      memberId: null,
      notes: t.notes
    })
    onUpdated()
  }

  async function remove(): Promise<void> {
    await window.api.transactions.delete(t.id)
    onUpdated()
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.02 }}
      className="flex items-center gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-accent/30"
      onContextMenu={(e) => e.preventDefault()}
    >
      <Checkbox checked={selected} onCheckedChange={(c) => onSelect(t.id, !!c)} />
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: `${t.category_color ?? '#6366f1'}22` }}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{t.description}</p>
        <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-1">
          {new Date(t.date).toLocaleDateString('sv-SE')}
          {editingCategory ? (
            <Select
              value={String(t.category_id ?? '')}
              onValueChange={(v) => saveCategory(v)}
              open
              onOpenChange={(o) => !o && setEditingCategory(false)}
            >
              <SelectTrigger className="h-6 w-32 text-xs">
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
          ) : (
            <button
              type="button"
              onClick={() => setEditingCategory(true)}
              className="rounded-full px-2 py-0.5 hover:ring-1 hover:ring-ring"
              style={{
                backgroundColor: `${t.category_color ?? '#6366f1'}22`,
                color: t.category_color
              }}
            >
              {t.category_name ?? 'Uncategorized'}
            </button>
          )}
          {t.is_recurring ? <span className="text-info">Recurring</span> : null}
          {t.is_unnecessary ? <span className="text-warning">Flagged</span> : null}
        </p>
      </div>
      {editingAmount ? (
        <Input
          type="number"
          className="w-24 h-8 text-right"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onBlur={saveAmount}
          onKeyDown={(e) => e.key === 'Enter' && saveAmount()}
          autoFocus
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditingAmount(true)}
          className={`font-semibold tabular-nums hover:underline ${
            t.type === 'income' ? 'text-success' : t.type === 'savings' || t.type === 'transfer' ? 'text-info' : 'text-foreground'
          }`}
        >
          {t.type === 'income' ? '+' : t.type === 'savings' || t.type === 'transfer' ? '→' : '-'}
          {formatMoney(t.amount, profile.displayCurrency, rates)}
        </button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Actions">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onEdit(t)}>
            <Pencil className="h-4 w-4 mr-2" />
            Edit details
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onAskAi(t)}>
            <Sparkles className="h-4 w-4 mr-2" />
            Ask AI about this
          </DropdownMenuItem>
          <DropdownMenuItem onClick={flagUnnecessary}>
            <Flag className="h-4 w-4 mr-2" />
            Flag unnecessary
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={remove} className="text-destructive">
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </motion.div>
  )
}
