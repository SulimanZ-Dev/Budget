import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLocation } from 'react-router-dom'

const TIPS: Record<string, { title: string; body: string }> = {
  '/': {
    title: 'Your dashboard',
    body: 'Track net worth, spending, savings rate, and AI insights at a glance.'
  },
  '/budget': {
    title: 'Budget by category',
    body: 'Tap a category card to see history, transactions, and notes in the side drawer.'
  },
  '/transactions': {
    title: 'Transactions',
    body: 'Click amount or category to edit inline. Filter recurring vs one-off. Import CSV with column mapping.'
  },
  '/goals': {
    title: 'Financial goals',
    body: 'Set savings, emergency fund, or FIRE targets. Use the menu on each card for actions.'
  },
  '/wealth': {
    title: 'Wealth',
    body: 'Log monthly snapshots to chart net worth. Model pension growth with the projection calculator.'
  },
  '/analytics': {
    title: 'Analytics',
    body: 'Explore MoM changes, spending heatmaps, and your year-to-date savings timeline.'
  },
  '/subscriptions': {
    title: 'Subscriptions',
    body: 'Track recurring services and see combined monthly and annual costs.'
  },
  '/income': {
    title: 'Income',
    body: 'Manage multiple income streams and toggle gross vs net display.'
  },
  '/savings': {
    title: 'Savings',
    body: 'Log one-off savings transfers. These are deducted from your budget balance automatically.'
  },
  '/habits': {
    title: 'Habits',
    body: 'Log monthly mood and keep your transaction tracking streak alive.'
  },
  '/ai': {
    title: 'AI Assistant',
    body: 'Ask natural language questions about your real numbers. Add API key in Settings.'
  },
  '/settings': {
    title: 'Settings',
    body: 'Configure your profile, tax, inflation, AI API key, themes, and data import/export.'
  }
}

export function CoachMarks(): JSX.Element | null {
  const location = useLocation()
  const path = location.pathname || '/'
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({})
  const [ready, setReady] = useState(false)

  useEffect(() => {
    window.api.settings.get('coachMarksDismissed').then((v) => {
      setDismissed((v as Record<string, boolean>) ?? {})
      setReady(true)
    })
  }, [])

  const tip = TIPS[path] ?? TIPS['/']
  const show = ready && tip && !dismissed[path]

  async function dismiss(): Promise<void> {
    const next = { ...dismissed, [path]: true }
    setDismissed(next)
    await window.api.settings.set('coachMarksDismissed', next)
  }

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          className="mx-6 mb-4 flex items-start justify-between gap-4 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3"
        >
          <div>
            <p className="font-semibold text-sm">{tip.title}</p>
            <p className="text-sm text-muted-foreground mt-0.5">{tip.body}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={dismiss} aria-label="Dismiss tip">
            <X className="h-4 w-4" />
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
