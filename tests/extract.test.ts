import { describe, expect, test } from 'bun:test'
import { MAX_ADDS, RESCAN_MESSAGES, buildPrompt, parseOps, pending, type Message } from '../hooks/loose-ends/extract.ts'

const msgs = (n: number): Message[] => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `m${i}` }))

describe('pending', () => {
  test('judges what came after the cursor, holding back the latest exchange', () => {
    const all: Message[] = [...msgs(3), { role: 'user', text: '  ' }, { role: 'assistant', text: 'a3' }, { role: 'user', text: 'u5' }, { role: 'assistant', text: 'a6' }]
    const { batch, latest, cursor } = pending(all, 2)
    expect(batch.map(m => m.text)).toEqual(['m2', 'a3'])
    expect(latest.map(m => m.text)).toEqual(['u5', 'a6'])
    expect(cursor).toBe(5)
  })

  test('has nothing to judge until the person writes again', () => {
    const { batch, latest, cursor } = pending(msgs(2), 0)
    expect(batch).toEqual([])
    expect(latest.map(m => m.text)).toEqual(['m0', 'm1'])
    expect(cursor).toBe(0)
  })

  test('skips tool results when finding the latest message', () => {
    const all: Message[] = [...msgs(2), { role: 'user', text: 'm2' }, { role: 'assistant', text: 'tool' }, { role: 'user', text: '' }, { role: 'assistant', text: 'end' }]
    const { batch, latest, cursor } = pending(all, 0)
    expect(batch.map(m => m.text)).toEqual(['m0', 'm1'])
    expect(latest.map(m => m.text)).toEqual(['m2', 'tool', 'end'])
    expect(cursor).toBe(2)
  })

  test('reads the tail again when the transcript shrank', () => {
    const { batch, latest, cursor } = pending(msgs(100), 500)
    expect(batch.length).toBe(RESCAN_MESSAGES - 2)
    expect(batch[0]?.text).toBe(`m${100 - RESCAN_MESSAGES}`)
    expect(latest.map(m => m.text)).toEqual(['m98', 'm99'])
    expect(cursor).toBe(98)
  })
})

describe('buildPrompt', () => {
  test('lists the checklist and labels the speakers', () => {
    const prompt = buildPrompt([{ id: 1, text: 'Pick the model', status: 'open', pinned: false }], msgs(2))
    expect(prompt).toContain('#1 [open] Pick the model')
    expect(prompt).toContain('<earlier_messages>\nPERSON: m0\n\nASSISTANT: m1\n</earlier_messages>')
    expect(prompt).toContain('<latest_exchange>\n\n</latest_exchange>')
  })

  test('keeps the newest messages within the budget', () => {
    const big = Array.from({ length: 20 }, (_, i): Message => ({ role: 'user', text: `${i}:${'x'.repeat(5000)}` }))
    const prompt = buildPrompt([], big)
    expect(prompt).toContain('PERSON: 19:')
    expect(prompt).not.toContain('PERSON: 0:')
  })
})

describe('parseOps', () => {
  test('reads JSON wrapped in prose or fences', () => {
    expect(parseOps('```json\n{"add": ["a"], "done": [2, "#3"]}\n```')).toEqual({ add: ['a'], done: [2, 3] })
  })

  test('keeps at most MAX_ADDS new items', () => {
    expect(parseOps('{"add": ["a", "b", "c", "d", "e"]}')?.add.length).toBe(MAX_ADDS)
  })

  test('defaults missing fields and rejects non-JSON', () => {
    expect(parseOps('{"add": ["a", 5]}')).toEqual({ add: ['a'], done: [] })
    expect(parseOps('nothing here')).toBeUndefined()
    expect(parseOps('{broken')).toBeUndefined()
  })
})
