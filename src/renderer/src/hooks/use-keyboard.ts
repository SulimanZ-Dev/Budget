import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/app-store'

function isInputField(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false
  const tag = el.tagName.toLowerCase()
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    el.isContentEditable ||
    el.hasAttribute('data-input') ||
    el.closest('[contenteditable]') !== null ||
    el.closest('[role="combobox"]') !== null ||
    el.closest('[role="textbox"]') !== null
  )
}

function shouldSkipShortcuts(target: EventTarget | null): boolean {
  if (isInputField(target)) return true
  return Boolean(
    document.querySelector('[role="dialog"][aria-modal="true"]') ||
      document.querySelector('[data-state="open"][role="dialog"]')
  )
}

export function useKeyboardShortcuts(): void {
  const navigate = useNavigate()
  const { setCommandOpen, setTransactionModalOpen, openAI, profile, setProfile } = useAppStore()

  useEffect(() => {
    return window.api.commands.onOpenCommandPalette(() => {
      if (!shouldSkipShortcuts(document.activeElement)) {
        setCommandOpen(true)
      }
    })
  }, [setCommandOpen])

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const target = e.target

      if (shouldSkipShortcuts(target)) return

      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const key = e.key.toLowerCase()

      if (key === 'k') {
        e.preventDefault()
        e.stopPropagation()
        setCommandOpen(true)
      } else if (key === 'n') {
        e.preventDefault()
        setTransactionModalOpen(true)
      } else if (e.key === ',') {
        e.preventDefault()
        navigate('/settings')
      } else if (key === 'd') {
        e.preventDefault()
        const next = profile.theme === 'dark' ? 'light' : 'dark'
        setProfile({ theme: next })
        window.api.theme.set(next)
        document.documentElement.classList.toggle('dark', next === 'dark')
      } else if (key === 'f') {
        e.preventDefault()
        navigate('/transactions')
      } else if (e.shiftKey && key === 'a') {
        e.preventDefault()
        openAI()
        navigate('/ai')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [navigate, setCommandOpen, setTransactionModalOpen, openAI, profile.theme, setProfile])
}
