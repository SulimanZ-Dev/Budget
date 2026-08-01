export interface DebtPlanInput {
  id: number
  name: string
  balance: number
  interestRate: number
  minimum: number
}

export interface DebtPayoffMilestone {
  id: number
  name: string
  month: number
  payoffDate: string
}

export interface DebtPayoffPlan {
  months: number | null
  totalInterest: number
  payoffDate: string | null
  payoffOrder: DebtPayoffMilestone[]
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

function monthDate(startDate: string, months: number): string {
  const [year, month, day] = startDate.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1 + months, Math.min(day || 1, 28)))
  return date.toISOString().slice(0, 10)
}

export function calculateDebtPayoffPlan(
  debts: DebtPlanInput[],
  strategy: 'snowball' | 'avalanche',
  extraPayment: number,
  startDate = new Date().toISOString().slice(0, 10)
): DebtPayoffPlan {
  const rows = debts
    .map((debt) => ({
      ...debt,
      balance: Math.max(0, roundMoney(Number(debt.balance) || 0)),
      interestRate: Math.max(0, Number(debt.interestRate) || 0),
      minimum: Math.max(0, roundMoney(Number(debt.minimum) || 0))
    }))
    .filter((debt) => debt.balance > 0)

  const monthlyBudget = roundMoney(
    rows.reduce((sum, debt) => sum + debt.minimum, 0) + Math.max(0, Number(extraPayment) || 0)
  )
  if (rows.length === 0) return { months: 0, totalInterest: 0, payoffDate: startDate, payoffOrder: [] }
  if (monthlyBudget <= 0) return { months: null, totalInterest: 0, payoffDate: null, payoffOrder: [] }

  let months = 0
  let totalInterest = 0
  const payoffOrder: DebtPayoffMilestone[] = []

  while (rows.some((debt) => debt.balance > 0.005) && months < 1200) {
    months += 1
    const activeBeforePayment = rows.filter((debt) => debt.balance > 0.005)
    for (const debt of activeBeforePayment) {
      const interest = debt.balance * debt.interestRate / 1200
      debt.balance = roundMoney(debt.balance + interest)
      totalInterest += interest
    }

    let available = monthlyBudget
    for (const debt of activeBeforePayment) {
      const payment = Math.min(debt.balance, debt.minimum, available)
      debt.balance = roundMoney(debt.balance - payment)
      available = roundMoney(available - payment)
    }

    const prioritized = rows
      .filter((debt) => debt.balance > 0.005)
      .sort((a, b) => strategy === 'snowball'
        ? a.balance - b.balance || b.interestRate - a.interestRate
        : b.interestRate - a.interestRate || a.balance - b.balance)

    for (const debt of prioritized) {
      if (available <= 0) break
      const payment = Math.min(debt.balance, available)
      debt.balance = roundMoney(debt.balance - payment)
      available = roundMoney(available - payment)
    }

    for (const debt of activeBeforePayment) {
      if (debt.balance <= 0.005 && !payoffOrder.some((item) => item.id === debt.id)) {
        payoffOrder.push({ id: debt.id, name: debt.name, month: months, payoffDate: monthDate(startDate, months) })
      }
    }
  }

  if (rows.some((debt) => debt.balance > 0.005)) {
    return { months: null, totalInterest: roundMoney(totalInterest), payoffDate: null, payoffOrder }
  }
  return {
    months,
    totalInterest: roundMoney(totalInterest),
    payoffDate: monthDate(startDate, months),
    payoffOrder
  }
}
