import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAppStore } from '@/store/app-store'
import { Wallet, Target, Banknote, User, Plus, Minus } from 'lucide-react'

const steps = [
  { icon: User, title: 'Welcome', desc: 'Let\'s set up your personal budget in a few steps.' },
  { icon: Banknote, title: 'Income Sources', desc: 'Add all your income sources.' },
  { icon: Wallet, title: 'Budget', desc: 'Create your first spending categories.' },
  { icon: Target, title: 'Goals', desc: 'Set a savings goal to stay motivated.' }
]

interface IncomeSource {
  name: string
  amount: string
  grossOrNet: 'gross' | 'net'
  isRecurring: boolean
  frequency: 'weekly' | 'fortnightly' | 'monthly' | 'yearly'
}

export function OnboardingFlow({ onComplete }: { onComplete: () => void }): JSX.Element {
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [incomeSources, setIncomeSources] = useState<IncomeSource[]>([
    { name: 'Salary', amount: '', grossOrNet: 'net', isRecurring: true, frequency: 'monthly' }
  ])
  const [categories, setCategories] = useState('Food, Transport, Housing, Entertainment')
  const [goalName, setGoalName] = useState('Emergency fund')
  const [goalAmount, setGoalAmount] = useState('30000')
  const { setProfile } = useAppStore()

  function addIncomeSource(): void {
    setIncomeSources([
      ...incomeSources,
      { name: '', amount: '', grossOrNet: 'net', isRecurring: true, frequency: 'monthly' }
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

    // Create income sources and entries
    const now = new Date()
    for (const src of incomeSources) {
      if (src.amount) {
        const created = await window.api.income.createSource({
          name: src.name,
          amount: parseFloat(src.amount),
          isGross: src.grossOrNet === 'gross' ? 1 : 0,
          grossOrNet: src.grossOrNet,
          isRecurring: src.isRecurring,
          frequency: src.frequency
        })
        await window.api.income.setEntry({
          sourceId: created.id,
          year: now.getFullYear(),
          month: now.getMonth() + 1,
          amount: parseFloat(src.amount)
        })
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-xl"
      >
        <AnimatePresence mode="wait">
          <motion.div key={step} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <div className="mb-6 flex justify-center">
              <div className="rounded-full bg-primary/10 p-4">
                <Icon className="h-8 w-8 text-primary" />
              </div>
            </div>
            <h2 className="text-center text-2xl font-bold">{steps[step].title}</h2>
            <p className="mt-2 text-center text-muted-foreground">{steps[step].desc}</p>
            <div className="mt-6 space-y-4">
              {step === 0 && (
                <div className="grid gap-2">
                  <Label>Your name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex" />
                </div>
              )}
              {step === 1 && (
                <div className="space-y-4">
                  {incomeSources.map((src, index) => (
                    <div key={index} className="rounded-lg border p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <Label>Income source {index + 1}</Label>
                        {incomeSources.length > 1 && (
                          <Button variant="ghost" size="icon" onClick={() => removeIncomeSource(index)}>
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
                          Non-recurring income is saved but does not count toward monthly baseline.
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
              {step === 2 && (
                <div className="grid gap-2">
                  <Label>Categories (comma-separated)</Label>
                  <Input value={categories} onChange={(e) => setCategories(e.target.value)} />
                </div>
              )}
              {step === 3 && (
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
