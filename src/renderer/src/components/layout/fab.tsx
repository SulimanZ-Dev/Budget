import { motion } from 'framer-motion'
import { Plus } from 'lucide-react'
import { useAppStore } from '@/store/app-store'

export function FloatingActionButton(): JSX.Element {
  const { setTransactionModalOpen } = useAppStore()

  return (
    <motion.button
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      onClick={() => setTransactionModalOpen(true)}
      className="fixed bottom-6 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label="Add transaction"
      title="Add transaction (Ctrl+N)"
    >
      <Plus className="h-6 w-6" />
    </motion.button>
  )
}
