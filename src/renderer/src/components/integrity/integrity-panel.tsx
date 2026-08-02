import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Shield, AlertTriangle, CheckCircle2, RefreshCw, Trash2, FileSignature } from 'lucide-react'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Card } from '../ui/card'

export function IntegrityPanel() {
  const [isScanning, setIsScanning] = useState(false)
  const [scanResults, setScanResults] = useState<any>(null)
  const [warnings, setWarnings] = useState<any[]>([])
  const [isBackfilling, setIsBackfilling] = useState(false)

  useEffect(() => {
    loadWarnings()
  }, [])

  async function loadWarnings() {
    try {
      const result = await window.api.integrity.getWarnings()
      if (result.success && result.warnings) {
        setWarnings(result.warnings)
      }
    } catch (error) {
      console.error('Failed to load warnings:', error)
    }
  }

  async function handleScan() {
    setIsScanning(true)
    try {
      const result = await window.api.integrity.scan()
      if (result.success && result.results) {
        setScanResults(result.results)
        await loadWarnings()
      }
    } catch (error) {
      console.error('Scan failed:', error)
    } finally {
      setIsScanning(false)
    }
  }

  async function handleClearWarnings() {
    try {
      const result = await window.api.integrity.clearWarnings()
      if (result.success) {
        setWarnings([])
        setScanResults(null)
      }
    } catch (error) {
      console.error('Failed to clear warnings:', error)
    }
  }

  async function handleBackfill() {
    setIsBackfilling(true)
    try {
      const result = await window.api.integrity.backfillHMACs()
      if (result.success) {
        await loadWarnings()
        setScanResults(null)
        // Re-scan to show updated state
        const scan = await window.api.integrity.scan()
        if (scan.success && scan.results) {
          setScanResults(scan.results)
        }
      }
    } catch (error) {
      console.error('Backfill failed:', error)
    } finally {
      setIsBackfilling(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card className="p-6 bg-card border-border">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" />
              Data Integrity
              {scanResults && (
                scanResults.failed === 0 && scanResults.missing === 0
                  ? <Badge className="bg-success/10 text-success border-success/20">All Verified</Badge>
                  : <Badge variant="destructive">Issues Found</Badge>
              )}
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Verify HMAC signatures to detect unauthorized modifications
            </p>
          </div>
          <Button
            onClick={handleScan}
            disabled={isScanning}
            size="sm"
            className="bg-primary hover:bg-primary/90"
          >
            {isScanning ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Scanning...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                Scan Database
              </>
            )}
          </Button>
          <Button
            onClick={handleBackfill}
            disabled={isBackfilling}
            size="sm"
            variant="outline"
          >
            {isBackfilling ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Signing...
              </>
            ) : (
              <>
                <FileSignature className="w-4 h-4 mr-2" />
                Backfill HMACs
              </>
            )}
          </Button>
        </div>

        {scanResults && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            {(() => {
              const total = scanResults.total || 1
              const score = Math.round(((total - scanResults.failed - scanResults.missing) / total) * 100)
              return (
                <>
                  <div className="mb-4 p-4 rounded-lg bg-primary/5 border border-primary/20">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Integrity Score</p>
                        <p className="text-3xl font-bold text-primary">{score}%</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">
                          {scanResults.verified} of {total} records verified intact
                        </p>
                        {score === 100 ? (
                          <Badge className="bg-success/10 text-success border-success/20 mt-1">Perfect</Badge>
                        ) : score >= 95 ? (
                          <Badge className="bg-success/10 text-success border-success/20 mt-1">Good</Badge>
                        ) : score >= 80 ? (
                          <Badge className="bg-warning/10 text-warning border-warning/20 mt-1">Needs Attention</Badge>
                        ) : (
                          <Badge variant="destructive" className="mt-1">Critical</Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-4">
                    <div className="p-4 rounded-lg bg-muted">
                      <div className="text-2xl font-bold text-foreground">
                        {scanResults.total}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">Total Records</div>
                    </div>
                    <div className="p-4 rounded-lg bg-success/10 border border-success/20">
                      <div className="text-2xl font-bold text-success">
                        {scanResults.verified}
                      </div>
                      <Badge variant="secondary" className="mt-1 bg-success/20 text-success hover:bg-success/20">Verified</Badge>
                    </div>
                    <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20">
                      <div className="text-2xl font-bold text-destructive">
                        {scanResults.failed}
                      </div>
                      <Badge variant="destructive" className="mt-1">Failed</Badge>
                    </div>
                    <div className="p-4 rounded-lg bg-warning/10 border border-warning/20">
                      <div className="text-2xl font-bold text-warning">
                        {scanResults.missing}
                      </div>
                      <Badge variant="outline" className="mt-1 border-warning/50 text-warning">Missing HMAC</Badge>
                    </div>
                  </div>
                </>
              )
            })()}

            {scanResults.failed === 0 && scanResults.missing === 0 ? (
              <div className="flex items-center gap-3 p-4 rounded-lg bg-success/10 border border-success/20">
                <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0" />
                <div className="text-sm text-success">
                  All records passed integrity verification. Your data is secure.
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 p-4 rounded-lg bg-warning/10 border border-warning/20">
                <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0" />
                <div className="text-sm text-warning">
                  {scanResults.failed > 0 && (
                    <p className="font-medium">
                      {scanResults.failed} record(s) failed verification. This may indicate tampering.
                    </p>
                  )}
                  {scanResults.missing > 0 && (
                    <p className="mt-1">
                      {scanResults.missing} record(s) are missing HMAC signatures.
                    </p>
                  )}
                </div>
              </div>
            )}

            {scanResults.tables && Object.keys(scanResults.tables).length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-foreground">By Table</h4>
                {Object.entries(scanResults.tables ?? {}).map(([table, stats]: [string, any]) => (
                  <div
                    key={table}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                  >
                    <span className="text-sm text-foreground font-mono">{table}</span>
                    <div className="flex items-center gap-4 text-xs">
                      <span className="text-success">
                        ✓ {stats.verified}
                      </span>
                      {stats.failed > 0 && (
                        <span className="text-destructive">
                          ✗ {stats.failed}
                        </span>
                      )}
                      {stats.missing > 0 && (
                        <span className="text-warning">
                          ? {stats.missing}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </Card>

      {warnings.length > 0 && (
        <Card className="p-6 bg-card border-border">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-warning" />
              Integrity Warnings ({warnings.length})
            </h3>
            <Button
              onClick={handleClearWarnings}
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-foreground"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Clear All
            </Button>
          </div>

          <div className="space-y-2 max-h-96 overflow-y-auto">
            {warnings.map((warning) => (
              <motion.div
                key={warning.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="p-3 rounded-lg bg-warning/5 border border-warning/20"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono text-warning">
                        {warning.table_name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Row #{warning.row_id}
                      </span>
                    </div>
                    <p className="text-sm text-foreground">{warning.reason}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(warning.detected_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

// Made with Bob
