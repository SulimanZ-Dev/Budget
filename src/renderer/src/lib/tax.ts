export function parseOptionalTaxAmount(value: string): number | null {
  if (value.trim() === '') return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function calculateTaxReconciledYtd(
  monthlyDifferenceTotal: number,
  expectedYearlyTaxOwed: number | null
): number {
  return expectedYearlyTaxOwed == null
    ? monthlyDifferenceTotal
    : monthlyDifferenceTotal - expectedYearlyTaxOwed
}
