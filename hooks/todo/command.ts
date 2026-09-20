import { EMPTY, addItem, counts, mark, setStatus, type Item, type Status, type TodoState } from './list.ts'

export type Config = {
  enabled: boolean
  /** Rows the band may take above the prompt, its header included. */
  rows: number
  /** Whether `/exit` asks first while items are open. */
  confirmExit: boolean
}

export const DEFAULTS: Config = { enabled: true, rows: 8, confirmExit: true }

const MIN_ROWS = 2
const MAX_ROWS = 30

export function readConfig(saved: unknown): Config {
  const s = (typeof saved === 'object' && saved !== null ? saved : {}) as Record<string, unknown>
  return {
    enabled: typeof s.enabled === 'boolean' ? s.enabled : DEFAULTS.enabled,
    rows: typeof s.rows === 'number' && Number.isInteger(s.rows) && s.rows >= MIN_ROWS && s.rows <= MAX_ROWS ? s.rows : DEFAULTS.rows,
    confirmExit: typeof s.confirmExit === 'boolean' ? s.confirmExit : DEFAULTS.confirmExit,
  }
}

export const HELP = [
  '/todo                  the whole list',
  '/todo add <text>       add an item by hand',
  '/todo done <n...>      mark items done',
  '/todo undo <n...>      reopen items',
  '/todo rm <n...>        drop items (the model will not add them again)',
  '/todo clear            empty the list',
  '/todo scan             read the whole conversation again',
  '/todo on | off         show or hide the band above the prompt',
  `/todo rows <n>         rows the band may take (${MIN_ROWS} to ${MAX_ROWS})`,
  '/todo exit on | off    ask before /exit while items are open',
].join('\n')

const OPEN_SHOWN = 5

/** What `/exit` prints when the person stays. */
export function openText(items: readonly Item[]): string {
  const open = items.filter(item => item.status === 'open')
  const shown = open.slice(0, OPEN_SHOWN)
  const rest = open.length - shown.length
  return [
    `todo: staying here, ${open.length} open`,
    ...shown.map(line),
    ...(rest > 0 ? [`… +${rest} more · /todo`] : []),
  ].join('\n')
}

const line = (item: Item) => `${mark(item)} ${item.id}. ${item.text}`

export function listText(items: readonly Item[], config: Config): string {
  const visible = items.filter(item => item.status !== 'dropped')
  const { open, done } = counts(items)
  const head = `todo: ${open} open · ${done} done${config.enabled ? '' : ' (band off: /todo on)'}`
  if (visible.length === 0) return `${head}\nnothing yet: items show up as the conversation raises them`
  const ordered = [...visible.filter(item => item.status === 'open'), ...visible.filter(item => item.status === 'done')]
  return [head, ...ordered.map(line)].join('\n')
}

function parseIds(words: readonly string[]): number[] {
  return words.join(' ').split(/[\s,]+/).map(word => Number(word.replace(/^#/, ''))).filter(n => Number.isInteger(n) && n > 0)
}

const STATUS_OF: Record<string, Status> = { done: 'done', undo: 'open', rm: 'dropped' }

export type Applied = { state: TodoState; config: Config; text: string; scan?: true }

/** Applies one `/todo` invocation; returns the new state and config and the transcript line. */
export function applyCommand(state: TodoState, config: Config, args: string): Applied {
  const trimmed = args.trim()
  const [head = '', ...rest] = trimmed.split(/\s+/)
  const verb = head.toLowerCase()
  const same = (text: string): Applied => ({ state, config, text })

  if (!verb || verb === 'list') return same(listText(state.items, config))
  if (verb === 'help') return same(HELP)
  if (verb === 'on' || verb === 'off') {
    return { state, config: { ...config, enabled: verb === 'on' }, text: `todo: band ${verb}` }
  }
  if (verb === 'add') {
    const added = addItem(state, trimmed.slice(head.length))
    if (!added.item) return same('todo: add takes the item\'s text, e.g. /todo add review the schema')
    return { state: added.state, config, text: `todo: added ${line(added.item)}` }
  }
  const status = STATUS_OF[verb]
  if (status) {
    const ids = parseIds(rest)
    if (ids.length === 0) return same(`todo: ${verb} takes item numbers, e.g. /todo ${verb} 2 5`)
    const result = setStatus(state, ids, status)
    const report = [
      ...result.changed.map(line),
      ...(result.missing.length > 0 ? [`no item ${result.missing.join(', ')}`] : []),
    ]
    return { state: result.state, config, text: `todo: ${report.join('\n')}` }
  }
  if (verb === 'clear') return { state: { ...EMPTY, cursor: state.cursor }, config, text: 'todo: cleared' }
  if (verb === 'scan') return { state: { ...state, cursor: 0 }, config, text: 'todo: reading the conversation again…', scan: true }
  if (verb === 'exit') {
    const arg = (rest[0] ?? '').toLowerCase()
    if (arg !== 'on' && arg !== 'off') return same('todo: exit on or off')
    return { state, config: { ...config, confirmExit: arg === 'on' }, text: `todo: /exit asks first: ${arg}` }
  }
  if (verb === 'rows') {
    const rows = Number(rest[0])
    if (!Number.isInteger(rows) || rows < MIN_ROWS || rows > MAX_ROWS) return same(`todo: rows takes a whole number from ${MIN_ROWS} to ${MAX_ROWS}`)
    return { state, config: { ...config, rows }, text: `todo: the band takes up to ${rows} rows` }
  }
  return same(`todo: no command "${head}"\n${HELP}`)
}
