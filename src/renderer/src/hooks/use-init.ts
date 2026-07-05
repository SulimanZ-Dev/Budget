import { useEffect } from 'react'
import { useAppStore } from '@/store/app-store'

export function useAppInit(): void {
  const { setProfile, setRates, setOnboardingComplete, setLoading, setSelectedMonth } = useAppStore()

  useEffect(() => {
    async function init(): Promise<void> {
      try {
        const profile = await window.api.settings.getProfile()
        if (profile && typeof profile === 'object') setProfile(profile)

        const onboarding = await window.api.settings.get('onboardingComplete')
        setOnboardingComplete(!!onboarding)

        const savedMonth = await window.api.settings.get('selectedMonth')
        if (savedMonth && typeof savedMonth === 'number') {
          setSelectedMonth(savedMonth)
        }

        const rates = await window.api.currency.fetch()
        if (rates?.rates) setRates(rates.rates)

        // Check recurring sources for due billings
        window.api.subscriptions.checkBilling().catch(() => {})
        window.api.savings.checkBilling().catch(() => {})
        window.api.income.checkBilling().catch(() => {})
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [setProfile, setRates, setOnboardingComplete, setLoading, setSelectedMonth])
}
