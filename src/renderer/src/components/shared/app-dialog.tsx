import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type DialogRequest =
  | {
      type: 'alert'
      title: string
      message: string
      resolve: () => void
    }
  | {
      type: 'confirm'
      title: string
      message: string
      confirmLabel: string
      cancelLabel: string
      destructive?: boolean
      resolve: (confirmed: boolean) => void
    }

interface AppDialogApi {
  alert: (message: string, title?: string) => Promise<void>
  confirm: (message: string, options?: {
    title?: string
    confirmLabel?: string
    cancelLabel?: string
    destructive?: boolean
  }) => Promise<boolean>
}

const AppDialogContext = createContext<AppDialogApi | null>(null)

export function AppDialogProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [request, setRequest] = useState<DialogRequest | null>(null)

  const close = useCallback((confirmed?: boolean) => {
    setRequest((current) => {
      if (!current) return null
      if (current.type === 'confirm') {
        current.resolve(Boolean(confirmed))
      } else {
        current.resolve()
      }
      return null
    })
  }, [])

  const api = useMemo<AppDialogApi>(() => ({
    alert: (message, title = 'Notice') =>
      new Promise<void>((resolve) => {
        setRequest({ type: 'alert', title, message, resolve })
      }),
    confirm: (message, options = {}) =>
      new Promise<boolean>((resolve) => {
        setRequest({
          type: 'confirm',
          title: options.title ?? 'Confirm',
          message,
          confirmLabel: options.confirmLabel ?? 'Continue',
          cancelLabel: options.cancelLabel ?? 'Cancel',
          destructive: options.destructive,
          resolve
        })
      })
  }), [])

  return (
    <AppDialogContext.Provider value={api}>
      {children}
      <Dialog open={request !== null} onOpenChange={(open) => {
        if (!open) close(false)
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{request?.title}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{request?.message}</p>
          <div className="flex justify-end gap-2">
            {request?.type === 'confirm' && (
              <Button variant="outline" onClick={() => close(false)}>
                {request.cancelLabel}
              </Button>
            )}
            <Button
              variant={request?.type === 'confirm' && request.destructive ? 'destructive' : 'default'}
              onClick={() => close(true)}
            >
              {request?.type === 'confirm' ? request.confirmLabel : 'OK'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppDialogContext.Provider>
  )
}

export function useAppDialog(): AppDialogApi {
  const context = useContext(AppDialogContext)
  if (!context) {
    throw new Error('useAppDialog must be used within AppDialogProvider')
  }
  return context
}
