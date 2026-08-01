import { useEffect, useState } from 'react'
import { FlaskConical } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAppStore } from '@/store/app-store'
import { formatMoney } from '@/lib/utils'

interface ScenarioResult { baseline: { income: number; expenses: number; net: number }; scenario: { income: number; expenses: number; net: number } }

export function ScenarioPlanner(): JSX.Element {
  const { profile, rates } = useAppStore()
  const [incomeChange, setIncomeChange] = useState('0')
  const [expenseChange, setExpenseChange] = useState('0')
  const [recurringIncrease, setRecurringIncrease] = useState('0')
  const [result, setResult] = useState<ScenarioResult | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => window.api.planning.scenario({ incomeChangePercent: Number(incomeChange) || 0, expenseChangePercent: Number(expenseChange) || 0, recurringIncrease: Number(recurringIncrease) || 0 }).then((value) => setResult(value as ScenarioResult)), 200)
    return () => clearTimeout(timer)
  }, [incomeChange, expenseChange, recurringIncrease])

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><FlaskConical className="h-4 w-4" /> Scenario planner</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1"><Label>Income change (%)</Label><Input type="number" value={incomeChange} onChange={(event) => setIncomeChange(event.target.value)} /></div>
          <div className="grid gap-1"><Label>Expense change (%)</Label><Input type="number" value={expenseChange} onChange={(event) => setExpenseChange(event.target.value)} /></div>
          <div className="grid gap-1"><Label>Recurring increase / month</Label><Input type="number" value={recurringIncrease} onChange={(event) => setRecurringIncrease(event.target.value)} /></div>
        </div>
        {result && <div className="grid gap-3 sm:grid-cols-2"><div className="rounded border p-3"><p className="text-xs text-muted-foreground">Current monthly average</p><p className="text-lg font-semibold">{formatMoney(result.baseline.net, profile.displayCurrency, rates)} net</p></div><div className="rounded border p-3"><p className="text-xs text-muted-foreground">Scenario</p><p className={`text-lg font-semibold ${result.scenario.net < 0 ? 'text-destructive' : 'text-success'}`}>{formatMoney(result.scenario.net, profile.displayCurrency, rates)} net</p></div></div>}
      </CardContent>
    </Card>
  )
}
