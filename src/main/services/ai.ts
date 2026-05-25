import Anthropic from '@anthropic-ai/sdk'
import { getApiKey } from './keychain'
import { buildFinancialContext } from './ai-context'

const MODEL = 'claude-sonnet-4-20250514'

export async function chatWithAI(
  messages: { role: 'user' | 'assistant'; content: string }[],
  screenContext?: string
): Promise<string> {
  const apiKey = await getApiKey()
  if (!apiKey) {
    throw new Error('API_KEY_MISSING')
  }

  const client = new Anthropic({ apiKey })
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
  const apiKey = await getApiKey()
  if (!apiKey) return null

  const client = new Anthropic({ apiKey })
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
  const apiKey = await getApiKey()
  if (!apiKey) return 'Connect your Claude API key in Settings to unlock AI insights.'

  const client = new Anthropic({ apiKey })
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
  const apiKey = await getApiKey()
  if (!apiKey) return 'Add your API key in Settings for personalized budget coaching.'

  const client = new Anthropic({ apiKey })
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
