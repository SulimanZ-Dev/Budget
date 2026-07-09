import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAppStore } from '@/store/app-store'
import { Wallet, Target, Banknote, User, Plus, Minus, Sparkles, Shield, Landmark } from 'lucide-react'

const today = new Date().toISOString().slice(0, 10)

const steps = [
  {
    icon: User,
    title: 'Welcome to Budget',
    desc: 'Set up the basics once, then track accounts, transactions, income, tax, goals, and recurring bills from one private desktop app.'
  },
  {
    icon: Landmark,
    title: 'Start With Your Main Account',
    desc: 'Name the account you use most and add an optional starting balance so your dashboard does not begin from zero.'
  },
  {
    icon: Banknote,
    title: 'Add Your Income',
    desc: 'Tell us where money comes from, when it is next paid, and whether it is gross or net. Income will stay linked to the right account.'
  },
  {
    icon: Wallet,
    title: 'Create Categories',
    desc: 'Organize your spending into categories like Food, Transport, and Entertainment. You can always add more later.'
  },
  {
    icon: Target,
    title: 'Set Your First Goal',
    desc: 'What are you saving for? An emergency fund, vacation, or something else? Set a target to stay motivated.'
  },
  {
    icon: Sparkles,
    title: 'Tools Ready From Day One',
    desc: 'Use imports, duplicate checks, undo for bulk actions, tax reconciliation, subscriptions, plugins, AI, and the event history when you need them.'
  },
  {
    icon: Shield,
    title: 'Security & Privacy',
    desc: 'Your data stays on this computer. Encryption, privacy audit tools, and local-first settings are available from the main app.'
  }
]

interface IncomeSource {
  name: string
  amount: string
  grossOrNet: 'gross' | 'net'
  isRecurring: boolean
  frequency: 'weekly' | 'fortnightly' | 'monthly' | 'yearly'
  nextBillingDate: string
}

type AccountType = 'checking' | 'savings' | 'cash' | 'other'

export function OnboardingFlow({ onComplete }: { onComplete: () => void }): JSX.Element {
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [accountName, setAccountName] = useState('Main')
  const [accountType, setAccountType] = useState<AccountType>('checking')
  const [openingBalance, setOpeningBalance] = useState('')
  const [incomeSources, setIncomeSources] = useState<IncomeSource[]>([
    { name: 'Salary', amount: '', grossOrNet: 'net', isRecurring: true, frequency: 'monthly', nextBillingDate: today }
  ])
  const [categories, setCategories] = useState('Food, Transport, Housing, Entertainment')
  const [goalName, setGoalName] = useState('Emergency fund')
  const [goalAmount, setGoalAmount] = useState('30000')
  const { setProfile } = useAppStore()

  function addIncomeSource(): void {
    setIncomeSources([
      ...incomeSources,
      { name: '', amount: '', grossOrNet: 'net', isRecurring: true, frequency: 'monthly', nextBillingDate: today }
    ])
  }

  function removeIncomeSource(index: number): void {
    setIncomeSources(incomeSources.filter((_, i) => i !== index))
  }

  function updateIncomeSource(index: number, field: keyof IncomeSource, value: string | boolean): void {
    const updated = [...incomeSources]
    updated[index] = { ...updated[index], [field]: value }
    setIncomeSources(updated)
  }

  async function finish(): Promise<void> {
    setProfile({ name, currency: 'SEK', displayCurrency: 'SEK' })
    await window.api.settings.setProfile({
      name,
      currency: 'SEK',
      displayCurrency: 'SEK',
      year: new Date().getFullYear()
    })

    const accounts = (await window.api.accounts.list()) as {
      id: number
      name: string
      is_archived: number
      transaction_count?: number
    }[]
    const firstAccount = accounts.find((account) => account.is_archived !== 1)
    const parsedOpeningBalance = parseFloat(openingBalance)
    const openingBalanceValue = Number.isFinite(parsedOpeningBalance) ? parsedOpeningBalance : 0
    let accountId = firstAccount?.id

    if (firstAccount && (firstAccount.transaction_count ?? 0) === 0) {
      await window.api.accounts.update(firstAccount.id, {
        name: accountName.trim() || firstAccount.name || 'Main',
        type: accountType,
        currency: 'SEK',
        openingBalance: openingBalanceValue
      })
    } else if (!firstAccount) {
      const created = await window.api.accounts.create({
        name: accountName.trim() || 'Main',
        type: accountType,
        currency: 'SEK',
        openingBalance: openingBalanceValue
      })
      accountId = created.id
    }

    const now = new Date()
    for (const src of incomeSources) {
      const amount = Math.abs(parseFloat(src.amount))
      if (Number.isFinite(amount) && amount > 0) {
        const created = await window.api.income.createSource({
          name: src.name.trim() || 'Income',
          amount,
          isGross: src.grossOrNet === 'gross' ? 1 : 0,
          grossOrNet: src.grossOrNet,
          isRecurring: src.isRecurring,
          frequency: src.frequency,
          accountId,
          nextBillingDate: src.nextBillingDate || today
        })
        if (src.isRecurring) {
          await window.api.income.setEntry({
            sourceId: created.id,
            year: now.getFullYear(),
            month: now.getMonth() + 1,
            amount
          })
        }
      }
    }

    const colors = ['#ef4444', '#f97316', '#3b82f6', '#8b5cf6', '#22c55e']
    const catList = categories.split(',').map((s) => s.trim()).filter(Boolean)
    for (let i = 0; i < catList.length; i++) {
      const cat = catList[i]
      await window.api.categories.create({
        name: cat,
        color: colors[i % colors.length],
        icon: 'wallet',
        budgetAmount: 0
      })
    }
    await window.api.goals.create({
      name: goalName,
      type: 'savings',
      targetAmount: parseFloat(goalAmount) || 30000,
      currentAmount: 0
    })
    await window.api.settings.set('onboardingComplete', true)
    onComplete()
  }

  const Icon = steps[step].icon

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 p-4 backdrop-blur">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border bg-card p-8 shadow-xl"
      >
        <AnimatePresence mode="wait">
          <motion.div key={step} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <div className="mb-6 flex justify-center">
              <div className="rounded-full bg-primary/10 p-4">
                <Icon className="h-8 w-8 text-primary" />
              </div>
            </div>
            <h2 className="text-center text-2xl font-bold">{steps[step].title}</h2>
            <p className="mt-2 text-center text-sm text-muted-foreground leading-relaxed">{steps[step].desc}</p>
            <div className="mt-6 space-y-4">
              {step === 0 && (
                <div className="grid gap-2">
                  <Label>Your name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex" />
                </div>
              )}
              {step === 1 && (
                <div className="space-y-4">
                  <div className="grid gap-2">
                    <Label>Main account name</Label>
                    <Input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="Main" />
                  </div>
                  <div className="grid gap-2">
                    <Label>Account type</Label>
                    <select
                      value={accountType}
                      onChange={(e) => setAccountType(e.target.value as AccountType)}
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="checking">Checking</option>
                      <option value="savings">Savings</option>
                      <option value="cash">Cash</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Starting balance (SEK)</Label>
                    <Input
                      type="number"
                      value={openingBalance}
                      onChange={(e) => setOpeningBalance(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                </div>
              )}
              {step === 2 && (
                <div className="space-y-4">
                  {incomeSources.map((src, index) => (
                    <div key={index} className="rounded-lg border p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <Label>Income source {index + 1}</Label>
                        {incomeSources.length > 1 && (
                          <Button variant="ghost" size="icon" onClick={() => removeIncomeSource(index)} aria-label="Remove income source">
                            <Minus className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      <div className="grid gap-2">
                        <Label>Name</Label>
                        <Input
                          value={src.name}
                          onChange={(e) => updateIncomeSource(index, 'name', e.target.value)}
                          placeholder="Salary, Side job, etc."
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label>Monthly amount (SEK)</Label>
                        <Input
                          type="number"
                          value={src.amount}
                          onChange={(e) => updateIncomeSource(index, 'amount', e.target.value)}
                          placeholder="25000"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label>Next income date</Label>
                        <Input
                          type="date"
                          value={src.nextBillingDate}
                          onChange={(e) => updateIncomeSource(index, 'nextBillingDate', e.target.value)}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <Label className="text-sm">Is this gross or net salary?</Label>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant={src.grossOrNet === 'gross' ? 'default' : 'outline'}
                          onClick={() => updateIncomeSource(index, 'grossOrNet', 'gross')}
                        >
                          Gross
                        </Button>
                        <Button
                          type="button"
                          variant={src.grossOrNet === 'net' ? 'default' : 'outline'}
                          onClick={() => updateIncomeSource(index, 'grossOrNet', 'net')}
                        >
                          Net
                        </Button>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id={`recurring-${index}`}
                          checked={src.isRecurring}
                          onChange={(e) => updateIncomeSource(index, 'isRecurring', e.target.checked)}
                          className="h-4 w-4"
                        />
                        <Label htmlFor={`recurring-${index}`} className="text-sm">
                          Is this salary recurring?
                        </Label>
                      </div>
                      {src.isRecurring && (
                        <div className="grid gap-2">
                          <Label className="text-sm">Frequency</Label>
                          <div className="flex flex-wrap gap-2">
                            {(['weekly', 'fortnightly', 'monthly', 'yearly'] as const).map((frequency) => (
                              <Button
                                key={frequency}
                                type="button"
                                size="sm"
                                variant={src.frequency === frequency ? 'default' : 'outline'}
                                onClick={() => updateIncomeSource(index, 'frequency', frequency)}
                              >
                                {frequency[0].toUpperCase() + frequency.slice(1)}
                              </Button>
                            ))}
                          </div>
                        </div>
                      )}
                      {!src.isRecurring && (
                        <p className="text-xs text-muted-foreground">
                          Non-recurring income is saved for its selected date and linked back to this source.
                        </p>
                      )}
                    </div>
                  ))}
                  <Button variant="outline" onClick={addIncomeSource} className="w-full">
                    <Plus className="h-4 w-4 mr-2" />
                    Add another income source
                  </Button>
                </div>
              )}
              {step === 3 && (
                <div className="grid gap-2">
                  <Label>Categories (comma-separated)</Label>
                  <Input value={categories} onChange={(e) => setCategories(e.target.value)} />
                </div>
              )}
              {step === 4 && (
                <>
                  <div className="grid gap-2">
                    <Label>Goal name</Label>
                    <Input value={goalName} onChange={(e) => setGoalName(e.target.value)} />
                  </div>
                  <div className="grid gap-2">
                    <Label>Target (SEK)</Label>
                    <Input type="number" value={goalAmount} onChange={(e) => setGoalAmount(e.target.value)} />
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </AnimatePresence>
        <div className="mt-8 flex justify-between">
          <Button variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>
            Back
          </Button>
          {step < steps.length - 1 ? (
            <Button onClick={() => setStep(step + 1)}>Continue</Button>
          ) : (
            <Button onClick={finish}>Get started</Button>
          )}
        </div>
        <div className="mt-4 flex justify-center gap-1">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 w-8 rounded-full ${i === step ? 'bg-primary' : 'bg-muted'}`}
            />
          ))}
        </div>
      </motion.div>
    </div>
  )
}
