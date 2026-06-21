import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/app-store'

export function useKeyboardShortcuts(): void {
  const navigate = useNavigate()
  const {
    setCommandOpen,
    setTransactionModalOpen,
    openAI,
    profile,
    setProfile
  } = useAppStore()

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // Don't intercept shortcuts when user is typing in an input/textarea/contenteditable
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return
      }

      const mod = e.ctrlKey || e.metaKey
      if (!mod) return

      if (e.key === 'n') {
        e.preventDefault()
        setTransactionModalOpen(true)
      }
      if (e.key === 'k') {
        e.preventDefault()
        setCommandOpen(true)
      }
      if (e.key === ',') {
        e.preventDefault()
        navigate('/settings')
      }
      if (e.key === 'd') {
        e.preventDefault()
        const next = profile.theme === 'dark' ? 'light' : 'dark'
        setProfile({ theme: next })
        window.api.theme.set(next)
        document.documentElement.classList.toggle('dark', next === 'dark')
      }
      if (e.key === 'f') {
        e.preventDefault()
        navigate('/transactions')
      }
      if (e.shiftKey && e.key === 'A') {
        e.preventDefault()
        openAI()
        navigate('/ai')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [navigate, setCommandOpen, setTransactionModalOpen, openAI, profile.theme, setProfile])
}
