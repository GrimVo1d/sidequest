# Claude Code hook events

Stage 0 result: which events and fields actually reach the hooks, and in what order.

- **Verified version:** Claude Code **2.1.286**, model `claude-opus-5-5`.
- **Recon date:** 2026-10-09.
- **How it was collected:** the hook `hooks/recon-hook.py` was subscribed to all events from
  the settings schema (sandbox `dev/recon-sandbox/`) and ran synchronously in exec form
  (`args`). 125 events were recorded in five sessions:
  1. `default` mode, a 10-step scenario: create and read files, an edit, a search,
     tests, a failing command, a command blocked by `permissions.deny`, `ls -la`,
     a background subagent, `AskUserQuestion`, then a manual `/compact` and exit;
  2. `auto` mode: create a file, read it, delete it;
  3. `default` mode: the user refuses ("No") a `Write` permission, an attempt at
     `sleep 30`, idle for more than a minute after a reply;
  4. `auto` mode: `git push --force` — an attempt to get an auto-mode denial;
  5. `default` mode: Esc during a command, Esc during the agent's reply, a "No" refusal;
     after each one, more than a minute without any action.

## Answers to the Stage 0 questions

| Question | Answer |
|---|---|
| How to tell "waiting for permission" from "waiting for a new prompt" | Waiting for permission or for an answer to a question is `PermissionRequest`. Waiting for a new prompt is `Stop`. These are different events, no guessing needed. But if the user answers "No", **nothing** arrives, not even `Stop`, until they send a new prompt. Details below in the "Waiting" section. |
| Is there a separate denial event | **No**, for any of the three kinds of denial that were observed. Denial by a `permissions.deny` rule: there is no `PostToolUse*` after `PreToolUse`, and the call is visible only in `PostToolBatch`. Blocking by Claude Code itself (`sleep 30`): there is not even a `PreToolUse`, and the call is visible only in `PostToolBatch`. User denial ("No"): the call does not appear anywhere else. Auto-mode denial (`PermissionDenied`) was not observed: auto mode let `git push --force` through. |
| Is the todo list visible | **No.** In this version the agent has no tool for a task list: there is no `TodoWrite` and no `TaskCreate`, and a `ToolSearch` search did not find them. The agent kept the list as text, and `TaskCreated` / `TaskCompleted` never arrived. |
| Can the context fill level be known | **No.** No event has tokens or a context share. There is only `model` (in `SessionStart`) and `effort.level`. This can only be obtained from the transcript, and the transcript must not be read. A substitute remains: the number of actions since the last compaction. |
| Do open sessions pick up new hooks | Not checked: both sessions were started after the sandbox was set up. |

## Common fields

Present in almost every event:

| Field | What it is | Beyond the normalizer |
|---|---|---|
| `hook_event_name` | event name | yes |
| `session_id` | session UUID; for subagent events it is the same as the parent's | yes (shortened or hashed) |
| `cwd` | working folder | only the folder name, as `project` |
| `transcript_path` | path to the transcript | **no** |
| `scratchpad_dir` | the session's temporary folder | **no** |
| `prompt_id` | UUID of the current user prompt; absent in `SessionStart` (startup) and `InstructionsLoaded` | can be used for grouping |
| `permission_mode` | `default`, `auto` (probably other modes too) | yes |
| `effort` | `{"level": "high"}` | can be |
| `agent_id`, `agent_type` | present only if the event came from a subagent | yes |

## Events that arrived

| Event | When | Important fields (besides the common ones) |
|---|---|---|
| `SessionStart` | session start and **again after compaction** | `source`: `startup` / `compact`; `model` |
| `InstructionsLoaded` | a CLAUDE.md was loaded (one event per file) | `file_path`, `memory_type` (`User` / `Project`), `load_reason` |
| `UserPromptSubmit` | the user's prompt **or a background task notification** | `prompt` (text, not passed on) |
| `PreToolUse` | before a tool call | `tool_name`, `tool_input`, `tool_use_id` |
| `PermissionRequest` | before a permission dialog or an `AskUserQuestion` question | `tool_name`, `tool_input`, `permission_suggestions`; **no `tool_use_id`** |
| `Notification` | the terminal is calling the user | `notification_type` (`permission_prompt`, `idle_prompt`), `message` |
| `PostToolUse` | the tool finished successfully | `tool_name`, `tool_input`, `tool_response`, `tool_use_id`, `duration_ms` |
| `PostToolUseFailure` | the tool finished with an error | `tool_name`, `tool_input`, `tool_use_id`, `error` (`"Exit code N"` and the stderr output), `is_interrupt`, `duration_ms`; no `tool_response` |
| `PostToolBatch` | after a batch of parallel calls | `tool_calls`: `[{tool_name, tool_input, tool_use_id, tool_response}]` |
| `MessageDisplay` | the agent outputs text | `delta` (text), `index`, `final`, `message_id`, `turn_id` |
| `SubagentStart` | a subagent started | `agent_id`, `agent_type` |
| `SubagentStop` | a subagent finished | `agent_id`, `agent_type`, `last_assistant_message`, `agent_transcript_path`, `background_tasks`, `session_crons`, `stop_hook_active` |
| `Stop` | the agent finished its turn and waits for a prompt | `last_assistant_message`, `background_tasks`, `session_crons`, `stop_hook_active` |
| `PreCompact` | before compaction | `trigger` (`manual`; `auto` was not seen), `custom_instructions` |
| `PostCompact` | after compaction | `trigger`, `compact_summary` (text) |
| `SessionEnd` | exit from the session | `reason` (`prompt_input_exit`) |

The normalizer drops all text fields: `prompt`, `message`, `delta`,
`last_assistant_message`, `compact_summary`, `custom_instructions`, all contents of
`tool_input` / `tool_response` / `tool_calls`, and all paths.

### `tool_input` and `tool_response` by tool

| Tool | `tool_input` | `tool_response` (in `PostToolUse`) |
|---|---|---|
| `Write` | `file_path`, `content` | `type` (`create`), `filePath`, `content`, `structuredPatch` (empty for a new file), `originalFile` (`null`), `userModified` |
| `Edit` | `file_path`, `old_string`, `new_string`, `replace_all` | `filePath`, `oldString`, `newString`, `originalFile`, `structuredPatch: [{oldStart, oldLines, newStart, newLines, lines}]`, `userModified`, `replaceAll` |
| `Read` | `file_path` | `type` (`text`), `file: {filePath, content, numLines, startLine, totalLines}` |
| `Bash` | `command`, `description` | `stdout`, `stderr`, `interrupted`, `isImage`, `noOutputExpected` |
| `Agent` | `description`, `prompt`, `subagent_type` | `isAsync`, `status` (`async_launched`), `agentId`, `resolvedModel`, `outputFile`, … |
| `AskUserQuestion` | `questions[]`; in `PostToolUse` also `answers`, `annotations` | the same as `tool_input`, with the answers |
| `ToolSearch` | `query`, `max_results` | `matches`, `query`, `total_deferred_tools` |

- **Edit lines:** `lines_added` / `lines_removed` are counted from `structuredPatch[].lines`
  (prefixes `+` / `-`). For a `Write` of a new file the patch is empty, so count the lines
  of `content`. Overwriting an existing file with `Write` was not observed.
- **Command result:** the exit code does not arrive as a separate field. Success is
  `PostToolUse`, a non-zero code is `PostToolUseFailure`. Whether the tests passed is
  visible from which of the two events arrived.
- **`error` contains the command output.** It is `"Exit code N"`, and after a line break
  the stderr: `"Exit code 128\nfatal: not a git repository …"`. The normalizer takes only
  the number from the first line and drops the rest.
- **There is no `Grep` or `Glob` in this version.** The agent searched through `Bash`
  (`grep`, `find`), so scouting arrives as `Bash`.

## Event order

Session 1 (abridged, `+seconds` from the start):

```
+0.00   SessionStart(startup) → InstructionsLoaded ×2
+13.9   UserPromptSubmit
+20.2   PreToolUse ToolSearch → PostToolUse → PostToolBatch
+25.9   PreToolUse Write → PermissionRequest → (+6 c) Notification(permission_prompt) → PostToolUse
+35.8   PreToolUse Write → PermissionRequest → PostToolUse → PostToolBatch   # two Writes in one batch, permissions one at a time
+40.1   Pre/Post Read, Pre/Post Bash ×2 (+ MessageDisplay between them) → PostToolBatch
+43.7   PreToolUse Edit → PermissionRequest → PostToolUse → PostToolBatch
+48.2   PreToolUse Bash → PermissionRequest → PostToolUse → PostToolBatch          # tests passed
+53.4   PreToolUse Bash → PermissionRequest → PostToolUseFailure → PostToolBatch   # exit 1
+57.5   PreToolUse Bash → MessageDisplay → PostToolBatch                           # deny rule: no Post*
+59.4   PreToolUse Bash → PostToolUse → PostToolBatch                              # ls -la, no request
+62.7   PreToolUse Agent → PostToolUse Agent (5 ms) → SubagentStart → PostToolBatch
+64.5   [agent_id] PreToolUse Bash → PostToolUse → PostToolBatch
+64.9   PreToolUse AskUserQuestion → PermissionRequest
+66.0   SubagentStop                                   # arrived while the main agent waits for an answer
+69.0   PostToolUse AskUserQuestion → PostToolBatch
+69.0   UserPromptSubmit                               # this is the subagent notification, prompt_id unchanged
+75.6   Stop → MessageDisplay ×2                       # Stop came before the last text
+98.4   PreCompact(manual)
+118.9  SubagentStop(agent_type="")                    # hidden compaction agent, no SubagentStart
+118.9  SessionStart(compact) → PostCompact
+133.2  SessionEnd(prompt_input_exit)
```

Session 2 (`auto`): `Write`, `Read` and `Bash rm` went through without `PermissionRequest`;
otherwise the order is the same.

Session 3 (`default`, denial and idle):

```
+0.00   SessionStart(startup) → InstructionsLoaded ×2
+6.1    UserPromptSubmit
+10.5   PreToolUse Write → PermissionRequest
        # the user answered "No": no more events, no Stop either
+111.8  UserPromptSubmit                       # the next prompt, new prompt_id
+113.2  PostToolBatch                          # sleep 30 blocked by Claude Code: no PreToolUse, no Post*
        # the user interrupted the agent's reply with Esc: no events, no Stop
+125.7  UserPromptSubmit
+129.1  MessageDisplay ×2 → Stop
+189.2  Notification(idle_prompt)              # exactly 60 s after Stop
+254.0  SessionEnd(prompt_input_exit)
```

Session 4 (`auto`): `git push --force` went through without `PermissionRequest` and without
`PermissionDenied`: `PreToolUse` → `PostToolUseFailure` (`Exit code 128`) →
`PostToolBatch` → `MessageDisplay` ×2 → `Stop`.

Session 5 (`default`, interrupts and silence after them):

```
+0.00   SessionStart(startup) → InstructionsLoaded ×2
+8.3    UserPromptSubmit
+11.1   PreToolUse Bash → PermissionRequest
        # allowed, Esc pressed during the command: no PostToolUse*, no is_interrupt
+102.3  UserPromptSubmit                       # interrupted by Esc before the first text: nothing
+118.3  UserPromptSubmit
+146.7  MessageDisplay ×6, all final: false
        # Esc during the reply: final: true never arrived, no Stop
+240.5  UserPromptSubmit
+243.2  PreToolUse Write → PermissionRequest
        # "No": nothing
+319.1  SessionEnd(prompt_input_exit)
```

After every interrupt and denial 76–93 s passed, and `Notification(idle_prompt)` never
arrived.

## Quirks and traps

- **`tool_use_id` links** `PreToolUse`, `PostToolUse`, `PostToolUseFailure` and an element
  of `PostToolBatch.tool_calls`. `PermissionRequest` does not have it: link by order, with
  the last `PreToolUse` of the same agent.
- **`SessionStart` with `source: compact`** arrives with the same `session_id`. It is not a
  new session but the end of a compaction.
- **Compaction starts a hidden subagent.** A `SubagentStop` with `agent_type: ""` arrives
  without a matching `SubagentStart`. Do not count such a `SubagentStop` as a subagent,
  otherwise a spirit or minion appears out of nowhere.
- **A background task notification arrives as `UserPromptSubmit`.** It differs from a real
  prompt: `prompt_id` does not change, and the text starts with `<task-notification>`. A
  new user prompt always gets a new `prompt_id`. The normalizer can check the start of the
  text and drop it at once, the same way it determines the category of a `Bash` command.
- **Background subagent.** `PostToolUse` for `Agent` arrives immediately (`status:
  async_launched`, a few ms), before `SubagentStart`. The subagent's work runs in parallel
  with the main agent. Its events are marked with `agent_id`.
- **`Stop` is not always the last event of a turn:** `MessageDisplay` events with the final
  text came after it. The `background_tasks` field in `Stop` is a list of background tasks
  that are still running. If it is not empty, the agent will wake up on its own, and it is
  too early to start the match finale.
- **Parallel calls.** A batch can contain several tools: `Pre` / `Post` come for each one,
  `PostToolBatch` once per batch.
- **Reading does not need permission** even in `default` mode: `Read`, `grep`, `find` and
  `ls -la` went through without `PermissionRequest`.
- **`Notification(permission_prompt)` is unreliable:** it arrived once out of nine
  requests, and then after ~6 s, when the user was slow to answer. It did not arrive for an
  `AskUserQuestion` question. Do not use it for the pause.
- **`Notification(idle_prompt)`** arrives 60 s after `Stop` if the user sent nothing. It
  does not arrive after an interrupt or a denial. The game does not need it: the end of a
  task is visible from `Stop`, and it does not help for interrupts.
- **Not every turn ends with `Stop`.** There is none after a "No" denial and after an
  interrupt with the Esc key — during a command, during a reply, and before it. In all
  these cases nothing arrives at all, and the game keeps assuming the agent is working. The
  reliable sign that the previous turn has ended is a `UserPromptSubmit` with a new
  `prompt_id`.
- **An interrupted command gives no `PostToolUseFailure`.** The fields `is_interrupt` and
  `interrupted` exist, but were never `true`. An interrupted reply is sometimes visible
  from a `MessageDisplay` with `final: false` that is not followed by `final: true`, but
  this cannot be relied on: if Esc is pressed before the first text, there is no
  `MessageDisplay` at all.
- **Claude Code itself blocks some commands.** It rejected `sleep 30` even before
  `PreToolUse`: the call is present only in `PostToolBatch.tool_calls`, and its
  `tool_response` starts with `<tool_use_error>Blocked`.
- **A "No" denial leaves no traces.** The `tool_use_id` of the rejected call does not
  appear anywhere else: not in `Post*`, not in `PostToolBatch`. A denial can be inferred
  only after the fact: a `UserPromptSubmit` arrived, and the `PermissionRequest` stayed
  unanswered.
- **`MessageDisplay`** is the agent's text in chunks (`index`, `final`). It can be passed
  to the game as "the agent is speaking", without the text.

## Waiting: pause and resume

- **Start of the pause** is `PermissionRequest` (a permission or `AskUserQuestion`). The
  banner can show the tool name.
- **End of the pause** is the next event of the same session **without `agent_id`**,
  usually `PostToolUse`, `PostToolUseFailure` or `PostToolBatch`. Events with `agent_id`
  do not lift the pause: a background subagent sends events while the main agent waits for
  an answer. `SubagentStop` belongs here too.
- **After a "No" denial there is no event.** The agent stands and waits for a new prompt,
  while the game still sees the `PermissionRequest`. The pause is lifted only at the next
  `UserPromptSubmit`. So the "Continue" button in the banner is mandatory, not a
  fallback.
- **The agent is silent.** After Esc the game thinks the agent is working, and there will
  be no signal to the contrary. The solution is an "Agent is silent" pause after a
  threshold without events (90 s by default, changeable in the hub settings). The match
  does not end on the timeout. Details in PLAN.md 3.4.
- **End of the task** is `Stop` with an empty `background_tasks`. After that the session
  waits for a new prompt; there is no pause, and the match finale begins.
- In `auto` mode permissions are not requested, so `PermissionRequest` arrives only for
  `AskUserQuestion`.

## Not observed, needs checking

| What | Why it matters |
|---|---|
| `PermissionDenied` (auto-mode denial) | auto mode forbade nothing, not even `git push --force`; catch it when it happens, in Stage 1 |
| `StopFailure` | the turn broke off with an API error — hard to trigger, catch it when it happens |
| `TaskCreated` / `TaskCompleted` | there is no task list tool, see above |
| `PreCompact` / `PostCompact` with `trigger: auto` | there was only a manual `/compact` |
| hook with `async: true` | not checked: it was decided to run the hook synchronously (PLAN.md 3.3) |
| `UserPromptExpansion`, `CwdChanged`, `FileChanged`, `DirectoryAdded`, `ConfigChange`, `Setup`, `Pre/PostModelSwitch`, `Worktree*`, `Elicitation*`, `TeammateIdle` | the names were accepted (settings loaded without errors), but the events did not occur; not needed for the game |
| `WebSearch`, `WebFetch`, `NotebookEdit` | were not called |
| a subagent started synchronously (not in the background) | only a background one was seen |

## Mapping to game events (PLAN.md 3.2)

| `kind` | Source |
|---|---|
| `session_start` | `SessionStart` with `source: startup` (`compact` is not a new session) |
| `session_end` | `SessionEnd` |
| `prompt` | `UserPromptSubmit` with a new `prompt_id` |
| `tool` | `PostToolUse`; `action` by `tool_name` |
| `tool_error` | `PostToolUseFailure` |
| `blocked` | `PostToolBatch.tool_calls[].tool_use_id` that had neither `PostToolUse` nor `PostToolUseFailure` (denial by a rule and blocking by Claude Code); `UserPromptSubmit` while the pause is not lifted (a "No" denial, after the fact); plus `PermissionDenied`, once it is confirmed |
| `waiting` | `PermissionRequest` |
| `resumed` | the first event of the same session without `agent_id` after `waiting`, including `UserPromptSubmit` |
| `compact` | `PreCompact` (start) and `SessionStart(compact)` / `PostCompact` (end) |
| `subagent_start` / `subagent_stop` | `SubagentStart` / `SubagentStop` with a non-empty `agent_type` |
| `todo` | no source (see above) |
| `stop` | `Stop`; the finale only when `background_tasks` is empty |
| `unknown` | everything else |

Conclusions for the plan (decisions are in PLAN.md, section 9):

- **There is no `Grep` / `Glob`**, scouting goes through `Bash`. Decided: a `Bash` command
  category `search` (`grep`, `rg`, `find`, `ls`, `cat`, …) with `action: scout`.
- **Commit and push** (arena 0.4). For the `git` category the normalizer adds a `git`
  field — a list of words from `commit` and `push` only (`git commit`; `git push`,
  `gh pr create`, `gh pr merge`). The command itself does not go further.
