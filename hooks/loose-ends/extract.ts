import type { Item, Ops } from './list.ts'

export type Message = { role: 'user' | 'assistant'; text: string }

export const SYSTEM = `You watch a conversation between a person and an AI coding assistant and keep a short list of its loose ends: things that were raised, then left behind when the conversation moved on, and that the person would regret forgetting. You receive the current list, the earlier messages to judge, and the latest exchange, which shows where the conversation went next. Answer with JSON only, no prose:
{"add": ["<new item>", ...], "done": [<id>, ...]}

add: loose ends raised in <earlier_messages> that <latest_exchange> did not pick up, and that the list does not already cover (open, done or dropped). A loose end is, for example:
- a question the person asked that went unanswered, or that the assistant answered only in part
- a point the person raised in passing, next to the main request, that nobody came back to
- something deferred with "later", "for now", "after this", or a follow-up both agreed on without doing it
- a risk, caveat, bug or side effect the assistant noticed and the person did not respond to
- something the assistant skipped, stubbed, left as a TODO, could not verify, or assumed without confirming
- a choice the assistant offered or asked about that the person never answered
Not a loose end: the work being done, the person's main request and its steps, anything <latest_exchange> works on or answers, plans the assistant is carrying out, options that were weighed and settled, explanations, and the assistant's own intermediate steps. When unsure, leave it out: most turns add nothing, and a missed item costs less than noise. Write each item as a short phrase of at most 80 characters, in the language the person writes in, specific enough to act on without rereading the conversation. Merge related points into one item.
done: ids of open items the messages clearly settled: answered, decided, implemented or explicitly abandoned.
When nothing changes, answer {"add": [], "done": []}.`

const MAX_MESSAGE_CHARS = 4000
const MAX_BATCH_CHARS = 40000
const MAX_LATEST_CHARS = 12000
export const MAX_ADDS = 3
export const RESCAN_MESSAGES = 40

export type Pending = {
  /** Messages to judge: they come before the person's latest message, so what happened next is known. */
  batch: Message[]
  /** The person's latest message and the answers to it: evidence of what was picked up, judged on the next turn. */
  latest: Message[]
  cursor: number
}

/**
 * The messages past `cursor`, minus the latest exchange: something raised there is not left behind yet,
 * so the cursor stops at the person's latest message and that exchange is judged once the next one exists.
 * A transcript shorter than the cursor was compacted or cleared, so the tail is read again.
 */
export function pending(all: readonly Message[], cursor: number): Pending {
  const from = cursor > all.length ? Math.max(0, all.length - RESCAN_MESSAGES) : cursor
  const lastUser = all.findLastIndex(message => message.role === 'user' && message.text.trim() !== '')
  const split = lastUser < from ? from : lastUser
  const keep = (messages: readonly Message[]) => messages.filter(message => message.text.trim() !== '')
  return { batch: keep(all.slice(from, split)), latest: keep(all.slice(Math.max(from, lastUser))), cursor: split }
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)} […]` : text)

const line = (message: Message) => `${message.role === 'user' ? 'PERSON' : 'ASSISTANT'}: ${clip(message.text.trim(), MAX_MESSAGE_CHARS)}`

/** The newest messages that fit in `budget` characters; `fromStart` keeps the oldest instead. */
function fit(messages: readonly Message[], budget: number, fromStart = false): string {
  const lines: string[] = []
  const ordered = fromStart ? messages : [...messages].reverse()
  for (const message of ordered) {
    const text = line(message)
    if (text.length > budget) break
    budget -= text.length
    if (fromStart) lines.push(text)
    else lines.unshift(text)
  }
  return lines.join('\n\n')
}

export function buildPrompt(items: readonly Item[], batch: readonly Message[], latest: readonly Message[] = []): string {
  const list = items.length === 0 ? '(empty)' : items.map(item => `#${item.id} [${item.status}] ${item.text}`).join('\n')
  return `<list>\n${list}\n</list>\n\n<earlier_messages>\n${fit(batch, MAX_BATCH_CHARS)}\n</earlier_messages>\n\n<latest_exchange>\n${fit(latest, MAX_LATEST_CHARS, true)}\n</latest_exchange>`
}

export function parseOps(reply: string): Ops | undefined {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start < 0 || end < start) return undefined
  let data: unknown
  try {
    data = JSON.parse(reply.slice(start, end + 1))
  } catch {
    return undefined
  }
  if (typeof data !== 'object' || data === null) return undefined
  const d = data as Record<string, unknown>
  const add = Array.isArray(d.add) ? d.add.filter((x): x is string => typeof x === 'string').slice(0, MAX_ADDS) : []
  const done = Array.isArray(d.done)
    ? d.done.map(x => Number(String(x).replace(/^#/, ''))).filter(Number.isInteger)
    : []
  return { add, done }
}
