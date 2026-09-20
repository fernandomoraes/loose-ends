export type Status = 'open' | 'done' | 'dropped'

export type Item = {
  id: number
  text: string
  status: Status
  /** Set once the person changed the status by hand: the model no longer closes it. */
  pinned: boolean
}

export type TodoState = { items: Item[]; nextId: number; cursor: number }

export type Ops = { add: string[]; done: number[] }

export const EMPTY: TodoState = { items: [], nextId: 1, cursor: 0 }

const MAX_TEXT = 120

export function cleanText(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > MAX_TEXT ? `${flat.slice(0, MAX_TEXT - 1)}…` : flat
}

const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

const isStatus = (value: unknown): value is Status => value === 'open' || value === 'done' || value === 'dropped'

function readItem(raw: unknown): Item[] {
  if (typeof raw !== 'object' || raw === null) return []
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'number' || !Number.isInteger(r.id) || typeof r.text !== 'string' || !isStatus(r.status)) return []
  return [{ id: r.id, text: r.text, status: r.status, pinned: r.pinned === true }]
}

export function readState(saved: unknown): TodoState {
  const s = (typeof saved === 'object' && saved !== null ? saved : {}) as Record<string, unknown>
  const items = Array.isArray(s.items) ? s.items.flatMap(readItem) : []
  const maxId = items.reduce((max, item) => Math.max(max, item.id), 0)
  const nextId = typeof s.nextId === 'number' && Number.isInteger(s.nextId) && s.nextId > maxId ? s.nextId : maxId + 1
  const cursor = typeof s.cursor === 'number' && Number.isInteger(s.cursor) && s.cursor >= 0 ? s.cursor : 0
  return { items, nextId, cursor }
}

export function applyOps(state: TodoState, ops: Ops): TodoState {
  const items = state.items.map(item =>
    item.status === 'open' && !item.pinned && ops.done.includes(item.id) ? { ...item, status: 'done' as const } : item)
  const seen = new Set(items.map(item => normalize(item.text)))
  let nextId = state.nextId
  for (const raw of ops.add) {
    const text = cleanText(raw)
    const key = normalize(text)
    if (!key || seen.has(key)) continue
    seen.add(key)
    items.push({ id: nextId++, text, status: 'open', pinned: false })
  }
  return { ...state, items, nextId }
}

export function addItem(state: TodoState, raw: string): { state: TodoState; item: Item | undefined } {
  const text = cleanText(raw)
  if (!text) return { state, item: undefined }
  const item: Item = { id: state.nextId, text, status: 'open', pinned: false }
  return { state: { ...state, items: [...state.items, item], nextId: state.nextId + 1 }, item }
}

export function setStatus(state: TodoState, ids: readonly number[], status: Status): { state: TodoState; changed: Item[]; missing: number[] } {
  const known = new Set(state.items.map(item => item.id))
  const missing = ids.filter(id => !known.has(id))
  const changed: Item[] = []
  const items = state.items.map(item => {
    if (!ids.includes(item.id)) return item
    const next = { ...item, status, pinned: true }
    changed.push(next)
    return next
  })
  return { state: changed.length > 0 ? { ...state, items } : state, changed, missing }
}

export function toggle(state: TodoState, id: number): TodoState {
  const item = state.items.find(candidate => candidate.id === id)
  if (!item || item.status === 'dropped') return state
  return setStatus(state, [id], item.status === 'open' ? 'done' : 'open').state
}

export function counts(items: readonly Item[]): { open: number; done: number } {
  let open = 0
  let done = 0
  for (const item of items) {
    if (item.status === 'open') open++
    else if (item.status === 'done') done++
  }
  return { open, done }
}

/** What fits in `room` rows: open items first, then the latest done ones; one row goes to "+N more". */
export function bandItems(items: readonly Item[], room: number): { shown: Item[]; hidden: number } {
  const open = items.filter(item => item.status === 'open')
  const done = items.filter(item => item.status === 'done').reverse()
  const all = [...open, ...done]
  if (all.length <= room) return { shown: all, hidden: 0 }
  const fit = Math.max(0, room - 1)
  return { shown: all.slice(0, fit), hidden: all.length - fit }
}

export const mark = (item: Item) => (item.status === 'done' ? '✓' : item.status === 'dropped' ? '✗' : '○')
