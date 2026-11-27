// The knowledge base's topics (src/lib/knowledge-topics.ts) and the bug they
// fixed: the server page read the topic names from a 'use client' module, got a
// client reference instead of the object, showed raw keys and opened every
// editor on «Ерөнхий», so saving an entry would have reset its topic.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { describe, expect, it } from 'vitest'
import { KNOWLEDGE_TOPICS, TOPIC_LABELS, isKnowledgeTopic, knowledgeTopic, topicLabel } from '@/lib/knowledge-topics'

describe('knowledge topics', () => {
  it('names every topic in Mongolian, never by its key', () => {
    for (const topic of KNOWLEDGE_TOPICS) {
      expect(TOPIC_LABELS[topic]).toMatch(/^[А-ЯӨҮЁа-яөүё ,]+$/)
      expect(topicLabel(topic)).toBe(TOPIC_LABELS[topic])
      expect(topicLabel(topic)).not.toBe(topic)
    }
  })

  it('opens the editor of an entry on its stored topic, so a save sends the same topic back', () => {
    for (const topic of KNOWLEDGE_TOPICS) {
      expect(knowledgeTopic(topic)).toBe(topic)
      expect(isKnowledgeTopic(topic)).toBe(true)
    }
    expect(knowledgeTopic('preparation')).toBe('preparation')
  })

  it('reads a value no longer offered as «Ерөнхий» instead of showing it raw', () => {
    for (const value of ['', 'Preparation', 'unknown', null, undefined, 3]) {
      expect(knowledgeTopic(value)).toBe('general')
      expect(topicLabel(value)).toBe('Ерөнхий')
    }
  })
})

// A server page or layout may take components and types from a 'use client'
// module, nothing else: any other value arrives as a client reference.
const SRC = resolve(__dirname, '../../src')

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) files(path, out)
    else if (/^(page|layout|loading|error|not-found)\.tsx$/.test(name)) out.push(path)
  }
  return out
}

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? join(SRC, spec.slice(2)) : resolve(dirname(from), spec)
  for (const candidate of [base, `${base}.tsx`, `${base}.ts`, join(base, 'index.tsx'), join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

const isClientModule = (path: string) => /^\s*['"]use client['"]/.test(readFileSync(path, 'utf8'))

describe('server pages and client modules', () => {
  it('server pages import only components and types from client modules', () => {
    const problems: string[] = []
    for (const file of files(join(SRC, 'app'))) {
      if (isClientModule(file)) continue
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g)) {
        if (match[1]) continue
        const spec = match[3]
        if (!spec.startsWith('@/') && !spec.startsWith('.')) continue
        const target = resolveImport(file, spec)
        if (!target || !isClientModule(target)) continue
        for (const raw of match[2].split(',')) {
          const name = raw.trim().split(/\s+as\s+/)[0]
          if (!name || name.startsWith('type ')) continue
          // A component is PascalCase with a lowercase letter; ALL_CAPS constants and camelCase values are not.
          if (!/^[A-Z][A-Za-z0-9]*$/.test(name) || !/[a-z]/.test(name)) problems.push(`${file.slice(SRC.length)}: ${name} from ${spec}`)
        }
      }
    }
    expect(problems).toEqual([])
  })
})
