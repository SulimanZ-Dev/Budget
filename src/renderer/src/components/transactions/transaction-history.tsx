import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Clock, Undo2, Edit, Trash2, Flag, FlagOff, Tag } from 'lucide-react'

interface HistoryEvent {
  id: number
  transaction_id: number
  event_type: string
  event_data: string
  previous_values: string | null
  actor: string
  timestamp: string
  hmac: string
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
      setHistory(events as HistoryEvent[])
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

  function getEventIcon(eventType: string): JSX.Element {
    switch (eventType) {
      case 'CREATED':
        return <Edit className="h-4 w-4 text-success" />
      case 'UPDATED':
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

  function getEventDescription(event: HistoryEvent): string {
    const eventData = JSON.parse(event.event_data)
    const previousValues = event.previous_values ? JSON.parse(event.previous_values) : null

    switch (event.event_type) {
      case 'CREATED':
        return `Transaction created: ${eventData.description} (${eventData.amount} SEK)`
      case 'UPDATED': {
        const changes: string[] = []
        if (previousValues) {
          if (previousValues.description !== undefined) {
            changes.push(`description changed from "${previousValues.description}" to "${eventData.description}"`)
          }
          if (previousValues.amount !== undefined) {
            changes.push(`amount changed from ${previousValues.amount} to ${eventData.amount} SEK`)
          }
          if (previousValues.category_id !== undefined) {
            changes.push(`category changed`)
          }
          if (previousValues.date !== undefined) {
            changes.push(`date changed from ${previousValues.date} to ${eventData.date}`)
          }
        }
        return changes.length > 0 ? changes.join(', ') : 'Transaction updated'
      }
      case 'DELETED':
        return 'Transaction deleted'
      case 'FLAGGED':
        return 'Transaction flagged as unnecessary'
      case 'UNFLAGGED':
        return 'Transaction unflagged'
      case 'RECATEGORIZED':
        return `Category changed`
      default:
        return event.event_type
    }
  }

  function formatTimestamp(timestamp: string): string {
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
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

  const canUndo = history.length > 1 && history[0].event_type !== 'DELETED'

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
            <Card key={event.id} className="p-3">
              <div className="flex gap-3">
                <div className="flex-shrink-0 mt-0.5">
                  {getEventIcon(event.event_type)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium">
                      {event.event_type.charAt(0) + event.event_type.slice(1).toLowerCase()}
                    </p>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatTimestamp(event.timestamp)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {getEventDescription(event)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    by {event.actor}
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
