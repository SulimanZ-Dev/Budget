import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Command } from 'cmdk'
import { useAppStore } from '@/store/app-store'
import {
  LayoutDashboard,
  Wallet,
  ArrowLeftRight,
  Target,
  Settings,
  Sparkles,
  Plus,
  Receipt
} from 'lucide-react'
import { formatMoney } from '@/lib/utils'

interface TxHit {
  id: number
  description: string
  amount: number
  date: string
  type: string
  category_name?: string
}

export function CommandPalette(): JSX.Element | null {
  const { commandOpen, setCommandOpen, setTransactionModalOpen, profile, rates } = useAppStore()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [txHits, setTxHits] = useState<TxHit[]>([])

  useEffect(() => {
    if (!commandOpen) {
      setSearch('')
      setTxHits([])
    }
  }, [commandOpen])

  useEffect(() => {
    if (!search.trim() || search.length < 2) {
      setTxHits([])
      return
    }
    const t = setTimeout(() => {
      window.api.transactions.search(search.trim(), 8).then((r) => setTxHits(r as TxHit[]))
    }, 200)
    return () => clearTimeout(t)
  }, [search])

  if (!commandOpen) return null

  const run = (fn: () => void): void => {
    fn()
    setCommandOpen(false)
  }

  const navItems = [
    { label: 'Dashboard', icon: LayoutDashboard, path: '/' },
    { label: 'Budget', icon: Wallet, path: '/budget' },
    { label: 'Transactions', icon: ArrowLeftRight, path: '/transactions' },
    { label: 'Goals', icon: Target, path: '/goals' },
    { label: 'AI Assistant', icon: Sparkles, path: '/ai' },
    { label: 'Settings', icon: Settings, path: '/settings' }
  ]

  const filteredNav = navItems.filter((item) =>
    item.label.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[20vh]">
      <Command
        className="w-full max-w-lg overflow-hidden rounded-xl border bg-popover shadow-2xl"
        label="Command palette"
        shouldFilter={false}
      >
        <Command.Input
          value={search}
          onValueChange={setSearch}
          placeholder="Search transactions, jump to section..."
          className="w-full border-b bg-transparent px-4 py-3 text-sm outline-none"
        />
        <Command.List className="max-h-80 overflow-auto p-2">
          {filteredNav.length === 0 && txHits.length === 0 && (
            <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
              No results found.
            </Command.Empty>
          )}
          {filteredNav.length > 0 && (
            <Command.Group heading="Navigate">
              {filteredNav.map((item) => (
                <Command.Item
                  key={item.path}
                  value={item.label}
                  onSelect={() => run(() => navigate(item.path))}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm aria-selected:bg-accent"
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Command.Item>
              ))}
            </Command.Group>
          )}
          {txHits.length > 0 && (
            <Command.Group heading="Transactions">
              {txHits.map((tx) => (
                <Command.Item
                  key={tx.id}
                  value={`${tx.description}-${tx.id}`}
                  onSelect={() => run(() => navigate('/transactions'))}
                  className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm aria-selected:bg-accent"
                >
                  <span className="flex items-center gap-2 truncate">
                    <Receipt className="h-4 w-4 shrink-0" />
                    <span className="truncate">{tx.description}</span>
                  </span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {formatMoney(tx.amount, profile.displayCurrency, rates)}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
          <Command.Group heading="Actions">
            <Command.Item
              onSelect={() => run(() => setTransactionModalOpen(true))}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm aria-selected:bg-accent"
            >
              <Plus className="h-4 w-4" />
              Add transaction
            </Command.Item>
          </Command.Group>
        </Command.List>
      </Command>
      <button
        className="fixed inset-0 -z-10"
        onClick={() => setCommandOpen(false)}
        aria-label="Close command palette"
      />
    </div>
  )
}
