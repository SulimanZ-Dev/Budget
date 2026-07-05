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

export function SettingsPage(): JSX.Element {
  const { profile, setProfile, triggerRefresh } = useAppStore()
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
    const subCount = randomInt(5, 8)
    const txCount = randomInt(30, 50)
    const goalCount = randomInt(1, 2)

    for (let i = 0; i < subCount; i++) {
      const name = `${pick(subscriptions)} ${randomInt(1, 99)}`
      await window.api.subscriptions.create({
        name,
        amount: randomInt(79, 14900),
        frequency: pick(['monthly', 'monthly', 'yearly']),
        nextBillingDate: randomFutureDateWithinMonths(2),
        websiteUrl: '',
        icon: 'credit-card',
        color: pick(['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6']),
        notes: 'Demo data',
        taxDeductible: false,
        onHold: false
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
        date: randomDateWithinMonths(randomInt(3, 6)),
        isRecurring: false,
        notes: 'Demo data'
      })
    }

    for (let i = 0; i < goalCount; i++) {
      const target = randomInt(10000, 120000)
      await window.api.goals.create({
        name: `${pick(goalNames)} ${randomInt(1, 99)}`,
        type: `demo-${Date.now()}-${i}`,
        targetAmount: target,
        currentAmount: randomInt(500, Math.floor(target * 0.45)),
        targetDate: randomFutureDateWithinMonths(12),
        interestRate: 0,
        monthlyPayment: randomInt(500, 3000),
        notes: 'Demo data'
      })
    }

    triggerRefresh()
    return { subscriptions: subCount, transactions: txCount, goals: goalCount }
  }

  async function handleRunDemo(): Promise<void> {
    try {
      const result = await generateDemoData()
      await dialog.alert(
        `Added ${result.subscriptions} subscriptions, ${result.transactions} transactions, and ${result.goals} goals.`,
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
