import { useEffect, useMemo, useState } from 'react'
import { Calculator, Save, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { formatMoney, MONTH_NAMES } from '@/lib/utils'
import { calculateTaxReconciledYtd, parseOptionalTaxAmount } from '@/lib/tax'
import { useAppStore } from '@/store/app-store'

interface TaxEntry {
  id: number
  year: number
  month: number
  income_gross: number
  income_net_actual: number
  supposed_net_income: number
  updated_at?: string
}

interface TaxYearSettings {
  year: number
  expected_yearly_tax_owed: number | null
  updated_at?: string | null
}

function adjustmentLabel(difference: number): { label: string; className: string } {
  if (difference > 0) return { label: 'Expected refund', className: 'text-success' }
  if (difference < 0) return { label: 'Amount owed', className: 'text-destructive' }
  return { label: 'On target', className: 'text-muted-foreground' }
}

export function TaxEstimatorPage(): JSX.Element {
  const { profile, selectedMonth, rates } = useAppStore()
  const [entries, setEntries] = useState<TaxEntry[]>([])
  const [expectedYearlyTaxOwed, setExpectedYearlyTaxOwed] = useState('')
  const [yearSettingsLoaded, setYearSettingsLoaded] = useState(false)
  const [form, setForm] = useState({
    month: String(selectedMonth),
    incomeGross: '',
    incomeNetActual: '',
    supposedNetIncome: ''
  })

  useEffect(() => {
    load()
  }, [profile.year])

  const savedByMonth = useMemo(() => {
    const map = new Map<number, TaxEntry>()
    for (const entry of entries) map.set(entry.month, entry)
    return map
  }, [entries])

  const currentDifference = (Number.parseFloat(form.supposedNetIncome) || 0) - (Number.parseFloat(form.incomeNetActual) || 0)
  const currentAdjustment = adjustmentLabel(currentDifference)
  const yearlyDifference = entries.reduce(
    (sum, entry) => sum + entry.supposed_net_income - entry.income_net_actual,
    0
  )
  const expectedYearlyTaxAmount = parseOptionalTaxAmount(expectedYearlyTaxOwed)
  const hasExpectedYearlyTax = expectedYearlyTaxOwed.trim() !== '' && expectedYearlyTaxAmount !== null
  const reconciledYearlyDifference = calculateTaxReconciledYtd(
    yearlyDifference,
    hasExpectedYearlyTax ? expectedYearlyTaxAmount : null
  )
  const yearlyAdjustment = adjustmentLabel(reconciledYearlyDifference)

  function formatSignedMoney(amount: number): string {
    if (amount === 0) return formatMoney(0, profile.displayCurrency, rates)
    const sign = amount > 0 ? '+' : '-'
    return `${sign}${formatMoney(Math.abs(amount), profile.displayCurrency, rates)}`
  }

  async function load(): Promise<void> {
    setYearSettingsLoaded(false)
    const [rows, settings] = await Promise.all([
      window.api.tax.list(profile.year),
      window.api.tax.getYearSettings(profile.year)
    ])
    setEntries(rows as TaxEntry[])
    const yearSettings = settings as TaxYearSettings
    setExpectedYearlyTaxOwed(
      yearSettings.expected_yearly_tax_owed == null ? '' : String(yearSettings.expected_yearly_tax_owed)
    )
    setYearSettingsLoaded(true)
  }

  useEffect(() => {
    if (!yearSettingsLoaded) return
    const handle = window.setTimeout(() => {
      window.api.tax.setYearSettings({
        year: profile.year,
        expectedYearlyTaxOwed: parseOptionalTaxAmount(expectedYearlyTaxOwed)
      }).catch(() => {})
    }, 250)
    return () => window.clearTimeout(handle)
  }, [expectedYearlyTaxOwed, profile.year, yearSettingsLoaded])

  function loadMonth(month: string): void {
    const parsedMonth = Number.parseInt(month)
    const saved = savedByMonth.get(parsedMonth)
    setForm({
      month,
      incomeGross: saved ? String(saved.income_gross) : '',
      incomeNetActual: saved ? String(saved.income_net_actual) : '',
      supposedNetIncome: saved ? String(saved.supposed_net_income) : ''
    })
  }

  async function saveEntry(): Promise<void> {
    await window.api.tax.setEntry({
      year: profile.year,
      month: Number.parseInt(form.month),
      incomeGross: Number.parseFloat(form.incomeGross) || 0,
      incomeNetActual: Number.parseFloat(form.incomeNetActual) || 0,
      supposedNetIncome: Number.parseFloat(form.supposedNetIncome) || 0
    })
    await load()
  }

  async function deleteEntry(month: number): Promise<void> {
    await window.api.tax.deleteEntry(profile.year, month)
    await load()
    if (Number.parseInt(form.month) === month) {
      setForm({
        month: String(month),
        incomeGross: '',
        incomeNetActual: '',
        supposedNetIncome: ''
      })
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Calculator className="h-6 w-6" />
          Tax estimator
        </h1>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader>
            <CardTitle>Monthly entry</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-4">
            <div className="grid gap-2">
              <Label>Choose month</Label>
              <Select value={form.month} onValueChange={loadMonth}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTH_NAMES.map((month, index) => (
                    <SelectItem key={month} value={String(index + 1)}>
                      {month}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Income Gross</Label>
              <Input
                type="number"
                value={form.incomeGross}
                onChange={(event) => setForm({ ...form, incomeGross: event.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label>Income Net (actual)</Label>
              <Input
                type="number"
                value={form.incomeNetActual}
                onChange={(event) => setForm({ ...form, incomeNetActual: event.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label>Supposed Net Income</Label>
              <Input
                type="number"
                value={form.supposedNetIncome}
                onChange={(event) => setForm({ ...form, supposedNetIncome: event.target.value })}
              />
            </div>
            <div className="md:col-span-4">
              <Button onClick={saveEntry}>
                <Save className="h-4 w-4" />
                Save month
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>This month</CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-bold ${currentAdjustment.className}`}>
              {formatMoney(Math.abs(currentDifference), profile.displayCurrency, rates)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{currentAdjustment.label}</p>
            <div className="mt-4 border-t pt-4">
              {hasExpectedYearlyTax ? (
                <>
                  <p className="text-sm text-muted-foreground">Year-to-date (before reconciliation)</p>
                  <p className="text-lg font-semibold">
                    {formatSignedMoney(yearlyDifference)}
                  </p>
                  <p className="mt-3 text-sm text-muted-foreground">Year-to-date (reconciled)</p>
                  <p className={`text-xl font-bold ${yearlyAdjustment.className}`}>
                    {formatSignedMoney(reconciledYearlyDifference)}
                  </p>
                  <p className="text-sm text-muted-foreground">{yearlyAdjustment.label}</p>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">Year to date total</p>
                  <p className={`text-xl font-bold ${yearlyAdjustment.className}`}>
                    {formatMoney(Math.abs(yearlyDifference), profile.displayCurrency, rates)}
                  </p>
                  <p className="text-sm text-muted-foreground">{yearlyAdjustment.label}</p>
                </>
              )}
            </div>
            <div className="mt-4 border-t pt-4">
              <div className="grid gap-2">
                <Label htmlFor="expected-yearly-tax-owed">Expected Yearly Tax Owed (optional)</Label>
                <Input
                  id="expected-yearly-tax-owed"
                  type="number"
                  value={expectedYearlyTaxOwed}
                  onChange={(event) => setExpectedYearlyTaxOwed(event.target.value)}
                  placeholder="Leave blank for raw YTD"
                />
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                This is subtracted from your year-to-date total immediately in full, not spread
                across months. Entering or changing this number will update your total right away.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{profile.year} entries</CardTitle>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tax estimates saved for this year.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-3">Month</th>
                    <th className="py-2 pr-3">Income Gross</th>
                    <th className="py-2 pr-3">Income Net (actual)</th>
                    <th className="py-2 pr-3">Supposed Net Income</th>
                    <th className="py-2 pr-3">Result</th>
                    <th className="py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => {
                    const difference = entry.supposed_net_income - entry.income_net_actual
                    const adjustment = adjustmentLabel(difference)
                    return (
                      <tr key={entry.id} className="border-t">
                        <td className="py-3 pr-3">{MONTH_NAMES[entry.month - 1]}</td>
                        <td className="py-3 pr-3">{formatMoney(entry.income_gross, profile.displayCurrency, rates)}</td>
                        <td className="py-3 pr-3">{formatMoney(entry.income_net_actual, profile.displayCurrency, rates)}</td>
                        <td className="py-3 pr-3">{formatMoney(entry.supposed_net_income, profile.displayCurrency, rates)}</td>
                        <td className={`py-3 pr-3 font-medium ${adjustment.className}`}>
                          {adjustment.label}: {formatMoney(Math.abs(difference), profile.displayCurrency, rates)}
                        </td>
                        <td className="py-3 text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Delete ${MONTH_NAMES[entry.month - 1]} tax estimate`}
                            onClick={() => deleteEntry(entry.month)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
