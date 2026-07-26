import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:openExternal', url),
  theme: {
    get: (): Promise<string> => ipcRenderer.invoke('theme:get'),
    set: (source: 'system' | 'light' | 'dark'): Promise<boolean> =>
      ipcRenderer.invoke('theme:set', source)
  },
  notify: (title: string, body: string): Promise<void> =>
    ipcRenderer.invoke('notification:show', { title, body }),

  commands: {
    onOpenCommandPalette: (callback: () => void): (() => void) => {
      const listener = (): void => callback()
      ipcRenderer.on('command-palette:open', listener)
      return () => ipcRenderer.removeListener('command-palette:open', listener)
    }
  },

  years: {
    list: () => ipcRenderer.invoke('years:list')
  },

  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),
    getProfile: () => ipcRenderer.invoke('settings:getProfile'),
    setProfile: (profile: Record<string, unknown>) =>
      ipcRenderer.invoke('settings:setProfile', profile)
  },

  scheduler: {
    getConfig: () => ipcRenderer.invoke('scheduler:getConfig'),
    setConfig: (config: unknown) => ipcRenderer.invoke('scheduler:setConfig', config)
  },

  privacy: {
    auditState: () => ipcRenderer.invoke('privacy:auditState')
  },

  rules: {
    list: () => ipcRenderer.invoke('rules:list'),
    create: (rule: unknown) => ipcRenderer.invoke('rules:create', rule),
    delete: (id: number) => ipcRenderer.invoke('rules:delete', id),
    apply: () => ipcRenderer.invoke('rules:apply')
  },

  currency: {
    fetch: () => ipcRenderer.invoke('currency:fetch'),
    cached: () => ipcRenderer.invoke('currency:cached')
  },

  ai: {
    saveKey: (key: string) => ipcRenderer.invoke('ai:saveKey', key),
    hasKey: () => ipcRenderer.invoke('ai:hasKey'),
    deleteKey: () => ipcRenderer.invoke('ai:deleteKey'),
    chat: (messages: { role: 'user' | 'assistant'; content: string }[], ctx?: string) =>
      ipcRenderer.invoke('ai:chat', messages, ctx),
    suggestCategory: (desc: string) => ipcRenderer.invoke('ai:suggestCategory', desc),
    insight: () => ipcRenderer.invoke('ai:insight'),
    weeklyTip: () => ipcRenderer.invoke('ai:weeklyTip'),
    detectAnomalies: () => ipcRenderer.invoke('ai:detectAnomalies'),
    saveInsight: (content: string, year: number, month: number) =>
      ipcRenderer.invoke('ai:saveInsight', content, year, month)
  },

  members: {
    list: () => ipcRenderer.invoke('members:list'),
    create: (data: { name: string; color?: string }) => ipcRenderer.invoke('members:create', data),
    delete: (id: number) => ipcRenderer.invoke('members:delete', id)
  },

  accounts: {
    list: () => ipcRenderer.invoke('accounts:list'),
    create: (account: unknown) => ipcRenderer.invoke('accounts:create', account),
    update: (id: number, account: unknown) => ipcRenderer.invoke('accounts:update', id, account),
    archive: (id: number) => ipcRenderer.invoke('accounts:archive', id)
  },

  categories: {
    list: () => ipcRenderer.invoke('categories:list'),
    create: (cat: unknown) => ipcRenderer.invoke('categories:create', cat),
    update: (id: number, cat: unknown) => ipcRenderer.invoke('categories:update', id, cat),
    delete: (id: number) => ipcRenderer.invoke('categories:delete', id)
  },

  budget: {
    getMonth: (year: number, month: number) => ipcRenderer.invoke('budget:getMonth', year, month),
    categoryDetail: (categoryId: number, year: number, month: number) =>
      ipcRenderer.invoke('budget:categoryDetail', categoryId, year, month),
    setEntry: (data: unknown) => ipcRenderer.invoke('budget:setEntry', data)
  },

  transactions: {
    list: (filters?: Record<string, unknown>) => ipcRenderer.invoke('transactions:list', filters),
    count: (filters?: Record<string, unknown>) => ipcRenderer.invoke('transactions:count', filters),
    summary: (filters?: Record<string, unknown>) => ipcRenderer.invoke('transactions:summary', filters),
    search: (query: string, limit?: number) => ipcRenderer.invoke('transactions:search', query, limit),
    duplicates: (tx: unknown) => ipcRenderer.invoke('transactions:duplicates', tx),
    create: (tx: unknown) => ipcRenderer.invoke('transactions:create', tx),
    update: (id: number, tx: unknown) => ipcRenderer.invoke('transactions:update', id, tx),
    delete: (id: number) => ipcRenderer.invoke('transactions:delete', id),
    bulk: (action: string, ids: number[], data?: unknown) =>
      ipcRenderer.invoke('transactions:bulk', action, ids, data),
    csvPreview: (csv: string) => ipcRenderer.invoke('transactions:csvPreview', csv),
    importCsv: (csv: string, mapping?: unknown) =>
      ipcRenderer.invoke('transactions:importCsv', csv, mapping),
    exportCsv: () => ipcRenderer.invoke('transactions:exportCsv'),
    categoryTrend: (categoryId: number, year: number, anchorMonth: number, months?: number) =>
      ipcRenderer.invoke('transactions:categoryTrend', categoryId, year, anchorMonth, months),
    categoryVariance: (categoryId: number, year: number, month: number) =>
      ipcRenderer.invoke('transactions:categoryVariance', categoryId, year, month),
    recurringMerchantPatterns: (year: number, month: number) =>
      ipcRenderer.invoke('transactions:recurringMerchantPatterns', year, month),
    dismissRecurringMerchantPattern: (key: string) =>
      ipcRenderer.invoke('transactions:dismissRecurringMerchantPattern', key),
    importOfx: (accountId?: number) => ipcRenderer.invoke('transactions:importOfx', accountId),
    // Event sourcing methods
    history: (id: number) => ipcRenderer.invoke('transactions:history', id),
    undo: (id: number) => ipcRenderer.invoke('transactions:undo', id)
  },

  goals: {
    list: () => ipcRenderer.invoke('goals:list'),
    create: (goal: unknown) => ipcRenderer.invoke('goals:create', goal),
    update: (id: number, goal: unknown) => ipcRenderer.invoke('goals:update', id, goal),
    delete: (id: number) => ipcRenderer.invoke('goals:delete', id),
    emergencyTarget: () => ipcRenderer.invoke('goals:emergencyTarget'),
    autoCreateFromCategories: () => ipcRenderer.invoke('goals:autoCreateFromCategories')
  },

  wealth: {
    list: () => ipcRenderer.invoke('wealth:list'),
    create: (snap: unknown) => ipcRenderer.invoke('wealth:create', snap)
  },

  pension: {
    get: () => ipcRenderer.invoke('pension:get'),
    save: (data: unknown) => ipcRenderer.invoke('pension:save', data)
  },

  investments: {
    list: () => ipcRenderer.invoke('investments:list'),
    create: (inv: unknown) => ipcRenderer.invoke('investments:create', inv),
    update: (id: number, inv: unknown) => ipcRenderer.invoke('investments:update', id, inv),
    delete: (id: number) => ipcRenderer.invoke('investments:delete', id)
  },

  investmentHoldings: {
    list: () => ipcRenderer.invoke('investmentHoldings:list'),
    create: (holding: unknown) => ipcRenderer.invoke('investmentHoldings:create', holding),
    update: (id: number, holding: unknown) =>
      ipcRenderer.invoke('investmentHoldings:update', id, holding),
    delete: (id: number) => ipcRenderer.invoke('investmentHoldings:delete', id),
    totalValue: () => ipcRenderer.invoke('investmentHoldings:totalValue')
  },

  plugins: {
    discover: () => ipcRenderer.invoke('plugins:discover'),
    load: (pluginId: string) => ipcRenderer.invoke('plugins:load', pluginId),
    unload: (pluginId: string) => ipcRenderer.invoke('plugins:unload', pluginId),
    reload: (pluginId: string) => ipcRenderer.invoke('plugins:reload', pluginId),
    loaded: () => ipcRenderer.invoke('plugins:loaded')
  },

  subscriptions: {
    list: () => ipcRenderer.invoke('subscriptions:list'),
    create: (sub: unknown) => ipcRenderer.invoke('subscriptions:create', sub),
    update: (id: number, sub: unknown) => ipcRenderer.invoke('subscriptions:update', id, sub),
    delete: (id: number) => ipcRenderer.invoke('subscriptions:delete', id),
    link: (id: number) => ipcRenderer.invoke('subscriptions:link', id),
    unlink: (id: number) => ipcRenderer.invoke('subscriptions:unlink', id),
    checkBilling: () => ipcRenderer.invoke('subscriptions:checkBilling'),
    upcoming: () => ipcRenderer.invoke('subscriptions:upcoming')
  },

  savings: {
    sources: () => ipcRenderer.invoke('savings:sources'),
    deleteSource: (id: number) => ipcRenderer.invoke('savings:deleteSource', id),
    populateFuture: () => ipcRenderer.invoke('savings:populateFuture'),
    checkBilling: () => ipcRenderer.invoke('savings:checkBilling')
  },

  income: {
    sources: () => ipcRenderer.invoke('income:sources'),
    createSource: (src: unknown) => ipcRenderer.invoke('income:createSource', src),
    updateSource: (src: unknown) => ipcRenderer.invoke('income:updateSource', src),
    deleteSource: (id: number) => ipcRenderer.invoke('income:deleteSource', id),
    entries: (year: number) => ipcRenderer.invoke('income:entries', year),
    setEntry: (data: unknown) => ipcRenderer.invoke('income:setEntry', data),
    checkBilling: () => ipcRenderer.invoke('income:checkBilling')
  },

  mood: {
    list: () => ipcRenderer.invoke('mood:list'),
    set: (data: unknown) => ipcRenderer.invoke('mood:set', data)
  },

  habits: {
    missedDays: () => ipcRenderer.invoke('habits:missedDays')
  },

  analytics: {
    summary: (year: number) => ipcRenderer.invoke('analytics:summary', year),
    mom: (year: number, month: number) => ipcRenderer.invoke('analytics:mom', year, month),
    heatmap: (year: number) => ipcRenderer.invoke('analytics:heatmap', year),
    breakEven: (year: number) => ipcRenderer.invoke('analytics:breakEven', year),
    yearOverYear: (currentYear: number, yearsBack?: number) =>
      ipcRenderer.invoke('analytics:yearOverYear', currentYear, yearsBack)
  },

  dashboard: {
    stats: (year: number, month: number) => ipcRenderer.invoke('dashboard:stats', year, month),
    cashFlowForecast: (year: number, month: number) =>
      ipcRenderer.invoke('dashboard:cashFlowForecast', year, month)
  },

  data: {
    exportDb: () => ipcRenderer.invoke('data:exportDb'),
    exportJson: () => ipcRenderer.invoke('data:exportJson'),
    importDb: () => ipcRenderer.invoke('data:importDb'),
    importJson: () => ipcRenderer.invoke('data:importJson'),
    wipe: () => ipcRenderer.invoke('data:wipe'),
    repairFromEvents: () => ipcRenderer.invoke('data:repairFromEvents')
  },

  reports: {
    yearSummary: (year: number) => ipcRenderer.invoke('reports:yearSummary', year),
    taxReviewExport: (year: number, categoryIds: number[]) =>
      ipcRenderer.invoke('reports:taxReviewExport', year, categoryIds)
  },

  tax: {
    list: (year: number) => ipcRenderer.invoke('tax:list', year),
    getYearSettings: (year: number) => ipcRenderer.invoke('tax:getYearSettings', year),
    setYearSettings: (settings: unknown) => ipcRenderer.invoke('tax:setYearSettings', settings),
    setEntry: (entry: unknown) => ipcRenderer.invoke('tax:setEntry', entry),
    deleteEntry: (year: number, month: number) => ipcRenderer.invoke('tax:deleteEntry', year, month)
  },

  print: {
    yearSummary: () => ipcRenderer.invoke('print:yearSummary')
  },

  encryption: {
    requiresSetup: (): Promise<boolean> => ipcRenderer.invoke('encryption:requiresSetup'),
    requiresMigration: (): Promise<boolean> => ipcRenderer.invoke('encryption:requiresMigration'),
    isUnlocked: (): Promise<boolean> => ipcRenderer.invoke('encryption:isUnlocked'),
    isDatabaseReady: (): Promise<boolean> => ipcRenderer.invoke('encryption:isDatabaseReady'),
    setup: (password: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('encryption:setup', { password }),
    unlock: (password: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('encryption:unlock', { password }),
    lock: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('encryption:lock'),
    changePassword: (currentPassword: string, newPassword: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('encryption:changePassword', { currentPassword, newPassword })
  },

  integrity: {
    scan: (): Promise<{ success: boolean; results?: any; error?: string }> =>
      ipcRenderer.invoke('integrity:scan'),
    getWarnings: (): Promise<{ success: boolean; warnings?: any[]; error?: string }> =>
      ipcRenderer.invoke('integrity:getWarnings'),
    clearWarnings: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('integrity:clearWarnings'),
    backfillHMACs: (): Promise<{ success: boolean; results?: any; error?: string }> =>
      ipcRenderer.invoke('integrity:backfillHMACs')
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  const w = window as unknown as Window & { electron: typeof electronAPI; api: BudgetApi }
  w.electron = electronAPI
  w.api = api
}

export type BudgetApi = typeof api
