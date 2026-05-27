import { useEffect } from 'react'
import { useAppStore } from '@/store/app-store'

export function useAppInit(): void {
  const { setProfile, setRates, setOnboardingComplete, setLoading } = useAppStore()

  useEffect(() => {
    async function init(): Promise<void> {
      try {
        const profile = await window.api.settings.getProfile()
        if (profile && typeof profile === 'object') setProfile(profile)

        const onboarding = await window.api.settings.get('onboardingComplete')
        setOnboardingComplete(!!onboarding)

        const rates = await window.api.currency.fetch()
        if (rates?.rates) setRates(rates.rates)
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [setProfile, setRates, setOnboardingComplete, setLoading])
}
