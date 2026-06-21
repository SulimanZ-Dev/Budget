import { useState } from 'react'
import { motion } from 'framer-motion'
import { Lock, AlertCircle } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Card } from '../ui/card'

interface UnlockScreenProps {
  onUnlock: () => void
}

export function UnlockScreen({ onUnlock }: UnlockScreenProps) {
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [attempts, setAttempts] = useState(0)

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault()
    
    if (!password) {
      setError('Please enter your password')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const result = await window.api.encryption.unlock(password)
      
      if (result.success) {
        onUnlock()
      } else {
        setAttempts(prev => prev + 1)
        setError(result.error || 'Incorrect password')
        setPassword('')
      }
    } catch (err) {
      setError('An unexpected error occurred')
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4"
      style={{
        background: 'linear-gradient(135deg, hsl(var(--background-gradient-start)), hsl(var(--background-gradient-end)))'
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md"
      >
        <Card className="p-8 bg-card/80 backdrop-blur-xl border shadow-xl">
          <div className="text-center mb-8">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.1, type: 'spring', stiffness: 200 }}
              className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary/10 mb-4"
            >
              <Lock className="w-10 h-10 text-primary" />
            </motion.div>
            <h1 className="text-3xl font-bold mb-2">
              Budget
            </h1>
            <p className="text-muted-foreground">
              Enter your master password to unlock
            </p>
          </div>

          <form onSubmit={handleUnlock} className="space-y-4">
            <div>
              <Label htmlFor="password">Master Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                className="mt-1.5 text-lg"
                disabled={isLoading}
                autoFocus
              />
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 flex items-start gap-2"
              >
                <AlertCircle className="w-5 h-5 text-destructive mt-0.5 flex-shrink-0" />
                <div className="text-sm text-destructive">
                  <p className="font-medium">{error}</p>
                  {attempts > 2 && (
                    <p className="mt-1 text-destructive/80">
                      {attempts} failed attempts. Make sure you're using the correct password.
                    </p>
                  )}
                </div>
              </motion.div>
            )}

            <Button
              type="submit"
              disabled={!password || isLoading}
              className="w-full disabled:opacity-50"
              size="lg"
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full"
                  />
                  Unlocking...
                </span>
              ) : (
                'Unlock'
              )}
            </Button>
          </form>

          <div className="mt-6 pt-6 border-t border-border">
            <p className="text-xs text-muted-foreground text-center">
              Your data is encrypted with AES-256-GCM.
              <br />
              Only you have access to your encryption keys.
            </p>
          </div>
        </Card>
      </motion.div>
    </div>
  )
}

// Made with Bob
