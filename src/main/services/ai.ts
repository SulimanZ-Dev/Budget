import Anthropic from '@anthropic-ai/sdk'
import { getApiKey } from './keychain'
import { buildFinancialContext } from './ai-context'
import { getDatabase } from '../database-encrypted'

const MODEL = 'claude-sonnet-4-20250514'

export async function chatWithAI(
  messages: { role: 'user' | 'assistant'; content: string }[],
  screenContext?: string
): Promise<string> {
  let apiKey: string | null = await getApiKey()
  if (!apiKey) {
    throw new Error('API_KEY_MISSING')
  }

  const client = new Anthropic({ apiKey })
  apiKey = null
  const context = buildFinancialContext()
  const systemPrompt = `You are a helpful personal financial assistant inside a desktop budget app. The user's default currency is SEK. Be concise, actionable, and specific to their actual numbers. Never suggest spreadsheets.

${context}

${screenContext ? `Current screen context: ${screenContext}` : ''}`

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content
    }))
  })

  const block = response.content.find((b) => b.type === 'text')
  return block && block.type === 'text' ? block.text : 'No response generated.'
}



export async function suggestCategory(description: string): Promise<string | null> {
  let apiKey = await getApiKey()
  if (!apiKey) return null

  const client = new Anthropic({ apiKey })
  apiKey = null
  const context = buildFinancialContext()

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 64,
    system: `Suggest ONE budget category name for this transaction. Reply with ONLY the category name, nothing else.\n\nExisting categories in context:\n${context}`,
    messages: [{ role: 'user', content: `Transaction: "${description}"` }]
  })

  const block = response.content.find((b) => b.type === 'text')
  if (block && block.type === 'text') {
    return block.text.trim().replace(/['"]/g, '')
  }
  return null
}

export async function generateInsight(): Promise<string> {
  let apiKey = await getApiKey()
  if (!apiKey) return 'Connect your Claude API key in Settings to unlock AI insights.'

  const client = new Anthropic({ apiKey })
  apiKey = null
  const context = buildFinancialContext()

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 200,
    system:
      'Generate ONE short proactive financial insight (max 2 sentences) based on the user data. Be specific with numbers and percentages.',
    messages: [{ role: 'user', content: context }]
  })

  const block = response.content.find((b) => b.type === 'text')
  return block && block.type === 'text'
    ? block.text
    : 'Review your spending this month to stay on track.'
}

export async function generateWeeklyTip(): Promise<string> {
  let apiKey = await getApiKey()
  if (!apiKey) return 'Add your API key in Settings for personalized budget coaching.'

  const client = new Anthropic({ apiKey })
  apiKey = null
  const context = buildFinancialContext()

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 150,
    system:
      'Give ONE specific weekly budget tip based on the user actual data. Not generic advice. Max 2 sentences.',
    messages: [{ role: 'user', content: context }]
  })

  const block = response.content.find((b) => b.type === 'text')
  return block && block.type === 'text' ? block.text : 'Track every expense this week to improve accuracy.'
}

export function detectAnomalies(): { category: string; current: number; avg: number; stddev: number; severity: string }[] {
  const db = getDatabase()
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1

  const categories = db.prepare('SELECT id, name FROM categories').all() as { id: number; name: string }[]
  const anomalies: { category: string; current: number; avg: number; stddev: number; severity: string }[] = []

  for (const cat of categories) {
    const rows = db
      .prepare(
        `SELECT strftime('%m', date) as m, strftime('%Y', date) as y, SUM(amount) as total
         FROM transactions
         WHERE category_id = ? AND type = 'expense'
         GROUP BY y, m
         ORDER BY y, m`
      )
      .all(cat.id) as { m: string; y: string; total: number }[]

    if (rows.length < 3) continue

    const monthlyTotals = rows.map((r) => r.total)
    const currentTotal = monthlyTotals[monthlyTotals.length - 1]
    const historicalTotals = monthlyTotals.slice(0, -1).slice(-6)

    if (historicalTotals.length < 2) continue

    const avg = historicalTotals.reduce((s, v) => s + v, 0) / historicalTotals.length
    const variance = historicalTotals.reduce((s, v) => s + (v - avg) ** 2, 0) / historicalTotals.length
    const stddev = Math.sqrt(variance)

    if (stddev > 0 && currentTotal > avg + 2 * stddev) {
      const severity = currentTotal > avg + 3 * stddev ? 'high' : 'medium'
      anomalies.push({ category: cat.name, current: currentTotal, avg, stddev, severity })
    }
  }

  const content = anomalies.length
    ? `Anomaly alert: ${anomalies.map((a) => `${a.category} (${a.severity})`).join(', ')}`
    : null

  if (content) {
    db.prepare(
      `INSERT INTO ai_insights (type, content, year, month) VALUES (?, ?, ?, ?)`
    ).run('anomaly', content, year, month)
  }

  return anomalies
}
