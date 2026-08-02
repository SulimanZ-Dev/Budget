import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useAppStore, type DisplayCurrency } from '@/store/app-store'
import { SUPPORTED_LOCALES, LOCALE_LABELS, type AppLocale } from '@/lib/utils'
import { Download, Upload, Trash2, Key, Printer, Lock, RotateCcw, Play, FileText } from 'lucide-react'
import { InfoTooltip } from '@/components/shared/info-tooltip'
import { IntegrityPanel } from '@/components/integrity/integrity-panel'
import { PluginRegistry } from '@/components/plugins/plugin-registry'
import { SchedulerCard } from '@/components/shared/scheduler-card'
import { FinancialSettingsTools } from '@/components/settings/financial-settings-tools'
import { RuleEditor } from '@/components/shared/rule-editor'
import { useAppDialog } from '@/components/shared/app-dialog'
import { createSeededRandom } from '@/lib/demo-random'

interface DemoResult {
  accounts: number
  categories: number
  members: number
  subscriptions: number
  transactions: number
  goals: number
  incomeSources: number
  savingsSources: number
  taxEntries: number
  budgetEntries: number
  wealthSnapshots: number
  holdings: number
  investments: number
  rules: number
  moods: number
  debtPayments: number
  transactionDetails: number
  refundLinks: number
  transferCandidates: number
  linkedSubscriptions: number
  savedFilters: number
  merchantAliases: number
  recurringPatterns: number
  reconciliations: number
  rolloverCategories: number
}

interface CategoryOption {
  id: number
  name: string
}

interface AccountOption {
  id: number
  name: string
  type?: string
  is_archived?: number
}

interface AuditFixState {
  brokenLinks: unknown[]
  duplicateSubscriptionTransactions: unknown[]
  missingAccountTransactions: unknown[]
  recurringArchivedAccounts: unknown[]
}

function randomInt(min: number, max: number): number {
  return Math.floor(demoRandom() * (max - min + 1)) + min
}

let demoRandom = Math.random

function pick<T>(items: T[]): T {
  return items[randomInt(0, items.length - 1)]
}

function localIsoDate(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

function AuditFixMetric({ label, count }: { label: string; count: number }): JSX.Element {
  return (
    <div className={`rounded-lg border p-3 ${count > 0 ? 'border-warning/40 bg-warning/5' : 'bg-muted/30'}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={count > 0 ? 'text-xl font-semibold text-warning' : 'text-xl font-semibold'}>{count}</p>
    </div>
  )
}

function randomDateWithinMonths(monthsBack: number): string {
  const date = new Date()
  date.setDate(date.getDate() - randomInt(0, monthsBack * 30))
  return localIsoDate(date)
}

function randomFutureDateWithinMonths(monthsAhead: number): string {
  const date = new Date()
  date.setDate(date.getDate() + randomInt(30, monthsAhead * 30))
  return localIsoDate(date)
}

function dateMonthsAgo(monthsBack: number, day = 15): string {
  const date = new Date()
  date.setDate(1)
  date.setMonth(date.getMonth() - monthsBack)
  date.setDate(Math.min(day, 28))
  return localIsoDate(date)
}

export function SettingsPage(): JSX.Element {
  const { profile, setProfile, selectedMonth, triggerRefresh } = useAppStore()
  const dialog = useAppDialog()
  const [apiKey, setApiKey] = useState('')
  const [members, setMembers] = useState<{ id: number; name: string }[]>([])
  const [newMember, setNewMember] = useState('')
  const [saved, setSaved] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changePasswordError, setChangePasswordError] = useState('')
  const [changePasswordSuccess, setChangePasswordSuccess] = useState(false)
  const [changePasswordLoading, setChangePasswordLoading] = useState(false)
  const [appVersion, setAppVersion] = useState('')
  const [lastBackup, setLastBackup] = useState<string | null>(null)
  const [taxExportCategories, setTaxExportCategories] = useState<CategoryOption[]>([])
  const [selectedTaxCategoryIds, setSelectedTaxCategoryIds] = useState<Set<number>>(new Set())
  const [auditFix, setAuditFix] = useState<AuditFixState | null>(null)
  const [auditFixLoading, setAuditFixLoading] = useState(false)
  const [demoRunning, setDemoRunning] = useState(false)
  const [demoActive, setDemoActive] = useState(false)
  const [demoStatus, setDemoStatus] = useState<{ active: boolean; seed?: number | null; preset?: string | null; databasePath?: string | null; counts?: Record<string, number> }>({ active: false })
  const [demoSeed, setDemoSeed] = useState(() => String(Math.floor(Math.random() * 2147483647)))
  const [demoPreset, setDemoPreset] = useState('random')

  useEffect(() => {
    window.api.members.list().then(setMembers)
    window.api.getVersion().then(setAppVersion)
    window.api.demo.status().then((status: typeof demoStatus) => { setDemoActive(status.active); setDemoStatus(status); if (status.seed != null) setDemoSeed(String(status.seed)); if (status.preset) setDemoPreset(status.preset) })
    window.api.settings.get('lastDbBackup').then((v: string | null) => setLastBackup(v))
    window.api.categories.list().then((rows) => {
      const categoryRows = (rows as CategoryOption[]).filter((category) => Number.isInteger(category.id))
      setTaxExportCategories(categoryRows)
    })
  }, [])

  async function handleExportBackup(): Promise<void> {
    await window.api.data.exportDb()
    const now = new Date().toISOString().slice(0, 10)
    await window.api.settings.set('lastDbBackup', now)
    setLastBackup(now)
  }

  function toggleTaxCategory(categoryId: number): void {
    setSelectedTaxCategoryIds((current) => {
      const next = new Set(current)
      if (next.has(categoryId)) next.delete(categoryId)
      else next.add(categoryId)
      return next
    })
  }

  async function handleTaxReviewExport(): Promise<void> {
    const result = await window.api.reports.taxReviewExport(profile.year, [...selectedTaxCategoryIds])
    if (result?.filePath) {
      await dialog.alert(`Exported ${result.rowCount} rows to ${result.filePath}.`, 'Tax export complete')
    }
  }

  async function scanAuditFix(): Promise<void> {
    setAuditFixLoading(true)
    try {
      setAuditFix(await window.api.data.auditFixScan() as AuditFixState)
    } finally {
      setAuditFixLoading(false)
    }
  }

  async function applyAuditFix(): Promise<void> {
    if (!await dialog.confirm('Fix broken recurring links, duplicate subscription transactions, and missing account references?', {
      title: 'Apply audit fixes',
      confirmLabel: 'Fix data'
    })) return
    setAuditFixLoading(true)
    try {
      const result = await window.api.data.auditFixApply() as { clearedBrokenLinks: number; removedDuplicates: number; reassignedTransactions: number }
      await dialog.alert(
        `Fixed ${result.clearedBrokenLinks} broken links, removed ${result.removedDuplicates} duplicate transactions, and reassigned ${result.reassignedTransactions} transactions.`,
        'Audit fix complete'
      )
      await scanAuditFix()
      triggerRefresh()
    } finally {
      setAuditFixLoading(false)
    }
  }

  async function generateDemoData(seed: number, preset: string): Promise<DemoResult> {
    demoRandom = createSeededRandom(seed)
    if (preset === 'empty') {
      triggerRefresh()
      return { accounts: 0, categories: 0, members: 0, subscriptions: 0, transactions: 0, goals: 0, incomeSources: 0, savingsSources: 0, taxEntries: 0, budgetEntries: 0, wealthSnapshots: 0, holdings: 0, investments: 0, rules: 0, moods: 0, debtPayments: 0, transactionDetails: 0, refundLinks: 0, transferCandidates: 0, linkedSubscriptions: 0, savedFilters: 0, merchantAliases: 0, recurringPatterns: 0, reconciliations: 0, rolloverCategories: 0 }
    }
    const demoCategorySpecs = [
      { name: 'Groceries', icon: 'shopping-bag', color: '#22c55e', budgetAmount: 5200, isFixed: false, sortOrder: 10 },
      { name: 'Transport', icon: 'car', color: '#0ea5e9', budgetAmount: 1800, isFixed: false, sortOrder: 11 },
      { name: 'Dining', icon: 'utensils', color: '#f97316', budgetAmount: 2600, isFixed: false, sortOrder: 12 },
      { name: 'Utilities', icon: 'zap', color: '#eab308', budgetAmount: 2400, isFixed: true, sortOrder: 13 },
      { name: 'Housing', icon: 'home', color: '#8b5cf6', budgetAmount: 12500, isFixed: true, sortOrder: 14 },
      { name: 'Health', icon: 'heart-pulse', color: '#ef4444', budgetAmount: 1200, isFixed: false, sortOrder: 15 },
      { name: 'Shopping', icon: 'shopping-bag', color: '#ec4899', budgetAmount: 2200, isFixed: false, sortOrder: 16 },
      { name: 'Fun', icon: 'gamepad-2', color: '#14b8a6', budgetAmount: 1800, isFixed: false, sortOrder: 17 }
    ]
    let categories = await window.api.categories.list() as { id: number; name: string }[]
    let createdCategories = 0
    for (const spec of demoCategorySpecs) {
      if (categories.some((category) => category.name.toLowerCase() === spec.name.toLowerCase())) continue
      const created = await window.api.categories.create(spec) as { id: number; name: string }
      categories = [...categories, { id: created.id, name: spec.name }]
      createdCategories++
    }
    const expenseCategories = categories.filter((category) =>
      demoCategorySpecs.some((spec) => spec.name.toLowerCase() === category.name.toLowerCase())
    )
    const currentYear = profile.year
    const currentMonth = selectedMonth ?? new Date().getMonth() + 1
    const subscriptions = ['Netflix', 'Spotify', 'Gym', 'Rent', 'Phone Plan', 'Cloud Storage', 'Transit Pass', 'Meal Kit']
    const merchants = [
      'ICA groceries',
      'Coop market',
      'Espresso House',
      'Apotek purchase',
      'Train ticket',
      'Bookstore',
      'Hardware store',
      'Lunch cafe',
      'Electric bill',
      'Freelance invoice'
    ]
    const incomeNames = ['Salary', 'Consulting retainer', 'Side project', 'Quarterly bonus']
    const savingsNames = ['Emergency fund transfer', 'Index fund auto-save', 'Holiday account', 'Apartment deposit']
    const holdings = [
      { etfName: 'Global Index ETF', ticker: 'GLOBAL' },
      { etfName: 'Nordic Dividend Fund', ticker: 'NORD' },
      { etfName: 'Green Bonds ETF', ticker: 'GREEN' }
    ]
    const legacyInvestments = ['Company RSU plan', 'Robo-advisor account', 'Education fund']
    const rulePatterns = [
      { pattern: 'ICA', category: expenseCategories.find((c) => /food|grocer|market/i.test(c.name)) ?? pick(expenseCategories) },
      { pattern: 'Espresso', category: expenseCategories.find((c) => /food|dining|coffee/i.test(c.name)) ?? pick(expenseCategories) },
      { pattern: 'Train', category: expenseCategories.find((c) => /transport|travel/i.test(c.name)) ?? pick(expenseCategories) }
    ]
    const subCount = randomInt(5, 8)
    const txCount = randomInt(60, 90)
    const incomeSourceCount = randomInt(2, 3)
    const savingsSourceCount = randomInt(2, 3)
    const demoRunId = seed
    let supplementalTransactions = 0
    const monthsToSeed = Array.from({ length: 6 }, (_, i) => {
      const date = new Date(currentYear, currentMonth - 1 - i, 1)
      return { year: date.getFullYear(), month: date.getMonth() + 1 }
    })

    const accountSpecs = [
      { name: `Demo Checking ${randomInt(1, 99)}`, type: 'checking', currency: profile.baseCurrency, openingBalance: randomInt(8000, 26000) },
      { name: `Demo Savings ${randomInt(1, 99)}`, type: 'savings', currency: profile.baseCurrency, openingBalance: randomInt(25000, 90000) },
      { name: `Demo Cash ${randomInt(1, 99)}`, type: 'cash', currency: profile.baseCurrency, openingBalance: randomInt(500, 2500) }
    ]
    const createdAccounts: AccountOption[] = []
    for (const account of accountSpecs) {
      const created = await window.api.accounts.create(account) as { id: number }
      createdAccounts.push({ id: created.id, name: account.name, type: account.type })
    }
    const accounts = createdAccounts.length > 0
      ? createdAccounts
      : (await window.api.accounts.list() as AccountOption[]).filter((account) => account.is_archived !== 1)
    const checkingAccount = accounts.find((account) => account.type === 'checking') ?? accounts[0]
    const savingsAccount = accounts.find((account) => account.type === 'savings') ?? accounts[0]

    const memberNames = [`Alex ${randomInt(1, 99)}`, `Sam ${randomInt(1, 99)}`]
    const createdMembers: { id: number; name: string }[] = []
    for (const name of memberNames) {
      const member = await window.api.members.create({ name }) as { id: number; name: string }
      createdMembers.push(member)
    }

    for (let i = 0; i < incomeSourceCount; i++) {
      const amount = randomInt(12000, 42000)
      const created = await window.api.income.createSource({
        name: `${pick(incomeNames)} ${randomInt(1, 99)}`,
        amount,
        grossOrNet: pick(['gross', 'net']),
        isRecurring: i !== incomeSourceCount - 1,
        frequency: pick(['monthly', 'monthly', 'fortnightly']),
        color: pick(['#22c55e', '#14b8a6', '#0ea5e9', '#84cc16']),
        accountId: checkingAccount?.id,
        nextBillingDate: randomFutureDateWithinMonths(2)
      }) as { id: number }
      for (const period of monthsToSeed) {
        await window.api.income.setEntry({
          sourceId: created.id,
          year: period.year,
          month: period.month,
          amount: amount + randomInt(-1500, 2500),
          isIrregular: demoRandom() < 0.25
        })
      }
    }

    for (let i = 0; i < savingsSourceCount; i++) {
      await window.api.transactions.create({
        description: `${pick(savingsNames)} ${randomInt(1, 99)}`,
        amount: randomInt(800, 4500),
        type: 'savings',
        categoryId: undefined,
        accountId: savingsAccount?.id,
        date: dateMonthsAgo(randomInt(0, 2), randomInt(3, 24)),
        isRecurring: true,
        allowDuplicate: true,
        notes: 'Demo recurring savings'
      })
    }

    const createdSubscriptionIds: number[] = []
    for (let i = 0; i < subCount; i++) {
      const name = `${pick(subscriptions)} ${randomInt(1, 99)}`
      const created = await window.api.subscriptions.create({
        name,
        amount: randomInt(79, 14900),
        frequency: pick(['weekly', 'monthly', 'monthly', 'yearly']),
        nextBillingDate: randomFutureDateWithinMonths(2),
        websiteUrl: pick(['https://example.com', '']),
        icon: 'credit-card',
        color: pick(['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6']),
        notes: 'Demo data',
        taxDeductible: i === 0 || demoRandom() < 0.35,
        onHold: demoRandom() < 0.2,
        accountId: checkingAccount?.id
      }) as { id: number }
      createdSubscriptionIds.push(created.id)
    }

    let linkedSubscriptions = 0
    const subscriptionWithHistory = createdSubscriptionIds[0]
    if (subscriptionWithHistory && checkingAccount) {
      for (const [monthsBack, amount] of [[3, 89], [1, 109]] as const) {
        await window.api.transactions.create({
          description: 'Demo streaming subscription',
          amount,
          type: 'expense',
          accountId: checkingAccount.id,
          categoryId: expenseCategories[0]?.id,
          date: dateMonthsAgo(monthsBack, 12),
          isRecurring: false,
          allowDuplicate: true,
          notes: `subscription:${subscriptionWithHistory}`
        })
        supplementalTransactions++
      }
      const linked = await window.api.subscriptions.link(subscriptionWithHistory) as { success?: boolean }
      if (linked.success) linkedSubscriptions++
    }

    for (let i = 0; i < txCount; i++) {
      const type = demoRandom() < 0.12 ? 'income' : demoRandom() < 0.2 ? 'savings' : 'expense'
      const category = pick(expenseCategories)
      await window.api.transactions.create({
        description: type === 'income' ? pick(['Salary payout', 'Freelance invoice', 'Refund received']) : pick(merchants),
        amount: type === 'income' ? randomInt(12000, 42000) : randomInt(45, 3200),
        type,
        accountId: type === 'savings' ? savingsAccount?.id : checkingAccount?.id,
        categoryId: type === 'expense' ? category.id : undefined,
        date: randomDateWithinMonths(randomInt(6, 11)),
        isRecurring: false,
        isUnnecessary: type === 'expense' && demoRandom() < 0.12,
        memberId: pick(createdMembers).id,
        allowDuplicate: true,
        notes: 'Demo data'
      })
    }

    let transactionDetails = 0
    let refundLinks = 0
    let transferCandidates = 0
    let savedFilters = 0
    let merchantAliases = 0
    let recurringPatterns = 0
    let reconciliations = 0

    if (checkingAccount && expenseCategories.length >= 2 && createdMembers.length > 0) {
      const splitTransaction = await window.api.transactions.create({
        description: 'Demo shared grocery and household shop',
        amount: 1200,
        type: 'expense',
        accountId: checkingAccount.id,
        categoryId: expenseCategories[0].id,
        date: dateMonthsAgo(1, 18),
        isRecurring: false,
        allowDuplicate: true,
        notes: 'Open transaction details to see split, tags, sharing, and bank status'
      }) as { id: number }
      supplementalTransactions++
      await window.api.transactions.setSplits(splitTransaction.id, [
        { categoryId: expenseCategories[0].id, amount: 850 },
        { categoryId: expenseCategories[1].id, amount: 350 }
      ])
      transactionDetails++
      await window.api.transactions.setTags(splitTransaction.id, ['demo', 'household', 'shared'])
      transactionDetails++
      await window.api.transactions.setSharedExpenses(splitTransaction.id, [{
        memberId: createdMembers[1]?.id ?? createdMembers[0].id,
        personName: createdMembers[1]?.name ?? createdMembers[0].name,
        amount: 600,
        settled: false
      }])
      transactionDetails++
      await window.api.transactions.reconcile(splitTransaction.id, true)
      transactionDetails++

      const refundExpense = await window.api.transactions.create({
        description: 'Demo returned purchase', amount: 650, type: 'expense',
        accountId: checkingAccount.id, categoryId: expenseCategories[0].id,
        date: dateMonthsAgo(2, 8), isRecurring: false, allowDuplicate: true, notes: 'Demo refund source'
      }) as { id: number }
      const refundIncome = await window.api.transactions.create({
        description: 'Demo purchase refund', amount: 650, type: 'income',
        accountId: checkingAccount.id, date: dateMonthsAgo(2, 11),
        isRecurring: false, allowDuplicate: true, notes: 'Demo linked refund'
      }) as { id: number }
      supplementalTransactions += 2
      await window.api.transactions.linkRefund(refundExpense.id, refundIncome.id)
      refundLinks++

      if (savingsAccount && savingsAccount.id !== checkingAccount.id) {
        const transferDate = dateMonthsAgo(1, 10)
        await window.api.transactions.create({
          description: 'Demo account transfer', amount: 2400, type: 'expense',
          accountId: checkingAccount.id, date: transferDate,
          isRecurring: false, allowDuplicate: true, notes: 'Convert this pair in Transaction tools'
        })
        await window.api.transactions.create({
          description: 'Demo account transfer', amount: 2400, type: 'income',
          accountId: savingsAccount.id, date: transferDate,
          isRecurring: false, allowDuplicate: true, notes: 'Convert this pair in Transaction tools'
        })
        supplementalTransactions += 2
        transferCandidates++
      }

      const aliasPattern = `Demo Market ${demoRunId}`
      await window.api.merchants.saveAlias(aliasPattern, 'Demo Market')
      merchantAliases++
      for (let monthsBack = 0; monthsBack < 4; monthsBack++) {
        await window.api.transactions.create({
          description: `${aliasPattern} purchase`, amount: 420 + monthsBack * 15, type: 'expense',
          accountId: checkingAccount.id, categoryId: expenseCategories[0].id,
          date: dateMonthsAgo(monthsBack, 1), isRecurring: false, allowDuplicate: true,
          notes: 'Demo recurring merchant pattern'
        })
        supplementalTransactions++
      }
      recurringPatterns++

      await window.api.filters.save(`Demo unreconciled expenses ${demoRunId}`, {
        minAmount: '500', maxAmount: '', dateFrom: '', dateTo: '', reconciled: 'no'
      })
      savedFilters++
    }

    if (savingsAccount) {
      const statementDate = localIsoDate(new Date())
      const preview = await window.api.reconciliation.preview(savingsAccount.id, statementDate, 0) as { calculatedBalance: number }
      await window.api.reconciliation.complete(savingsAccount.id, statementDate, preview.calculatedBalance)
      reconciliations++
    }

    await window.api.tax.setYearSettings({
      year: currentYear,
      expectedYearlyTaxOwed: randomInt(98000, 185000)
    })
    let taxEntries = 0
    for (const period of monthsToSeed) {
      const incomeGross = randomInt(36000, 62000)
      const taxPaid = randomInt(9000, 18500)
      await window.api.tax.setEntry({
        year: period.year,
        month: period.month,
        incomeGross,
        incomeNetActual: incomeGross - taxPaid,
        supposedNetIncome: incomeGross - randomInt(10500, 19500)
      })
      taxEntries++
    }

    if (checkingAccount && expenseCategories[0]) {
      const createPresetTransaction = async (description: string, amount: number, type: 'expense' | 'income', date: string, accountId = checkingAccount.id, categoryId: number | null | undefined = expenseCategories[0].id): Promise<void> => {
        await window.api.transactions.create({ description, amount, type, accountId, categoryId, date, isRecurring: false, allowDuplicate: true, notes: `Demo preset: ${preset}` })
        supplementalTransactions++
      }
      if (preset === 'overspent') await createPresetTransaction('Emergency home repair', 65000, 'expense', localIsoDate(new Date()))
      if (preset === 'duplicates') {
        const date = localIsoDate(new Date())
        await createPresetTransaction('Duplicate card purchase', 799, 'expense', date)
        await createPresetTransaction('Duplicate card purchase', 799, 'expense', date)
      }
      if (preset === 'missing-categories') {
        for (let i = 0; i < 8; i++) await createPresetTransaction(`Uncategorized demo purchase ${i + 1}`, 125 + i * 37, 'expense', dateMonthsAgo(0, Math.min(28, i + 1)), checkingAccount.id, null)
      }
      if (preset === 'transfers' && savingsAccount) {
        for (let i = 0; i < 8; i++) {
          const date = dateMonthsAgo(i % 4, 4 + i)
          await createPresetTransaction(`Transfer batch ${i + 1}`, 500 + i * 250, 'expense', date, checkingAccount.id, undefined)
          await createPresetTransaction(`Transfer batch ${i + 1}`, 500 + i * 250, 'income', date, savingsAccount.id, undefined)
        }
      }
      if (preset === 'year-boundary') {
        await createPresetTransaction('New Year expense', 2026, 'expense', `${currentYear}-12-31`)
        await createPresetTransaction('New Year income', 2027, 'income', `${currentYear + 1}-01-01`, checkingAccount.id, undefined)
      }
    }
    if (preset === 'debt-heavy') {
      for (const [index, rate] of [24.9, 14.5, 8.2].entries()) {
        await window.api.goals.create({ name: `Stress debt ${index + 1}`, type: 'debt', creditor: `Demo creditor ${index + 1}`, targetAmount: 45000 + index * 55000, currentAmount: index * 2500, interestRate: rate, monthlyPayment: 900 + index * 700, nextPaymentDate: randomFutureDateWithinMonths(1), notes: 'Debt-heavy preset' })
      }
    }

    for (let i = 1; i <= 14; i++) {
      const date = new Date()
      date.setDate(date.getDate() - i)
      await window.api.transactions.create({
        description: pick(['Daily groceries', 'Transit tap', 'Lunch cafe', 'Evening pharmacy']),
        amount: randomInt(35, 260),
        type: 'expense',
        accountId: checkingAccount?.id,
        categoryId: pick(expenseCategories).id,
        date: localIsoDate(date),
        isRecurring: false,
        memberId: pick(createdMembers).id,
        allowDuplicate: true,
        notes: 'Demo streak data'
      })
    }

    const standardGoalSpecs = [
      { name: `Demo savings goal ${randomInt(1, 99)}`, type: 'savings', targetAmount: 90000, currentAmount: 0, monthlyPayment: 2500, notes: 'Savings goal populated from savings transactions' },
      { name: `Demo emergency fund ${randomInt(1, 99)}`, type: 'emergency', targetAmount: 75000, currentAmount: 0, monthlyPayment: 3000, notes: 'Emergency buffer goal' },
      { name: `Demo FIRE number ${randomInt(1, 99)}`, type: 'fire', targetAmount: 3500000, currentAmount: 0, monthlyPayment: 6500, notes: 'Long-term financial independence goal' },
      { name: `Demo custom goal ${randomInt(1, 99)}`, type: 'custom', targetAmount: 45000, currentAmount: 12500, monthlyPayment: 1800, notes: 'Custom goal with manually tracked progress' },
      { name: `Demo investment goal ${randomInt(1, 99)}`, type: 'investment', targetAmount: 250000, currentAmount: 0, monthlyPayment: 4000, notes: 'Progress follows investment holdings' }
    ]
    for (const goal of standardGoalSpecs) {
      await window.api.goals.create({
        ...goal,
        targetDate: randomFutureDateWithinMonths(goal.type === 'fire' ? 60 : 18)
      })
    }

    const debtSpecs = [
      { name: 'Demo credit card', creditor: 'Demo Bank', targetAmount: 36000, currentAmount: 4000, interestRate: 18.9, monthlyPayment: 1400, payments: [[1200, 3, 'Extra card payment'], [1500, 1, 'Monthly card payment']] as const },
      { name: 'Demo personal loan', creditor: 'Demo Finance', targetAmount: 120000, currentAmount: 18000, interestRate: 6.4, monthlyPayment: 3200, payments: [[3500, 2, 'Scheduled loan payment']] as const }
    ]
    let debtPayments = 0
    for (const debt of debtSpecs) {
      const created = await window.api.goals.create({
        name: `${debt.name} ${randomInt(1, 99)}`,
        type: 'debt',
        targetAmount: debt.targetAmount,
        currentAmount: debt.currentAmount,
        targetDate: randomFutureDateWithinMonths(36),
        interestRate: debt.interestRate,
        monthlyPayment: debt.monthlyPayment,
        creditor: debt.creditor,
        notes: 'Demo debt with minimum payment and payment history'
      }) as { id: number }
      for (const [amount, monthsBack, note] of debt.payments) {
        await window.api.goals.addDebtPayment(created.id, { amount, date: dateMonthsAgo(monthsBack, 20), note })
        debtPayments++
      }
    }
    const goalCount = standardGoalSpecs.length + debtSpecs.length

    let budgetEntries = 0
    const budgetCategories = expenseCategories.slice(0, Math.min(expenseCategories.length, 8))
    for (const period of monthsToSeed) {
      for (const category of budgetCategories) {
        await window.api.budget.setEntry({
          categoryId: category.id,
          year: period.year,
          month: period.month,
          amount: randomInt(700, 8500),
          notes: pick(['Demo planned spend', 'Demo seasonal adjustment', 'Demo regular category limit'])
        })
        budgetEntries++
      }
    }
    let rolloverCategories = 0
    for (const category of budgetCategories.slice(0, 2)) {
      await window.api.budget.setRollover(category.id, true)
      rolloverCategories++
    }

    for (let i = 0; i < 6; i++) {
      await window.api.wealth.create({
        date: dateMonthsAgo(5 - i, 28),
        assetsSavings: 25000 + i * randomInt(1800, 4200),
        assetsInvestments: 55000 + i * randomInt(2500, 6500),
        assetsProperty: 0,
        liabilitiesLoans: Math.max(0, 22000 - i * randomInt(1000, 2200)),
        liabilitiesCredit: randomInt(1500, 9000),
        notes: 'Demo monthly wealth snapshot'
      })
    }

    const demoHoldings = holdings.slice(0, randomInt(2, 3))
    for (const holding of demoHoldings) {
      const shares = randomInt(8, 75)
      const avgCost = randomInt(90, 650)
      const currentPrice = Math.round(avgCost * (0.92 + demoRandom() * 0.35))
      await window.api.investmentHoldings.create({
        etfName: holding.etfName,
        ticker: holding.ticker,
        shares,
        avgCost,
        currentPrice,
        currentValue: shares * currentPrice,
        notes: 'Demo holding'
      })
    }

    const investmentCount = randomInt(1, 2)
    for (let i = 0; i < investmentCount; i++) {
      const purchasePrice = randomInt(8000, 65000)
      await window.api.investments.create({
        name: `${pick(legacyInvestments)} ${randomInt(1, 99)}`,
        purchasePrice,
        currentValue: Math.round(purchasePrice * (0.85 + demoRandom() * 0.45)),
        purchaseDate: dateMonthsAgo(randomInt(4, 24), randomInt(1, 24)),
        notes: 'Demo legacy investment'
      })
    }

    await window.api.pension.save({
      current: randomInt(85000, 240000),
      monthly: randomInt(2500, 9000),
      returnRate: pick([4.5, 5.5, 6.5, 7]),
      retirementAge: pick([62, 65, 67])
    })

    let createdRules = 0
    for (const [index, rule] of rulePatterns.entries()) {
      if (rule.category?.id) {
        await window.api.rules.create({
          pattern: `Demo ${rule.pattern} rule ${demoRunId}`,
          categoryId: rule.category.id,
          priority: 50 + index * 25,
          applyFutureOnly: index === rulePatterns.length - 1,
          conditions: {
            kind: 'group',
            operator: 'AND',
            children: [
              { kind: 'condition', type: 'description_contains', value: rule.pattern },
              { kind: 'condition', type: 'type_is', value: 'expense' }
            ]
          }
        })
        createdRules++
      }
    }

    const moods = ['🙂', '😐', '😄', '😌']
    for (const period of monthsToSeed) {
      await window.api.mood.set({
        year: period.year,
        month: period.month,
        rating: randomInt(2, 5),
        emoji: pick(moods)
      })
    }

    triggerRefresh()
    return {
      accounts: createdAccounts.length,
      categories: createdCategories,
      members: createdMembers.length,
      subscriptions: subCount,
      transactions: txCount + 14 + supplementalTransactions,
      goals: goalCount,
      incomeSources: incomeSourceCount,
      savingsSources: savingsSourceCount,
      taxEntries,
      budgetEntries,
      wealthSnapshots: 6,
      holdings: demoHoldings.length,
      investments: investmentCount,
      rules: createdRules,
      moods: monthsToSeed.length,
      debtPayments,
      transactionDetails,
      refundLinks,
      transferCandidates,
      linkedSubscriptions,
      savedFilters,
      merchantAliases,
      recurringPatterns,
      reconciliations,
      rolloverCategories
    }
  }

  async function handleRunDemo(replay = false): Promise<void> {
    if (demoRunning) return
    const confirmed = await dialog.confirm(
      demoActive
        ? 'Reset the isolated demo environment and generate a new randomized dataset? Your real financial data will remain untouched.'
        : 'Start an isolated demo environment? The app will switch to a separate encrypted database and your real financial data will remain untouched.',
      {
        title: demoActive ? 'Reset demo environment' : 'Start demo environment',
        confirmLabel: demoActive ? 'Reset demo' : 'Start demo',
        destructive: demoActive
      }
    )
    if (!confirmed) return
    setDemoRunning(true)
    try {
      const seed = replay && demoStatus.seed != null ? demoStatus.seed : Math.max(1, Math.trunc(Number(demoSeed)) || Math.floor(Math.random() * 2147483647))
      const preset = replay ? demoStatus.preset ?? demoPreset : demoPreset
      await window.api.demo.enter()
      await window.api.demo.configure(seed, preset)
      await window.api.settings.setProfile({ ...profile, name: profile.name || 'Demo Developer' })
      await window.api.settings.set('onboardingComplete', true)
      await window.api.settings.set('selectedMonth', selectedMonth)
      const result = await generateDemoData(seed, preset)
      await dialog.alert(
        `The isolated demo environment is ready. Seed ${seed}, preset ${preset}. Added ${result.accounts} accounts, ${result.categories} categories, ${result.members} members, ${result.subscriptions} subscriptions, ${result.transactions} transactions, ${result.goals} goals, ${result.debtPayments} debt payments, ${result.incomeSources} income sources, ${result.savingsSources} savings sources, ${result.taxEntries} tax entries, ${result.budgetEntries} budget entries, ${result.wealthSnapshots} wealth snapshots, ${result.holdings} holdings, ${result.investments} legacy investments, ${result.rules} advanced rules, and ${result.moods} mood entries.\n\nAdvanced examples: ${result.transactionDetails} transaction-detail tools, ${result.refundLinks} refund link, ${result.transferCandidates} transfer candidate, ${result.linkedSubscriptions} linked subscription with price history, ${result.savedFilters} saved filter, ${result.merchantAliases} merchant alias, ${result.recurringPatterns} recurring merchant pattern, ${result.reconciliations} account reconciliation, and rollover on ${result.rolloverCategories} budget categories.`,
        'Demo environment ready'
      )
      window.location.reload()
    } catch (error) {
      await dialog.alert(
        `${error instanceof Error ? error.message : 'Failed to generate demo data.'}\n\nYour real financial database was not modified.`,
        'Demo data failed'
      )
      window.location.reload()
    } finally {
      setDemoRunning(false)
    }
  }

  async function saveProfile(updates: Partial<typeof profile> = {}): Promise<void> {
    const nextProfile = { ...useAppStore.getState().profile, ...updates }
    await window.api.settings.setProfile(nextProfile)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function saveApiKey(): Promise<void> {
    if (apiKey) {
      await window.api.ai.saveKey(apiKey)
      setApiKey('')
    }
  }

  async function handleChangePassword(): Promise<void> {
    setChangePasswordError('')
    setChangePasswordSuccess(false)
    if (!currentPassword) {
      setChangePasswordError('Current password is required')
      return
    }
    if (!newPassword || newPassword.length < 8) {
      setChangePasswordError('New password must be at least 8 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      setChangePasswordError('Passwords do not match')
      return
    }
    setChangePasswordLoading(true)
    try {
      const result = await window.api.encryption.changePassword(currentPassword, newPassword)
      if (result.success) {
        setChangePasswordSuccess(true)
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
        setTimeout(() => setChangePasswordSuccess(false), 3000)
      } else {
        setChangePasswordError(result.error || 'Failed to change password')
      }
    } catch {
      setChangePasswordError('Failed to change password')
    } finally {
      setChangePasswordLoading(false)
    }
  }

  async function setTheme(theme: 'system' | 'light' | 'dark'): Promise<void> {
    setProfile({ theme })
    await window.api.theme.set(theme)
    document.documentElement.classList.toggle(
      'dark',
      theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    )
    saveProfile({ theme })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6 pb-20">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label>Name</Label>
            <Input
              value={profile.name}
              onChange={(e) => setProfile({ name: e.target.value })}
              onBlur={() => saveProfile()}
            />
          </div>
          <div className="grid gap-2">
            <Label>Household members</Label>
            <div className="flex gap-2">
              <Input
                placeholder="Add member"
                value={newMember}
                onChange={(e) => setNewMember(e.target.value)}
              />
              <Button
                onClick={async () => {
                  if (newMember) {
                    await window.api.members.create({ name: newMember })
                    setNewMember('')
                    setMembers(await window.api.members.list())
                  }
                }}
              >
                Add
              </Button>
            </div>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {members.map((m) => (
                <li key={m.id} className="flex items-center justify-between rounded border px-3 py-1"><span>{m.name}</span><Button size="icon" variant="ghost" aria-label={`Delete ${m.name}`} onClick={async () => { await window.api.members.delete(m.id); setMembers(await window.api.members.list()) }}><Trash2 className="h-4 w-4" /></Button></li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Currency</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">Base currency (how amounts are stored):</p>
          <Select
            value={profile.baseCurrency || 'SEK'}
            onValueChange={(v) => {
              const baseCurrency = v as DisplayCurrency
              setProfile({ baseCurrency })
              saveProfile({ baseCurrency })
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="SEK">SEK (kr)</SelectItem>
              <SelectItem value="EUR">EUR (€)</SelectItem>
              <SelectItem value="USD">USD ($)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">Display toggle:</p>
          <Select
            value={profile.displayCurrency}
            onValueChange={(v) => {
              const displayCurrency = v as DisplayCurrency
              setProfile({ displayCurrency })
              saveProfile({ displayCurrency })
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="SEK">SEK (kr)</SelectItem>
              <SelectItem value="EUR">EUR (€)</SelectItem>
              <SelectItem value="USD">USD ($)</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tax & inflation</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Label>CPI inflation %</Label>
            <Input
              type="number"
              value={profile.cpiPercent}
              onChange={(e) => {
                const next = Number.parseFloat(e.target.value)
                setProfile({ cpiPercent: Number.isFinite(next) ? next : 0 })
              }}
              onBlur={() => saveProfile()}
            />
          </div>
          <div className="grid gap-2">
            <Label>Tax withheld %</Label>
            <Input
              type="number"
              value={profile.taxWithheldPercent}
              onChange={(e) => {
                const next = Number.parseFloat(e.target.value)
                setProfile({ taxWithheldPercent: Number.isFinite(next) ? next : 0 })
              }}
              onBlur={() => saveProfile()}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-4 w-4" />
            AI Assistant
            <InfoTooltip content="Your API key is stored in Windows Credential Manager when available, or encrypted locally. The key is never sent anywhere except to the Claude API when you ask a question." />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Claude API key (claude-sonnet-4-20250514). Stored in Windows Credential Manager when
            available.
          </p>
          <Input
            type="password"
            placeholder="sk-ant-..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <div className="flex gap-2">
            <Button onClick={saveApiKey}>Save API key</Button>
            <Button variant="destructive" onClick={() => window.api.ai.deleteKey()}>
              Remove key
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select value={profile.theme} onValueChange={(v) => setTheme(v as 'system' | 'light' | 'dark')}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">System</SelectItem>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center justify-between">
            <Label>Colorblind-friendly chart palette</Label>
            <Switch
              checked={profile.colorBlindMode}
              onCheckedChange={(v) => {
                setProfile({ colorBlindMode: v })
                saveProfile({ colorBlindMode: v })
              }}
            />
          </div>
          <div className="grid gap-2">
            <Label>Locale (number/date formatting)</Label>
            <Select
              value={profile.locale}
              onValueChange={(v) => {
                const locale = v as AppLocale
                setProfile({ locale })
                saveProfile({ locale })
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_LOCALES.map((l) => (
                  <SelectItem key={l} value={l}>
                    {LOCALE_LABELS[l]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Display</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Budget alerts (80% threshold)</Label>
            <Switch
              checked={profile.notificationsEnabled}
              onCheckedChange={(v) => {
                setProfile({ notificationsEnabled: v })
                saveProfile({ notificationsEnabled: v })
              }}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label>Auto-hide zero-value categories</Label>
            <Switch
              checked={profile.autoHideZeroCategories}
              onCheckedChange={(v) => {
                setProfile({ autoHideZeroCategories: v })
                saveProfile({ autoHideZeroCategories: v })
              }}
            />
          </div>
          <div className="grid gap-2">
            <Label>Savings rate target (%)</Label>
            <Input
              type="number"
              value={profile.savingsRateTarget}
              onChange={(e) => {
                const next = Number.parseFloat(e.target.value)
                setProfile({ savingsRateTarget: Number.isFinite(next) ? next : 20 })
              }}
              onBlur={() => saveProfile()}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Backup</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {lastBackup
              ? `Last backup: ${lastBackup}`
              : 'No backup yet. Schedule regular backups to protect your data.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={handleExportBackup}>
              <Download className="h-4 w-4" />
              Backup now (SQLite)
            </Button>
            <Button variant="outline" onClick={() => window.api.data.exportJson()}>
              <Download className="h-4 w-4" />
              Export JSON
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Data</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => window.api.data.exportDb()}>
            <Download className="h-4 w-4" />
            Export SQLite
          </Button>
          <Button variant="outline" onClick={() => window.api.data.exportJson()}>
            <Download className="h-4 w-4" />
            Export JSON
          </Button>
          <Button variant="outline" onClick={() => window.api.data.importJson()}>
            <Upload className="h-4 w-4" />
            Import JSON
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              const result = await window.api.data.importDb()
              if (result) {
                await dialog.alert('Database imported. Restart the app to apply changes.', 'Import complete')
              }
            }}
          >
            <Upload className="h-4 w-4" />
            Import SQLite
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              if (await dialog.confirm('Rebuild the transactions table from event history? Data loss is possible if events are incomplete.', {
                title: 'Repair from events',
                confirmLabel: 'Repair'
              })) {
                const result = await window.api.data.repairFromEvents()
                if (result.success) {
                  await dialog.alert(`Repair complete. Rebuilt ${result.count} transactions from events.`, 'Repair complete')
                  window.location.reload()
                } else {
                  await dialog.alert('Repair failed: ' + (result.error || 'Unknown error'), 'Repair failed')
                }
              }
            }}
          >
            <RotateCcw className="h-4 w-4" />
            Repair from events
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              await window.api.currency.fetch()
              await dialog.alert('Exchange rates refreshed.', 'Rates refreshed')
            }}
          >
            <RotateCcw className="h-4 w-4" />
            Refresh rates
          </Button>
          <Button
            variant="outline"
            onClick={() => window.location.hash = '#/report?print=1'}
          >
            <Printer className="h-4 w-4" />
            Year-end PDF
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              await window.api.encryption.lock()
              window.location.reload()
            }}
          >
            <Lock className="h-4 w-4" />
            Lock database
          </Button>
          <Button
            variant="destructive"
            onClick={async () => {
              if (await dialog.confirm(demoActive ? 'Delete all data in the current demo environment?' : 'Delete ALL real data and start fresh? This cannot be undone.', {
                title: demoActive ? 'Wipe demo data' : 'Wipe data',
                confirmLabel: demoActive ? 'Wipe demo' : 'Wipe data',
                destructive: true
              })) {
                await window.api.data.wipe()
                window.location.reload()
              }
            }}
          >
            <Trash2 className="h-4 w-4" />
            {demoActive ? 'Wipe demo data' : 'Wipe data & restart'}
          </Button>
          <div className="w-full rounded-md border border-info/30 bg-info/5 p-3">
            <p className="text-sm font-medium">Isolated developer demo</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Uses a separate encrypted database. Random demo activity, edits, wipes, imports, and restarts cannot change your real financial plan.
            </p>
            <div className="mt-3 grid gap-2 md:grid-cols-[180px_1fr_auto]">
              <div><Label>Seed</Label><Input value={demoSeed} onChange={(event) => setDemoSeed(event.target.value.replace(/\D/g, ''))} /></div>
              <div><Label>Scenario preset</Label><Select value={demoPreset} onValueChange={setDemoPreset}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="random">Random full dataset</SelectItem><SelectItem value="debt-heavy">Debt-heavy</SelectItem><SelectItem value="overspent">Overspent budget</SelectItem><SelectItem value="empty">Empty profile</SelectItem><SelectItem value="year-boundary">Year boundary</SelectItem><SelectItem value="duplicates">Duplicates</SelectItem><SelectItem value="missing-categories">Missing categories</SelectItem><SelectItem value="transfers">Many transfers</SelectItem></SelectContent></Select></div>
              <Button className="self-end" variant="ghost" onClick={() => setDemoSeed(String(Math.floor(Math.random() * 2147483647)))}>New random seed</Button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => handleRunDemo(false)} disabled={demoRunning}><Play className="h-4 w-4" />{demoRunning ? 'Preparing...' : demoActive ? 'Reset with seed' : 'Run Demo'}</Button>
              <Button variant="outline" onClick={() => handleRunDemo(true)} disabled={demoRunning || demoStatus.seed == null}>Replay same seed</Button>
            </div>
            {demoActive && <div className="mt-3 rounded border bg-background/60 p-3 text-xs"><p><span className="font-medium">Active seed:</span> {demoStatus.seed ?? 'unknown'} · <span className="font-medium">Preset:</span> {demoStatus.preset ?? 'random'}</p><p className="mt-1 break-all text-muted-foreground">{demoStatus.databasePath}</p><p className="mt-1 text-muted-foreground">{Object.entries(demoStatus.counts ?? {}).map(([key, count]) => `${key}: ${count}`).join(' · ')}</p></div>}
          </div>
        </CardContent>
        <CardContent className="border-t pt-4">
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">Audit/fix tool</p>
              <p className="text-xs text-muted-foreground">
                Scans app data for broken links, duplicate subscription transactions, archived recurring accounts, and missing account references.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={scanAuditFix} disabled={auditFixLoading}>
                <RotateCcw className="h-4 w-4" />
                Scan data
              </Button>
              <Button onClick={applyAuditFix} disabled={auditFixLoading || !auditFix}>
                Fix found issues
              </Button>
            </div>
            {auditFix && (
              <div className="grid gap-2 md:grid-cols-4">
                <AuditFixMetric label="Broken links" count={auditFix.brokenLinks.length} />
                <AuditFixMetric label="Duplicate subs" count={auditFix.duplicateSubscriptionTransactions.length} />
                <AuditFixMetric label="Missing accounts" count={auditFix.missingAccountTransactions.length} />
                <AuditFixMetric label="Archived recurring" count={auditFix.recurringArchivedAccounts.length} />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Tax/accountant export
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Exports {profile.year} tax-deductible subscriptions, income transactions, savings transactions, and expenses from the selected categories.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSelectedTaxCategoryIds(new Set(taxExportCategories.map((category) => category.id)))}
            >
              Select all categories
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSelectedTaxCategoryIds(new Set())}
            >
              Clear categories
            </Button>
          </div>
          <div className="grid max-h-48 gap-2 overflow-auto rounded-md border p-3 md:grid-cols-2">
            {taxExportCategories.map((category) => (
              <label key={category.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedTaxCategoryIds.has(category.id)}
                  onChange={() => toggleTaxCategory(category.id)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <span>{category.name}</span>
              </label>
            ))}
          </div>
          <Button variant="outline" onClick={handleTaxReviewExport}>
            <Download className="h-4 w-4" />
            Export tax CSV
          </Button>
        </CardContent>
      </Card>

      <FinancialSettingsTools />

      <SchedulerCard />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4" />
            Encryption
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label>Current password</Label>
            <Input
              type="password"
              placeholder="Enter current master password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>New password</Label>
            <Input
              type="password"
              placeholder="At least 8 characters"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>Confirm new password</Label>
            <Input
              type="password"
              placeholder="Repeat new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          {changePasswordError && (
            <p className="text-sm text-destructive">{changePasswordError}</p>
          )}
          {changePasswordSuccess && (
            <p className="text-sm text-success">Password changed successfully.</p>
          )}
          <Button onClick={handleChangePassword} disabled={changePasswordLoading}>
            {changePasswordLoading ? 'Changing...' : 'Change password'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Categorization Rules</CardTitle>
        </CardHeader>
        <CardContent>
          <RuleEditor />
        </CardContent>
      </Card>

      <IntegrityPanel />

      <Card>
        <CardHeader>
          <CardTitle>Plugins</CardTitle>
        </CardHeader>
        <CardContent>
          <PluginRegistry />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Onboarding</CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={async () => {
              await window.api.settings.set('onboardingComplete', false)
              window.location.reload()
            }}
          >
            Re-run welcome guide
          </Button>
        </CardContent>
      </Card>

      {saved && <p className="text-sm text-success" role="status" aria-live="polite">Saved.</p>}
      {appVersion && (
        <p className="text-xs text-muted-foreground text-center pt-4">
          Budget v{appVersion}
        </p>
      )}
    </div>
  )
}
