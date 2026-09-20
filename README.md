# loose-ends

A live checklist above the Claude Code prompt of what the conversation raised: topics, proposals, open questions, decisions and tasks. Nothing gets lost while the conversation moves on.

```
Todo · 3 open · 1 done
  ○ 2. Decide where the band draws: above the prompt or a side pane
  ○ 3. Expose the list to the main model as a tool?
  ○ 4. Prune old sessions from the store
  ✓ 1. Understand how Mindful-Claude hooks into the UI
```

## How it works

It is a Claude Mod: a plugin whose hooks are TypeScript functions running inside Claude Code.

- After every main-loop turn (`turn.complete`), it reads the messages the checklist has not seen yet (`$.session.messages()`) and asks Haiku (`$.model.complete`) which items to add and which open ones the conversation settled. The call runs outside the main context: the conversation's model never sees it.
- The list is drawn in the band above the prompt (`ui.render` on `AbovePrompt`). Collapse it with `ctrl+x ctrl+a`.
- Each item's `○` is a button that checks it off (and `✓` reopens it): click it in the fullscreen layout, or press `ctrl+x tab` to focus the band, walk with `Tab` or the arrows and press `Enter`.
- Each session keeps its own list in `$.store`, so `--resume` brings it back. The last 30 sessions are kept.
- `/exit` with open items asks first, from a `command.run` hook that runs the exit only when the dialog says so. It covers `/exit` alone: `ctrl+c` and `ctrl+d` raise no event a plugin can see, and `session.end` only observes. Turn it off with `/todo exit off`.
- Items you change by hand are pinned: the model never closes an item you reopened, and never adds back one you dropped.

Cost: one Haiku call per turn with the new messages (capped at about 40k characters) and the current list. It only runs in interactive sessions, never under `claude -p`.

## `/todo`

| Command | What it does |
|---|---|
| `/todo` | The whole list |
| `/todo add <text>` | Add an item by hand |
| `/todo done 2 5` | Mark items done |
| `/todo undo 2` | Reopen an item |
| `/todo rm 3` | Drop an item |
| `/todo clear` | Empty the list |
| `/todo scan` | Read the whole conversation again |
| `/todo on` / `off` | Show or hide the band (off also pauses the model calls) |
| `/todo rows 12` | Rows the band may take |
| `/todo exit on` / `off` | Ask before `/exit` while items are open |

## Develop

Needs Claude Code 2.1.278 or later (the build its types were generated from) with `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` in the settings `env`.

```sh
claude --plugin-dir .      # loads from disk, hot-reloads on save
bun test
claude plugin validate .claude-plugin/plugin.json
```

For type checking, run `/plugin-types` in a session, then `bunx -p typescript tsc -p .`.

To install it for every session:

```sh
claude plugin marketplace add fernandomoraes/loose-ends
claude plugin install loose-ends@loose-ends
```
