# Task D: the Workflows screen (browser app)

Read `briefs/common.md` first and follow it (it has the HTTP contract).

Create ONLY files under `web/src/workflows/`. The entry file is `web/src/workflows/WorkflowsScreen.tsx` and must export `function WorkflowsScreen(props: ScreenProps)`.

Read first: `web/src/App.tsx` (`ScreenProps`), `web/src/api.ts` (`api`, `listen`, `runEventsUrl`), `web/src/theme.css` (use its classes and variables; do not invent colours, sizes or new button styles), `src/shared/api.ts` (`Workflow`, `WorkflowStep`, `AgentStep`, `CommandStep`, `OnFail`, `WorkflowRunState`, `StepRun`, `WorkflowEvent`).

Stack: React 19 function components and hooks, TypeScript, plain CSS in one file `web/src/workflows/workflows.css` imported by the screen. No UI library, no state library, no chart or graph library: the graph is plain HTML and CSS.

## Purpose

A workflow is an ordered list of steps that plain code runs in order: an agent step lets the model work on a task, a command step runs a program (compile, simulate, a Python check). When a step fails, the workflow can go back to an earlier step and try again, a limited number of times. The user builds and edits workflows here, runs them, and watches each step pass or fail.

## Layout, top to bottom

**Header row:** `<h1>Workflows</h1>`, a status pill, and muted text `Plain code runs the steps in order. The model is used only inside agent steps.`
Pill text by run status: `Ready` (idle), `Running step <n> of <total>, round <r>` (class `warn`), `Paused before step <n>` (`tint`), `Finished in <r> round(s)` (`ok`), `Stopped, a step failed` (`bad`), `Stopped by you` (`bad`).

**Workflow card** (class `card`):
- Label `Workflow`, then one button per workflow (`aria-pressed` on the selected one) and a dashed `New workflow` button.
- A row of fields: `Name` (text), `Task for this run` (text, wide, initial value = the workflow's `task`), then the main button and, when the run is paused, a `Stop` button (`btn btn-danger`).
- Main button: `Run workflow` when idle; `Stop` (`btn btn-danger`) while running; `Continue` while paused; `Run again` after done, failed or stopped. (`btn btn-primary` except Stop.)
- `Variables`: a small list of `name` and `value` inputs for `workflow.vars`, with `Add variable` and a remove button per row. Muted hint: `Use {name} in tasks and commands. {task} is the task for this run.`
- A save state pill at the right of the card: `Saved` or `Unsaved` (`warn`). Edits are saved automatically with `api.saveWorkflow` 800 ms after the last change. There is no save button.
- `Delete workflow` (`btn btn-ghost`, asks `Delete this workflow?` with `window.confirm`).

**Graph card** (class `card`), only when there is at least one step. This must look refined: thin, quiet, exact.
- A header row: label `Graph`, and at the right a small legend: a 10px circle outline `Agent step`, a 10px rounded-square outline `Command step`, a small arc `Goes back if the step fails`.
- The graph is a horizontal row of equal-width columns, one per step (min 118px each; the card scrolls horizontally if needed).
- Each column, top to bottom, centred: a 28px marker, the step name (13px, weight 500), the agent id or the program name (12px, muted, ellipsis), the status word (12px, weight 500, coloured) only when not waiting, and small muted marks (`pauses for me`, `runs once`) when set. The whole column is a button; clicking it opens that step's card below and scrolls it into view.
- Marker: a circle for an agent step, a 7px-radius square for a command step, 2px border. Waiting: border `var(--line2)`, background `var(--card)`, the step number in muted text. Running: border `var(--acc)`, background `var(--tint)`, number in `var(--tintink)`, and a soft ring `box-shadow: 0 0 0 4px var(--tint)`. Passed or kept: border and background `var(--acc)`, a `✓` in `var(--onacc)`. Failed: border `var(--bad)`, background `var(--badb)`, a `!` in `var(--badink)`.
- A 2px line joins the centres of neighbouring markers, drawn behind them; a segment is `var(--acc)` when the step on its left has passed or was kept, otherwise `var(--line2)`.
- Above the markers, one arc per `onFail` rule whose target is an earlier step: a half-ellipse from the centre of the target marker to the centre of the failing step's marker (a `div` with `border: 1.5px solid; border-bottom: none; border-radius: 50% 50% 0 0 / 100% 100% 0 0`, absolutely positioned with percentage `left` and `width`, height `16 + 14 * span` px where span = number of columns crossed). A small downward triangle at the target end. Centred on the top of the arc, on a `var(--card)` background, an 11px label `on fail · max <maxRounds>`. Colour `var(--line2)` with muted label; `var(--bad)` when that step's latest result is failed.

**Two columns below** (wrap under 1000px):

Left, the step list:
- One card per step. Card header (a button, toggles the editor): number, name, a small tag `Agent` or `Command`, the agent id or the command joined with spaces (mono), at the right the status word coloured (`Waiting` muted, `Running` warn, `Passed` ok, `Kept` ok, `Failed` bad) and a caret. Border `var(--acc)` while running, `var(--bad)` when failed.
- Under the header, always visible, one muted line describing the rules: `If it fails: stop and ask me` or `If it fails: back to step <n>, at most <k> rounds`, plus ` · runs only once` and ` · pauses for me after` when set.
- The step's latest result text when it has one (mono, 12px, preserved line breaks, max height 160px, scrolls); failed results on `var(--badb)` with `var(--badink)`.
- While the step runs: the most recent `line` event for it, small and muted.
- When the run is failed, stopped or paused: a `Run from this step` button (`btn`) on every card, calling `api.resumeRun(runId, step.id)`.
- The editor (when open), a responsive grid of fields: `Step name`; `Type` select (`Agent step, uses the model` / `Command step, no model`); for an agent step an `Agent` select listing `props.config.agents` and a `Task` textarea (3 rows); for a command step a `Command` text input (mono) holding the program and arguments separated by spaces, with double quotes for an argument that contains spaces (parse it into the `command` array and join it back the same way) and a `Time limit, seconds` number input; `If it fails` select with `Stop and ask me` and one option `Go back to step <n>: <name>` for this step and each earlier step; `Most rounds` select (1, 2, 3, 5), shown only when going back; checkboxes `Pause for me after this step` and `Run only once, keep the result in later rounds`; buttons `Move up`, `Move down`, `Remove step` (`btn btn-danger`). Changing the type keeps the name and rules and gives the new type sensible empty fields.
- New ids: `step-<n>` with the smallest unused n. When a step is removed, any `onFail` that pointed to it is cleared.
- Under the list a dashed, full-width `Add step` button (adds an agent step named `New step` and opens it).
- No steps: `This workflow has no steps yet. Add a step to begin.`

Right, the run panel (fixed 320px):
- Three small cards in a row: `Round`, `Agent steps run`, `Command steps run` (count results in the current state by step type; kept steps do not count).
- A card `Result`: the name and result text of the most recently finished command step (mono, preserved line breaks; lines with FAIL or error in `tone-bad`, PASS in `tone-ok`). None yet: `Nothing yet. The output of the last command step shows up here.`
- A card `Rounds`: the run's `log`, one line each. Empty: `Nothing yet. Each loop back and each finished round is listed here.`
- Small muted text: the project folder the run uses (`props.folder`).

## Behaviour

- Load workflows with `api.workflows()` on mount. None: show only the `New workflow` button and `No workflows yet.` New workflow: id `workflow-<n>` (smallest unused), name `New workflow`, empty task, no vars, no steps; save it and select it.
- Run: `api.startRun({ workflow: <the current edited workflow>, folder: props.folder, server: props.server, task })`, then `listen(runEventsUrl(id), ...)`. A `state` event replaces the run state; a `line` event updates the latest line of its step. One run at a time per screen; starting a new one closes the old stream.
- Stop: `api.stopRun`. Continue: `api.resumeRun(id)`.
- Selecting another workflow while a run is active is allowed; the run panel then shows nothing for the other workflow (keep run state per workflow id).
- Keep the pure parts (command text <-> array, id generation, removing a step and clearing references, counters, status-to-words) in `web/src/workflows/logic.ts`, exported, with no React in it.
- Every failed API call shows its sentence in `tone-bad` near the main button; nothing fails silently.
- Close the event stream on unmount.

## Quality bar

- Calm and minimal, like the rest of `theme.css`: one accent colour, thin borders, no shadows other than the running ring, no gradients, no icon libraries.
- Keyboard: everything reachable by Tab; cards and graph columns are real buttons; every input has a visible label.
- No horizontal page scroll at 1280px (the graph card scrolls inside itself when it must).
- Works in both themes: use only CSS variables for colour.

## Verify

- From `web/`: `npx tsc --noEmit` shows no errors in your files. (`../src/shared` is included; errors in `web/src/work/` belong to someone else: ignore but mention.)
- Do not start a dev server.
