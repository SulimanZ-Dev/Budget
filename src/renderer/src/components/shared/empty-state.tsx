import { motion } from 'framer-motion'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { scaleInVariants } from '@/lib/motion'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
  illustration?: 'transactions' | 'goals' | 'chart' | 'wallet' | 'default'
}

// Inline SVG illustrations with hand-drawn/line-art style
const illustrations = {
  transactions: (
    <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      <motion.path
        d="M20 40 L100 40 M20 60 L100 60 M20 80 L100 80"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="4 4"
        className="text-muted-foreground/30"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.5, ease: "easeInOut" }}
      />
      <motion.circle
        cx="30"
        cy="40"
        r="4"
        fill="currentColor"
        className="text-primary"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.5, type: "spring" }}
      />
      <motion.circle
        cx="30"
        cy="60"
        r="4"
        fill="currentColor"
        className="text-primary"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.7, type: "spring" }}
      />
      <motion.circle
        cx="30"
        cy="80"
        r="4"
        fill="currentColor"
        className="text-primary"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.9, type: "spring" }}
      />
    </svg>
  ),
  goals: (
    <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      <motion.path
        d="M60 20 L60 100"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="text-muted-foreground/30"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1, ease: "easeInOut" }}
      />
      <motion.circle
        cx="60"
        cy="30"
        r="8"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        className="text-primary"
        initial={{ scale: 0, rotate: -180 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ delay: 0.3, type: "spring" }}
      />
      <motion.path
        d="M55 30 L58 33 L65 26"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-primary"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ delay: 0.6, duration: 0.3 }}
      />
      <motion.circle
        cx="60"
        cy="60"
        r="8"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        className="text-muted-foreground/50"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.5, type: "spring" }}
      />
      <motion.circle
        cx="60"
        cy="90"
        r="8"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        className="text-muted-foreground/30"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.7, type: "spring" }}
      />
    </svg>
  ),
  chart: (
    <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      <motion.rect
        x="20"
        y="60"
        width="15"
        height="40"
        rx="2"
        fill="currentColor"
        className="text-primary/30"
        initial={{ scaleY: 0 }}
        animate={{ scaleY: 1 }}
        transition={{ delay: 0.2, type: "spring" }}
        style={{ transformOrigin: "bottom" }}
      />
      <motion.rect
        x="45"
        y="40"
        width="15"
        height="60"
        rx="2"
        fill="currentColor"
        className="text-primary/50"
        initial={{ scaleY: 0 }}
        animate={{ scaleY: 1 }}
        transition={{ delay: 0.4, type: "spring" }}
        style={{ transformOrigin: "bottom" }}
      />
      <motion.rect
        x="70"
        y="30"
        width="15"
        height="70"
        rx="2"
        fill="currentColor"
        className="text-primary"
        initial={{ scaleY: 0 }}
        animate={{ scaleY: 1 }}
        transition={{ delay: 0.6, type: "spring" }}
        style={{ transformOrigin: "bottom" }}
      />
      <motion.path
        d="M15 105 L105 105"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="text-muted-foreground/30"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.8 }}
      />
    </svg>
  ),
  wallet: (
    <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      <motion.rect
        x="25"
        y="35"
        width="70"
        height="50"
        rx="8"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        className="text-primary"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1, ease: "easeInOut" }}
      />
      <motion.rect
        x="70"
        y="52"
        width="20"
        height="16"
        rx="4"
        fill="currentColor"
        className="text-primary/30"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.5, type: "spring" }}
      />
      <motion.circle
        cx="80"
        cy="60"
        r="3"
        fill="currentColor"
        className="text-primary"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.8, type: "spring" }}
      />
    </svg>
  ),
  default: (
    <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      <motion.circle
        cx="60"
        cy="60"
        r="30"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="4 4"
        fill="none"
        className="text-muted-foreground/30"
        initial={{ pathLength: 0, rotate: -90 }}
        animate={{ pathLength: 1, rotate: 0 }}
        transition={{ duration: 1.5, ease: "easeInOut" }}
      />
      <motion.path
        d="M60 45 L60 60 L70 70"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-primary"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ delay: 0.5, duration: 0.5 }}
      />
    </svg>
  ),
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  illustration = 'default'
}: EmptyStateProps): JSX.Element {
  return (
    <motion.div
      variants={scaleInVariants}
      initial="hidden"
      animate="visible"
      className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-muted/30 px-8 py-16 text-center"
    >
      <motion.div
        className="mb-6"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        {illustrations[illustration]}
      </motion.div>
      {Icon && (
        <div className="mb-4 rounded-full bg-primary/10 p-3">
          <Icon className="h-6 w-6 text-primary" />
        </div>
      )}
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">{description}</p>
      {actionLabel && onAction && (
        <Button className="mt-6" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </motion.div>
  )
}
