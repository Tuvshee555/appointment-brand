// Role-based access control. Roles and their permission lists are seeded into
// salon.admin_roles from ROLE_DEFINITIONS; the server always checks the
// permission list loaded with the session, never what the browser shows.

export const PERMISSIONS = [
  'dashboard.view',
  'appointments.view',
  'appointments.manage',
  'services.view',
  'services.manage',
  'staff.view',
  'staff.manage',
  'customers.view',
  'customers.manage',
  'customers.contact',
  'payments.view',
  'payments.manage',
  'reports.view',
  'settings.view',
  'settings.manage',
  'notifications.view',
  'assistant.view',
  'audit.view',
  'demo.reset',
] as const

export type Permission = (typeof PERMISSIONS)[number]

export type RoleKey = 'owner' | 'manager' | 'reception' | 'specialist' | 'demo_viewer'

const VIEW_ALL: Permission[] = PERMISSIONS.filter((p) => p.endsWith('.view'))

export const ROLE_DEFINITIONS: Record<RoleKey, { name: string; description: string; permissions: Permission[] }> = {
  owner: {
    name: 'Эзэмшигч',
    description: 'Бүх тохиргоо, үнэ, ажилтан, тайлан, демо өгөгдлийг удирдана.',
    permissions: [...PERMISSIONS],
  },
  manager: {
    name: 'Менежер',
    description: 'Цаг захиалга, үйлчилгээ, ажилтан, харилцагч, төлбөр, тайланг удирдана.',
    permissions: PERMISSIONS.filter((p) => p !== 'demo.reset' && p !== 'audit.view'),
  },
  reception: {
    name: 'Ресепшн',
    description: 'Цаг захиалга, харилцагчийн бүртгэл, төлбөр хүлээн авалт.',
    permissions: [
      'dashboard.view',
      'appointments.view',
      'appointments.manage',
      'services.view',
      'staff.view',
      'customers.view',
      'customers.manage',
      'customers.contact',
      'payments.view',
      'payments.manage',
      'notifications.view',
    ],
  },
  specialist: {
    name: 'Мастер',
    description: 'Зөвхөн өөрийн хуваарь, захиалгыг харж, үйлчилгээ дууссаныг тэмдэглэнэ.',
    permissions: ['dashboard.view', 'appointments.view', 'services.view', 'staff.view'],
  },
  demo_viewer: {
    name: 'Демо зочин',
    description:
      'Зохиомол өгөгдлийг уншина. Өөрчлөлтийг сервер шалгаад хадгалахгүйгээр буцаана; зөвхөн өөрийн үүсгэсэн туршилтын захиалгыг өөрчилнө.',
    permissions: VIEW_ALL,
  },
}

export function hasPermission(permissions: readonly string[], permission: Permission): boolean {
  return permissions.includes(permission)
}
