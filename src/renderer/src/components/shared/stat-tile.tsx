import { motion, useSpring, useTransform } from 'framer-motion'
import { useEffect } from 'react'
import { cn, formatMoney } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
import { cardHoverVariants, numberSpringConfig } from '@/lib/motion'
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
  
  // Animated number value
  const numericValue = typeof value === 'number' ? value : 0
  const spring = useSpring(numericValue, numberSpringConfig)
  
  useEffect(() => {
    spring.set(numericValue)
  }, [numericValue, spring])

  // Format the animated value
  const displayValue = useTransform(spring, (latest) => {
    if (format === 'money') {
      return formatMoney(latest, profile.displayCurrency, rates)
    } else if (format === 'percent') {
      return `${latest.toFixed(1)}%`
    } else if (format === 'number') {
      return Math.round(latest).toLocaleString()
    }
    return String(value)
  })

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
      whileHover="hover"
      whileTap="tap"
      variants={cardHoverVariants}
      transition={{ delay, duration: 0.4 }}
      className="glass-card rounded-xl p-5 cursor-pointer"
    >
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      </div>
      <motion.p className={cn('mt-2 text-3xl font-bold tracking-tight', colorClass)}>
        {displayValue}
      </motion.p>
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
