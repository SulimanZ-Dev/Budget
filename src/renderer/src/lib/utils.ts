import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
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
  const symbol = currency === 'SEK' ? 'kr' : currency === 'EUR' ? '€' : '$'
  // Use en-US locale for comma thousands separator, max 2 decimals
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Math.round(value * 100) / 100)
  return currency === 'SEK' ? `${formatted} ${symbol}` : `${symbol}${formatted}`
}

/**
 * Format a number as currency with comma thousands separator and max 2 decimals
 * @param amount - The amount to format
 * @param options - Optional formatting options
 * @returns Formatted currency string (e.g., "1,250,000.50")
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
