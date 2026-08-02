import { useEffect, useState } from 'react'
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Sidebar } from '@/components/layout/sidebar'
import { RightDrawer } from '@/components/layout/drawer'
import { FloatingActionButton } from '@/components/layout/fab'
import { CommandPalette } from '@/components/layout/command-palette'
import { TransactionModal } from '@/components/transactions/transaction-modal'
import { OnboardingFlow } from '@/components/onboarding/onboarding-flow'
import { EncryptionSetup } from '@/components/auth/encryption-setup'
import { UnlockScreen } from '@/components/auth/unlock-screen'
import { ThemeToggle } from '@/components/shared/theme-toggle'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppInit } from '@/hooks/use-init'
import { useKeyboardShortcuts } from '@/hooks/use-keyboard'
import { useAppStore } from '@/store/app-store'
import { DashboardPage } from '@/pages/dashboard'
import { AccountsPage } from '@/pages/accounts'
import { BudgetPage } from '@/pages/budget'
import { TransactionsPage } from '@/pages/transactions'
import { GoalsPage } from '@/pages/goals'
import { WealthPage } from '@/pages/wealth'
import { AnalyticsPage } from '@/pages/analytics'
import { SubscriptionsPage } from '@/pages/subscriptions'
import { IncomePage } from '@/pages/income'
import { SavingsPage } from '@/pages/savings'
import { HabitsPage } from '@/pages/habits'
import { TaxEstimatorPage } from '@/pages/tax-estimator'
import { PrivacyAuditPage } from '@/pages/privacy-audit'
import { AiAssistantPage } from '@/pages/ai-assistant'
import { SettingsPage } from '@/pages/settings'
import { ReviewInboxPage } from '@/pages/review-inbox'
import { YearEndReportPage } from '@/pages/year-end-report'
import { CoachMarks } from '@/components/shared/coach-marks'
import { AppDialogProvider, useAppDialog } from '@/components/shared/app-dialog'
import { FlaskConical, LogOut } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

function PageTransition({ children }: { children: React.ReactNode }): JSX.Element {
  const location = useLocation()
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, x: 12 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -12 }}
        transition={{ duration: 0.2 }}
        className="h-full overflow-auto"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}

function DemoModeBanner(): JSX.Element | null {
  const dialog = useAppDialog()
  const [status, setStatus] = useState<{ active: boolean; seed?: number | null; preset?: string | null }>({ active: false })
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    window.api.demo.status()
      .then((value: typeof status) => setStatus(value))
      .catch(() => setStatus({ active: false }))
  }, [])

  if (!status.active) return null

  async function leaveDemo(): Promise<void> {
    if (!await dialog.confirm(
      'Leave the simulated environment and return to your real financial plan? All demo-only changes will be discarded.',
      { title: 'Exit demo environment', confirmLabel: 'Return to real data', destructive: true }
    )) return

    setLeaving(true)
    try {
      await window.api.demo.exit()
      window.location.reload()
    } catch (error) {
      setLeaving(false)
      await dialog.alert(
        error instanceof Error ? error.message : 'Could not leave the demo environment.',
        'Demo environment still active'
      )
    }
  }

  return (
    <div
      className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-warning/40 bg-warning/15 px-4 py-2 text-sm"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <FlaskConical className="h-4 w-4 text-warning" />
        <div>
          <span className="font-semibold">Simulated demo environment</span>
          {status.seed != null && <span className="ml-2 rounded bg-warning/20 px-1.5 py-0.5 font-mono text-xs">seed {status.seed} · {status.preset ?? 'random'}</span>}
          <span className="ml-2 text-muted-foreground">Changes here never touch your real financial plan.</span>
        </div>
      </div>
      <Button className="app-no-drag" size="sm" variant="outline" disabled={leaving} onClick={leaveDemo}>
        <LogOut className="h-4 w-4" />
        {leaving ? 'Returning...' : 'Exit demo'}
      </Button>
    </div>
  )
}

function AppShell(): JSX.Element {
  const [encryptionState, setEncryptionState] = useState<'checking' | 'setup' | 'unlock' | 'ready'>('checking')
  
  useEffect(() => {
    async function checkEncryption() {
      try {
        const requiresSetup = await window.api.encryption.requiresSetup()
        if (requiresSetup) {
          setEncryptionState('setup')
          return
        }
        
        const isUnlocked = await window.api.encryption.isUnlocked()
        if (!isUnlocked) {
          setEncryptionState('unlock')
          return
        }
        
        setEncryptionState('ready')
      } catch (error) {
        console.error('Failed to check encryption state:', error)
        setEncryptionState('setup')
      }
    }
    
    checkEncryption()
  }, [])

  const handleEncryptionReady = () => {
    setEncryptionState('ready')
  }

  // Show encryption setup/unlock screens
  if (encryptionState === 'checking') {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <motion.div
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ repeat: Infinity, duration: 1.5 }}
          className="text-lg font-medium text-muted-foreground"
        >
          Initializing security...
        </motion.div>
      </div>
    )
  }

  if (encryptionState === 'setup') {
    return <EncryptionSetup onComplete={handleEncryptionReady} />
  }

  if (encryptionState === 'unlock') {
    return <UnlockScreen onUnlock={handleEncryptionReady} />
  }

  return <AppContent />
}

function AppContent(): JSX.Element {
  useAppInit()
  useKeyboardShortcuts()
  const {
    profile,
    setYear,
    transactionModalOpen,
    setTransactionModalOpen,
    onboardingComplete,
    setOnboardingComplete,
    showHelp,
    setShowHelp,
    loading,
    selectedMonth,
    triggerRefresh
  } = useAppStore()
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [availableYears, setAvailableYears] = useState<number[]>([profile.year])

  useEffect(() => {
    window.api.years.list().then((years) => {
      setAvailableYears(years as number[])
      if ((years as number[]).length > 0 && !(years as number[]).includes(profile.year)) {
        setYear((years as number[])[0])
      }
    })
  }, [])

  useEffect(() => {
    if (!loading && !onboardingComplete) setShowOnboarding(true)
  }, [loading, onboardingComplete])

  useEffect(() => {
    const applyTheme = (): void => {
      // Default to dark mode if theme is 'system' and no preference is set
      const dark =
        profile.theme === 'dark' ||
        (profile.theme === 'system' &&
          (window.matchMedia('(prefers-color-scheme: dark)').matches ||
           !window.matchMedia('(prefers-color-scheme: light)').matches))
      document.documentElement.classList.toggle('dark', dark)
    }
    applyTheme()
    window.api.theme.set(profile.theme)
  }, [profile.theme])

  // Adaptive accent color based on budget status
  useEffect(() => {
    async function checkBudgetStatus(): Promise<void> {
      try {
        const [budget, txs, incomeEntries, incomeSources] = await Promise.all([
          window.api.budget.getMonth(profile.year, selectedMonth),
          window.api.transactions.list({ year: profile.year, month: selectedMonth }),
          window.api.income.entries(profile.year),
          window.api.income.sources()
        ])

        const budgetEntries = budget as { category_id: number; amount: number }[]
        const transactions = txs as { category_id: number; amount: number; type: string }[]
        const sources = incomeSources as { id: number; amount: number; frequency: string; is_recurring: number }[]
        const entries = incomeEntries as { source_id: number; month: number; amount: number }[]

        // Calculate total budget
        const totalBudget = budgetEntries.reduce((sum, e) => sum + e.amount, 0)
        
        // Calculate total spending
        const totalSpent = transactions.reduce((sum, t) => {
          if (t.type === 'expense' && t.category_id) return sum + t.amount
          return sum
        }, 0)

        // Calculate monthly income
        const monthlyIncome = sources.reduce((sum, src) => {
          const entry = entries.find((e) => e.source_id === src.id && e.month === selectedMonth)
          const amount = entry?.amount ?? (src.is_recurring === 1 ? src.amount : 0)
          return sum + amount
        }, 0)

        // Determine budget status
        const spendingRatio = totalBudget > 0 ? totalSpent / totalBudget : 0
        const incomeRatio = monthlyIncome > 0 ? totalSpent / monthlyIncome : 0

        let status: 'under' | 'near' | 'over' = 'under'
        if (spendingRatio > 1 || incomeRatio > 0.9) {
          status = 'over'
        } else if (spendingRatio > 0.8 || incomeRatio > 0.75) {
          status = 'near'
        }

        // Apply adaptive accent color
        const root = document.documentElement
        if (status === 'over') {
          // Shift toward amber/red for overspending
          root.style.setProperty('--accent-hue', '15')
          root.style.setProperty('--accent-sat', '85%')
        } else if (status === 'near') {
          // Shift toward amber for approaching budget
          root.style.setProperty('--accent-hue', '38')
          root.style.setProperty('--accent-sat', '90%')
        } else {
          // Default calm blue
          root.style.setProperty('--accent-hue', '217')
          root.style.setProperty('--accent-sat', '91%')
        }
      } catch (error) {
        // Silently fail, keep default colors
      }
    }

    if (!loading) {
      checkBudgetStatus()
    }
  }, [profile.year, selectedMonth, loading])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <motion.div
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ repeat: Infinity, duration: 1.5 }}
          className="text-lg font-medium text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          Loading your budget...
        </motion.div>
      </div>
    )
  }

  return (
    <>
      {(showOnboarding || showHelp) && (
        <OnboardingFlow
          onComplete={() => {
            setOnboardingComplete(true)
            setShowOnboarding(false)
            setShowHelp(false)
          }}
        />
      )}
      <TooltipProvider>
      <AppDialogProvider>
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded focus:bg-background focus:p-2 focus:text-sm focus:font-medium focus:outline-none focus:ring-2">
        Skip to content
      </a>
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar />
        <main id="main-content" aria-label="Main content" className="flex flex-1 flex-col overflow-hidden">
          <DemoModeBanner />
          <header className="flex h-10 shrink-0 items-center justify-end gap-4 border-b px-4 pt-10 md:pt-0 md:pl-4 app-drag-region">
            <div className="app-no-drag"><ThemeToggle /></div>
            <div className="app-no-drag">
            <Select
              value={String(profile.year)}
              onValueChange={(v) => setYear(parseInt(v))}
            >
              <SelectTrigger className="w-28 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableYears.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            </div>
          </header>
          <CoachMarks />
          <div className="flex-1 overflow-hidden">
            <PageTransition>
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/accounts" element={<AccountsPage />} />
                <Route path="/budget" element={<BudgetPage />} />
                <Route path="/transactions" element={<TransactionsPage />} />
                <Route path="/review" element={<ReviewInboxPage />} />
                <Route path="/goals" element={<GoalsPage />} />
                <Route path="/wealth" element={<WealthPage />} />
                <Route path="/analytics" element={<AnalyticsPage />} />
                <Route path="/subscriptions" element={<SubscriptionsPage />} />
                <Route path="/income" element={<IncomePage />} />
                <Route path="/savings" element={<SavingsPage />} />
                <Route path="/habits" element={<HabitsPage />} />
                <Route path="/tax" element={<TaxEstimatorPage />} />
                <Route path="/privacy" element={<PrivacyAuditPage />} />
                <Route path="/ai" element={<AiAssistantPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Routes>
            </PageTransition>
          </div>
        </main>
        <RightDrawer />
        <FloatingActionButton />
        <CommandPalette />
        <TransactionModal
          open={transactionModalOpen}
          onOpenChange={setTransactionModalOpen}
          onSaved={() => triggerRefresh()}
        />
      </div>
      </AppDialogProvider>
      </TooltipProvider>
    </>
  )
}

export default function App(): JSX.Element {
  return (
    <HashRouter>
      <Routes>
        <Route path="/report" element={<YearEndReportPage />} />
        <Route path="/*" element={<AppShell />} />
      </Routes>
    </HashRouter>
  )
}
