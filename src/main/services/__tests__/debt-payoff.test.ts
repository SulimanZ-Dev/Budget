import { describe, expect, it } from 'vitest'
import { calculateDebtPayoffPlan } from '../debt-payoff'

const debts = [
  { id: 1, name: 'Small loan', balance: 1000, interestRate: 5, minimum: 100 },
  { id: 2, name: 'Expensive card', balance: 3000, interestRate: 20, minimum: 150 }
]

describe('calculateDebtPayoffPlan', () => {
  it('rolls the full monthly budget into the next debt after payoff', () => {
    const plan = calculateDebtPayoffPlan(debts, 'snowball', 50, '2026-08-01')
    expect(plan.months).not.toBeNull()
    expect(plan.payoffOrder.map((item) => item.id)).toEqual([1, 2])
    expect(plan.payoffOrder[0].month).toBeLessThan(plan.payoffOrder[1].month)
  })

  it('prioritizes the highest interest debt for avalanche', () => {
    const avalanche = calculateDebtPayoffPlan(debts, 'avalanche', 200, '2026-08-01')
    const snowball = calculateDebtPayoffPlan(debts, 'snowball', 200, '2026-08-01')
    expect(avalanche.totalInterest).toBeLessThan(snowball.totalInterest)
    expect(avalanche.payoffDate).toMatch(/^202\d-\d{2}-\d{2}$/)
  })

  it('reports an impossible plan when no payment budget exists', () => {
    const plan = calculateDebtPayoffPlan([{ ...debts[0], minimum: 0 }], 'snowball', 0)
    expect(plan.months).toBeNull()
    expect(plan.payoffDate).toBeNull()
  })
})
