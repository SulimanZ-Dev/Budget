import { useEffect, useState } from 'react'
import { Database, Download, KeyRound, Lock, RefreshCw, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface AuditState {
  appDataPath: string
  databasePath: string
  databaseReady: boolean
  apiKeyPresent: boolean
  lastBackup: string | null
  integrityWarningCount: number
}

interface ScanSummary {
  total: number
  verified: number
  failed: number
  missing: number
}

function stateClass(ok: boolean): string {
  return ok ? 'text-success' : 'text-warning'
}

export function PrivacyAuditPage(): JSX.Element {
  const [state, setState] = useState<AuditState | null>(null)
  const [isUnlocked, setIsUnlocked] = useState(false)
  const [scanSummary, setScanSummary] = useState<ScanSummary | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    refresh()
  }, [])

  async function refresh(): Promise<void> {
    const [audit, unlocked] = await Promise.all([
      window.api.privacy.auditState(),
      window.api.encryption.isUnlocked()
    ])
    setState(audit as AuditState)
    setIsUnlocked(unlocked)
  }

  async function runScan(): Promise<void> {
    setLoading(true)
    try {
      const result = await window.api.integrity.scan()
      if (result.success && result.results) {
        setScanSummary(result.results as ScanSummary)
      }
      await refresh()
    } finally {
      setLoading(false)
    }
  }

  async function backupNow(): Promise<void> {
    const path = await window.api.data.exportDb()
    if (path) {
      const today = new Date().toISOString().slice(0, 10)
      await window.api.settings.set('lastDbBackup', today)
      await refresh()
    }
  }

  const integrityHealthy = (scanSummary ? scanSummary.failed === 0 && scanSummary.missing === 0 : (state?.integrityWarningCount ?? 0) === 0)

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <ShieldCheck className="h-6 w-6" />
          Privacy audit
        </h1>
        <Button variant="outline" onClick={refresh}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <Lock className="mb-3 h-5 w-5 text-primary" />
            <p className="text-sm text-muted-foreground">Encryption</p>
            <p className={`text-lg font-semibold ${stateClass(isUnlocked)}`}>
              {isUnlocked ? 'Unlocked and encrypted' : 'Locked'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <KeyRound className="mb-3 h-5 w-5 text-primary" />
            <p className="text-sm text-muted-foreground">Claude API key</p>
            <p className={`text-lg font-semibold ${stateClass(!!state?.apiKeyPresent)}`}>
              {state?.apiKeyPresent ? 'Present' : 'Not saved'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <Download className="mb-3 h-5 w-5 text-primary" />
            <p className="text-sm text-muted-foreground">Last backup</p>
            <p className={`text-lg font-semibold ${stateClass(!!state?.lastBackup)}`}>
              {state?.lastBackup ?? 'No backup yet'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <ShieldCheck className="mb-3 h-5 w-5 text-primary" />
            <p className="text-sm text-muted-foreground">Integrity</p>
            <p className={`text-lg font-semibold ${stateClass(integrityHealthy)}`}>
              {integrityHealthy ? 'No warnings' : `${state?.integrityWarningCount ?? 0} warnings`}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            Sensitive data locations
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <p className="text-muted-foreground">Application data folder</p>
            <p className="break-all font-mono">{state?.appDataPath ?? 'Loading...'}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Encrypted database</p>
            <p className="break-all font-mono">{state?.databasePath ?? 'Loading...'}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Database state</p>
            <p className={stateClass(!!state?.databaseReady)}>{state?.databaseReady ? 'Ready' : 'Not initialized'}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Audit actions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={backupNow}>
            <Download className="h-4 w-4" />
            Backup now
          </Button>
          <Button variant="outline" onClick={runScan} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Run integrity scan
          </Button>
        </CardContent>
      </Card>

      {scanSummary && (
        <Card>
          <CardHeader>
            <CardTitle>Latest integrity scan</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm md:grid-cols-4">
            <div>
              <p className="text-muted-foreground">Total</p>
              <p className="text-xl font-semibold">{scanSummary.total}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Verified</p>
              <p className="text-xl font-semibold text-success">{scanSummary.verified}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Failed</p>
              <p className="text-xl font-semibold text-destructive">{scanSummary.failed}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Missing HMAC</p>
              <p className="text-xl font-semibold text-warning">{scanSummary.missing}</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
