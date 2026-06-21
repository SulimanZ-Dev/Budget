import { NavLink } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  LayoutDashboard,
  Wallet,
  ArrowLeftRight,
  Target,
  Landmark,
  BarChart3,
  CreditCard,
  Sparkles,
  Settings,
  ChevronLeft,
  ChevronRight,
  Heart,
  Banknote,
  PiggyBank,
  HelpCircle
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
import { Button } from '@/components/ui/button'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/budget', icon: Wallet, label: 'Budget' },
  { to: '/transactions', icon: ArrowLeftRight, label: 'Transactions' },
  { to: '/goals', icon: Target, label: 'Goals' },
  { to: '/wealth', icon: Landmark, label: 'Wealth' },
  { to: '/analytics', icon: BarChart3, label: 'Analytics' },
  { to: '/subscriptions', icon: CreditCard, label: 'Subscriptions' },
  { to: '/income', icon: Banknote, label: 'Income' },
  { to: '/savings', icon: PiggyBank, label: 'Savings' },
  { to: '/habits', icon: Heart, label: 'Habits' },
  { to: '/ai', icon: Sparkles, label: 'AI Assistant' },
  { to: '/settings', icon: Settings, label: 'Settings' }
]

export function Sidebar(): JSX.Element {
  const { sidebarCollapsed, setSidebarCollapsed, setShowHelp } = useAppStore()

  return (
    <motion.aside
      animate={{ width: sidebarCollapsed ? 72 : 220 }}
      className="flex h-full flex-col border-r bg-card/50 pt-10"
    >
      <div className="flex items-center gap-2 px-4 pb-6">
        {!sidebarCollapsed && (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-lg font-bold tracking-tight"
          >
            Budget
          </motion.span>
        )}
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-2">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )
            }
          >
            <Icon className="h-5 w-5 shrink-0" />
            {!sidebarCollapsed && <span>{label}</span>}
          </NavLink>
        ))}
      </nav>
      <div className="space-y-1 p-2">
        <Button
          variant="ghost"
          className={cn("w-full justify-start", sidebarCollapsed && "justify-center")}
          onClick={() => setShowHelp(true)}
          title="Help & Guide"
        >
          <HelpCircle className="h-5 w-5 shrink-0" />
          {!sidebarCollapsed && <span className="ml-3">Help</span>}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="w-full"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>
    </motion.aside>
  )
}
