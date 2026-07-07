import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Trash2, Play } from 'lucide-react'
import { useAppDialog } from '@/components/shared/app-dialog'

type RuleOperator = 'AND' | 'OR'
type RuleConditionType = 'description_contains' | 'amount_min' | 'amount_max' | 'category_is' | 'type_is'

interface RuleCondition {
  kind: 'condition'
  type: RuleConditionType
  value: string | number
}

interface RuleGroup {
  kind: 'group'
  operator: RuleOperator
  children: RuleCondition[]
}

interface Rule {
  id: number
  pattern: string
  category_id: number
  category_name?: string
  priority?: number
  apply_future_only?: number
  conditions_json?: string | null
}

interface DraftGroup {
  operator: RuleOperator
  conditions: RuleCondition[]
}

const conditionLabels: Record<RuleConditionType, string> = {
  description_contains: 'Description contains',
  amount_min: 'Amount at least',
  amount_max: 'Amount at most',
  category_is: 'Current category is',
  type_is: 'Transaction type is'
}

function defaultCondition(): RuleCondition {
  return { kind: 'condition', type: 'description_contains', value: '' }
}

function summarizeCondition(condition: RuleCondition, categories: { id: number; name: string }[]): string {
  if (condition.type === 'category_is') {
    return `${conditionLabels[condition.type]} ${categories.find((cat) => cat.id === Number(condition.value))?.name ?? condition.value}`
  }
  return `${conditionLabels[condition.type]} ${condition.value}`
}

function summarizeRule(rule: Rule, categories: { id: number; name: string }[]): string {
  if (!rule.conditions_json) return `"${rule.pattern}"`
  try {
    const parsed = JSON.parse(rule.conditions_json) as { kind: 'group'; operator: RuleOperator; children: RuleGroup[] | RuleCondition[] }
    const children = parsed.children ?? []
    return children
      .map((child) => {
        if (child.kind === 'condition') return summarizeCondition(child, categories)
        return `(${child.children.map((condition) => summarizeCondition(condition, categories)).join(` ${child.operator} `)})`
      })
      .join(` ${parsed.operator} `)
  } catch {
    return `"${rule.pattern}"`
  }
}

export function RuleEditor(): JSX.Element {
  const dialog = useAppDialog()
  const [rules, setRules] = useState<Rule[]>([])
  const [categories, setCategories] = useState<{ id: number; name: string }[]>([])
  const [targetCategoryId, setTargetCategoryId] = useState('')
  const [priority, setPriority] = useState('100')
  const [applyFutureOnly, setApplyFutureOnly] = useState(false)
  const [rootOperator, setRootOperator] = useState<RuleOperator>('OR')
  const [groups, setGroups] = useState<DraftGroup[]>([
    { operator: 'AND', conditions: [defaultCondition()] }
  ])

  useEffect(() => {
    refreshRules()
    window.api.categories.list().then((c) => setCategories(c as { id: number; name: string }[]))
  }, [])

  async function refreshRules(): Promise<void> {
    const updated = await window.api.rules.list()
    setRules(updated as Rule[])
  }

  function updateCondition(groupIndex: number, conditionIndex: number, patch: Partial<RuleCondition>): void {
    setGroups((current) => current.map((group, gi) => {
      if (gi !== groupIndex) return group
      return {
        ...group,
        conditions: group.conditions.map((condition, ci) => ci === conditionIndex ? { ...condition, ...patch } : condition)
      }
    }))
  }

  function removeCondition(groupIndex: number, conditionIndex: number): void {
    setGroups((current) => current.map((group, gi) => {
      if (gi !== groupIndex) return group
      const nextConditions = group.conditions.filter((_, ci) => ci !== conditionIndex)
      return { ...group, conditions: nextConditions.length ? nextConditions : [defaultCondition()] }
    }))
  }

  function removeGroup(groupIndex: number): void {
    setGroups((current) => {
      const next = current.filter((_, index) => index !== groupIndex)
      return next.length ? next : [{ operator: 'AND', conditions: [defaultCondition()] }]
    })
  }

  function resetDraft(): void {
    setTargetCategoryId('')
    setPriority('100')
    setApplyFutureOnly(false)
    setRootOperator('OR')
    setGroups([{ operator: 'AND', conditions: [defaultCondition()] }])
  }

  async function addRule(): Promise<void> {
    if (!targetCategoryId) return
    const cleanGroups = groups.map((group) => ({
      kind: 'group' as const,
      operator: group.operator,
      children: group.conditions.filter((condition) => String(condition.value).trim() !== '')
    })).filter((group) => group.children.length > 0)
    if (!cleanGroups.length) return

    const conditions = cleanGroups.length === 1
      ? cleanGroups[0]
      : { kind: 'group' as const, operator: rootOperator, children: cleanGroups }
    const firstDescription = cleanGroups
      .flatMap((group) => group.children)
      .find((condition) => condition.type === 'description_contains')?.value

    await window.api.rules.create({
      pattern: String(firstDescription ?? 'Advanced rule'),
      categoryId: parseInt(targetCategoryId),
      priority: parseInt(priority) || 100,
      applyFutureOnly,
      conditions
    })
    resetDraft()
    await refreshRules()
  }

  async function deleteRule(id: number): Promise<void> {
    await window.api.rules.delete(id)
    await refreshRules()
  }

  async function applyAll(): Promise<void> {
    try {
      const updated = await window.api.rules.apply()
      if (updated.length > 0) {
        await dialog.alert(`Updated ${updated.length} transactions.`, 'Rules applied')
      } else {
        await dialog.alert('No existing transactions matched active rules.', 'Rules applied')
      }
    } catch (error) {
      await dialog.alert(
        error instanceof Error ? error.message : 'Failed to apply categorization rules.',
        'Rules failed'
      )
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_140px_180px]">
          <div className="grid gap-2">
            <Label>Target category</Label>
            <Select value={targetCategoryId} onValueChange={setTargetCategoryId}>
              <SelectTrigger>
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={String(category.id)}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Priority</Label>
            <Input type="number" value={priority} onChange={(event) => setPriority(event.target.value)} />
          </div>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={applyFutureOnly}
              onChange={(event) => setApplyFutureOnly(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            Future imports only
          </label>
        </div>

        {groups.length > 1 && (
          <div className="mt-3 flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Match</span>
            <Select value={rootOperator} onValueChange={(value) => setRootOperator(value as RuleOperator)}>
              <SelectTrigger className="h-8 w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="OR">Any group</SelectItem>
                <SelectItem value="AND">All groups</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="mt-4 space-y-3">
          {groups.map((group, groupIndex) => (
            <div key={groupIndex} className="rounded-md border bg-muted/20 p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Group {groupIndex + 1}</span>
                  <Select
                    value={group.operator}
                    onValueChange={(value) => {
                      setGroups((current) => current.map((item, index) => index === groupIndex ? { ...item, operator: value as RuleOperator } : item))
                    }}
                  >
                    <SelectTrigger className="h-8 w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="AND">All conditions</SelectItem>
                      <SelectItem value="OR">Any condition</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button variant="ghost" size="sm" onClick={() => removeGroup(groupIndex)}>
                  Remove group
                </Button>
              </div>

              <div className="space-y-2">
                {group.conditions.map((condition, conditionIndex) => (
                  <div key={conditionIndex} className="grid gap-2 md:grid-cols-[190px_1fr_36px]">
                    <Select
                      value={condition.type}
                      onValueChange={(value) => updateCondition(groupIndex, conditionIndex, { type: value as RuleConditionType, value: '' })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(conditionLabels).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {condition.type === 'category_is' ? (
                      <Select value={String(condition.value)} onValueChange={(value) => updateCondition(groupIndex, conditionIndex, { value: Number(value) })}>
                        <SelectTrigger>
                          <SelectValue placeholder="Category" />
                        </SelectTrigger>
                        <SelectContent>
                          {categories.map((category) => (
                            <SelectItem key={category.id} value={String(category.id)}>{category.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : condition.type === 'type_is' ? (
                      <Select value={String(condition.value)} onValueChange={(value) => updateCondition(groupIndex, conditionIndex, { value })}>
                        <SelectTrigger>
                          <SelectValue placeholder="Type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="expense">Expense</SelectItem>
                          <SelectItem value="income">Income</SelectItem>
                          <SelectItem value="savings">Savings</SelectItem>
                          <SelectItem value="transfer">Transfer</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        type={condition.type.startsWith('amount') ? 'number' : 'text'}
                        value={String(condition.value)}
                        onChange={(event) => updateCondition(groupIndex, conditionIndex, { value: condition.type.startsWith('amount') ? Number(event.target.value) : event.target.value })}
                      />
                    )}
                    <Button variant="ghost" size="icon" aria-label="Remove condition" onClick={() => removeCondition(groupIndex, conditionIndex)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>

              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => {
                  setGroups((current) => current.map((item, index) => index === groupIndex ? { ...item, conditions: [...item.conditions, defaultCondition()] } : item))
                }}
              >
                <Plus className="h-4 w-4" />
                Add condition
              </Button>
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => setGroups((current) => [...current, { operator: 'AND', conditions: [defaultCondition()] }])}
          >
            <Plus className="h-4 w-4" />
            Add group
          </Button>
          <Button onClick={addRule} disabled={!targetCategoryId}>
            <Plus className="h-4 w-4" />
            Save rule
          </Button>
        </div>
      </div>

      {rules.length > 0 && (
        <div className="space-y-2">
          {rules.map((rule) => (
            <div key={rule.id} className="flex items-center justify-between gap-3 rounded border p-3 text-sm">
              <div>
                <p className="font-medium">
                  Priority {rule.priority ?? 100} - {rule.category_name || `Category #${rule.category_id}`}
                  {rule.apply_future_only ? <span className="ml-2 text-xs text-muted-foreground">Future imports only</span> : null}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{summarizeRule(rule, categories)}</p>
              </div>
              <Button variant="ghost" size="icon" aria-label="Delete rule" onClick={() => deleteRule(rule.id)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {rules.length > 0 && (
        <Button variant="outline" onClick={applyAll}>
          <Play className="h-4 w-4" />
          Apply non-future-only rules to existing transactions
        </Button>
      )}
    </div>
  )
}
