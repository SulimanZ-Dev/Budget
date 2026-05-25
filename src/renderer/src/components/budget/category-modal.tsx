import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { CATEGORY_COLORS, CATEGORY_ICONS } from '@/lib/category-icons'
import * as LucideIcons from 'lucide-react'
import { cn } from '@/lib/utils'

interface CategoryModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  year: number
  month: number
}

export function CategoryModal({
  open,
  onOpenChange,
  onSaved,
  year,
  month
}: CategoryModalProps): JSX.Element {
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [icon, setIcon] = useState<string>('wallet')
  const [color, setColor] = useState(CATEGORY_COLORS[5])
  const [isFixed, setIsFixed] = useState(false)

  async function save(): Promise<void> {
    if (!name.trim()) return
    const cat = await window.api.categories.create({
      name: name.trim(),
      icon,
      color,
      isFixed,
      budgetAmount: parseFloat(amount) || 0
    })
    await window.api.budget.setEntry({
      categoryId: cat.id,
      year,
      month,
      amount: parseFloat(amount) || 0
    })
    setName('')
    setAmount('')
    onOpenChange(false)
    onSaved()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add budget category</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Groceries" />
          </div>
          <div className="grid gap-2">
            <Label>Monthly budget (SEK)</Label>
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Icon</Label>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_ICONS.map((ic) => {
                const key = ic
                  .split('-')
                  .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
                  .join('')
                const Icon =
                  (LucideIcons as unknown as Record<string, LucideIcons.LucideIcon>)[key] ??
                  LucideIcons.Wallet
                return (
                  <button
                    key={ic}
                    type="button"
                    onClick={() => setIcon(ic)}
                    className={cn(
                      'flex h-9 w-9 items-center justify-center rounded-lg border',
                      icon === ic && 'border-primary bg-primary/10'
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                )
              })}
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={cn(
                    'h-8 w-8 rounded-full border-2',
                    color === c ? 'border-foreground scale-110' : 'border-transparent'
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Label>Fixed expense</Label>
            <Switch checked={isFixed} onCheckedChange={setIsFixed} />
          </div>
          <Button onClick={save}>Create category</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
