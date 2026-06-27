import { create } from 'zustand'

export type DisplayCurrency = 'SEK' | 'EUR' | 'USD'

export interface Profile {
  name: string
  currency: DisplayCurrency
  displayCurrency: DisplayCurrency
  cpiPercent: number
  taxWithheldPercent: number
  theme: 'system' | 'light' | 'dark'
  year: number
  autoHideZeroCategories: boolean
  notificationsEnabled: boolean
  grossIncomeToggle: boolean
}

interface AppState {
  profile: Profile
  rates: Record<string, number>
  sidebarCollapsed: boolean
  drawerOpen: boolean
  drawerContent: React.ReactNode | null
  selectedMonth: number
  commandOpen: boolean
  transactionModalOpen: boolean
  aiPanelOpen: boolean
  aiPrefill: string
  aiScreenContext: string
  onboardingComplete: boolean
  showHelp: boolean
  inflationAdjust: boolean
  loading: boolean
  refreshTrigger: number

  setProfile: (p: Partial<Profile>) => void
  setRates: (rates: Record<string, number>) => void
  setSidebarCollapsed: (v: boolean) => void
  openDrawer: (content: React.ReactNode) => void
  closeDrawer: () => void
  setSelectedMonth: (m: number) => void
  setYear: (y: number) => void
  setCommandOpen: (v: boolean) => void
  setTransactionModalOpen: (v: boolean) => void
  openAI: (prefill?: string, context?: string) => void
  setOnboardingComplete: (v: boolean) => void
  setShowHelp: (v: boolean) => void
  setInflationAdjust: (v: boolean) => void
  setLoading: (v: boolean) => void
  triggerRefresh: () => void
}

const defaultProfile: Profile = {
  name: '',
  currency: 'SEK',
  displayCurrency: 'SEK',
  cpiPercent: 2.5,
  taxWithheldPercent: 30,
  theme: 'dark', // Dark mode by default
  year: new Date().getFullYear(),
  autoHideZeroCategories: false,
  notificationsEnabled: true,
  grossIncomeToggle: false
}

export const useAppStore = create<AppState>((set, get) => ({
  profile: defaultProfile,
  rates: { SEK: 1, EUR: 0.088, USD: 0.095 },
  sidebarCollapsed: false,
  drawerOpen: false,
  drawerContent: null,
  selectedMonth: new Date().getMonth() + 1,
  commandOpen: false,
  transactionModalOpen: false,
  aiPanelOpen: false,
  aiPrefill: '',
  aiScreenContext: '',
  onboardingComplete: true,
  showHelp: false,
  inflationAdjust: false,
  loading: true,
  refreshTrigger: 0,

  setProfile: (p) => set({ profile: { ...get().profile, ...p } }),
  setRates: (rates) => set({ rates }),
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
  openDrawer: (content) => set({ drawerOpen: true, drawerContent: content }),
  closeDrawer: () => set({ drawerOpen: false, drawerContent: null }),
  setSelectedMonth: (m) => set({ selectedMonth: m }),
  setYear: (y) => set({ profile: { ...get().profile, year: y } }),
  setCommandOpen: (v) => set({ commandOpen: v }),
  setTransactionModalOpen: (v) => set({ transactionModalOpen: v }),
  openAI: (prefill = '', context = '') =>
    set({ aiPanelOpen: true, aiPrefill: prefill, aiScreenContext: context }),
  setOnboardingComplete: (v) => set({ onboardingComplete: v }),
  setShowHelp: (v) => set({ showHelp: v }),
  setInflationAdjust: (v) => set({ inflationAdjust: v }),
  setLoading: (v) => set({ loading: v }),
  triggerRefresh: () => set((state) => ({ refreshTrigger: state.refreshTrigger + 1 }))
}))
