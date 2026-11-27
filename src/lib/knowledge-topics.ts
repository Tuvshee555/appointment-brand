// The assistant knowledge base's topics and their Mongolian names.
//
// A plain module on purpose: the knowledge page is a server component, and a
// constant imported from a 'use client' module reaches it as a client
// reference, not as the object. That is how every entry once showed its raw
// key («preparation») and every editor opened on «Ерөнхий», so saving an entry
// would have reset its topic (2026-11-27). Server pages, client forms and the
// save action all read the topics from here.

export const KNOWLEDGE_TOPICS = ['general', 'preparation', 'aftercare', 'payment', 'parking', 'policy'] as const

export type KnowledgeTopic = (typeof KNOWLEDGE_TOPICS)[number]

export const TOPIC_LABELS: Record<KnowledgeTopic, string> = {
  general: 'Ерөнхий',
  preparation: 'Бэлтгэл',
  aftercare: 'Дараах арчилгаа',
  payment: 'Төлбөр',
  parking: 'Зогсоол, хүрэх',
  policy: 'Журам',
}

export function isKnowledgeTopic(value: unknown): value is KnowledgeTopic {
  return typeof value === 'string' && (KNOWLEDGE_TOPICS as readonly string[]).includes(value)
}

/** A stored topic as the editor opens it: the topic itself, or «Ерөнхий» for a value no longer offered. */
export function knowledgeTopic(value: unknown): KnowledgeTopic {
  return isKnowledgeTopic(value) ? value : 'general'
}

/** The name staff read; never the raw key. */
export function topicLabel(value: unknown): string {
  return TOPIC_LABELS[knowledgeTopic(value)]
}
