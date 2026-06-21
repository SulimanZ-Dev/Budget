import { motion } from 'framer-motion'
import { useState } from 'react'
import { formatMoney } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
import { staggerContainerVariants, fadeInUpVariants } from '@/lib/motion'

interface SpendingHeatmapProps {
  data: { date: string; amount: number }[]
  year: number
  month: number
}

export function SpendingHeatmap({ data, year, month }: SpendingHeatmapProps): JSX.Element {
  const { profile, rates } = useAppStore()
  const [hoveredDay, setHoveredDay] = useState<{ date: string; amount: number } | null>(null)

  // Get days in month
  const daysInMonth = new Date(year, month, 0).getDate()
  const firstDayOfWeek = new Date(year, month - 1, 1).getDay()

  // Create a map of date -> amount
  const spendingMap = new Map<string, number>()
  let maxSpending = 0
  
  data.forEach((d) => {
    spendingMap.set(d.date, d.amount)
    if (d.amount > maxSpending) maxSpending = d.amount
  })

  // Generate calendar grid
  const weeks: (number | null)[][] = []
  let currentWeek: (number | null)[] = new Array(firstDayOfWeek).fill(null)

  for (let day = 1; day <= daysInMonth; day++) {
    currentWeek.push(day)
    if (currentWeek.length === 7) {
      weeks.push(currentWeek)
      currentWeek = []
    }
  }

  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) {
      currentWeek.push(null)
    }
    weeks.push(currentWeek)
  }

  // Get color intensity based on spending
  const getIntensity = (amount: number): string => {
    if (amount === 0) return 'bg-muted/30'
    const intensity = Math.min(amount / maxSpending, 1)
    
    if (intensity < 0.2) return 'bg-primary/20'
    if (intensity < 0.4) return 'bg-primary/40'
    if (intensity < 0.6) return 'bg-primary/60'
    if (intensity < 0.8) return 'bg-primary/80'
    return 'bg-primary'
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Less</span>
          <div className="flex gap-1">
            {[0.1, 0.3, 0.5, 0.7, 0.9].map((intensity, i) => (
              <div
                key={i}
                className={`h-3 w-3 rounded-sm ${getIntensity(maxSpending * intensity)}`}
              />
            ))}
          </div>
          <span className="text-muted-foreground">More</span>
        </div>
      </div>

      <motion.div
        variants={staggerContainerVariants}
        initial="hidden"
        animate="visible"
        className="space-y-1"
      >
        {/* Day labels */}
        <div className="grid grid-cols-7 gap-1 text-xs text-muted-foreground">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
            <div key={day} className="text-center">
              {day}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        {weeks.map((week, weekIndex) => (
          <motion.div
            key={weekIndex}
            variants={fadeInUpVariants}
            className="grid grid-cols-7 gap-1"
          >
            {week.map((day, dayIndex) => {
              if (day === null) {
                return <div key={`empty-${dayIndex}`} className="aspect-square" />
              }

              const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
              const amount = spendingMap.get(dateStr) || 0
              const intensity = getIntensity(amount)

              return (
                <motion.div
                  key={day}
                  className="relative"
                  onMouseEnter={() => setHoveredDay({ date: dateStr, amount })}
                  onMouseLeave={() => setHoveredDay(null)}
                  whileHover={{ scale: 1.1 }}
                  transition={{ duration: 0.15 }}
                >
                  <div
                    className={`aspect-square rounded-sm ${intensity} flex items-center justify-center text-xs font-medium transition-colors cursor-pointer border border-transparent hover:border-primary/50`}
                  >
                    {day}
                  </div>
                  
                  {/* Tooltip */}
                  {hoveredDay?.date === dateStr && (
                    <motion.div
                      initial={{ opacity: 0, y: -5 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-10 whitespace-nowrap rounded-lg bg-popover px-3 py-2 text-xs shadow-lg border"
                    >
                      <div className="font-medium">
                        {new Date(dateStr).toLocaleDateString('en-US', { 
                          month: 'short', 
                          day: 'numeric' 
                        })}
                      </div>
                      <div className="text-muted-foreground">
                        {amount > 0 
                          ? formatMoney(amount, profile.displayCurrency, rates)
                          : 'No spending'}
                      </div>
                      {/* Arrow */}
                      <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px">
                        <div className="border-4 border-transparent border-t-popover" />
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              )
            })}
          </motion.div>
        ))}
      </motion.div>

      {/* Summary stats */}
      <div className="flex items-center justify-between text-sm pt-2 border-t">
        <span className="text-muted-foreground">
          Total days with spending: {data.filter(d => d.amount > 0).length}
        </span>
        <span className="text-muted-foreground">
          Peak day: {formatMoney(maxSpending, profile.displayCurrency, rates)}
        </span>
      </div>
    </div>
  )
}

// Made with Bob
