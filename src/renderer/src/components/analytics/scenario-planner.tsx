import { useEffect, useState } from 'react'
import { FlaskConical } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAppStore } from '@/store/app-store'
import { formatMoney } from '@/lib/utils'

interface ScenarioResult { baseline: { income: number; expenses: number; net: number }; scenario: { income: number; expenses: number; net: number } }
interface ScenarioEvent { date: string; type: 'income' | 'expense' | 'debt' | 'one-time'; amount: number; label: string }
interface SavedScenario { id: number; name: string; events: ScenarioEvent[] }
interface ProjectionRow { period: string; income: number; expenses: number; net: number; balance: number; events: ScenarioEvent[] }

export function ScenarioPlanner(): JSX.Element {
  const { profile, rates } = useAppStore()
  const [incomeChange, setIncomeChange] = useState('0')
  const [expenseChange, setExpenseChange] = useState('0')
  const [recurringIncrease, setRecurringIncrease] = useState('0')
  const [result, setResult] = useState<ScenarioResult | null>(null)
  const [saved, setSaved] = useState<SavedScenario[]>([])
  const [scenarioId, setScenarioId] = useState('')
  const [name, setName] = useState('')
  const [events, setEvents] = useState<ScenarioEvent[]>([])
  const [draft, setDraft] = useState({ label: '', date: new Date().toISOString().slice(0, 7) + '-01', type: 'expense' as ScenarioEvent['type'], amount: '' })
  const [projection, setProjection] = useState<ProjectionRow[]>([])

  useEffect(() => {
    const timer = setTimeout(() => window.api.planning.scenario({ incomeChangePercent: Number(incomeChange) || 0, expenseChangePercent: Number(expenseChange) || 0, recurringIncrease: Number(recurringIncrease) || 0 }).then((value) => setResult(value as ScenarioResult)), 200)
    return () => clearTimeout(timer)
  }, [incomeChange, expenseChange, recurringIncrease])

  useEffect(() => { window.api.scenarios.list().then((rows) => setSaved(rows as SavedScenario[])) }, [])
  useEffect(() => {
    const timer = setTimeout(() => window.api.scenarios.project(events).then((rows) => setProjection(rows as ProjectionRow[])), 150)
    return () => clearTimeout(timer)
  }, [events])

  function loadScenario(id: string): void {
    setScenarioId(id)
    const scenario = saved.find((item) => String(item.id) === id)
    if (!scenario) return
    setName(scenario.name)
    setEvents(scenario.events)
  }

  async function saveScenario(): Promise<void> {
    const result = await window.api.scenarios.save({ id: scenarioId ? Number(scenarioId) : undefined, name, events }) as { id: number }
    const rows = await window.api.scenarios.list() as SavedScenario[]
    setSaved(rows)
    setScenarioId(String(result.id))
  }

  function addEvent(): void {
    const amount = Number(draft.amount)
    if (!draft.label.trim() || !draft.date || amount <= 0) return
    setEvents((current) => [...current, { label: draft.label.trim(), date: draft.date, type: draft.type, amount }])
    setDraft((current) => ({ ...current, label: '', amount: '' }))
  }

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
        <div className="border-t pt-4">
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <div className="min-w-40 flex-1"><Label>Saved timeline</Label><Select value={scenarioId} onValueChange={loadScenario}><SelectTrigger><SelectValue placeholder="New scenario" /></SelectTrigger><SelectContent>{saved.map((scenario) => <SelectItem key={scenario.id} value={String(scenario.id)}>{scenario.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="min-w-40 flex-1"><Label>Name</Label><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Move in October" /></div>
            <Button onClick={saveScenario} disabled={!name.trim()}>Save scenario</Button>
            <Button variant="ghost" disabled={!scenarioId} onClick={async () => { await window.api.scenarios.delete(Number(scenarioId)); setSaved(await window.api.scenarios.list() as SavedScenario[]); setScenarioId(''); setName(''); setEvents([]) }}>Delete</Button>
          </div>
          <div className="grid gap-2 md:grid-cols-[1fr_150px_140px_140px_auto]">
            <Input value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} placeholder="New salary, car, move..." />
            <Input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} />
            <Select value={draft.type} onValueChange={(type: ScenarioEvent['type']) => setDraft({ ...draft, type })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="income">Income</SelectItem><SelectItem value="expense">Expense</SelectItem><SelectItem value="debt">Debt payoff</SelectItem><SelectItem value="one-time">One-time purchase</SelectItem></SelectContent></Select>
            <Input type="number" min="0" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} placeholder="Amount" />
            <Button variant="outline" onClick={addEvent}>Add event</Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Income and expense changes continue from their start date. Debt payoff and one-time purchases affect only the selected month.</p>
          {events.length > 0 && <div className="mt-3 space-y-1">{events.map((event, index) => <div key={`${event.date}-${event.label}-${index}`} className="flex items-center justify-between rounded border px-3 py-2 text-sm"><span>{event.date} · {event.label} · {event.type} · {formatMoney(event.amount, profile.displayCurrency, rates)}</span><Button variant="ghost" size="sm" onClick={() => setEvents((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</Button></div>)}</div>}
          {projection.length > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-3"><div className="rounded border p-3"><p className="text-xs text-muted-foreground">12-month projected balance</p><p className={`font-semibold ${projection.at(-1)!.balance < 0 ? 'text-destructive' : 'text-success'}`}>{formatMoney(projection.at(-1)!.balance, profile.displayCurrency, rates)}</p></div><div className="rounded border p-3"><p className="text-xs text-muted-foreground">Lowest monthly net</p><p className="font-semibold">{formatMoney(Math.min(...projection.map((row) => row.net)), profile.displayCurrency, rates)}</p></div><div className="rounded border p-3"><p className="text-xs text-muted-foreground">Timeline events</p><p className="font-semibold">{events.length}</p></div></div>}
        </div>
      </CardContent>
    </Card>
  )
}
