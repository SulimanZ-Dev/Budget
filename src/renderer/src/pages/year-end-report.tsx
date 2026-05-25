import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAppStore } from '@/store/app-store'
import { formatMoney, MONTH_NAMES } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Printer } from 'lucide-react'

interface YearReport {
  year: number
  profile: { name: string }
  monthly: { month: number; expenses: number; income: number }[]
  totalExpenses: number
  totalIncome: number
  netSavings: number
  savingsRate: number
  topCategories: { name: string; color: string; total: number }[]
  goals: { name: string; type: string; current_amount: number; target_amount: number }[]
  subscriptionMonthly: number
  transactionCount: number
  netWorth: number
  streak: { current: number; longest: number }
}

export function YearEndReportPage(): JSX.Element {
  const { profile, rates } = useAppStore()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const autoPrint = params.get('print') === '1'
  const [report, setReport] = useState<YearReport | null>(null)

  useEffect(() => {
    window.api.reports.yearSummary(profile.year).then((r) => setReport(r as YearReport))
  }, [profile.year])

  useEffect(() => {
    if (autoPrint && report) {
      const t = setTimeout(() => window.api.print.yearSummary(), 800)
      return () => clearTimeout(t)
    }
  }, [autoPrint, report])

  if (!report) {
    return <div className="p-8 text-center text-muted-foreground">Preparing report...</div>
  }

  return (
    <div className="min-h-screen bg-white text-black print:p-8 dark:bg-background dark:text-foreground">
      <div className="mx-auto max-w-3xl p-8 print:max-w-none">
        <div className="mb-8 flex items-center justify-between print:hidden">
          <Button variant="ghost" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <Button onClick={() => window.api.print.yearSummary()}>
            <Printer className="h-4 w-4" />
            Print / Save PDF
          </Button>
        </div>

        <header className="border-b pb-6 mb-8">
          <p className="text-sm text-muted-foreground uppercase tracking-widest">Year in review</p>
          <h1 className="text-4xl font-bold mt-2">
            {report.profile.name ? `${report.profile.name}'s` : 'Your'} {report.year} Budget
          </h1>
          <p className="text-muted-foreground mt-2">Generated {new Date().toLocaleDateString('sv-SE')}</p>
        </header>

        <section className="grid grid-cols-2 gap-6 mb-10 sm:grid-cols-4">
          <Stat label="Total income" value={formatMoney(report.totalIncome, profile.displayCurrency, rates)} />
          <Stat label="Total expenses" value={formatMoney(report.totalExpenses, profile.displayCurrency, rates)} />
          <Stat
            label="Net savings"
            value={formatMoney(report.netSavings, profile.displayCurrency, rates)}
            highlight={report.netSavings >= 0 ? 'success' : 'danger'}
          />
          <Stat label="Savings rate" value={`${report.savingsRate.toFixed(1)}%`} />
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">Monthly overview</h2>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2">Month</th>
                <th className="text-right py-2">Income</th>
                <th className="text-right py-2">Expenses</th>
                <th className="text-right py-2">Net</th>
              </tr>
            </thead>
            <tbody>
              {report.monthly.map((m) => (
                <tr key={m.month} className="border-b border-muted/30">
                  <td className="py-2">{MONTH_NAMES[m.month - 1]}</td>
                  <td className="text-right py-2 tabular-nums">
                    {formatMoney(m.income, profile.displayCurrency, rates)}
                  </td>
                  <td className="text-right py-2 tabular-nums">
                    {formatMoney(m.expenses, profile.displayCurrency, rates)}
                  </td>
                  <td
                    className={`text-right py-2 tabular-nums font-medium ${
                      m.income - m.expenses >= 0 ? 'text-green-700' : 'text-red-700'
                    }`}
                  >
                    {formatMoney(m.income - m.expenses, profile.displayCurrency, rates)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">Top spending categories</h2>
          <ul className="space-y-2">
            {report.topCategories.map((c) => (
              <li key={c.name} className="flex justify-between text-sm">
                <span className="font-medium" style={{ color: c.color }}>
                  {c.name}
                </span>
                <span className="tabular-nums">
                  {formatMoney(c.total, profile.displayCurrency, rates)}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {report.goals.length > 0 && (
          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">Goals progress</h2>
            <ul className="space-y-3">
              {report.goals.map((g) => {
                const pct = g.target_amount > 0 ? (g.current_amount / g.target_amount) * 100 : 0
                return (
                  <li key={g.name} className="text-sm">
                    <div className="flex justify-between mb-1">
                      <span className="font-medium">{g.name}</span>
                      <span>{pct.toFixed(0)}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full"
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        <section className="grid grid-cols-2 gap-4 text-sm text-muted-foreground border-t pt-6">
          <p>Transactions logged: {report.transactionCount}</p>
          <p>Tracking streak: {report.streak.current} days (best {report.streak.longest})</p>
          <p>
            Subscriptions:{' '}
            {formatMoney(report.subscriptionMonthly, profile.displayCurrency, rates)}/mo
          </p>
          <p>
            Net worth (latest):{' '}
            {formatMoney(report.netWorth, profile.displayCurrency, rates)}
          </p>
        </section>
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  highlight
}: {
  label: string
  value: string
  highlight?: 'success' | 'danger'
}): JSX.Element {
  const color =
    highlight === 'success'
      ? 'text-green-600'
      : highlight === 'danger'
        ? 'text-red-600'
        : ''
  return (
    <div>
      <p className="text-xs text-muted-foreground uppercase">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
    </div>
  )
}
