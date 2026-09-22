import { describe, expect, test } from 'bun:test'
import { EMPTY, applyOps, bandItems, cleanText, readState, setStatus, toggle, type LooseEndsState } from '../hooks/loose-ends/list.ts'

const withItems = (...texts: string[]): LooseEndsState => applyOps(EMPTY, { add: texts, done: [] })

describe('applyOps', () => {
  test('adds items with sequential ids', () => {
    const state = withItems('Decide where to draw', 'Pick the model')
    expect(state.items.map(item => [item.id, item.text, item.status])).toEqual([
      [1, 'Decide where to draw', 'open'],
      [2, 'Pick the model', 'open'],
    ])
    expect(state.nextId).toBe(3)
  })

  test('skips duplicates by normalized text, dropped items included', () => {
    const dropped = setStatus(withItems('Pick the model'), [1], 'dropped').state
    const next = applyOps(dropped, { add: ['pick the model!', 'Write tests'], done: [] })
    expect(next.items.map(item => item.text)).toEqual(['Pick the model', 'Write tests'])
  })

  test('closes open items, never pinned ones', () => {
    const reopened = setStatus(withItems('A', 'B'), [2], 'open').state
    const next = applyOps(reopened, { add: [], done: [1, 2, 99] })
    expect(next.items.map(item => item.status)).toEqual(['done', 'open'])
  })
})

describe('readState', () => {
  test('falls back to empty on junk', () => {
    expect(readState(undefined)).toEqual(EMPTY)
    expect(readState({ items: 'nope', cursor: -3 })).toEqual(EMPTY)
  })

  test('keeps valid items and repairs nextId', () => {
    const state = readState({ items: [{ id: 4, text: 'x', status: 'done' }, { id: 'bad' }], nextId: 2, cursor: 7 })
    expect(state).toEqual({ items: [{ id: 4, text: 'x', status: 'done', pinned: false }], nextId: 5, cursor: 7 })
  })
})

describe('bandItems', () => {
  test('open first, then latest done, with a more row when it overflows', () => {
    const base = withItems('a', 'b', 'c', 'd')
    const state = setStatus(base, [1, 2], 'done').state
    expect(bandItems(state.items, 10).shown.map(item => item.id)).toEqual([3, 4, 2, 1])
    const tight = bandItems(state.items, 3)
    expect(tight.shown.map(item => item.id)).toEqual([3, 4])
    expect(tight.hidden).toBe(2)
  })
})

test('toggle flips open and done, pins the item, leaves dropped and unknown ids alone', () => {
  const base = setStatus(withItems('a', 'b'), [2], 'dropped').state
  const done = toggle(base, 1)
  expect(done.items[0]).toEqual({ id: 1, text: 'a', status: 'done', pinned: true })
  expect(toggle(done, 1).items[0]?.status).toBe('open')
  expect(toggle(base, 2)).toBe(base)
  expect(toggle(base, 9)).toBe(base)
})

test('cleanText flattens whitespace and caps length', () => {
  expect(cleanText('  a\n  b  ')).toBe('a b')
  expect(cleanText('x'.repeat(300)).length).toBe(120)
})
