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

  const sharedCardClass = "p-8 bg-card/80 backdrop-blur-xl border shadow-xl"
  const sharedFieldClass = "mt-1.5"

  if (step === 'intro') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4"
        style={{
          background: 'linear-gradient(135deg, hsl(var(--background-gradient-start)), hsl(var(--background-gradient-end)))'
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-2xl"
        >
          <Card className={sharedCardClass}>
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
                <Shield className="w-8 h-8 text-primary" />
              </div>
              <h1 className="text-3xl font-bold mb-2">
                Welcome to Budget
              </h1>
              <p className="text-muted-foreground">
                Let's secure your financial data with zero-knowledge encryption
              </p>
            </div>

            <div className="space-y-6 mb-8">
              <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/50">
                <Lock className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                <div>
                  <h3 className="font-semibold mb-1">
                    End-to-End Encryption
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Your data is encrypted locally using AES-256-GCM. Only you have the key.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/50">
                <Key className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                <div>
                  <h3 className="font-semibold mb-1">
                    Master Password
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Your master password is never stored. It's used to derive encryption keys using Argon2id.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/50">
                <Shield className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                <div>
                  <h3 className="font-semibold mb-1">
                    Tamper Detection
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    HMAC signatures protect your data integrity. Any unauthorized changes are detected.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-warning/10 border border-warning/20 rounded-lg p-4 mb-6">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-warning mt-0.5 flex-shrink-0" />
                <div className="text-sm text-warning-foreground/80">
                  <p className="font-semibold mb-1 text-warning-foreground">Important</p>
                  <p>
                    If you forget your master password, your data cannot be recovered. 
                    Choose a strong password you'll remember.
                  </p>
                </div>
              </div>
            </div>

            <Button onClick={() => setStep('setup')} className="w-full" size="lg">
              Continue to Setup
            </Button>
          </Card>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4"
      style={{
        background: 'linear-gradient(135deg, hsl(var(--background-gradient-start)), hsl(var(--background-gradient-end)))'
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <Card className={sharedCardClass}>
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
              <Lock className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold mb-2">
              Create Master Password
            </h1>
            <p className="text-muted-foreground text-sm">
              This password will encrypt all your financial data
            </p>
          </div>

          <div className="space-y-4 mb-6">
            <div>
              <Label htmlFor="password">Master Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter a strong password"
                className={sharedFieldClass}
                disabled={isLoading}
              />
              {password && (
                <div className="mt-2">
                  <div className="flex items-center gap-2 text-xs">
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
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
              <Label htmlFor="confirm">Confirm Password</Label>
              <Input
                id="confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your password"
                className={sharedFieldClass}
                disabled={isLoading}
              />
              {confirmPassword && (
                <div className="mt-2 flex items-center gap-2 text-xs">
                  {passwordsMatch ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-success" />
                      <span className="text-success">Passwords match</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-4 h-4 text-destructive" />
                      <span className="text-destructive">Passwords do not match</span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
              {error}
            </div>
          )}

          <div className="space-y-3">
            <Button
              onClick={handleSetup}
              disabled={!passwordsMatch || password.length < 8 || isLoading}
              className="w-full disabled:opacity-50"
              size="lg"
            >
              {isLoading ? 'Setting up encryption...' : 'Create & Encrypt'}
            </Button>

            <Button
              onClick={() => setStep('intro')}
              variant="ghost"
              className="w-full"
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
      color: 'bg-destructive',
      textColor: 'text-destructive'
    }
  } else if (strength < 70) {
    return {
      percent: strength,
      label: 'Fair',
      color: 'bg-warning',
      textColor: 'text-warning'
    }
  } else {
    return {
      percent: strength,
      label: 'Strong',
      color: 'bg-success',
      textColor: 'text-success'
    }
  }
}

// Made with Bob
