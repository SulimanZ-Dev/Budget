import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

// Re-export all formatting utilities from the new locale-aware module
export {
  formatNumber,
  formatMoney,
  formatDate,
  formatPercent,
  MONTH_NAMES,
  MONTH_NAMES_BY_LOCALE,
  getMonthNames,
  SUPPORTED_LOCALES,
  LOCALE_LABELS
} from './format'
export type { AppLocale } from './format'

// Colorblind-friendly palette (Wong, 2011 — Nature Methods)
export const COLORBLIND_PALETTE = [
  '#0072B2', // Blue
  '#E69F00', // Orange
  '#009E73', // Green
  '#CC79A7', // Pink
  '#56B4E9', // Sky blue
  '#F0E442', // Yellow
  '#D55E00', // Vermillion
  '#000000'  // Black
]

export const DEFAULT_PALETTE = [
  '#6366f1', '#ef4444', '#22c55e', '#f59e0b', '#3b82f6',
  '#ec4899', '#14b8a6', '#a855f7', '#f97316', '#06b6d4'
]