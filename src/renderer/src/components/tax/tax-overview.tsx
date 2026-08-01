import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAppStore } from '@/store/app-store'
import { formatMoney } from '@/lib/utils'

interface TaxOverviewData { grossIncome: number; netIncome: number; withheld: number; deductibleExpenses: number; expectedTax: number | null; difference: number | null }

export function TaxOverview(): JSX.Element | null {
  const { profile, rates, refreshTrigger } = useAppStore()
  const [overview, setOverview] = useState<TaxOverviewData | null>(null)
  useEffect(() => { window.api.tax.overview(profile.year).then((value) => setOverview(value as TaxOverviewData)) }, [profile.year, refreshTrigger])
  if (!overview) return null
  const items = [
    ['Gross income', overview.grossIncome], ['Net income', overview.netIncome],
    ['Tax withheld', overview.withheld], ['Deductible expenses', overview.deductibleExpenses]
  ] as const
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Yearly tax overview</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">{items.map(([label, value]) => <div key={label} className="rounded border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="font-semibold tabular-nums">{formatMoney(value, profile.displayCurrency, rates)}</p></div>)}</div>
        <p className="text-sm text-muted-foreground">{overview.expectedTax == null ? 'Set expected yearly tax owed below to enable reconciliation.' : `Expected yearly tax: ${formatMoney(overview.expectedTax, profile.displayCurrency, rates)} · ${overview.difference! >= 0 ? 'estimated overpayment' : 'estimated amount remaining'} ${formatMoney(Math.abs(overview.difference!), profile.displayCurrency, rates)}`}</p>
      </CardContent>
    </Card>
  )
}
