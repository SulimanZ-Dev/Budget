import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { useAppStore } from '@/store/app-store'
import { formatMoney, MONTH_NAMES } from '@/lib/utils'

interface Suggestion { category_id: number; name: string; average: number; suggested: number }
interface Rollover { category_id: number; name: string; enabled: number; rollover: number }

export function BudgetPlanningTools({ onRefresh }: { onRefresh: () => void }): JSX.Element {
  const { profile, selectedMonth, rates } = useAppStore()
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [rollovers, setRollovers] = useState<Rollover[]>([])
  const target = selectedMonth === 12 ? { year: profile.year + 1, month: 1 } : { year: profile.year, month: selectedMonth + 1 }

  async function load(): Promise<void> {
    const [suggestionRows, rolloverRows] = await Promise.all([
      window.api.planning.budgetSuggestions(target.year, target.month),
      window.api.budget.getRollover(profile.year, selectedMonth)
    ])
    setSuggestions(suggestionRows as Suggestion[])
    setRollovers(rolloverRows as Rollover[])
  }

  useEffect(() => { load() }, [profile.year, selectedMonth])

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4" /> Budget suggestion for {MONTH_NAMES[target.month - 1]} {target.year}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {suggestions.length === 0 ? <p className="text-sm text-muted-foreground">More spending history is needed.</p> : <>
            <div className="max-h-40 space-y-2 overflow-auto">{suggestions.map((item) => <div key={item.category_id} className="flex justify-between text-sm"><span>{item.name}</span><span className="tabular-nums">{formatMoney(item.suggested, profile.displayCurrency, rates)}</span></div>)}</div>
            <Button size="sm" onClick={async () => { await window.api.budget.applySuggestions(target.year, target.month, suggestions.map((item) => ({ categoryId: item.category_id, amount: item.suggested }))); onRefresh() }}>Apply suggestions</Button>
          </>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Budget rollover</CardTitle></CardHeader>
        <CardContent className="max-h-56 space-y-2 overflow-auto">
          {rollovers.map((item) => <div key={item.category_id} className="flex items-center justify-between gap-3 text-sm"><div><p>{item.name}</p><p className="text-xs text-muted-foreground">Available: {formatMoney(item.rollover, profile.displayCurrency, rates)}</p></div><Switch checked={item.enabled === 1} onCheckedChange={async (enabled) => { await window.api.budget.setRollover(item.category_id, enabled); await load(); onRefresh() }} /></div>)}
        </CardContent>
      </Card>
    </div>
  )
}
