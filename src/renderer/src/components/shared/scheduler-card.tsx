import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Clock } from 'lucide-react'

export function SchedulerCard(): JSX.Element {
  const [config, setConfig] = useState<{ enabled: boolean; intervalHours: number } | null>(null)

  useEffect(() => {
    window.api.scheduler.getConfig().then(setConfig)
  }, [])

  if (!config) return <></>

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Auto-billing scheduler
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Switch
            checked={config.enabled}
            onCheckedChange={(v) => {
              const next = { ...config, enabled: v }
              setConfig(next)
              window.api.scheduler.setConfig(next)
            }}
            id="scheduler-enabled"
          />
          <Label htmlFor="scheduler-enabled">Auto-create recurring transactions</Label>
        </div>
        <div className="grid grid-cols-2 gap-2 items-center">
          <Label>Check interval (hours)</Label>
          <Input
            type="number"
            min={1}
            value={config.intervalHours}
            onChange={(e) => {
              const v = parseInt(e.target.value) || 1
              const next = { ...config, intervalHours: v }
              setConfig(next)
              window.api.scheduler.setConfig(next)
            }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Automatically creates transactions for subscriptions, income sources, and savings on schedule.
        </p>
        <Button variant="outline" size="sm" onClick={() => {
          window.api.subscriptions.checkBilling()
          window.api.savings.checkBilling()
          window.api.income.checkBilling()
        }}>
          Run now
        </Button>
      </CardContent>
    </Card>
  )
}
