/* @jsx h */
import type { CommandRunInput, CommandRunResult, EngineInterface, Register } from 'claude-code'
import { DEFAULTS, applyCommand, openText, readConfig, type Config } from './todo/command.ts'
import { SYSTEM, buildPrompt, parseOps, pending } from './todo/extract.ts'
import { EMPTY, applyOps, bandItems, counts, mark, readState, toggle, type TodoState } from './todo/list.ts'

const MODEL = 'haiku'
const MAX_SESSIONS = 30
const COLOR = '#5fb3b3'

let config: Config = DEFAULTS
let state: TodoState = EMPTY
let sessionId: string | undefined
let isInteractive = false
let isUpdating = false
let isQueued = false

const log = ($: EngineInterface, what: string, to: 'transcript' | 'debug' = 'transcript') => (err: unknown) =>
  $.ui.log(`loose-ends: ${what}: ${err}`, { to })

const keyOf = (id: string) => `session:${id}`

async function syncSession($: EngineInterface): Promise<void> {
  const id = await $.session.id()
  if (id === sessionId) return
  sessionId = id
  state = readState(await $.store.get(keyOf(id)).catch(log($, 'store read failed')))
  $.ui.invalidate('ui.render')
}

async function save($: EngineInterface): Promise<void> {
  if (sessionId === undefined) return
  await $.store.set(keyOf(sessionId), state)
  const sessions = (await $.store.keys()).filter(key => key.startsWith('session:'))
  for (const old of sessions.slice(0, Math.max(0, sessions.length - MAX_SESSIONS))) await $.store.delete(old)
}

async function toggleItem($: EngineInterface, id: number): Promise<void> {
  state = toggle(state, id)
  $.ui.invalidate('ui.render')
  await save($).catch(log($, 'store write failed'))
}

async function update($: EngineInterface): Promise<void> {
  if (isUpdating) {
    isQueued = true
    return
  }
  isUpdating = true
  $.ui.invalidate('ui.render')
  try {
    await syncSession($)
    const { batch, cursor } = pending(await $.session.messages(), state.cursor)
    if (batch.length > 0) {
      const reply = await $.model.complete({ model: MODEL, system: SYSTEM, prompt: buildPrompt(state.items, batch) })
      const ops = parseOps(reply)
      if (!ops) throw new Error(`unreadable reply: ${reply.slice(0, 200)}`)
      state = applyOps(state, ops)
    }
    state = { ...state, cursor }
    await save($)
  } catch (err) {
    log($, 'update failed', 'debug')(err)
  } finally {
    isUpdating = false
    $.ui.invalidate('ui.render')
    if (isQueued) {
      isQueued = false
      $.clock.after(0, () => void update($))
    }
  }
}

type Next = (e: CommandRunInput) => Promise<CommandRunResult>

/** `/exit` while items are open: the dialog decides, and Esc or a dismissal keeps the session. */
async function confirmExit($: EngineInterface, e: CommandRunInput, next: Next): Promise<CommandRunResult> {
  await syncSession($).catch(log($, 'session not read', 'debug'))
  const { open } = counts(state.items)
  if (!config.enabled || !config.confirmExit || open === 0) return next(e)
  const answer = await $.ui
    .ask(`${open} open todo item${open === 1 ? '' : 's'}. Leave the session?`, { options: ['Leave', 'Stay'], header: 'Todo' })
    .catch(() => 'Stay')
  return answer === 'Leave' ? next(e) : { text: openText(state.items) }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    isInteractive = e.isInteractive
    config = readConfig(await $.store.get('config').catch(log($, 'store read failed')))
    await syncSession($).catch(log($, 'session not read'))
    await $.command.register({
      name: 'todo',
      description: 'The checklist of what this conversation raised: add, done, undo, rm, clear, scan, on, off (loose-ends)',
      argumentHint: '[add <text> | done <n> | undo <n> | rm <n> | clear | scan | on | off | rows <n> | exit on|off | help]',
      immediate: true,
    }).catch(log($, '/todo not registered'))
    return r
  })

  on('turn.start', async ($, e, next) => {
    await syncSession($).catch(log($, 'session not read', 'debug'))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const isMainAnswer = e.agentId === undefined && (e.reason === 'answer' || e.reason === 'aborted')
    if (isInteractive && config.enabled && isMainAnswer) $.clock.after(0, () => void update($))
    return r
  })

  on('command.run', { command: 'todo' }, async ($, e) => {
    await syncSession($).catch(log($, 'session not read', 'debug'))
    const applied = applyCommand(state, config, e.args)
    if (applied.config !== config) {
      config = applied.config
      await $.store.set('config', config).catch(log($, 'store write failed'))
    }
    if (applied.state !== state) {
      state = applied.state
      await save($).catch(log($, 'store write failed'))
    }
    if (applied.scan) $.clock.after(0, () => void update($))
    $.ui.invalidate('ui.render')
    return { text: applied.text }
  })

  on('command.run', { command: 'exit' }, confirmExit)
  on('command.run', { command: 'quit' }, confirmExit)

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!config.enabled || e.props.hasSurvey) return next(e)
    const { open, done } = counts(state.items)
    if (open + done === 0 && !isUpdating) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const room = Math.max(1, Math.min(config.rows, e.props.maxRows) - 1)
    const { shown, hidden } = bandItems(state.items, room)
    const header = `Todo · ${open} open${done > 0 ? ` · ${done} done` : ''}${isUpdating ? ' · updating…' : ''}`
    const hint = e.viewport?.isFullscreen ? 'click ○ to check off' : 'ctrl+x tab, then enter to check off'
    return (
      <Box flexDirection="column">
        <Box flexDirection="column" width={e.props.bodyColumns}>
          <Box flexDirection="row" gap={2}>
            <Text color={COLOR} bold>{header}</Text>
            <Text dimColor wrap="truncate-end">{hint}</Text>
          </Box>
          {shown.map(item => (
            <Box flexDirection="row" paddingLeft={2}>
              <Button key={`toggle:${item.id}`} label={`${mark(item)} ${item.id}.`} plain
                dimColor={item.status === 'done'} onPress={() => void toggleItem($, item.id)} />
              <Text wrap="truncate-end" dimColor={item.status === 'done'} strikethrough={item.status === 'done'}>
                {` ${item.text}`}
              </Text>
            </Box>
          ))}
          {hidden > 0 ? <Text dimColor>{`  +${hidden} more · /todo`}</Text> : null}
        </Box>
        {await next(e)}
      </Box>
    )
  })
}
