import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { useAppStore } from '@/store/app-store'
import { formatMoney } from '@/lib/utils'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts'
import { MONTH_NAMES } from '@/lib/utils'
import { AskAiButton } from '@/components/shared/ask-ai-button'

export function IncomePage(): JSX.Element {
  const { profile, rates, setProfile } = useAppStore()
  const [sources, setSources] = useState<{ id: number; name: string; amount: number; color: string }[]>([])
  const [entries, setEntries] = useState<
    { source_id: number; source_name: string; month: number; amount: number; is_irregular: number; color: string }[]
  >([])

  useEffect(() => {
    load()
  }, [profile.year])

  async function load(): Promise<void> {
    setSources(await window.api.income.sources())
    setEntries(await window.api.income.entries(profile.year))
  }

  const chartData = MONTH_NAMES.map((name, i) => {
    const month = i + 1
    const row: Record<string, string | number> = { month: name.slice(0, 3) }
    for (const src of sources) {
      const e = entries.find((en) => en.source_id === src.id && en.month === month)
      row[src.name] = e?.amount ?? 0
    }
    return row
  })

  const totalAnnual = entries.reduce((s, e) => s + e.amount, 0)
  const grossMultiplier = profile.grossIncomeToggle ? 1 / (1 - profile.taxWithheldPercent / 100) : 1
  const estimatedTax = totalAnnual * (profile.taxWithheldPercent / 100)
  const takeHome = totalAnnual - estimatedTax

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Income</h1>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              checked={profile.grossIncomeToggle}
              onCheckedChange={(v) => {
                setProfile({ grossIncomeToggle: v })
                window.api.settings.setProfile({ ...profile, grossIncomeToggle: v })
              }}
            />
            <Label>Gross vs net</Label>
          </div>
          <AskAiButton context="income" />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Total income ({profile.year})</p>
            <p className="text-2xl font-bold">
              {formatMoney(totalAnnual * grossMultiplier, profile.displayCurrency, rates)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tax estimator</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <p>
              Withheld ({profile.taxWithheldPercent}%):{' '}
              <span className="font-medium">{formatMoney(estimatedTax, profile.displayCurrency, rates)}</span>
            </p>
            <p>
              Take-home:{' '}
              <span className="font-medium text-success">
                {formatMoney(takeHome, profile.displayCurrency, rates)}
              </span>
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Income by stream</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {sources.map((src) => {
            const total = entries.filter((e) => e.source_id === src.id).reduce((s, e) => s + e.amount, 0)
            const pct = totalAnnual > 0 ? (total / totalAnnual) * 100 : 0
            return (
              <div key={src.id} className="flex items-center justify-between rounded-lg border p-4">
                <div className="flex items-center gap-3">
                  <div className="h-3 w-3 rounded-full" style={{ backgroundColor: src.color }} />
                  <span className="font-medium">{src.name}</span>
                </div>
                <div className="text-right">
                  <p className="font-bold">{formatMoney(total, profile.displayCurrency, rates)}</p>
                  <p className="text-xs text-muted-foreground">{pct.toFixed(0)}% of total</p>
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Monthly income trend</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <XAxis dataKey="month" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip />
              <Legend />
              {sources.map((s) => (
                <Bar key={s.id} dataKey={s.name} stackId="a" fill={s.color} radius={[0, 0, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  )
}
