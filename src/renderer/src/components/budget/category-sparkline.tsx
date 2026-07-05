import React from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { formatMoney } from '@/lib/utils'

interface Point {
  month: number
  spent: number
}

interface CategorySparklineProps {
  data: Point[]
  currency?: string
  rates?: Record<string, number>
}

export function CategorySparkline({ data, currency = 'SEK', rates }: CategorySparklineProps): JSX.Element {
  return (
    <ResponsiveContainer width="100%" height={48}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="month" tick={{ fontSize: 10 }} tickFormatter={(v) => `M${v}`} hide />
        <YAxis hide domain={[0, 'auto']} />
        <Tooltip
          formatter={(v: number) => formatMoney(v, currency, rates)}
          labelFormatter={(l) => `Month ${l}`}
        />
        <Area type="monotone" dataKey="spent" stroke="hsl(var(--primary))" fill="url(#spark)" dot={false} strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  )
}