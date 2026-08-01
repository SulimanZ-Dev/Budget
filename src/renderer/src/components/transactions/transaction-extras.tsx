import { useEffect, useState } from 'react'
import { FilePlus2, FolderOpen, Link2, Plus, Save, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useAppDialog } from '@/components/shared/app-dialog'

interface Extras {
  transaction: { merchant_name?: string | null; reconciled: number }
  splits: Array<{ category_id: number; amount: number; category_name: string }>
  tags: Array<{ id: number; name: string }>
  attachments: Array<{ id: number; file_name: string }>
  sharedExpenses: Array<{ id: number; member_id?: number | null; person_name: string; share_amount: number; settled: number }>
  refundLinks: Array<{ id: number; description: string; amount: number; date: string }>
}

interface Option { id: number; name: string }

export function TransactionExtras({ transactionId, amount, type, onChanged }: {
  transactionId: number
  amount: number
  type: string
  onChanged: () => void
}): JSX.Element {
  const dialog = useAppDialog()
  const [extras, setExtras] = useState<Extras | null>(null)
  const [categories, setCategories] = useState<Option[]>([])
  const [members, setMembers] = useState<Option[]>([])
  const [tags, setTags] = useState('')
  const [splits, setSplits] = useState<Array<{ categoryId: string; amount: string }>>([])
  const [shares, setShares] = useState<Array<{ memberId: string; personName: string; amount: string; settled: boolean }>>([])
  const [refundCandidates, setRefundCandidates] = useState<Array<{ id: number; description: string; amount: number; date: string }>>([])
  const [refundId, setRefundId] = useState('')

  async function load(): Promise<void> {
    const [data, categoryRows, memberRows, candidates] = await Promise.all([
      window.api.transactions.extras(transactionId),
      window.api.categories.list(),
      window.api.members.list(),
      window.api.transactions.refundCandidates(transactionId)
    ])
    const value = data as Extras
    setExtras(value)
    setCategories(categoryRows as Option[])
    setMembers(memberRows as Option[])
    setTags(value.tags.map((tag) => tag.name).join(', '))
    setSplits(value.splits.map((split) => ({ categoryId: String(split.category_id), amount: String(split.amount) })))
    setShares(value.sharedExpenses.map((share) => ({
      memberId: String(share.member_id ?? ''), personName: share.person_name,
      amount: String(share.share_amount), settled: share.settled === 1
    })))
    setRefundCandidates(candidates as typeof refundCandidates)
  }

  useEffect(() => { load() }, [transactionId])

  async function saveSplits(): Promise<void> {
    try {
      await window.api.transactions.setSplits(transactionId, splits.filter((split) => split.categoryId && Number(split.amount) > 0).map((split) => ({ categoryId: Number(split.categoryId), amount: Number(split.amount) })))
      await load()
      onChanged()
    } catch (error) {
      await dialog.alert(error instanceof Error ? error.message : 'Could not save splits.', 'Split failed')
    }
  }

  async function saveTags(): Promise<void> {
    await window.api.transactions.setTags(transactionId, tags.split(',').map((tag) => tag.trim()).filter(Boolean))
    await load()
  }

  async function saveShares(): Promise<void> {
    try {
      await window.api.transactions.setSharedExpenses(transactionId, shares.filter((share) => share.personName.trim() && Number(share.amount) >= 0).map((share) => ({
        memberId: share.memberId ? Number(share.memberId) : null,
        personName: share.personName.trim(), amount: Number(share.amount), settled: share.settled
      })))
      await load()
    } catch (error) {
      await dialog.alert(error instanceof Error ? error.message : 'Could not save shared expenses.', 'Share failed')
    }
  }

  if (!extras) return <p className="text-sm text-muted-foreground">Loading transaction tools...</p>

  return (
    <div className="space-y-5 border-t pt-5">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Bank reconciliation</p>
            <p className="text-xs text-muted-foreground">Mark this transaction as verified against the bank.</p>
          </div>
          <Switch checked={extras.transaction.reconciled === 1} onCheckedChange={async (checked) => {
            await window.api.transactions.reconcile(transactionId, checked)
            await load()
            onChanged()
          }} />
        </div>
        {extras.transaction.merchant_name && <p className="text-xs text-muted-foreground">Normalized merchant: {extras.transaction.merchant_name}</p>}
      </div>

      <div className="space-y-2">
        <Label>Tags</Label>
        <div className="flex gap-2">
          <Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="holiday, work, renovation" />
          <Button variant="outline" size="icon" onClick={saveTags} aria-label="Save tags"><Save className="h-4 w-4" /></Button>
        </div>
      </div>

      {type === 'expense' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Category split</Label>
            <span className="text-xs text-muted-foreground">Total {amount}</span>
          </div>
          {splits.map((split, index) => (
            <div key={index} className="grid grid-cols-[1fr_100px_36px] gap-2">
              <Select value={split.categoryId} onValueChange={(value) => setSplits((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, categoryId: value } : item))}>
                <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
                <SelectContent>{categories.map((category) => <SelectItem key={category.id} value={String(category.id)}>{category.name}</SelectItem>)}</SelectContent>
              </Select>
              <Input type="number" min="0" value={split.amount} onChange={(event) => setSplits((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, amount: event.target.value } : item))} />
              <Button variant="ghost" size="icon" aria-label="Remove split" onClick={() => setSplits((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setSplits((current) => [...current, { categoryId: '', amount: '' }])}><Plus className="h-4 w-4" /> Add split</Button>
            <Button size="sm" onClick={saveSplits}><Save className="h-4 w-4" /> Save splits</Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between"><Label>Receipts and attachments</Label><Button variant="outline" size="sm" onClick={async () => { await window.api.transactions.addAttachment(transactionId); await load() }}><FilePlus2 className="h-4 w-4" /> Attach</Button></div>
        {extras.attachments.length === 0 ? <p className="text-xs text-muted-foreground">No attachments.</p> : extras.attachments.map((attachment) => (
          <div key={attachment.id} className="flex items-center justify-between gap-2 rounded border px-3 py-2 text-sm">
            <span className="truncate">{attachment.file_name}</span>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" aria-label="Open attachment" onClick={() => window.api.transactions.openAttachment(attachment.id)}><FolderOpen className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" aria-label="Remove attachment" onClick={async () => { await window.api.transactions.removeAttachment(attachment.id); await load() }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
            </div>
          </div>
        ))}
      </div>

      {type === 'expense' && (
        <div className="space-y-2">
          <Label>Shared expense</Label>
          {shares.map((share, index) => (
            <div key={index} className="grid grid-cols-[1fr_90px_auto_36px] items-center gap-2">
              <Input value={share.personName} onChange={(event) => setShares((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, personName: event.target.value } : item))} placeholder="Person" list={`members-${transactionId}`} />
              <Input type="number" min="0" value={share.amount} onChange={(event) => setShares((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, amount: event.target.value } : item))} placeholder="Share" />
              <label className="flex items-center gap-1 text-xs"><Switch checked={share.settled} onCheckedChange={(settled) => setShares((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, settled } : item))} /> Settled</label>
              <Button variant="ghost" size="icon" aria-label="Remove person" onClick={() => setShares((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <datalist id={`members-${transactionId}`}>{members.map((member) => <option key={member.id} value={member.name} />)}</datalist>
          <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setShares((current) => [...current, { memberId: '', personName: '', amount: '', settled: false }])}><Plus className="h-4 w-4" /> Add person</Button><Button size="sm" onClick={saveShares}><Save className="h-4 w-4" /> Save shares</Button></div>
        </div>
      )}

      {(type === 'expense' || type === 'income') && (
        <div className="space-y-2">
          <Label>Refund link</Label>
          {extras.refundLinks.map((link) => <div key={link.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm"><span className="truncate">{link.description} · {link.amount} · {link.date}</span><Button variant="ghost" size="icon" aria-label="Unlink refund" onClick={async () => { await window.api.transactions.unlinkRefund(link.id); await load() }}><Trash2 className="h-4 w-4" /></Button></div>)}
          {refundCandidates.length > 0 && <div className="flex gap-2"><Select value={refundId} onValueChange={setRefundId}><SelectTrigger><SelectValue placeholder="Choose matching transaction" /></SelectTrigger><SelectContent>{refundCandidates.map((candidate) => <SelectItem key={candidate.id} value={String(candidate.id)}>{candidate.description} · {candidate.amount} · {candidate.date}</SelectItem>)}</SelectContent></Select><Button variant="outline" size="icon" disabled={!refundId} aria-label="Link refund" onClick={async () => { await window.api.transactions.linkRefund(transactionId, Number(refundId)); setRefundId(''); await load() }}><Link2 className="h-4 w-4" /></Button></div>}
        </div>
      )}
    </div>
  )
}
