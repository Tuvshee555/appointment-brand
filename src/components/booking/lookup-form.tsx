'use client'

import { Loader2 } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { lookupBookingAction } from '@/server/actions/customer-booking'

export function LookupForm() {
  const router = useRouter()
  const params = useSearchParams()
  const [reference, setReference] = useState(params.get('reference') ?? '')
  const [phone, setPhone] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault()
        start(async () => {
          setError(null)
          const res = await lookupBookingAction({ reference, phone })
          if (res.ok) {
            router.push(`/booking/${res.data.reference}`)
            return
          }
          setErrors(res.fieldErrors ?? {})
          setError(res.fieldErrors ? null : res.error)
        })
      }}
    >
      <Field label="Захиалгын дугаар" htmlFor="lookup-ref" error={errors.reference} hint="Жишээ: SV-7K3QH9">
        <Input
          id="lookup-ref"
          value={reference}
          onChange={(e) => setReference(e.target.value.toUpperCase())}
          autoCapitalize="characters"
          autoComplete="off"
          aria-invalid={Boolean(errors.reference)}
        />
      </Field>
      <Field label="Захиалсан утасны дугаар" htmlFor="lookup-phone" error={errors.phone}>
        <Input
          id="lookup-phone"
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          aria-invalid={Boolean(errors.phone)}
        />
      </Field>
      {error ? (
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        Захиалгаа харах
      </Button>
    </form>
  )
}
