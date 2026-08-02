import { useEffect, useState } from 'react'
import { AlertTriangle, CalendarDays, TrendingUp, WalletCards } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAppStore } from '@/store/app-store'
import { formatMoney } from '@/lib/utils'

interface CashFlowDay { date: string; balance: number; events: Array<{ label: string; amount: number; type: string }> }
interface FinancialAlert { severity: 'info' | 'warning' | 'critical'; title: string; detail: string }
interface ExpenseForecast { spent: number; projected: number; elapsedDays: number; daysInMonth: number }
interface SafeToSpend { available: number; perDay: number; daysRemaining: number; components: { expectedIncome: number; spent: number; reservedBudget: number; upcomingBills: number; savingsCommitments: number; debtMinimums: number } }

export function FinancialOverview(): JSX.Element | null {
  const { profile, selectedMonth, rates, refreshTrigger } = useAppStore()
  const [calendar, setCalendar] = useState<CashFlowDay[]>([])
  const [alerts, setAlerts] = useState<FinancialAlert[]>([])
  const [forecast, setForecast] = useState<ExpenseForecast | null>(null)
  const [safeToSpend, setSafeToSpend] = useState<SafeToSpend | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      window.api.planning.cashFlowCalendar(35),
      window.api.alerts.financial(profile.year, selectedMonth),
      window.api.planning.expenseForecast(profile.year, selectedMonth),
      window.api.planning.safeToSpend(profile.year, selectedMonth)
    ]).then(async ([days, alertRows, projection, safe]) => {
      if (cancelled) return
      const nextAlerts = alertRows as FinancialAlert[]
      setCalendar(days as CashFlowDay[])
      setAlerts(nextAlerts)
      setForecast(projection as ExpenseForecast)
      setSafeToSpend(safe as SafeToSpend)
      if (profile.notificationsEnabled && nextAlerts.length > 0) {
        const currentDate = new Date().toISOString().slice(0, 10)
        const lastDate = await window.api.settings.get('lastFinancialAlertDate')
        if (lastDate !== currentDate) {
          await window.api.notify(nextAlerts[0].title, nextAlerts[0].detail)
          await window.api.settings.set('lastFinancialAlertDate', currentDate)
        }
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [profile.year, profile.notificationsEnabled, selectedMonth, refreshTrigger])

  if (!forecast && calendar.length === 0 && alerts.length === 0) return null
  const activeDays = calendar.filter((day) => day.events.length > 0).slice(0, 8)

  return (
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><WalletCards className="h-4 w-4" /> Safe to spend</CardTitle></CardHeader>
        <CardContent>{safeToSpend && <><p className={`text-2xl font-semibold tabular-nums ${safeToSpend.available < 0 ? 'text-destructive' : 'text-success'}`}>{formatMoney(safeToSpend.available, profile.displayCurrency, rates)}</p><p className="text-sm text-muted-foreground">{formatMoney(safeToSpend.perDay, profile.displayCurrency, rates)} per day for {safeToSpend.daysRemaining} days after budgets, bills, savings, and debt minimums.</p></>}</CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><TrendingUp className="h-4 w-4" /> Expense forecast</CardTitle></CardHeader>
        <CardContent>{forecast && <><p className="text-2xl font-semibold tabular-nums">{formatMoney(forecast.projected, profile.displayCurrency, rates)}</p><p className="text-sm text-muted-foreground">Projected month-end from {formatMoney(forecast.spent, profile.displayCurrency, rates)} spent through day {forecast.elapsedDays}.</p></>}</CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4" /> Financial alerts</CardTitle></CardHeader>
        <CardContent className="space-y-2">{alerts.length === 0 ? <p className="text-sm text-muted-foreground">No active alerts.</p> : alerts.slice(0, 5).map((alert, index) => <div key={`${alert.title}-${index}`} className={`rounded border px-3 py-2 text-sm ${alert.severity === 'critical' ? 'border-destructive/40' : 'border-warning/40'}`}><p className="font-medium">{alert.title}</p><p className="text-xs text-muted-foreground">{alert.detail}</p></div>)}</CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CalendarDays className="h-4 w-4" /> Cash-flow calendar</CardTitle></CardHeader>
        <CardContent className="space-y-2">{activeDays.length === 0 ? <p className="text-sm text-muted-foreground">No scheduled cash flow in the next 35 days.</p> : activeDays.map((day) => <div key={day.date} className="flex items-start justify-between gap-3 text-sm"><div><p className="font-medium">{day.date}</p><p className="text-xs text-muted-foreground">{day.events.map((event) => event.label).join(', ')}</p></div><span className="shrink-0 tabular-nums">{formatMoney(day.balance, profile.displayCurrency, rates)}</span></div>)}</CardContent>
      </Card>
    </div>
  )
}
