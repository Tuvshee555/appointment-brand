// Small text helpers for Messenger and Instagram replies. Pure, so they are
// unit-tested without a database.

/**
 * Adds a day's free times to a Messenger reply. When the assistant's last line is
 * "Маргааш, Маникюр — сул цагууд: <tip>", the times go right after its colon, so the day
 * and service are not repeated on a second line; otherwise they get a line of their own.
 */
export function withSlotTimes(lines: string[], header: string, times: string): string[] {
  const last = lines[lines.length - 1]
  const at = last?.startsWith(header) ? last.search(/(сул цагууд|free times):/) : -1
  if (last === undefined || at < 0) return [...lines, `${header}: ${times}`]
  const colon = last.indexOf(':', at) + 1
  const tip = last.slice(colon).trim()
  return [...lines.slice(0, -1), `${last.slice(0, colon)} ${times}.${tip ? ` ${tip}` : ''}`]
}
