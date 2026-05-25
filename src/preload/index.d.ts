import type { BudgetApi } from './index'

declare global {
  interface Window {
    api: BudgetApi
    electron: typeof import('@electron-toolkit/preload').electronAPI
  }
}

export {}
