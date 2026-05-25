import { motion } from 'framer-motion'
import { cn, formatMoney } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
import type { LucideIcon } from 'lucide-react'

interface StatTileProps {
  label: string
  value: number | string
  icon?: LucideIcon
  trend?: number
  format?: 'money' | 'percent' | 'number' | 'text'
  color?: 'default' | 'success' | 'warning' | 'destructive' | 'info'
  delay?: number
}

export function StatTile({
  label,
  value,
  icon: Icon,
  trend,
  format = 'money',
  color = 'default',
  delay = 0
}: StatTileProps): JSX.Element {
  const { profile, rates } = useAppStore()
  const display =
    format === 'money' && typeof value === 'number'
      ? formatMoney(value, profile.displayCurrency, rates)
      : format === 'percent' && typeof value === 'number'
        ? `${value.toFixed(1)}%`
        : String(value)

  const colorClass = {
    default: 'text-foreground',
    success: 'text-success',
    warning: 'text-warning',
    destructive: 'text-destructive',
    info: 'text-info'
  }[color]

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
      className="rounded-xl border bg-card p-5 shadow-sm"
    >
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      </div>
      <p className={cn('mt-2 text-3xl font-bold tracking-tight', colorClass)}>{display}</p>
      {trend !== undefined && (
        <p
          className={cn(
            'mt-1 text-xs font-medium',
            trend >= 0 ? 'text-success' : 'text-destructive'
          )}
        >
          {trend >= 0 ? '↑' : '↓'} {Math.abs(trend).toFixed(1)}% vs last month
        </p>
      )}
    </motion.div>
  )
}
