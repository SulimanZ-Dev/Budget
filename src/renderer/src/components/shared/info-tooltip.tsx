import { Info } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface InfoTooltipProps {
  content: string
}

export function InfoTooltip({ content }: InfoTooltipProps): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center cursor-help text-muted-foreground/60 hover:text-muted-foreground transition-colors">
          <Info className="h-3.5 w-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <p className="text-xs leading-relaxed">{content}</p>
      </TooltipContent>
    </Tooltip>
  )
}
