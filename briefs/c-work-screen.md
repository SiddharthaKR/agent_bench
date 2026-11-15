# Task C: the Work screen (browser app)

Read `briefs/common.md` first and follow it (it has the HTTP contract).

Create ONLY files under `web/src/work/`. The entry file is `web/src/work/WorkScreen.tsx` and must export `function WorkScreen(props: ScreenProps)`.

Read first: `web/src/App.tsx` (`ScreenProps`), `web/src/api.ts` (`api`, `listen`, `sessionEventsUrl`), `web/src/theme.css` (use its classes and variables; do not invent colours, sizes or new button styles), `src/shared/api.ts` (`SessionEvent`, `TreeNode`, `DiffLine`).

Stack: React 19 function components and hooks, TypeScript, plain CSS in one file `web/src/work/work.css` imported by the screen. No UI library, no state library. The editor is CodeMirror 6 using only the installed packages: `@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/language`, `@codemirror/legacy-modes` (use `StreamLanguage.define(verilog)` from `@codemirror/legacy-modes/mode/verilog` for `.v`, `.sv`, `.vh`; `python` mode for `.py`; plain text otherwise).

## Purpose

This is where the user does daily hardware coding with a local model. They see the project files, edit a file themselves, watch what the agent does step by step, accept or reject each change, and tell it what to do next. It looks like a code editor: files on the left, the file in the middle, the conversation on the right.

## Layout

One row at the top, then three panels side by side that fill the remaining height. Below 1000px wide the panels wrap.

**Top row:** `<h1>` with the agent's name (from `props.config.agents`), the folder path (mono, muted), a status pill (`Idle`, `Working` with class `warn`, `Waiting for you` with class `tint`), and at the right a checkbox `Ask me before edits` (default on; when a session exists, changing it calls `api.setAskFirst`).

**Files panel** (fixed 240px, class `card`):
- Label `Folder`, a text input holding the folder path and an `Open` button (form submit). Open calls `props.setFolder(path)` and reloads the tree.
- The tree from `api.tree(folder)`. Folders are collapsible (top level open by default), with a caret (`▸` / `▾`), 16px indentation per level. Files open on click. The open file is highlighted with `var(--tint)`. Rows are buttons, 28px tall, text does not wrap (ellipsis).
- A file the agent changed in this session (a `file` event) shows a bold `M` at the right in `var(--warn)`.
- Empty folder: `This folder has no files yet.` Error from the server: show its sentence in `tone-bad`.
- Under the tree, small muted text: `M marks files the agent changed.`
- Reload the tree when a `file` event arrives for a path that is not in the tree yet.

**Code panel** (flexible, widest, class `card`): three tabs `File`, `Change`, `Output` (buttons with `aria-pressed`), and the open file's path at the right (mono, muted).
- **File tab:** the CodeMirror editor filling the panel (line numbers, undo history, default keymap, the theme following the page: read CSS variables so it works in light and dark). Above it one line: `Editing <path>`, a pill `Saved` or `Unsaved` (class `warn`), and at the right the hint `Saves on its own. Ctrl+S saves now.` There is NO save button.
  - Autosave: 1200 ms after the last keystroke call `api.writeFile`. Ctrl+S (and Cmd+S) saves at once and must not open the browser's save dialog. Switching files or leaving saves first if unsaved.
  - If the agent changes the open file (a `file` event for it): when the editor has no unsaved text, reload it; when it has, keep the user's text and show a one-line notice `The agent changed this file.` with a `Reload` button.
  - No file open: `Open a file from the list.`
- **Change tab:** the most recent `proposal`. Header: `Proposed change to <path>` (or `New file <path>`) and a pill: `Waiting for you` (`tint`), `Applied` (`ok`), `Discarded` (`bad`). The diff: one row per `DiffLine`, mono, with a gutter mark (`+`, `−`, or blank) and the line number; added rows background `var(--okb)` text `var(--addink)`, removed rows background `var(--badb)` text `var(--badink)`. While pending: buttons `Accept` (class `btn btn-primary`) and `Reject` (class `btn`), which call `api.resolveProposal`. No proposal yet: `No proposed changes yet.` When a new pending proposal arrives, switch to this tab.
- **Output tab:** the result text of the most recent finished step whose tool is `compile` or `run_sim`, mono, one row per line; lines containing FAIL or error (case-insensitive) in `tone-bad`, lines containing PASS in `tone-ok`. Header shows which tool and target it came from. None yet: `No tool output yet.`

**Conversation panel** (min 340px, flexible, class `card`), a column:
- The feed, scrolling, newest at the bottom, auto-scrolls to the bottom when new items arrive unless the user has scrolled up.
  - `user`: right-aligned bubble, background `var(--tint)`.
  - `agent`: plain text, left, preserving line breaks.
  - `note`: small text, muted, or `tone-bad` when `tone` is `bad`.
  - `step`: a row with a 2px left border. It is a button: caret, the tool name (mono, medium weight), the target, and the status (`running…` in `tone-warn`, `ok` in `tone-ok`, `error` in `tone-bad`, `waiting for you` in `tone-warn`, `rejected` and `blocked` in `tone-bad`). The first line of the result is shown under failed steps. Clicking expands three labelled blocks: `What the model thought` (the `thinking` text, or `Nothing recorded.`), `Tool call it made` (`call`, mono, preserved whitespace), `Result it got back` (`result`, mono). Long blocks scroll inside a max height of 240px.
- While the state is `working`: a line `Agent is working…` and under it, small and muted, the last 3 lines of the live `stream` text (thinking and text deltas concatenated since the last step or message; clear it when a `step`, `agent` or `user` event arrives).
- Two quick buttons (class `btn`, pill-shaped via border-radius 999px): `Fix the failing tests`, `Run the simulation again`. They send that text.
- The message form: a text input (placeholder `Tell the agent what to do`), `Send` (`btn btn-primary`), `Stop` (`btn btn-danger`, enabled only while working or waiting), and a `New session` button (`btn btn-ghost`) that forgets the current session and clears the feed.
- Empty feed: `Start a session. Type what you want this agent to do in the box below.`

## Session handling

- No session until the first message. On Send: if there is no session, `api.createSession({ agent, folder, server, askFirst })`, then `listen(sessionEventsUrl(id), ...)`, then `api.sendMessage`. While working, Send still works (it steers the agent).
- Reduce events into state in one pure reducer function (`web/src/work/reduce.ts`, exported, no React in it): events with an `id` replace the earlier item with the same id and keep its position; `status`, `stream`, `file`, `usage` update their own fields. Keep it easy to test.
- Show `usage` in the top row as small muted text: `<modelCalls> model calls · context <contextTokens> tokens`.
- Changing the agent, folder or model server in the header starts fresh: close the stream, clear the session.
- Close the event stream on unmount.
- Every failed API call shows its sentence as a `note` with tone `bad` in the feed; nothing fails silently.

## Quality bar

- Looks calm and minimal, like the rest of `theme.css`: one accent colour, thin borders, no shadows, no gradients, no icons libraries (the carets are text characters).
- Keyboard: everything reachable by Tab; the tree and steps are real buttons; inputs have labels (visible or `aria-label`).
- No horizontal page scroll at 1280px. Long paths and lines wrap or ellipsize inside their panel.
- Works in both themes: use only CSS variables for colour.

## Verify

- From `web/`: `npx tsc --noEmit` shows no errors in your files. (`../src/shared` is included; errors in `web/src/workflows/` belong to someone else: ignore but mention.)
- Do not start a dev server.
