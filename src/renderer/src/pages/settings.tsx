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
import { Download, Upload, Trash2, Key, Printer, Lock, RotateCcw } from 'lucide-react'
import { InfoTooltip } from '@/components/shared/info-tooltip'
import { IntegrityPanel } from '@/components/integrity/integrity-panel'
import { PluginRegistry } from '@/components/plugins/plugin-registry'

export function SettingsPage(): JSX.Element {
  const { profile, setProfile } = useAppStore()
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

  useEffect(() => {
    window.api.members.list().then(setMembers)
    window.api.getVersion().then(setAppVersion)
  }, [])

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
          <p className="text-sm text-muted-foreground">Default: SEK. Display toggle:</p>
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
              if (confirm('Rebuild the transactions table from event history? Data loss is possible if events are incomplete.')) {
                const result = await window.api.data.repairFromEvents()
                if (result.success) {
                  alert(`Repair complete. Rebuilt ${result.count} transactions from events.`)
                  window.location.reload()
                } else {
                  alert('Repair failed: ' + (result.error || 'Unknown error'))
                }
              }
            }}
          >
            <RotateCcw className="h-4 w-4" />
            Repair from events
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
              if (confirm('Delete ALL data and start fresh? This cannot be undone.')) {
                await window.api.data.wipe()
                window.location.reload()
              }
            }}
          >
            <Trash2 className="h-4 w-4" />
            Wipe data & restart
          </Button>
        </CardContent>
      </Card>

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

      {saved && <p className="text-sm text-success">Saved.</p>}
      {appVersion && (
        <p className="text-xs text-muted-foreground text-center pt-4">
          Budget v{appVersion}
        </p>
      )}
    </div>
  )
}
