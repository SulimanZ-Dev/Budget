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
  const formatted = new Intl.NumberFormat('sv-SE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Math.round(value * 100) / 100)
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
