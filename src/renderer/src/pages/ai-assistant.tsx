import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Send, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAppStore } from '@/store/app-store'
import { useNavigate } from 'react-router-dom'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

export function AiAssistantPage(): JSX.Element {
  const { aiPrefill, aiScreenContext } = useAppStore()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [hasKey, setHasKey] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    window.api.ai.hasKey().then(setHasKey)
    if (aiPrefill) {
      setInput(aiPrefill)
    }
  }, [aiPrefill])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send(): Promise<void> {
    if (!input.trim() || loading) return
    const userMsg: Message = { role: 'user', content: input.trim() }
    setMessages((m) => [...m, userMsg])
    setInput('')
    setLoading(true)
    try {
      const reply = await window.api.ai.chat(
        [...messages, userMsg],
        aiScreenContext || undefined
      )
      setMessages((m) => [...m, { role: 'assistant', content: reply }])
    } catch (e) {
      const err = e as Error
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content:
            err.message === 'API_KEY_MISSING'
              ? 'Please add your Claude API key in Settings to use the AI assistant.'
              : 'Something went wrong. Check your API key and connection.'
        }
      ])
    } finally {
      setLoading(false)
    }
  }

  if (!hasKey) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
        <Sparkles className="mb-4 h-12 w-12 text-primary" />
        <h2 className="text-xl font-bold">Connect Claude</h2>
        <p className="mt-2 max-w-md text-muted-foreground">
          Add your Anthropic API key in Settings. It is stored securely in the Windows credential
          manager.
        </p>
        <Button className="mt-6" onClick={() => navigate('/settings')}>
          Go to Settings
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-40px)] flex-col p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-primary" />
          AI Assistant
        </h1>
        <p className="text-sm text-muted-foreground">
          Your financial advisor — aware of budgets, goals, transactions, and net worth.
        </p>
      </div>

      <ScrollArea className="flex-1 rounded-xl border bg-card/50 p-4">
        {messages.length === 0 && (
          <div className="flex h-full min-h-[300px] flex-col items-center justify-center text-center text-muted-foreground">
            <p>Try asking:</p>
            <ul className="mt-4 space-y-2 text-sm text-left">
              <li>How much did I spend on food this year?</li>
              <li>Am I on track to hit my savings goal?</li>
              <li>What if I cut dining out by 30%?</li>
              <li>When will I reach my FIRE number?</li>
            </ul>
          </div>
        )}
        <div className="space-y-4">
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted'
                }`}
              >
                {msg.content}
              </div>
            </motion.div>
          ))}
          {loading && (
            <div className="text-sm text-muted-foreground animate-pulse">Thinking...</div>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <div className="mt-4 flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="Ask about your finances..."
          className="flex-1"
        />
        <Button onClick={send} disabled={loading} size="icon" aria-label="Send message">
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
