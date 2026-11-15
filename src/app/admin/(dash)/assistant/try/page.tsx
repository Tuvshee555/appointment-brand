import { connection } from 'next/server'
import { TestChat } from '@/components/admin/assistant/test-chat'
import { AssistantTabs } from '@/components/admin/assistant/tabs'
import { PageHeader } from '@/components/admin/ui'
import { requireAdminPage } from '@/server/auth/current'

export const metadata = { title: 'Туршиж үзэх · AI туслах' }

export default async function AssistantTryPage() {
  await requireAdminPage('assistant.view')
  await connection()
  return (
    <>
      <PageHeader
        title="AI туслах"
        description="Үйлчлүүлэгчийн оронд туслахтай ярьж үзнэ үү. Хариулт бүрийн доор төрөл, ашигласан арга (дүрэм эсвэл AI), үйлдлүүд харагдана. Захиалга, цуцлалт, цаг өөрчлөлтийг сервер бүрэн шалгаад хадгалахгүй буцаана."
      />
      <AssistantTabs current="try" />
      <TestChat />
    </>
  )
}
