import { describe, expect, test } from 'bun:test'
import { RESCAN_MESSAGES, buildPrompt, parseOps, pending, type Message } from '../hooks/todo/extract.ts'

const msgs = (n: number): Message[] => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `m${i}` }))

describe('pending', () => {
  test('takes what came after the cursor, skipping empty messages', () => {
    const all: Message[] = [...msgs(3), { role: 'user', text: '  ' }, { role: 'assistant', text: 'last' }]
    const { batch, cursor } = pending(all, 2)
    expect(batch.map(m => m.text)).toEqual(['m2', 'last'])
    expect(cursor).toBe(5)
  })

  test('reads the tail again when the transcript shrank', () => {
    const { batch, cursor } = pending(msgs(100), 500)
    expect(batch.length).toBe(RESCAN_MESSAGES)
    expect(batch[0]?.text).toBe(`m${100 - RESCAN_MESSAGES}`)
    expect(cursor).toBe(100)
  })
})

describe('buildPrompt', () => {
  test('lists the checklist and labels the speakers', () => {
    const prompt = buildPrompt([{ id: 1, text: 'Pick the model', status: 'open', pinned: false }], msgs(2))
    expect(prompt).toContain('#1 [open] Pick the model')
    expect(prompt).toContain('PERSON: m0')
    expect(prompt).toContain('ASSISTANT: m1')
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

  test('defaults missing fields and rejects non-JSON', () => {
    expect(parseOps('{"add": ["a", 5]}')).toEqual({ add: ['a'], done: [] })
    expect(parseOps('nothing here')).toBeUndefined()
    expect(parseOps('{broken')).toBeUndefined()
  })
})
