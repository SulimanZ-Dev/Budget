import { useEffect, useState } from 'react'
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Sidebar } from '@/components/layout/sidebar'
import { RightDrawer } from '@/components/layout/drawer'
import { FloatingActionButton } from '@/components/layout/fab'
import { CommandPalette } from '@/components/layout/command-palette'
import { TransactionModal } from '@/components/transactions/transaction-modal'
import { OnboardingFlow } from '@/components/onboarding/onboarding-flow'
import { useAppInit } from '@/hooks/use-init'
import { useKeyboardShortcuts } from '@/hooks/use-keyboard'
import { useAppStore } from '@/store/app-store'
import { DashboardPage } from '@/pages/dashboard'
import { BudgetPage } from '@/pages/budget'
import { TransactionsPage } from '@/pages/transactions'
import { GoalsPage } from '@/pages/goals'
import { WealthPage } from '@/pages/wealth'
import { AnalyticsPage } from '@/pages/analytics'
import { SubscriptionsPage } from '@/pages/subscriptions'
import { IncomePage } from '@/pages/income'
import { SavingsPage } from '@/pages/savings'
import { HabitsPage } from '@/pages/habits'
import { AiAssistantPage } from '@/pages/ai-assistant'
import { SettingsPage } from '@/pages/settings'
import { YearEndReportPage } from '@/pages/year-end-report'
import { CoachMarks } from '@/components/shared/coach-marks'
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

function AppShell(): JSX.Element {
  useAppInit()
  useKeyboardShortcuts()
  const {
    profile,
    setYear,
    transactionModalOpen,
    setTransactionModalOpen,
    onboardingComplete,
    setOnboardingComplete,
    loading
  } = useAppStore()
  const [showOnboarding, setShowOnboarding] = useState(false)

  useEffect(() => {
    if (!loading && !onboardingComplete) setShowOnboarding(true)
  }, [loading, onboardingComplete])

  useEffect(() => {
    const applyTheme = (): void => {
      const dark =
        profile.theme === 'dark' ||
        (profile.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.classList.toggle('dark', dark)
    }
    applyTheme()
    window.api.theme.set(profile.theme)
  }, [profile.theme])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <motion.div
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ repeat: Infinity, duration: 1.5 }}
          className="text-lg font-medium text-muted-foreground"
        >
          Loading your budget...
        </motion.div>
      </div>
    )
  }

  return (
    <>
      {showOnboarding && (
        <OnboardingFlow
          onComplete={() => {
            setOnboardingComplete(true)
            setShowOnboarding(false)
          }}
        />
      )}
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar />
        <main className="flex flex-1 flex-col overflow-hidden">
          <header className="flex h-10 shrink-0 items-center justify-end gap-4 border-b px-4 pt-10 md:pt-0 md:pl-4">
            <Select
              value={String(profile.year)}
              onValueChange={(v) => setYear(parseInt(v))}
            >
              <SelectTrigger className="w-28 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[2024, 2025, 2026].map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </header>
          <CoachMarks />
          <div className="flex-1 overflow-hidden">
            <PageTransition>
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/budget" element={<BudgetPage />} />
                <Route path="/transactions" element={<TransactionsPage />} />
                <Route path="/goals" element={<GoalsPage />} />
                <Route path="/wealth" element={<WealthPage />} />
                <Route path="/analytics" element={<AnalyticsPage />} />
                <Route path="/subscriptions" element={<SubscriptionsPage />} />
                <Route path="/income" element={<IncomePage />} />
                <Route path="/savings" element={<SavingsPage />} />
                <Route path="/habits" element={<HabitsPage />} />
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
        />
      </div>
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
