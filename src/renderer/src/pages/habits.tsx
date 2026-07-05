import { useEffect, useState } from 'react'
import { Flame, CalendarX } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store/app-store'
import { AskAiButton } from '@/components/shared/ask-ai-button'

const EMOJIS = ['😫', '😕', '😐', '🙂', '😄']

export function HabitsPage(): JSX.Element {
  const { profile } = useAppStore()
  const [streak, setStreak] = useState({ current: 0, longest: 0 })
  const [moods, setMoods] = useState<{ year: number; month: number; rating: number; emoji: string }[]>([])
  const [missedDays, setMissedDays] = useState<string[]>([])

  useEffect(() => {
    window.api.settings.get('spendingStreak').then((s) => s && setStreak(s))
    window.api.mood.list().then(setMoods)
    window.api.habits.missedDays().then(setMissedDays)
  }, [])

  async function rateMonth(rating: number): Promise<void> {
    const now = new Date()
    const lastMonth = now.getMonth() === 0 ? 12 : now.getMonth()
    const lastYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()
    await window.api.mood.set({
      year: lastYear,
      month: lastMonth,
      rating,
      emoji: EMOJIS[rating - 1]
    })
    setMoods(await window.api.mood.list())
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Lifestyle & Habits</h1>
        <AskAiButton context="habits" prefill="How does my mood correlate with my spending?" />
      </div>

      <Card className="border-warning/30 bg-warning/5">
        <CardContent className="flex items-center gap-6 p-8">
          <Flame className="h-16 w-16 text-warning" />
          <div>
            <p className="text-sm text-muted-foreground">Spending tracking streak</p>
            <p className="text-4xl font-bold">{streak.current} days</p>
            <p className="text-sm text-muted-foreground">Longest: {streak.longest} days</p>
          </div>
        </CardContent>
      </Card>

      {missedDays.length > 0 && (
        <Card>
          <CardContent className="flex items-start gap-4 p-6">
            <CalendarX className="h-8 w-8 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Missed tracking days</p>
              <p className="text-sm text-muted-foreground">
                No transactions recorded on: {missedDays.slice(0, 10).join(', ')}
                {missedDays.length > 10 && ` and ${missedDays.length - 10} more`}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Monthly mood</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">Rate last closed month (1–5)</p>
          <div className="flex gap-2">
            {EMOJIS.map((emoji, i) => (
              <Button key={i} variant="outline" size="lg" onClick={() => rateMonth(i + 1)}>
                {emoji}
              </Button>
            ))}
          </div>
          <div className="mt-6 flex gap-2 flex-wrap">
            {moods.map((m) => (
              <div
                key={`${m.year}-${m.month}`}
                className="rounded-lg border px-3 py-2 text-center text-sm"
                title={`${m.year}-${m.month}`}
              >
                <span className="text-2xl">{m.emoji}</span>
                <p className="text-xs text-muted-foreground">
                  {m.month}/{m.year}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Mood vs spending</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Ask AI to compare your mood ratings with spending patterns for personalized observations.
        </CardContent>
      </Card>
    </div>
  )
}
