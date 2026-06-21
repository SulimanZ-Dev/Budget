import { useState } from 'react'
import { motion } from 'framer-motion'
import { Lock, Shield, Key, AlertCircle, CheckCircle2 } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Card } from '../ui/card'

interface EncryptionSetupProps {
  onComplete: () => void
}

export function EncryptionSetup({ onComplete }: EncryptionSetupProps) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [step, setStep] = useState<'intro' | 'setup'>('intro')

  const passwordStrength = getPasswordStrength(password)
  const passwordsMatch = password === confirmPassword && password.length > 0

  async function handleSetup() {
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const result = await window.api.encryption.setup(password)
      
      if (result.success) {
        onComplete()
      } else {
        setError(result.error || 'Failed to setup encryption')
      }
    } catch (err) {
      setError('An unexpected error occurred')
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }

  if (step === 'intro') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-800 p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-2xl"
        >
          <Card className="p-8 bg-zinc-900/50 border-zinc-800 backdrop-blur">
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-indigo-500/10 mb-4">
                <Shield className="w-8 h-8 text-indigo-400" />
              </div>
              <h1 className="text-3xl font-bold text-zinc-100 mb-2">
                Welcome to Budget
              </h1>
              <p className="text-zinc-400">
                Let's secure your financial data with zero-knowledge encryption
              </p>
            </div>

            <div className="space-y-6 mb-8">
              <div className="flex items-start gap-4 p-4 rounded-lg bg-zinc-800/50">
                <Lock className="w-5 h-5 text-indigo-400 mt-0.5 flex-shrink-0" />
                <div>
                  <h3 className="font-semibold text-zinc-100 mb-1">
                    End-to-End Encryption
                  </h3>
                  <p className="text-sm text-zinc-400">
                    Your data is encrypted locally using AES-256-GCM. Only you have the key.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4 p-4 rounded-lg bg-zinc-800/50">
                <Key className="w-5 h-5 text-indigo-400 mt-0.5 flex-shrink-0" />
                <div>
                  <h3 className="font-semibold text-zinc-100 mb-1">
                    Master Password
                  </h3>
                  <p className="text-sm text-zinc-400">
                    Your master password is never stored. It's used to derive encryption keys using Argon2id.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4 p-4 rounded-lg bg-zinc-800/50">
                <Shield className="w-5 h-5 text-indigo-400 mt-0.5 flex-shrink-0" />
                <div>
                  <h3 className="font-semibold text-zinc-100 mb-1">
                    Tamper Detection
                  </h3>
                  <p className="text-sm text-zinc-400">
                    HMAC signatures protect your data integrity. Any unauthorized changes are detected.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 mb-6">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-amber-200">
                  <p className="font-semibold mb-1">Important</p>
                  <p>
                    If you forget your master password, your data cannot be recovered. 
                    Choose a strong password you'll remember.
                  </p>
                </div>
              </div>
            </div>

            <Button
              onClick={() => setStep('setup')}
              className="w-full bg-indigo-600 hover:bg-indigo-700"
              size="lg"
            >
              Continue to Setup
            </Button>
          </Card>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-800 p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <Card className="p-8 bg-zinc-900/50 border-zinc-800 backdrop-blur">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-indigo-500/10 mb-4">
              <Lock className="w-8 h-8 text-indigo-400" />
            </div>
            <h1 className="text-2xl font-bold text-zinc-100 mb-2">
              Create Master Password
            </h1>
            <p className="text-zinc-400 text-sm">
              This password will encrypt all your financial data
            </p>
          </div>

          <div className="space-y-4 mb-6">
            <div>
              <Label htmlFor="password" className="text-zinc-300">
                Master Password
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter a strong password"
                className="mt-1.5 bg-zinc-800 border-zinc-700 text-zinc-100"
                disabled={isLoading}
              />
              {password && (
                <div className="mt-2">
                  <div className="flex items-center gap-2 text-xs">
                    <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${passwordStrength.percent}%` }}
                        className={`h-full ${passwordStrength.color}`}
                      />
                    </div>
                    <span className={`font-medium ${passwordStrength.textColor}`}>
                      {passwordStrength.label}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div>
              <Label htmlFor="confirm" className="text-zinc-300">
                Confirm Password
              </Label>
              <Input
                id="confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your password"
                className="mt-1.5 bg-zinc-800 border-zinc-700 text-zinc-100"
                disabled={isLoading}
              />
              {confirmPassword && (
                <div className="mt-2 flex items-center gap-2 text-xs">
                  {passwordsMatch ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-green-400" />
                      <span className="text-green-400">Passwords match</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-4 h-4 text-red-400" />
                      <span className="text-red-400">Passwords do not match</span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="space-y-3">
            <Button
              onClick={handleSetup}
              disabled={!passwordsMatch || password.length < 8 || isLoading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
              size="lg"
            >
              {isLoading ? 'Setting up encryption...' : 'Create & Encrypt'}
            </Button>

            <Button
              onClick={() => setStep('intro')}
              variant="ghost"
              className="w-full text-zinc-400 hover:text-zinc-100"
              disabled={isLoading}
            >
              Back
            </Button>
          </div>
        </Card>
      </motion.div>
    </div>
  )
}

function getPasswordStrength(password: string): {
  percent: number
  label: string
  color: string
  textColor: string
} {
  if (password.length === 0) {
    return { percent: 0, label: '', color: '', textColor: '' }
  }

  let strength = 0
  
  // Length
  if (password.length >= 8) strength += 20
  if (password.length >= 12) strength += 20
  if (password.length >= 16) strength += 10
  
  // Character variety
  if (/[a-z]/.test(password)) strength += 10
  if (/[A-Z]/.test(password)) strength += 10
  if (/[0-9]/.test(password)) strength += 15
  if (/[^a-zA-Z0-9]/.test(password)) strength += 15

  if (strength < 40) {
    return {
      percent: strength,
      label: 'Weak',
      color: 'bg-red-500',
      textColor: 'text-red-400'
    }
  } else if (strength < 70) {
    return {
      percent: strength,
      label: 'Fair',
      color: 'bg-amber-500',
      textColor: 'text-amber-400'
    }
  } else {
    return {
      percent: strength,
      label: 'Strong',
      color: 'bg-green-500',
      textColor: 'text-green-400'
    }
  }
}

// Made with Bob
