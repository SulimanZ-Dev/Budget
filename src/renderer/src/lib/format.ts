/**
 * Shared locale-aware formatting utility.
 * Centralizes all Intl.NumberFormat and Intl.DateTimeFormat calls
 * so the app can be switched between locales (sv-SE, en-US, en-GB, etc.)
 * from a single settings profile field.
 */

// Supported locales
export type AppLocale = 'sv-SE' | 'en-US' | 'en-GB'

export const SUPPORTED_LOCALES: AppLocale[] = ['sv-SE', 'en-US', 'en-GB']

export const LOCALE_LABELS: Record<AppLocale, string> = {
  'sv-SE': 'Svenska (SEK)',
  'en-US': 'English (US)',
  'en-GB': 'English (UK)'
}

/**
 * Format a number with locale-aware thousand separators and decimal places.
 */
export function formatNumber(
  amount: number,
  locale: AppLocale = 'sv-SE',
  decimals = 2
): string {
  const value = Number.isFinite(amount) ? amount : 0
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals))
}

/**
 * Format a monetary amount with currency symbol and locale-aware number formatting.
 * This function converts to display currency using rates if needed, then formats.
 */
export function formatMoney(
  amount: number,
  currency: string = 'SEK',
  rates?: Record<string, number>,
  locale: AppLocale = 'sv-SE'
): string {
  let value = Number.isFinite(amount) ? amount : 0
  const base = Object.entries(rates || {}).find(([, v]) => v === 1)?.[0] || 'SEK'
  if (currency !== base && rates?.[currency]) {
    value = amount * rates[currency]
  }
  const formatted = formatNumber(value, locale)

  // Currency symbol placement differs by locale
  if (locale === 'sv-SE') {
    // Swedish: "1 234,56 kr"
    const symbol = currency === 'SEK' ? 'kr' : currency === 'EUR' ? '€' : '$'
    if (currency === 'SEK') return `${formatted} ${symbol}`
    return `${symbol}${formatted}`
  } else {
    // English: "$1,234.56" or "kr1,234.56"
    const symbol = currency === 'SEK' ? 'kr' : currency === 'EUR' ? '€' : '$'
    return `${symbol}${formatted}`
  }
}

/**
 * Format a date using a locale-aware formatter.
 * Previously hardcoded to 'sv-SE' in some places.
 */
export function formatDate(
  date: Date,
  locale: AppLocale = 'sv-SE',
  options?: Intl.DateTimeFormatOptions
): string {
  const defaults: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }
  return date.toLocaleDateString(locale, options ?? defaults)
}

/**
 * Format a percent value with optional sign.
 */
export function formatPercent(value: number): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
}

// Backward-compatible default month names (sv-SE)
export const MONTH_NAMES: string[] = [
  'Januari', 'Februari', 'Mars', 'April', 'Maj', 'Juni',
  'Juli', 'Augusti', 'September', 'Oktober', 'November', 'December'
]

// Locale-aware month names lookup
export const MONTH_NAMES_BY_LOCALE: Record<AppLocale, string[]> = {
  'sv-SE': [
    'Januari', 'Februari', 'Mars', 'April', 'Maj', 'Juni',
    'Juli', 'Augusti', 'September', 'Oktober', 'November', 'December'
  ],
  'en-US': [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ],
  'en-GB': [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ]
}

export function getMonthNames(locale: AppLocale): string[] {
  return MONTH_NAMES_BY_LOCALE[locale] ?? MONTH_NAMES
}
