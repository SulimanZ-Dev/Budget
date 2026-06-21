import { useEffect, useState } from 'react'
import { PiggyBank, Plus, Pencil, Trash2 } from 'lucide-react'
import { InfoTooltip } from '@/components/shared/info-tooltip'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAppStore } from '@/store/app-store'
import { formatMoney } from '@/lib/utils'
import { EmptyState } from '@/components/shared/empty-state'
import { TransactionDetailDrawer } from '@/components/transactions/transaction-detail-drawer'

type SavingsTx = {
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

export function SavingsPage(): JSX.Element {
  const { profile, rates, selectedMonth, openDrawer, closeDrawer } = useAppStore()
  const [rows, setRows] = useState<SavingsTx[]>([])
  const [form, setForm] = useState({
    description: '',
    amount: '',
    date: new Date().toISOString().slice(0, 10)
  })

  useEffect(() => {
    load()
  }, [profile.year, selectedMonth])

  async function load(): Promise<void> {
    const txs = (await window.api.transactions.list({
      year: profile.year,
      month: selectedMonth,
      type: 'savings'
    })) as SavingsTx[]
    setRows(txs)
  }

  async function save(): Promise<void> {
    const amount = Number.parseFloat(form.amount)
    if (!form.description.trim() || !Number.isFinite(amount) || amount <= 0) return
    await window.api.transactions.create({
      description: form.description.trim(),
      amount,
      type: 'savings',
      categoryId: null,
      date: form.date,
      isRecurring: false,
      isUnnecessary: false,
      memberId: null,
      notes: null
    })
    setForm({ description: '', amount: '', date: new Date().toISOString().slice(0, 10) })
    await load()
  }

  async function remove(id: number): Promise<void> {
    if (!confirm('Delete this savings transaction?')) return
    await window.api.transactions.delete(id)
    await load()
  }

  const totalSavedMonth = rows.reduce((sum, row) => sum + row.amount, 0)

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          Savings
          <InfoTooltip content="Record money moved to savings accounts here. These are deducted from your available budget balance automatically, and contribute toward your savings goals." />
        </h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Save money</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <div className="grid gap-2 md:col-span-2">
            <Label>Description</Label>
            <Input
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="Emergency fund transfer"
            />
          </div>
          <div className="grid gap-2">
            <Label>Amount</Label>
            <Input
              type="number"
              min="0"
              value={form.amount}
              onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
            />
          </div>
          <div className="grid gap-2">
            <Label>Date</Label>
            <Input
              type="date"
              value={form.date}
              onChange={(e) => setForm((prev) => ({ ...prev, date: e.target.value }))}
            />
          </div>
          <Button className="md:col-span-4" onClick={save}>
            <Plus className="h-4 w-4" />
            Add savings transaction
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <p className="text-sm text-muted-foreground">Saved this month</p>
          <p className="text-2xl font-bold text-success">
            {formatMoney(totalSavedMonth, profile.displayCurrency, rates)}
          </p>
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <EmptyState
          icon={PiggyBank}
          title="No savings recorded"
          description="Add a savings transaction above. It will reduce your available budget balance automatically."
        />
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <Card key={row.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <p className="font-medium">{row.description}</p>
                  <p className="text-xs text-muted-foreground">{row.date}</p>
                </div>
                <div className="flex items-center gap-2">
                  <p className="font-semibold">{formatMoney(row.amount, profile.displayCurrency, rates)}</p>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      openDrawer(
                        <TransactionDetailDrawer
                          transaction={row}
                          onSaved={() => {
                            closeDrawer()
                            load()
                          }}
                        />
                      )
                    }
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="text-destructive" onClick={() => remove(row.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
