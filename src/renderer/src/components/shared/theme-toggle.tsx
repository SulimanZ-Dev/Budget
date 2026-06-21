import { motion, AnimatePresence } from 'framer-motion'
import { Moon, Sun } from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { transitions } from '@/lib/motion'

export function ThemeToggle(): JSX.Element {
  const { profile, setProfile } = useAppStore()
  
  const isDark = profile.theme === 'dark' || 
    (profile.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  async function toggleTheme(): Promise<void> {
    const newTheme = isDark ? 'light' : 'dark'
    setProfile({ theme: newTheme })
    await window.api.theme.set(newTheme)
    await window.api.settings.setProfile({ ...profile, theme: newTheme })
    document.documentElement.classList.toggle('dark', newTheme === 'dark')
  }

  return (
    <motion.button
      onClick={toggleTheme}
      className="relative flex h-9 w-9 items-center justify-center rounded-lg border bg-card hover:bg-accent transition-colors"
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      transition={transitions.fast}
      aria-label="Toggle theme"
    >
      <AnimatePresence mode="wait" initial={false}>
        {isDark ? (
          <motion.div
            key="moon"
            initial={{ rotate: -90, opacity: 0, scale: 0.6 }}
            animate={{ rotate: 0, opacity: 1, scale: 1 }}
            exit={{ rotate: 90, opacity: 0, scale: 0.6 }}
            transition={transitions.standard}
          >
            <Moon className="h-4 w-4" />
          </motion.div>
        ) : (
          <motion.div
            key="sun"
            initial={{ rotate: 90, opacity: 0, scale: 0.6 }}
            animate={{ rotate: 0, opacity: 1, scale: 1 }}
            exit={{ rotate: -90, opacity: 0, scale: 0.6 }}
            transition={transitions.standard}
          >
            <Sun className="h-4 w-4" />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.button>
  )
}

// Made with Bob
