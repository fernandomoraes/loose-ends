import type { Item, Ops } from './list.ts'

export type Message = { role: 'user' | 'assistant'; text: string }

export const SYSTEM = `You keep a running checklist for a person talking with an AI coding assistant, so that nothing raised in the conversation gets lost while it moves on. You receive the current checklist and the newest messages. Answer with JSON only, no prose:
{"add": ["<new item>", ...], "done": [<id>, ...]}

add: things raised in the new messages that the person will want to come back to and that the checklist does not already cover (open, done or dropped): topics to discuss, proposals and ideas, open questions, decisions to make, tasks to do or check. Write each as a short phrase of at most 80 characters, in the language the person writes in. Merge closely related points into one item. Leave out small talk and the assistant's own intermediate steps (reading files, running commands).
done: ids of open items the new messages clearly settled: answered, decided, implemented or explicitly abandoned.
When nothing changes, answer {"add": [], "done": []}.`

const MAX_MESSAGE_CHARS = 4000
const MAX_BATCH_CHARS = 40000
export const RESCAN_MESSAGES = 40

/** The messages past `cursor`; a transcript shorter than the cursor was compacted or cleared, so the tail is read again. */
export function pending(all: readonly Message[], cursor: number): { batch: Message[]; cursor: number } {
  const from = cursor > all.length ? Math.max(0, all.length - RESCAN_MESSAGES) : cursor
  return { batch: all.slice(from).filter(message => message.text.trim() !== ''), cursor: all.length }
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)} […]` : text)

export function buildPrompt(items: readonly Item[], batch: readonly Message[]): string {
  const list = items.length === 0 ? '(empty)' : items.map(item => `#${item.id} [${item.status}] ${item.text}`).join('\n')
  const lines: string[] = []
  let budget = MAX_BATCH_CHARS
  for (const message of [...batch].reverse()) {
    const line = `${message.role === 'user' ? 'PERSON' : 'ASSISTANT'}: ${clip(message.text.trim(), MAX_MESSAGE_CHARS)}`
    if (line.length > budget) break
    budget -= line.length
    lines.unshift(line)
  }
  return `<checklist>\n${list}\n</checklist>\n\n<new_messages>\n${lines.join('\n\n')}\n</new_messages>`
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
  const add = Array.isArray(d.add) ? d.add.filter((x): x is string => typeof x === 'string') : []
  const done = Array.isArray(d.done)
    ? d.done.map(x => Number(String(x).replace(/^#/, ''))).filter(Number.isInteger)
    : []
  return { add, done }
}
