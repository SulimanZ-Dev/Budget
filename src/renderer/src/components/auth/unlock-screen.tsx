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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-800 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md"
      >
        <Card className="p-8 bg-zinc-900/50 border-zinc-800 backdrop-blur">
          <div className="text-center mb-8">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.1, type: 'spring', stiffness: 200 }}
              className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-indigo-500/10 mb-4"
            >
              <Lock className="w-10 h-10 text-indigo-400" />
            </motion.div>
            <h1 className="text-3xl font-bold text-zinc-100 mb-2">
              Budget
            </h1>
            <p className="text-zinc-400">
              Enter your master password to unlock
            </p>
          </div>

          <form onSubmit={handleUnlock} className="space-y-4">
            <div>
              <Label htmlFor="password" className="text-zinc-300">
                Master Password
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                className="mt-1.5 bg-zinc-800 border-zinc-700 text-zinc-100 text-lg"
                disabled={isLoading}
                autoFocus
              />
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2"
              >
                <AlertCircle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-red-400">
                  <p className="font-medium">{error}</p>
                  {attempts > 2 && (
                    <p className="mt-1 text-red-400/80">
                      {attempts} failed attempts. Make sure you're using the correct password.
                    </p>
                  )}
                </div>
              </motion.div>
            )}

            <Button
              type="submit"
              disabled={!password || isLoading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
              size="lg"
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full"
                  />
                  Unlocking...
                </span>
              ) : (
                'Unlock'
              )}
            </Button>
          </form>

          <div className="mt-6 pt-6 border-t border-zinc-800">
            <p className="text-xs text-zinc-500 text-center">
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
