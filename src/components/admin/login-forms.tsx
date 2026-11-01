'use client'

import { Eye, Loader2, LogIn, UserRound } from 'lucide-react'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { loginAction, startDemoAction } from '@/server/actions/auth'

export function DemoEntry({ enabled }: { enabled: boolean }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const go = (view: 'owner' | 'specialist') =>
    start(async () => {
      setError(null)
      const res = await startDemoAction({ view })
      if (res && !res.ok) setError(res.error)
    })
  if (!enabled) return <p className="text-sm text-ink-3">Демо нэвтрэлт энэ орчинд идэвхгүй.</p>
  return (
    <div className="space-y-3">
      <Button size="lg" className="w-full" onClick={() => go('owner')} disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        Админ самбар үзэх
      </Button>
      <Button variant="secondary" className="w-full" onClick={() => go('specialist')} disabled={pending}>
        <UserRound className="size-4" aria-hidden />
        Мастерын эрхээр үзэх (Ану)
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function LoginForm() {
  const [pending, start] = useTransition()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        start(async () => {
          setError(null)
          const res = await loginAction({ email, password })
          if (res && !res.ok) setError(res.error)
        })
      }}
    >
      <Field label="И-мэйл" htmlFor="login-email">
        <Input
          id="login-email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </Field>
      <Field label="Нууц үг" htmlFor="login-password">
        <Input
          id="login-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </Field>
      {error ? (
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="secondary" className="w-full" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <LogIn className="size-4" aria-hidden />}
        Нэвтрэх
      </Button>
    </form>
  )
}
