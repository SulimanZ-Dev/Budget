import { useCallback, useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

export function RightDrawer(): JSX.Element {
  const { drawerOpen, drawerContent, closeDrawer } = useAppStore()
  const asideRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (drawerOpen) {
      closeRef.current?.focus()
    }
  }, [drawerOpen])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeDrawer()
        return
      }
      if (e.key === 'Tab') {
        const aside = asideRef.current
        if (!aside) return
        const focusable = aside.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
        if (!focusable.length) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    },
    [closeDrawer]
  )

  return (
    <AnimatePresence>
      {drawerOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/40"
            aria-hidden="true"
            onClick={closeDrawer}
          />
          <motion.aside
            ref={asideRef}
            role="dialog"
            aria-modal="true"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l bg-background shadow-2xl"
            onKeyDown={handleKeyDown}
          >
            <div className="flex items-center justify-between border-b px-4 py-3 pt-12">
              <span className="text-sm font-medium text-muted-foreground">Details</span>
              <Button ref={closeRef} variant="ghost" size="icon" onClick={closeDrawer} aria-label="Close drawer">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <ScrollArea className="flex-1 p-4">{drawerContent}</ScrollArea>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
