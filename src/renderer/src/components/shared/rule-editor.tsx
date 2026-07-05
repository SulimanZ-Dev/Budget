import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Trash2, Play } from 'lucide-react'

interface Rule {
  id: number
  pattern: string
  category_id: number
  category_name?: string
}

export function RuleEditor(): JSX.Element {
  const [rules, setRules] = useState<Rule[]>([])
  const [categories, setCategories] = useState<{ id: number; name: string }[]>([])
  const [pattern, setPattern] = useState('')
  const [categoryId, setCategoryId] = useState('')

  useEffect(() => {
    window.api.rules.list().then((r) => setRules(r as Rule[]))
    window.api.categories.list().then((c) => setCategories(c as { id: number; name: string }[]))
  }, [])

  async function addRule(): Promise<void> {
    if (!pattern.trim() || !categoryId) return
    const result = await window.api.rules.create({ pattern: pattern.trim(), categoryId: parseInt(categoryId) })
    if (result) {
      setPattern('')
      setCategoryId('')
      const updated = await window.api.rules.list()
      setRules(updated as Rule[])
    }
  }

  async function deleteRule(id: number): Promise<void> {
    await window.api.rules.delete(id)
    const updated = await window.api.rules.list()
    setRules(updated as Rule[])
  }

  async function applyAll(): Promise<void> {
    const updated = await window.api.rules.apply()
    if (updated.length > 0) {
      alert(`Auto-categorized ${updated.length} transactions.`)
    } else {
      alert('No uncategorized transactions matched existing rules.')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Label>Description contains</Label>
          <Input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="e.g. Netflix" />
        </div>
        <div className="w-44">
          <Label>Category</Label>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger>
              <SelectValue placeholder="Select..." />
            </SelectTrigger>
            <SelectContent>
              {categories.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={addRule} disabled={!pattern.trim() || !categoryId}>
          <Plus className="h-4 w-4" />
          Add
        </Button>
      </div>

      {rules.length > 0 && (
        <div className="space-y-2">
          {rules.map((rule) => (
            <div key={rule.id} className="flex items-center justify-between rounded border p-3 text-sm">
              <span>
                "<strong>{rule.pattern}</strong>" → {rule.category_name || `Category #${rule.category_id}`}
              </span>
              <Button variant="ghost" size="icon" onClick={() => deleteRule(rule.id)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {rules.length > 0 && (
        <Button variant="outline" onClick={applyAll}>
          <Play className="h-4 w-4" />
          Apply rules to uncategorized transactions
        </Button>
      )}
    </div>
  )
}
