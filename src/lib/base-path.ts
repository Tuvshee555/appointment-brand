// The app is served under a base path (/portfolio/appointments). next/link and
// redirects add it automatically; plain <img src>, next/image src and fetch()
// URLs do not, so those go through withBasePath().

export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

export function withBasePath(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) return path
  if (BASE_PATH && (path === BASE_PATH || path.startsWith(`${BASE_PATH}/`))) return path
  return `${BASE_PATH}${path}`
}
