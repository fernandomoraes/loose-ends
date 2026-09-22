import { describe, expect, test } from 'bun:test'
import { DEFAULTS, applyCommand, openText, readConfig } from '../hooks/loose-ends/command.ts'
import { EMPTY, applyOps } from '../hooks/loose-ends/list.ts'

const state = { ...applyOps(EMPTY, { add: ['First', 'Second'], done: [] }), cursor: 6 }

describe('applyCommand', () => {
  test('lists with no arguments', () => {
    const { text } = applyCommand(state, DEFAULTS, '')
    expect(text).toContain('2 open')
    expect(text).toContain('○ 1. First')
  })

  test('done, undo and rm pin the items', () => {
    const done = applyCommand(state, DEFAULTS, 'done 1, #2 9')
    expect(done.state.items.map(item => [item.status, item.pinned])).toEqual([['done', true], ['done', true]])
    expect(done.text).toContain('no item 9')
    const undone = applyCommand(done.state, DEFAULTS, 'undo 2')
    expect(undone.state.items[1]?.status).toBe('open')
    expect(applyCommand(state, DEFAULTS, 'rm 1').state.items[0]?.status).toBe('dropped')
  })

  test('add keeps the text as typed', () => {
    const { state: next, text } = applyCommand(state, DEFAULTS, 'add   Revisar o schema  do banco ')
    expect(next.items.at(-1)?.text).toBe('Revisar o schema do banco')
    expect(text).toContain('3. Revisar o schema do banco')
  })

  test('clear keeps the cursor, scan resets it', () => {
    expect(applyCommand(state, DEFAULTS, 'clear').state).toEqual({ ...EMPTY, cursor: 6 })
    const scan = applyCommand(state, DEFAULTS, 'scan')
    expect(scan.scan).toBe(true)
    expect(scan.state.cursor).toBe(0)
  })

  test('on, off, rows and exit change the config', () => {
    expect(applyCommand(state, DEFAULTS, 'off').config.enabled).toBe(false)
    expect(applyCommand(state, DEFAULTS, 'rows 12').config.rows).toBe(12)
    expect(applyCommand(state, DEFAULTS, 'rows 99').config).toBe(DEFAULTS)
    expect(applyCommand(state, DEFAULTS, 'exit off').config.confirmExit).toBe(false)
    expect(applyCommand(state, DEFAULTS, 'exit').config).toBe(DEFAULTS)
  })
})

test('openText lists the open items and counts the rest', () => {
  const many = applyOps(EMPTY, { add: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], done: [] })
  const text = openText(applyCommand(many, DEFAULTS, 'done 1').state.items)
  expect(text.split('\n')[0]).toBe('loose-ends: staying here, 6 open')
  expect(text).toContain('○ 2. b')
  expect(text).toContain('+1 more')
})

test('readConfig falls back field by field', () => {
  expect(readConfig({ enabled: false, rows: 'x' })).toEqual({ ...DEFAULTS, enabled: false })
})
