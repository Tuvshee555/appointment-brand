'use client'

import { ImageUp, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { FeedbackLine, feedbackFrom, type Feedback } from '@/components/admin/action-button'
import { Card } from '@/components/admin/ui'
import { Button } from '@/components/ui/button'
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/field'
import { Photo } from '@/components/ui/photo'
import { formatMoney } from '@/lib/money'
import {
  saveAddonAction,
  saveCategoryAction,
  saveServiceAction,
  uploadServiceImageAction,
} from '@/server/actions/admin-catalog'
import type { CatalogAdmin } from '@/server/queries/admin-catalog'

type Service = CatalogAdmin['services'][number]

const num = (v: string) => Number(v.replace(/[\s,₮]/g, '')) || 0

/** Resizes an image in the browser (max 1600px, WebP) before upload. */
async function resizeToDataUrl(file: File, max = 1600): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/webp', 0.85)
}

export function ServiceForm({ catalog, service }: { catalog: CatalogAdmin; service: Service | null }) {
  const router = useRouter()
  const [v, setV] = useState({
    name: service?.name ?? '',
    categoryId: service?.categoryId ?? catalog.categories[0]?.id ?? '',
    shortDescription: service?.shortDescription ?? '',
    description: service?.description ?? '',
    durationMinutes: String(service?.durationMinutes ?? 60),
    price: String(service?.price ?? ''),
    priceType: service?.priceType ?? 'fixed',
    bufferMinutes:
      service?.bufferMinutes === null || service?.bufferMinutes === undefined ? '' : String(service.bufferMinutes),
    isActive: service?.isActive ?? true,
    isFeatured: service?.isFeatured ?? false,
    onlineBookable: service?.onlineBookable ?? true,
    addonIds: service?.addonIds ?? [],
    skillIds: service?.skillIds ?? [],
    staffIds: service?.staffIds ?? [],
  })
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [pending, start] = useTransition()
  const [imgFeedback, setImgFeedback] = useState<Feedback>(null)
  const toggle = (key: 'addonIds' | 'skillIds' | 'staffIds', value: string) =>
    setV((s) => ({ ...s, [key]: s[key].includes(value) ? s[key].filter((x) => x !== value) : [...s[key], value] }))
  const lacking = catalog.staff.filter(
    (st) => v.staffIds.includes(st.id) && v.skillIds.some((sk) => !st.skillIds.includes(sk)),
  )

  return (
    <form
      className="grid gap-6 xl:grid-cols-[1.4fr_1fr]"
      onSubmit={(e) => {
        e.preventDefault()
        start(async () => {
          const res = await saveServiceAction({
            id: service?.id ?? null,
            name: v.name,
            categoryId: v.categoryId,
            shortDescription: v.shortDescription,
            description: v.description,
            durationMinutes: num(v.durationMinutes),
            price: num(v.price),
            priceType: v.priceType,
            bufferMinutes: v.bufferMinutes === '' ? null : num(v.bufferMinutes),
            isActive: v.isActive,
            isFeatured: v.isFeatured,
            onlineBookable: v.onlineBookable,
            addonIds: v.addonIds,
            skillIds: v.skillIds,
            staffIds: v.staffIds,
          })
          setFeedback(feedbackFrom(res, 'Хадгалагдлаа. Вэбсайт, захиалга, чатбот шинэ мэдээллийг шууд ашиглана.'))
          if (res.ok && !res.simulated && !service) router.push(`/admin/services/${res.data.id}`)
        })
      }}
    >
      <div className="space-y-6">
        <Card title="Үндсэн мэдээлэл">
          <div className="space-y-4">
            <Field label="Нэр" htmlFor="sv-name">
              <Input id="sv-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Ангилал" htmlFor="sv-cat">
                <Select id="sv-cat" value={v.categoryId} onChange={(e) => setV({ ...v, categoryId: e.target.value })}>
                  {catalog.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.isActive ? '' : ' (идэвхгүй)'}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Үргэлжлэх хугацаа (минут)"
                htmlFor="sv-dur"
                hint="Хуанли, сул цагийн тооцоонд шууд нөлөөлнө"
              >
                <Input
                  id="sv-dur"
                  inputMode="numeric"
                  value={v.durationMinutes}
                  onChange={(e) => setV({ ...v, durationMinutes: e.target.value })}
                />
              </Field>
              <Field label="Үнэ (₮)" htmlFor="sv-price" hint={num(v.price) ? formatMoney(num(v.price)) : undefined}>
                <Input
                  id="sv-price"
                  inputMode="numeric"
                  value={v.price}
                  onChange={(e) => setV({ ...v, price: e.target.value })}
                />
              </Field>
              <Field label="Үнийн төрөл" htmlFor="sv-ptype">
                <Select
                  id="sv-ptype"
                  value={v.priceType}
                  onChange={(e) => setV({ ...v, priceType: e.target.value as 'fixed' | 'from' })}
                >
                  <option value="fixed">Тогтмол</option>
                  <option value="from">«-өөс» (салонд тохирно)</option>
                </Select>
              </Field>
              <Field
                label="Дараагийн захиалгын өмнөх бэлтгэл (минут)"
                htmlFor="sv-buf"
                optional
                hint="Хоосон бол салоны ерөнхий тохиргоо"
              >
                <Input
                  id="sv-buf"
                  inputMode="numeric"
                  value={v.bufferMinutes}
                  onChange={(e) => setV({ ...v, bufferMinutes: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Товч тайлбар" htmlFor="sv-short">
              <Input
                id="sv-short"
                maxLength={220}
                value={v.shortDescription}
                onChange={(e) => setV({ ...v, shortDescription: e.target.value })}
              />
            </Field>
            <Field label="Дэлгэрэнгүй тайлбар" htmlFor="sv-desc">
              <Textarea
                id="sv-desc"
                rows={4}
                maxLength={2000}
                value={v.description}
                onChange={(e) => setV({ ...v, description: e.target.value })}
              />
            </Field>
            <div className="flex flex-wrap gap-5">
              <Checkbox
                label="Идэвхтэй"
                checked={v.isActive}
                onChange={(e) => setV({ ...v, isActive: e.target.checked })}
              />
              <Checkbox
                label="Онцлох"
                checked={v.isFeatured}
                onChange={(e) => setV({ ...v, isFeatured: e.target.checked })}
              />
              <Checkbox
                label="Онлайнаар захиална"
                checked={v.onlineBookable}
                onChange={(e) => setV({ ...v, onlineBookable: e.target.checked })}
              />
            </div>
          </div>
        </Card>
        <Card title="Нэмэлт сонголт">
          <div className="grid gap-2 sm:grid-cols-2">
            {catalog.addons.map((a) => (
              <Checkbox
                key={a.id}
                label={`${a.name} · +${formatMoney(a.price)}${a.priceType === 'from' ? '-өөс' : ''} · +${a.durationMinutes} мин${a.isActive ? '' : ' (идэвхгүй)'}`}
                checked={v.addonIds.includes(a.id)}
                onChange={() => toggle('addonIds', a.id)}
              />
            ))}
          </div>
        </Card>
      </div>
      <div className="space-y-6">
        {service ? (
          <Card title="Зураг">
            <div className="relative aspect-[4/3] overflow-hidden rounded-xs bg-sand">
              {service.imageUrl ? (
                <Photo
                  src={service.imageUrl}
                  alt={service.imageAlt ?? service.name}
                  fill
                  sizes="400px"
                  className="object-cover"
                />
              ) : null}
            </div>
            <label className="mt-3 inline-flex cursor-pointer items-center gap-2 text-sm text-cocoa-700 underline underline-offset-4">
              <ImageUp className="size-4" aria-hidden /> Шинэ зураг байршуулах
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  setImgFeedback({ kind: 'ok', text: 'Байршуулж байна…' })
                  const dataUrl = await resizeToDataUrl(file)
                  const res = await uploadServiceImageAction({ id: service.id, dataUrl, alt: v.name })
                  if (res.ok && res.data.note) setImgFeedback({ kind: 'simulated', text: res.data.note })
                  else setImgFeedback(feedbackFrom(res, 'Зураг шинэчлэгдлээ.'))
                  if (res.ok && res.data.url) router.refresh()
                }}
              />
            </label>
            <div className="mt-2">
              <FeedbackLine feedback={imgFeedback} />
            </div>
          </Card>
        ) : null}
        <Card title="Шаардлагатай ур чадвар">
          <div className="grid gap-2">
            {catalog.skills.map((s) => (
              <Checkbox
                key={s.id}
                label={s.name}
                checked={v.skillIds.includes(s.id)}
                onChange={() => toggle('skillIds', s.id)}
              />
            ))}
          </div>
        </Card>
        <Card title="Хийх мастерууд">
          <div className="grid gap-2">
            {catalog.staff.map((s) => (
              <Checkbox
                key={s.id}
                label={`${s.name}${s.isActive ? '' : ' (идэвхгүй)'}`}
                checked={v.staffIds.includes(s.id)}
                onChange={() => toggle('staffIds', s.id)}
              />
            ))}
          </div>
          {lacking.length ? (
            <p className="mt-3 text-sm text-amber-700">
              {lacking.map((l) => l.name).join(', ')} шаардлагатай ур чадваргүй — хадгалахад татгалзана.
            </p>
          ) : null}
        </Card>
        <div className="space-y-3">
          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Хадгалах
          </Button>
          <FeedbackLine feedback={feedback} />
          <p className="text-xs text-ink-3">Үнэ өөрчлөхөд өмнөх захиалгууд захиалах үеийн үнээрээ хадгалагдана.</p>
        </div>
      </div>
    </form>
  )
}

export function AddonRow({ addon }: { addon: CatalogAdmin['addons'][number] | null }) {
  const [v, setV] = useState({
    name: addon?.name ?? '',
    price: String(addon?.price ?? ''),
    durationMinutes: String(addon?.durationMinutes ?? 15),
    priceType: addon?.priceType ?? 'fixed',
    isActive: addon?.isActive ?? true,
  })
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [pending, start] = useTransition()
  return (
    <form
      className="space-y-2 border-b border-line py-3.5 last:border-0"
      onSubmit={(e) => {
        e.preventDefault()
        start(async () =>
          setFeedback(
            feedbackFrom(
              await saveAddonAction({
                id: addon?.id ?? null,
                name: v.name,
                description: addon?.description ?? '',
                price: num(v.price),
                priceType: v.priceType,
                durationMinutes: num(v.durationMinutes),
                isActive: v.isActive,
              }),
              'Хадгалагдлаа.',
            ),
          ),
        )
      }}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <Input
            aria-label="Нэмэлтийн нэр"
            placeholder="Нэмэлтийн нэр"
            value={v.name}
            onChange={(e) => setV({ ...v, name: e.target.value })}
          />
        </div>
        <Checkbox label="Идэвхтэй" checked={v.isActive} onChange={(e) => setV({ ...v, isActive: e.target.checked })} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink-3">
        <span className="flex items-center gap-1.5">
          <span className="w-28">
            <Input
              aria-label="Үнэ (₮)"
              inputMode="numeric"
              placeholder="Үнэ"
              value={v.price}
              onChange={(e) => setV({ ...v, price: e.target.value })}
            />
          </span>
          ₮
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-20">
            <Input
              aria-label="Хугацаа (минут)"
              inputMode="numeric"
              placeholder="Мин"
              value={v.durationMinutes}
              onChange={(e) => setV({ ...v, durationMinutes: e.target.value })}
            />
          </span>
          мин
        </span>
        <span className="w-44">
          <Select
            aria-label="Үнийн төрөл"
            value={v.priceType}
            onChange={(e) => setV({ ...v, priceType: e.target.value as 'fixed' | 'from' })}
          >
            <option value="fixed">Тогтмол үнэ</option>
            <option value="from">«-өөс» үнэ</option>
          </Select>
        </span>
        <Button type="submit" variant="secondary" size="sm" disabled={pending} className="ml-auto">
          {addon ? 'Хадгалах' : 'Нэмэх'}
        </Button>
      </div>
      <FeedbackLine feedback={feedback} />
    </form>
  )
}

export function CategoryRow({ category }: { category: CatalogAdmin['categories'][number] | null }) {
  const [name, setName] = useState(category?.name ?? '')
  const [isActive, setActive] = useState(category?.isActive ?? true)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [pending, start] = useTransition()
  return (
    <form
      className="flex flex-wrap items-center gap-2 border-b border-line py-2.5 last:border-0"
      onSubmit={(e) => {
        e.preventDefault()
        start(async () =>
          setFeedback(
            feedbackFrom(
              await saveCategoryAction({
                id: category?.id ?? null,
                name,
                description: category?.description ?? '',
                isActive,
              }),
              'Хадгалагдлаа.',
            ),
          ),
        )
      }}
    >
      <Input
        aria-label="Ангиллын нэр"
        placeholder="Шинэ ангилал"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="min-w-40 flex-1"
      />
      <Checkbox label="Идэвхтэй" checked={isActive} onChange={(e) => setActive(e.target.checked)} />
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {category ? 'Хадгалах' : 'Нэмэх'}
      </Button>
      {feedback ? (
        <div className="w-full">
          <FeedbackLine feedback={feedback} />
        </div>
      ) : null}
    </form>
  )
}
