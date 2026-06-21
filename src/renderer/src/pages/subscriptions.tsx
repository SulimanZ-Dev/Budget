import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { CreditCard, Plus, ExternalLink } from 'lucide-react'
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

interface Sub {
  id: number
  name: string
  amount: number
  frequency: string
  next_billing_date?: string
  website_url?: string
  color: string
}

export function SubscriptionsPage(): JSX.Element {
  const { profile, rates } = useAppStore()
  const [subs, setSubs] = useState<Sub[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState({ name: '', amount: '', url: '' })

  useEffect(() => {
    load()
  }, [])

  async function load(): Promise<void> {
    setSubs(await window.api.subscriptions.list())
  }

  const monthlyTotal = subs.reduce(
    (s, sub) => s + (sub.frequency === 'annual' ? sub.amount / 12 : sub.amount),
    0
  )
  const annualTotal = monthlyTotal * 12
  const maxAmt = Math.max(...subs.map((s) => s.amount), 1)

  function tier(amount: number): string {
    const ratio = amount / maxAmt
    if (ratio > 0.66) return 'border-destructive/40 bg-destructive/5'
    if (ratio > 0.33) return 'border-warning/40 bg-warning/5'
    return 'border-success/30 bg-success/5'
  }

  async function save(): Promise<void> {
    const amount = parseFloat(form.amount)
    if (!form.name.trim() || !Number.isFinite(amount) || amount <= 0) return
    if (editingId) {
      await window.api.subscriptions.update(editingId, {
        name: form.name,
        amount,
        frequency: 'monthly',
        websiteUrl: form.url
      })
    } else {
      await window.api.subscriptions.create({
        name: form.name,
        amount,
        frequency: 'monthly',
        websiteUrl: form.url
      })
    }
    setEditingId(null)
    setForm({ name: '', amount: '', url: '' })
    setModalOpen(false)
    load()
  }

  async function remove(id: number): Promise<void> {
    if (!confirm('Delete this subscription?')) return
    await window.api.subscriptions.delete(id)
    load()
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          Subscriptions
          <InfoTooltip content="Cards are color-coded by cost tier: green (low), amber (medium), red (high). All amounts are converted to a monthly equivalent." />
        </h1>
        <div className="flex gap-2">
          <AskAiButton
            context="subscriptions"
            prefill="Which subscriptions should I cancel based on my spending habits?"
          />
          <Button onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Monthly total</p>
            <p className="text-3xl font-bold">{formatMoney(monthlyTotal, profile.displayCurrency, rates)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Annual total</p>
            <p className="text-3xl font-bold">{formatMoney(annualTotal, profile.displayCurrency, rates)}</p>
          </CardContent>
        </Card>
      </div>

      {subs.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title="No subscriptions tracked"
          description="Add streaming, software, and other recurring services to see your true monthly cost."
          actionLabel="Add subscription"
          onAction={() => setModalOpen(true)}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {subs.map((sub, i) => (
            <motion.div
              key={sub.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Card className={tier(sub.amount)}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-lg"
                      style={{ backgroundColor: `${sub.color}33` }}
                    >
                      <CreditCard className="h-5 w-5" style={{ color: sub.color }} />
                    </div>
                    <span className="text-xs text-muted-foreground capitalize">{sub.frequency}</span>
                  </div>
                  <h3 className="mt-3 font-semibold">{sub.name}</h3>
                  <p className="text-2xl font-bold">
                    {formatMoney(sub.amount, profile.displayCurrency, rates)}
                  </p>
                  {sub.next_billing_date && (
                    <p className="mt-1 text-xs text-muted-foreground">Next: {sub.next_billing_date}</p>
                  )}
                  {sub.website_url && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-3 gap-1"
                      onClick={() => window.api.openExternal(sub.website_url!)}
                    >
                      <ExternalLink className="h-3 w-3" />
                      Open website
                    </Button>
                  )}
                  <div className="mt-3 flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditingId(sub.id)
                        setForm({ name: sub.name, amount: String(sub.amount), url: sub.website_url ?? '' })
                        setModalOpen(true)
                      }}
                    >
                      <Pencil className="h-3 w-3" />
                      Edit
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => remove(sub.id)}>
                      <Trash2 className="h-3 w-3" />
                      Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
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
            <Button onClick={save}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
