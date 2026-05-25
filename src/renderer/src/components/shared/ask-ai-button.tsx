import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store/app-store'
import { useNavigate } from 'react-router-dom'

interface AskAiButtonProps {
  context: string
  prefill?: string
  variant?: 'default' | 'outline' | 'ghost'
  size?: 'default' | 'sm'
}

export function AskAiButton({
  context,
  prefill,
  variant = 'outline',
  size = 'sm'
}: AskAiButtonProps): JSX.Element {
  const { openAI } = useAppStore()
  const navigate = useNavigate()

  return (
    <Button
      variant={variant}
      size={size}
      onClick={() => {
        openAI(prefill ?? `Tell me about ${context}`, context)
        navigate('/ai')
      }}
    >
      <Sparkles className="h-4 w-4" />
      Ask AI
    </Button>
  )
}
