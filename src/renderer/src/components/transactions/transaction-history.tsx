import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Clock, Undo2, Edit, Trash2, Flag, FlagOff, Tag } from 'lucide-react'

interface HistoryEvent {
  event_id: number
  action: string
  details: string
  actor: string
  timestamp: string
}

interface TransactionHistoryProps {
  transactionId: number
  onUndo?: () => void
}

export function TransactionHistory({ transactionId, onUndo }: TransactionHistoryProps): JSX.Element {
  const [history, setHistory] = useState<HistoryEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadHistory()
  }, [transactionId])

  async function loadHistory(): Promise<void> {
    setLoading(true)
    try {
      const events = await window.api.transactions.history(transactionId)
      setHistory([...(events as HistoryEvent[])].sort((a, b) => b.event_id - a.event_id))
    } catch (error) {
      console.error('Failed to load transaction history:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleUndo(): Promise<void> {
    try {
      await window.api.transactions.undo(transactionId)
      await loadHistory()
      onUndo?.()
    } catch (error) {
      console.error('Failed to undo transaction:', error)
    }
  }

  function getEventIcon(action: string): JSX.Element {
    switch (action.toUpperCase()) {
      case 'CREATED':
        return <Edit className="h-4 w-4 text-success" />
      case 'UPDATED':
      case 'RESTORED':
        return <Edit className="h-4 w-4 text-info" />
      case 'DELETED':
        return <Trash2 className="h-4 w-4 text-destructive" />
      case 'FLAGGED':
        return <Flag className="h-4 w-4 text-warning" />
      case 'UNFLAGGED':
        return <FlagOff className="h-4 w-4 text-muted-foreground" />
      case 'RECATEGORIZED':
        return <Tag className="h-4 w-4 text-purple-500" />
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />
    }
  }

  function formatTimestamp(timestamp: string): string {
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = Math.max(0, now.getTime() - date.getTime())
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`
    
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-sm text-muted-foreground">Loading history...</div>
      </div>
    )
  }

  if (history.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-sm text-muted-foreground">No history available</div>
      </div>
    )
  }

  const canUndo = history.length > 1 && history[0].action.toUpperCase() !== 'DELETED'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Transaction History</h3>
        {canUndo && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleUndo}
            className="gap-2"
          >
            <Undo2 className="h-4 w-4" />
            Undo Last Change
          </Button>
        )}
      </div>

      <ScrollArea className="h-[300px]">
        <div className="space-y-3">
          {history.map((event, index) => (
            <Card key={event.event_id} className="p-3">
              <div className="flex gap-3">
                <div className="flex-shrink-0 mt-0.5">
                  {getEventIcon(event.action)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium">
                      {event.action}
                    </p>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatTimestamp(event.timestamp)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {event.details || 'No details'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    by {event.actor || 'system'}
                  </p>
                  {index === 0 && (
                    <span className="inline-block mt-2 px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary rounded">
                      Current
                    </span>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}

// Made with Bob
