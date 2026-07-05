import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useAppStore, type DisplayCurrency } from '@/store/app-store'
import { SUPPORTED_LOCALES, LOCALE_LABELS, type AppLocale } from '@/lib/utils'
import { Download, Upload, Trash2, Key, Printer, Lock, RotateCcw, Play } from 'lucide-react'
import { InfoTooltip } from '@/components/shared/info-tooltip'
import { IntegrityPanel } from '@/components/integrity/integrity-panel'
import { PluginRegistry } from '@/components/plugins/plugin-registry'
import { SchedulerCard } from '@/components/shared/scheduler-card'
import { RuleEditor } from '@/components/shared/rule-editor'
import { useAppDialog } from '@/components/shared/app-dialog'

interface DemoResult {
  subscriptions: number
  transactions: number
  goals: number
  incomeSources: number
  savingsSources: number
  budgetEntries: number
  wealthSnapshots: number
  holdings: number
  investments: number
  rules: number
  moods: number
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function pick<T>(items: T[]): T {
  return items[randomInt(0, items.length - 1)]
}

function randomDateWithinMonths(monthsBack: number): string {
  const date = new Date()
  date.setDate(date.getDate() - randomInt(0, monthsBack * 30))
  return date.toISOString().slice(0, 10)
}

function randomFutureDateWithinMonths(monthsAhead: number): string {
  const date = new Date()
  date.setDate(date.getDate() + randomInt(30, monthsAhead * 30))
  return date.toISOString().slice(0, 10)
}

function dateMonthsAgo(monthsBack: number, day = 15): string {
  const date = new Date()
  date.setMonth(date.getMonth() - monthsBack)
  date.setDate(Math.min(day, 28))
  return date.toISOString().slice(0, 10)
}

export function SettingsPage(): JSX.Element {
  const { profile, setProfile, selectedMonth, triggerRefresh } = useAppStore()
  const dialog = useAppDialog()
  const [apiKey, setApiKey] = useState('')
  const [members, setMembers] = useState<{ id: number; name: string }[]>([])
  const [newMember, setNewMember] = useState('')
  const [saved, setSaved] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changePasswordError, setChangePasswordError] = useState('')
  const [changePasswordSuccess, setChangePasswordSuccess] = useState(false)
  const [changePasswordLoading, setChangePasswordLoading] = useState(false)
  const [appVersion, setAppVersion] = useState('')
  const [lastBackup, setLastBackup] = useState<string | null>(null)

  useEffect(() => {
    window.api.members.list().then(setMembers)
    window.api.getVersion().then(setAppVersion)
    window.api.settings.get('lastDbBackup').then((v: string | null) => setLastBackup(v))
  }, [])

  async function handleExportBackup(): Promise<void> {
    await window.api.data.exportDb()
    const now = new Date().toISOString().slice(0, 10)
    await window.api.settings.set('lastDbBackup', now)
    setLastBackup(now)
  }

  async function generateDemoData(): Promise<DemoResult> {
    const categories = await window.api.categories.list() as { id: number; name: string }[]
    const expenseCategories = categories.length > 0 ? categories : [{ id: undefined as unknown as number, name: 'Demo' }]
    const currentYear = profile.year
    const currentMonth = selectedMonth ?? new Date().getMonth() + 1
    const subscriptions = ['Netflix', 'Spotify', 'Gym', 'Rent', 'Phone Plan', 'Cloud Storage', 'Transit Pass', 'Meal Kit']
    const merchants = [
      'ICA groceries',
      'Coop market',
      'Espresso House',
      'Apotek purchase',
      'Train ticket',
      'Bookstore',
      'Hardware store',
      'Lunch cafe',
      'Electric bill',
      'Freelance invoice'
    ]
    const goalNames = ['Vacation fund', 'New laptop', 'Emergency boost', 'Moving fund']
    const incomeNames = ['Salary', 'Consulting retainer', 'Side project', 'Quarterly bonus']
    const savingsNames = ['Emergency fund transfer', 'Index fund auto-save', 'Holiday account', 'Apartment deposit']
    const holdings = [
      { etfName: 'Global Index ETF', ticker: 'GLOBAL' },
      { etfName: 'Nordic Dividend Fund', ticker: 'NORD' },
      { etfName: 'Green Bonds ETF', ticker: 'GREEN' }
    ]
    const legacyInvestments = ['Company RSU plan', 'Robo-advisor account', 'Education fund']
    const rulePatterns = [
      { pattern: 'ICA', category: expenseCategories.find((c) => /food|grocer|market/i.test(c.name)) ?? pick(expenseCategories) },
      { pattern: 'Espresso', category: expenseCategories.find((c) => /food|dining|coffee/i.test(c.name)) ?? pick(expenseCategories) },
      { pattern: 'Train', category: expenseCategories.find((c) => /transport|travel/i.test(c.name)) ?? pick(expenseCategories) }
    ]
    const subCount = randomInt(5, 8)
    const txCount = randomInt(60, 90)
    const goalCount = randomInt(3, 5)
    const incomeSourceCount = randomInt(2, 3)
    const savingsSourceCount = randomInt(2, 3)
    const monthsToSeed = Array.from({ length: 6 }, (_, i) => {
      const date = new Date(currentYear, currentMonth - 1 - i, 1)
      return { year: date.getFullYear(), month: date.getMonth() + 1 }
    })

    const memberNames = [`Alex ${randomInt(1, 99)}`, `Sam ${randomInt(1, 99)}`]
    for (const name of memberNames) {
      await window.api.members.create({ name })
    }

    const createdIncomeSourceIds: number[] = []
    for (let i = 0; i < incomeSourceCount; i++) {
      const amount = randomInt(12000, 42000)
      const created = await window.api.income.createSource({
        name: `${pick(incomeNames)} ${randomInt(1, 99)}`,
        amount,
        grossOrNet: pick(['gross', 'net']),
        isRecurring: i !== incomeSourceCount - 1,
        frequency: pick(['monthly', 'monthly', 'fortnightly']),
        color: pick(['#22c55e', '#14b8a6', '#0ea5e9', '#84cc16'])
      }) as { id: number }
      createdIncomeSourceIds.push(created.id)
      for (const period of monthsToSeed) {
        await window.api.income.setEntry({
          sourceId: created.id,
          year: period.year,
          month: period.month,
          amount: amount + randomInt(-1500, 2500),
          isIrregular: Math.random() < 0.25
        })
      }
    }

    for (let i = 0; i < savingsSourceCount; i++) {
      await window.api.transactions.create({
        description: `${pick(savingsNames)} ${randomInt(1, 99)}`,
        amount: randomInt(800, 4500),
        type: 'savings',
        categoryId: undefined,
        date: dateMonthsAgo(randomInt(0, 2), randomInt(3, 24)),
        isRecurring: true,
        notes: 'Demo recurring savings'
      })
    }

    for (let i = 0; i < subCount; i++) {
      const name = `${pick(subscriptions)} ${randomInt(1, 99)}`
      await window.api.subscriptions.create({
        name,
        amount: randomInt(79, 14900),
        frequency: pick(['weekly', 'monthly', 'monthly', 'yearly']),
        nextBillingDate: randomFutureDateWithinMonths(2),
        websiteUrl: pick(['https://example.com', '']),
        icon: 'credit-card',
        color: pick(['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6']),
        notes: 'Demo data',
        taxDeductible: Math.random() < 0.35,
        onHold: Math.random() < 0.2
      })
    }

    for (let i = 0; i < txCount; i++) {
      const type = Math.random() < 0.12 ? 'income' : Math.random() < 0.2 ? 'savings' : 'expense'
      const category = pick(expenseCategories)
      await window.api.transactions.create({
        description: type === 'income' ? pick(['Salary payout', 'Freelance invoice', 'Refund received']) : pick(merchants),
        amount: type === 'income' ? randomInt(12000, 42000) : randomInt(45, 3200),
        type,
        categoryId: type === 'expense' ? category.id : undefined,
        date: randomDateWithinMonths(randomInt(6, 11)),
        isRecurring: false,
        isUnnecessary: type === 'expense' && Math.random() < 0.12,
        notes: 'Demo data'
      })
    }

    for (let i = 1; i <= 14; i++) {
      const date = new Date()
      date.setDate(date.getDate() - i)
      await window.api.transactions.create({
        description: pick(['Daily groceries', 'Transit tap', 'Lunch cafe', 'Evening pharmacy']),
        amount: randomInt(35, 260),
        type: 'expense',
        categoryId: pick(expenseCategories).id,
        date: date.toISOString().slice(0, 10),
        isRecurring: false,
        notes: 'Demo streak data'
      })
    }

    for (let i = 0; i < goalCount; i++) {
      const target = randomInt(10000, 120000)
      await window.api.goals.create({
        name: `${pick(goalNames)} ${randomInt(1, 99)}`,
        type: `demo-${Date.now()}-${i}`,
        targetAmount: target,
        currentAmount: randomInt(500, Math.floor(target * 0.8)),
        targetDate: randomFutureDateWithinMonths(12),
        interestRate: pick([0, 2.5, 4.2]),
        monthlyPayment: randomInt(500, 3000),
        notes: pick(['Demo target with monthly top-ups', 'Demo goal for a near-term purchase', 'Demo buffer goal'])
      })
    }

    let budgetEntries = 0
    const budgetCategories = expenseCategories.slice(0, Math.min(expenseCategories.length, 8))
    for (const period of monthsToSeed) {
      for (const category of budgetCategories) {
        await window.api.budget.setEntry({
          categoryId: category.id,
          year: period.year,
          month: period.month,
          amount: randomInt(700, 8500),
          notes: pick(['Demo planned spend', 'Demo seasonal adjustment', 'Demo regular category limit'])
        })
        budgetEntries++
      }
    }

    for (let i = 0; i < 6; i++) {
      await window.api.wealth.create({
        date: dateMonthsAgo(5 - i, 28),
        assetsSavings: 25000 + i * randomInt(1800, 4200),
        assetsInvestments: 55000 + i * randomInt(2500, 6500),
        assetsProperty: 0,
        liabilitiesLoans: Math.max(0, 22000 - i * randomInt(1000, 2200)),
        liabilitiesCredit: randomInt(1500, 9000),
        notes: 'Demo monthly wealth snapshot'
      })
    }

    const demoHoldings = holdings.slice(0, randomInt(2, 3))
    for (const holding of demoHoldings) {
      const shares = randomInt(8, 75)
      const avgCost = randomInt(90, 650)
      const currentPrice = Math.round(avgCost * (0.92 + Math.random() * 0.35))
      await window.api.investmentHoldings.create({
        etfName: holding.etfName,
        ticker: holding.ticker,
        shares,
        avgCost,
        currentPrice,
        currentValue: shares * currentPrice,
        notes: 'Demo holding'
      })
    }

    const investmentCount = randomInt(1, 2)
    for (let i = 0; i < investmentCount; i++) {
      const purchasePrice = randomInt(8000, 65000)
      await window.api.investments.create({
        name: `${pick(legacyInvestments)} ${randomInt(1, 99)}`,
        purchasePrice,
        currentValue: Math.round(purchasePrice * (0.85 + Math.random() * 0.45)),
        purchaseDate: dateMonthsAgo(randomInt(4, 24), randomInt(1, 24)),
        notes: 'Demo legacy investment'
      })
    }

    await window.api.pension.save({
      current: randomInt(85000, 240000),
      monthly: randomInt(2500, 9000),
      returnRate: pick([4.5, 5.5, 6.5, 7]),
      retirementAge: pick([62, 65, 67])
    })

    for (const rule of rulePatterns) {
      if (rule.category?.id) {
        await window.api.rules.create({ pattern: `${rule.pattern} ${randomInt(1, 99)}`, categoryId: rule.category.id })
      }
    }

    const moods = ['🙂', '😐', '😄', '😌']
    for (const period of monthsToSeed) {
      await window.api.mood.set({
        year: period.year,
        month: period.month,
        rating: randomInt(2, 5),
        emoji: pick(moods)
      })
    }

    triggerRefresh()
    return {
      subscriptions: subCount,
      transactions: txCount + 14,
      goals: goalCount,
      incomeSources: incomeSourceCount,
      savingsSources: savingsSourceCount,
      budgetEntries,
      wealthSnapshots: 6,
      holdings: demoHoldings.length,
      investments: investmentCount,
      rules: rulePatterns.length,
      moods: monthsToSeed.length
    }
  }

  async function handleRunDemo(): Promise<void> {
    try {
      const result = await generateDemoData()
      await dialog.alert(
        `Added ${result.subscriptions} subscriptions, ${result.transactions} transactions, ${result.goals} goals, ${result.incomeSources} income sources, ${result.savingsSources} savings sources, ${result.budgetEntries} budget entries, ${result.wealthSnapshots} wealth snapshots, ${result.holdings} holdings, ${result.investments} legacy investments, ${result.rules} rules, and ${result.moods} mood entries.`,
        'Demo data added'
      )
    } catch (error) {
      await dialog.alert(
        error instanceof Error ? error.message : 'Failed to generate demo data.',
        'Demo data failed'
      )
    }
  }

  async function saveProfile(): Promise<void> {
    await window.api.settings.setProfile({ ...profile })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function saveApiKey(): Promise<void> {
    if (apiKey) {
      await window.api.ai.saveKey(apiKey)
      setApiKey('')
    }
  }

  async function handleChangePassword(): Promise<void> {
    setChangePasswordError('')
    setChangePasswordSuccess(false)
    if (!currentPassword) {
      setChangePasswordError('Current password is required')
      return
    }
    if (!newPassword || newPassword.length < 8) {
      setChangePasswordError('New password must be at least 8 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      setChangePasswordError('Passwords do not match')
      return
    }
    setChangePasswordLoading(true)
    try {
      const result = await window.api.encryption.changePassword(currentPassword, newPassword)
      if (result.success) {
        setChangePasswordSuccess(true)
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
        setTimeout(() => setChangePasswordSuccess(false), 3000)
      } else {
        setChangePasswordError(result.error || 'Failed to change password')
      }
    } catch {
      setChangePasswordError('Failed to change password')
    } finally {
      setChangePasswordLoading(false)
    }
  }

  async function setTheme(theme: 'system' | 'light' | 'dark'): Promise<void> {
    setProfile({ theme })
    await window.api.theme.set(theme)
    document.documentElement.classList.toggle(
      'dark',
      theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    )
    saveProfile()
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6 pb-20">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label>Name</Label>
            <Input
              value={profile.name}
              onChange={(e) => setProfile({ name: e.target.value })}
              onBlur={saveProfile}
            />
          </div>
          <div className="grid gap-2">
            <Label>Household members</Label>
            <div className="flex gap-2">
              <Input
                placeholder="Add member"
                value={newMember}
                onChange={(e) => setNewMember(e.target.value)}
              />
              <Button
                onClick={async () => {
                  if (newMember) {
                    await window.api.members.create({ name: newMember })
                    setNewMember('')
                    setMembers(await window.api.members.list())
                  }
                }}
              >
                Add
              </Button>
            </div>
            <ul className="text-sm text-muted-foreground">
              {members.map((m) => (
                <li key={m.id}>{m.name}</li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Currency</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">Base currency (how amounts are stored):</p>
          <Select
            value={profile.baseCurrency || 'SEK'}
            onValueChange={(v) => {
              setProfile({ baseCurrency: v as DisplayCurrency })
              saveProfile()
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="SEK">SEK (kr)</SelectItem>
              <SelectItem value="EUR">EUR (€)</SelectItem>
              <SelectItem value="USD">USD ($)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">Display toggle:</p>
          <Select
            value={profile.displayCurrency}
            onValueChange={(v) => {
              setProfile({ displayCurrency: v as DisplayCurrency })
              saveProfile()
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="SEK">SEK (kr)</SelectItem>
              <SelectItem value="EUR">EUR (€)</SelectItem>
              <SelectItem value="USD">USD ($)</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tax & inflation</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Label>CPI inflation %</Label>
            <Input
              type="number"
              value={profile.cpiPercent}
              onChange={(e) => {
                const next = Number.parseFloat(e.target.value)
                setProfile({ cpiPercent: Number.isFinite(next) ? next : 0 })
              }}
              onBlur={saveProfile}
            />
          </div>
          <div className="grid gap-2">
            <Label>Tax withheld %</Label>
            <Input
              type="number"
              value={profile.taxWithheldPercent}
              onChange={(e) => {
                const next = Number.parseFloat(e.target.value)
                setProfile({ taxWithheldPercent: Number.isFinite(next) ? next : 0 })
              }}
              onBlur={saveProfile}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-4 w-4" />
            AI Assistant
            <InfoTooltip content="Your API key is stored in Windows Credential Manager when available, or encrypted locally. The key is never sent anywhere except to the Claude API when you ask a question." />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Claude API key (claude-sonnet-4-20250514). Stored in Windows Credential Manager when
            available.
          </p>
          <Input
            type="password"
            placeholder="sk-ant-..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <div className="flex gap-2">
            <Button onClick={saveApiKey}>Save API key</Button>
            <Button variant="destructive" onClick={() => window.api.ai.deleteKey()}>
              Remove key
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select value={profile.theme} onValueChange={(v) => setTheme(v as 'system' | 'light' | 'dark')}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">System</SelectItem>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center justify-between">
            <Label>Colorblind-friendly chart palette</Label>
            <Switch
              checked={profile.colorBlindMode}
              onCheckedChange={(v) => {
                setProfile({ colorBlindMode: v })
                saveProfile()
              }}
            />
          </div>
          <div className="grid gap-2">
            <Label>Locale (number/date formatting)</Label>
            <Select
              value={profile.locale}
              onValueChange={(v) => {
                setProfile({ locale: v as AppLocale })
                saveProfile()
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_LOCALES.map((l) => (
                  <SelectItem key={l} value={l}>
                    {LOCALE_LABELS[l]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Display</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Budget alerts (80% threshold)</Label>
            <Switch
              checked={profile.notificationsEnabled}
              onCheckedChange={(v) => {
                setProfile({ notificationsEnabled: v })
                saveProfile()
              }}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label>Auto-hide zero-value categories</Label>
            <Switch
              checked={profile.autoHideZeroCategories}
              onCheckedChange={(v) => {
                setProfile({ autoHideZeroCategories: v })
                saveProfile()
              }}
            />
          </div>
          <div className="grid gap-2">
            <Label>Savings rate target (%)</Label>
            <Input
              type="number"
              value={profile.savingsRateTarget}
              onChange={(e) => {
                const next = Number.parseFloat(e.target.value)
                setProfile({ savingsRateTarget: Number.isFinite(next) ? next : 20 })
              }}
              onBlur={saveProfile}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Backup</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {lastBackup
              ? `Last backup: ${lastBackup}`
              : 'No backup yet. Schedule regular backups to protect your data.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={handleExportBackup}>
              <Download className="h-4 w-4" />
              Backup now (SQLite)
            </Button>
            <Button variant="outline" onClick={() => window.api.data.exportJson()}>
              <Download className="h-4 w-4" />
              Export JSON
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Data</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => window.api.data.exportDb()}>
            <Download className="h-4 w-4" />
            Export SQLite
          </Button>
          <Button variant="outline" onClick={() => window.api.data.exportJson()}>
            <Download className="h-4 w-4" />
            Export JSON
          </Button>
          <Button variant="outline" onClick={() => window.api.data.importJson()}>
            <Upload className="h-4 w-4" />
            Import JSON
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              const result = await window.api.data.importDb()
              if (result) {
                await dialog.alert('Database imported. Restart the app to apply changes.', 'Import complete')
              }
            }}
          >
            <Upload className="h-4 w-4" />
            Import SQLite
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              if (await dialog.confirm('Rebuild the transactions table from event history? Data loss is possible if events are incomplete.', {
                title: 'Repair from events',
                confirmLabel: 'Repair'
              })) {
                const result = await window.api.data.repairFromEvents()
                if (result.success) {
                  await dialog.alert(`Repair complete. Rebuilt ${result.count} transactions from events.`, 'Repair complete')
                  window.location.reload()
                } else {
                  await dialog.alert('Repair failed: ' + (result.error || 'Unknown error'), 'Repair failed')
                }
              }
            }}
          >
            <RotateCcw className="h-4 w-4" />
            Repair from events
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              await window.api.currency.fetch()
              await dialog.alert('Exchange rates refreshed.', 'Rates refreshed')
            }}
          >
            <RotateCcw className="h-4 w-4" />
            Refresh rates
          </Button>
          <Button
            variant="outline"
            onClick={() => window.location.hash = '#/report?print=1'}
          >
            <Printer className="h-4 w-4" />
            Year-end PDF
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              await window.api.encryption.lock()
              window.location.reload()
            }}
          >
            <Lock className="h-4 w-4" />
            Lock database
          </Button>
          <Button
            variant="destructive"
            onClick={async () => {
              if (await dialog.confirm('Delete ALL data and start fresh? This cannot be undone.', {
                title: 'Wipe data',
                confirmLabel: 'Wipe data',
                destructive: true
              })) {
                await window.api.data.wipe()
                window.location.reload()
              }
            }}
          >
            <Trash2 className="h-4 w-4" />
            Wipe data & restart
          </Button>
          <Button variant="outline" onClick={handleRunDemo}>
            <Play className="h-4 w-4" />
            Run Demo
          </Button>
        </CardContent>
      </Card>

      <SchedulerCard />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4" />
            Encryption
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label>Current password</Label>
            <Input
              type="password"
              placeholder="Enter current master password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>New password</Label>
            <Input
              type="password"
              placeholder="At least 8 characters"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>Confirm new password</Label>
            <Input
              type="password"
              placeholder="Repeat new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          {changePasswordError && (
            <p className="text-sm text-destructive">{changePasswordError}</p>
          )}
          {changePasswordSuccess && (
            <p className="text-sm text-success">Password changed successfully.</p>
          )}
          <Button onClick={handleChangePassword} disabled={changePasswordLoading}>
            {changePasswordLoading ? 'Changing...' : 'Change password'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Categorization Rules</CardTitle>
        </CardHeader>
        <CardContent>
          <RuleEditor />
        </CardContent>
      </Card>

      <IntegrityPanel />

      <Card>
        <CardHeader>
          <CardTitle>Plugins</CardTitle>
        </CardHeader>
        <CardContent>
          <PluginRegistry />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Onboarding</CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={async () => {
              await window.api.settings.set('onboardingComplete', false)
              window.location.reload()
            }}
          >
            Re-run welcome guide
          </Button>
        </CardContent>
      </Card>

      {saved && <p className="text-sm text-success" role="status" aria-live="polite">Saved.</p>}
      {appVersion && (
        <p className="text-xs text-muted-foreground text-center pt-4">
          Budget v{appVersion}
        </p>
      )}
    </div>
  )
}
