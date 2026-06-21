import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/**
 * Format a number with locale-aware formatting (comma thousands separator, fixed decimals)
 * Shared across all financial tabs.
 */
export function formatCurrency(
  amount: number,
  options?: {
    decimals?: number
    prefix?: string
    suffix?: string
  }
): string {
  const value = Number.isFinite(amount) ? amount : 0
  const decimals = options?.decimals ?? 2
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals))
  const prefix = options?.prefix ?? ''
  const suffix = options?.suffix ?? ''
  return `${prefix}${formatted}${suffix}`
}

export function formatMoney(
  amount: number,
  currency: string = 'SEK',
  rates?: Record<string, number>
): string {
  let value = Number.isFinite(amount) ? amount : 0
  if (currency !== 'SEK' && rates?.[currency]) {
    value = amount * rates[currency]
  }
  const formatted = formatCurrency(value)
  const symbol = currency === 'SEK' ? 'kr' : currency === 'EUR' ? '€' : '$'
  return currency === 'SEK' ? `${formatted} ${symbol}` : `${symbol}${formatted}`
}

export function formatPercent(value: number): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
}

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]
