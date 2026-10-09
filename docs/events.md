# События хуков Claude Code

Результат этапа 0: какие события и поля реально приходят в хуки и в каком порядке.

- **Проверенная версия:** Claude Code **2.1.286**, модель `claude-opus-5-5`.
- **Дата разведки:** 2026-10-09.
- **Как собирали:** хук `hooks/recon-hook.py` был подписан на все события из схемы
  настроек (песочница `dev/recon-sandbox/`), запускался синхронно в exec-форме (`args`).
  Записано 125 событий в пяти сессиях:
  1. режим `default`, сценарий из 10 шагов: создать и прочитать файлы, правка, поиск,
     тесты, падающая команда, команда под запретом `permissions.deny`, `ls -la`,
     фоновый сабагент, `AskUserQuestion`, затем ручной `/compact` и выход;
  2. режим `auto`: создать файл, прочитать, удалить;
  3. режим `default`: отказ пользователя («No») в разрешении на `Write`, попытка
     `sleep 30`, простой после ответа больше минуты;
  4. режим `auto`: `git push --force` — попытка получить отказ автомода;
  5. режим `default`: Esc во время команды, Esc во время ответа агента, отказ «No»;
     после каждого — больше минуты без действий.

## Ответы на вопросы этапа 0

| Вопрос | Ответ |
|---|---|
| Как отличить «ждёт разрешения» от «ждёт нового промпта» | Ждёт разрешения или ответа на вопрос — `PermissionRequest`. Ждёт нового промпта — `Stop`. Это разные события, угадывать не нужно. Но если пользователь ответил «No», не приходит **ничего**, даже `Stop`, пока он не отправит новый промпт. Подробности ниже в разделе «Ожидание». |
| Есть ли отдельное событие отказа | **Нет** ни для одного из трёх наблюдавшихся видов отказа. Запрет правилом `permissions.deny`: после `PreToolUse` нет `PostToolUse*`, вызов виден только в `PostToolBatch`. Блокировка самим Claude Code (`sleep 30`): нет даже `PreToolUse`, вызов виден только в `PostToolBatch`. Отказ пользователя («No»): вызов не появляется больше нигде. Отказ автомода (`PermissionDenied`) не наблюдался: автомод пропустил `git push --force`. |
| Виден ли todo-лист | **Нет.** В этой версии у агента нет инструмента для списка задач: нет ни `TodoWrite`, ни `TaskCreate`, и поиск через `ToolSearch` их не нашёл. Агент вёл список текстом, `TaskCreated` / `TaskCompleted` не пришли ни разу. |
| Можно ли узнать заполнение контекста | **Нет.** Ни в одном событии нет токенов или доли контекста. Есть только `model` (в `SessionStart`) и `effort.level`. Получить это можно лишь из транскрипта, а транскрипт читать нельзя. Остаётся заменитель: число действий с последнего compaction. |
| Подхватывают ли открытые сессии новые хуки | Не проверялось: обе сессии запускались уже после настройки песочницы. |

## Общие поля

Есть почти в каждом событии:

| Поле | Что это | Дальше нормализатора |
|---|---|---|
| `hook_event_name` | имя события | да |
| `session_id` | UUID сессии; у событий сабагента — тот же, что у родителя | да (укороченный или хеш) |
| `cwd` | рабочая папка | только имя папки как `project` |
| `transcript_path` | путь к транскрипту | **нет** |
| `scratchpad_dir` | временная папка сессии | **нет** |
| `prompt_id` | UUID текущего промпта пользователя; нет в `SessionStart` (startup) и `InstructionsLoaded` | можно для группировки |
| `permission_mode` | `default`, `auto` (вероятно, и другие режимы) | да |
| `effort` | `{"level": "high"}` | можно |
| `agent_id`, `agent_type` | есть, только если событие пришло из сабагента | да |

## События, которые пришли

| Событие | Когда | Важные поля (кроме общих) |
|---|---|---|
| `SessionStart` | старт сессии и **повторно после compaction** | `source`: `startup` / `compact`; `model` |
| `InstructionsLoaded` | загружен CLAUDE.md (по событию на файл) | `file_path`, `memory_type` (`User` / `Project`), `load_reason` |
| `UserPromptSubmit` | промпт пользователя **или уведомление о фоновой задаче** | `prompt` (текст, не передаётся) |
| `PreToolUse` | перед вызовом инструмента | `tool_name`, `tool_input`, `tool_use_id` |
| `PermissionRequest` | перед диалогом разрешения или вопросом `AskUserQuestion` | `tool_name`, `tool_input`, `permission_suggestions`; **нет `tool_use_id`** |
| `Notification` | терминал зовёт пользователя | `notification_type` (`permission_prompt`, `idle_prompt`), `message` |
| `PostToolUse` | инструмент отработал успешно | `tool_name`, `tool_input`, `tool_response`, `tool_use_id`, `duration_ms` |
| `PostToolUseFailure` | инструмент завершился ошибкой | `tool_name`, `tool_input`, `tool_use_id`, `error` (`"Exit code N"` и вывод stderr), `is_interrupt`, `duration_ms`; нет `tool_response` |
| `PostToolBatch` | после пачки параллельных вызовов | `tool_calls`: `[{tool_name, tool_input, tool_use_id, tool_response}]` |
| `MessageDisplay` | агент выводит текст | `delta` (текст), `index`, `final`, `message_id`, `turn_id` |
| `SubagentStart` | сабагент запущен | `agent_id`, `agent_type` |
| `SubagentStop` | сабагент закончил | `agent_id`, `agent_type`, `last_assistant_message`, `agent_transcript_path`, `background_tasks`, `session_crons`, `stop_hook_active` |
| `Stop` | агент закончил ход и ждёт промпт | `last_assistant_message`, `background_tasks`, `session_crons`, `stop_hook_active` |
| `PreCompact` | перед compaction | `trigger` (`manual`; `auto` не видели), `custom_instructions` |
| `PostCompact` | после compaction | `trigger`, `compact_summary` (текст) |
| `SessionEnd` | выход из сессии | `reason` (`prompt_input_exit`) |

Все текстовые поля нормализатор выбрасывает: `prompt`, `message`, `delta`,
`last_assistant_message`, `compact_summary`, `custom_instructions`, всё содержимое
`tool_input` / `tool_response` / `tool_calls`, а также все пути.

### `tool_input` и `tool_response` по инструментам

| Инструмент | `tool_input` | `tool_response` (в `PostToolUse`) |
|---|---|---|
| `Write` | `file_path`, `content` | `type` (`create`), `filePath`, `content`, `structuredPatch` (пустой для нового файла), `originalFile` (`null`), `userModified` |
| `Edit` | `file_path`, `old_string`, `new_string`, `replace_all` | `filePath`, `oldString`, `newString`, `originalFile`, `structuredPatch: [{oldStart, oldLines, newStart, newLines, lines}]`, `userModified`, `replaceAll` |
| `Read` | `file_path` | `type` (`text`), `file: {filePath, content, numLines, startLine, totalLines}` |
| `Bash` | `command`, `description` | `stdout`, `stderr`, `interrupted`, `isImage`, `noOutputExpected` |
| `Agent` | `description`, `prompt`, `subagent_type` | `isAsync`, `status` (`async_launched`), `agentId`, `resolvedModel`, `outputFile`, … |
| `AskUserQuestion` | `questions[]`; в `PostToolUse` ещё `answers`, `annotations` | то же, что `tool_input` с ответами |
| `ToolSearch` | `query`, `max_results` | `matches`, `query`, `total_deferred_tools` |

- **Строки правки:** `lines_added` / `lines_removed` считаются по `structuredPatch[].lines`
  (префиксы `+` / `-`). Для `Write` нового файла патч пустой, поэтому считать строки
  `content`. Перезапись существующего файла через `Write` не наблюдалась.
- **Результат команды:** код выхода отдельным полем не приходит. Успех — это
  `PostToolUse`, ненулевой код — `PostToolUseFailure`. Прошли ли тесты, видно по тому,
  какое из двух событий пришло.
- **`error` содержит вывод команды.** Это `"Exit code N"`, а после перевода строки —
  stderr: `"Exit code 128\nfatal: not a git repository …"`. Нормализатор берёт из
  первой строки только число, остальное выбрасывает.
- **`Grep` и `Glob` в этой версии нет.** Агент искал через `Bash` (`grep`, `find`), так что
  разведка приходит как `Bash`.

## Порядок событий

Сессия 1 (сокращённо, `+секунды` от старта):

```
+0.00   SessionStart(startup) → InstructionsLoaded ×2
+13.9   UserPromptSubmit
+20.2   PreToolUse ToolSearch → PostToolUse → PostToolBatch
+25.9   PreToolUse Write → PermissionRequest → (+6 c) Notification(permission_prompt) → PostToolUse
+35.8   PreToolUse Write → PermissionRequest → PostToolUse → PostToolBatch   # два Write в одной пачке, разрешения по очереди
+40.1   Pre/Post Read, Pre/Post Bash ×2 (+ MessageDisplay между ними) → PostToolBatch
+43.7   PreToolUse Edit → PermissionRequest → PostToolUse → PostToolBatch
+48.2   PreToolUse Bash → PermissionRequest → PostToolUse → PostToolBatch          # тесты прошли
+53.4   PreToolUse Bash → PermissionRequest → PostToolUseFailure → PostToolBatch   # exit 1
+57.5   PreToolUse Bash → MessageDisplay → PostToolBatch                           # deny-правило: Post* нет
+59.4   PreToolUse Bash → PostToolUse → PostToolBatch                              # ls -la, без запроса
+62.7   PreToolUse Agent → PostToolUse Agent (5 мс) → SubagentStart → PostToolBatch
+64.5   [agent_id] PreToolUse Bash → PostToolUse → PostToolBatch
+64.9   PreToolUse AskUserQuestion → PermissionRequest
+66.0   SubagentStop                                   # пришёл, пока главный агент ждёт ответа
+69.0   PostToolUse AskUserQuestion → PostToolBatch
+69.0   UserPromptSubmit                               # это уведомление о сабагенте, prompt_id прежний
+75.6   Stop → MessageDisplay ×2                       # Stop пришёл раньше последнего текста
+98.4   PreCompact(manual)
+118.9  SubagentStop(agent_type="")                    # скрытый агент compaction, без SubagentStart
+118.9  SessionStart(compact) → PostCompact
+133.2  SessionEnd(prompt_input_exit)
```

Сессия 2 (`auto`): `Write`, `Read` и `Bash rm` прошли без `PermissionRequest`, в
остальном порядок такой же.

Сессия 3 (`default`, отказ и простой):

```
+0.00   SessionStart(startup) → InstructionsLoaded ×2
+6.1    UserPromptSubmit
+10.5   PreToolUse Write → PermissionRequest
        # пользователь ответил «No»: дальше ни одного события, Stop тоже нет
+111.8  UserPromptSubmit                       # следующий промпт, новый prompt_id
+113.2  PostToolBatch                          # sleep 30 заблокирован Claude Code: ни PreToolUse, ни Post*
        # пользователь прервал ответ агента Esc: ни одного события, Stop нет
+125.7  UserPromptSubmit
+129.1  MessageDisplay ×2 → Stop
+189.2  Notification(idle_prompt)              # ровно через 60 с после Stop
+254.0  SessionEnd(prompt_input_exit)
```

Сессия 4 (`auto`): `git push --force` прошёл без `PermissionRequest` и без
`PermissionDenied`: `PreToolUse` → `PostToolUseFailure` (`Exit code 128`) →
`PostToolBatch` → `MessageDisplay` ×2 → `Stop`.

Сессия 5 (`default`, прерывания и тишина после них):

```
+0.00   SessionStart(startup) → InstructionsLoaded ×2
+8.3    UserPromptSubmit
+11.1   PreToolUse Bash → PermissionRequest
        # разрешили, во время команды нажали Esc: ни PostToolUse*, ни is_interrupt
+102.3  UserPromptSubmit                       # прерван Esc до первого текста: ничего
+118.3  UserPromptSubmit
+146.7  MessageDisplay ×6, все final: false
        # Esc во время ответа: final: true так и не пришёл, Stop нет
+240.5  UserPromptSubmit
+243.2  PreToolUse Write → PermissionRequest
        # «No»: ничего
+319.1  SessionEnd(prompt_input_exit)
```

После каждого прерывания и отказа прошло 76–93 с, и `Notification(idle_prompt)` не
пришла ни разу.

## Особенности и ловушки

- **`tool_use_id` связывает** `PreToolUse`, `PostToolUse`, `PostToolUseFailure` и
  элемент `PostToolBatch.tool_calls`. У `PermissionRequest` его нет: связывать по
  порядку, с последним `PreToolUse` того же агента.
- **`SessionStart` с `source: compact`** приходит с тем же `session_id`. Это не новая
  сессия, а конец compaction.
- **Compaction запускает скрытого сабагента.** Приходит `SubagentStop` с
  `agent_type: ""` без парного `SubagentStart`. Такой `SubagentStop` не считать
  сабагентом, иначе дух или миньон появится из ниоткуда.
- **Уведомление о фоновой задаче приходит как `UserPromptSubmit`.** Отличия от
  настоящего промпта: `prompt_id` не меняется, а текст начинается с
  `<task-notification>`. Новый промпт пользователя всегда получает новый `prompt_id`.
  Нормализатор может проверить начало текста и сразу его выбросить, так же как
  определяет категорию `Bash`-команды.
- **Фоновый сабагент.** `PostToolUse` для `Agent` приходит сразу (`status:
  async_launched`, несколько мс), раньше `SubagentStart`. Работа сабагента идёт
  параллельно с главным агентом. Его события помечены `agent_id`.
- **`Stop` не всегда последнее событие хода:** `MessageDisplay` с итоговым текстом
  пришли после него. Поле `background_tasks` в `Stop` — список фоновых задач, которые ещё
  работают. Если он не пуст, агент проснётся сам, и финал матча начинать рано.
- **Параллельные вызовы.** В одной пачке может быть несколько инструментов: `Pre` / `Post`
  идут по каждому, `PostToolBatch` — один на пачку.
- **Чтение не требует разрешения** даже в режиме `default`: `Read`, `grep`, `find` и
  `ls -la` прошли без `PermissionRequest`.
- **`Notification(permission_prompt)` ненадёжна:** пришла один раз из девяти запросов, и
  то через ~6 с, когда пользователь медлил с ответом. На вопрос `AskUserQuestion` её не
  было. Для паузы её не использовать.
- **`Notification(idle_prompt)`** приходит через 60 с после `Stop`, если пользователь
  ничего не отправил. После прерывания и отказа её нет. Для игры не нужна: конец задачи
  виден по `Stop`, а для прерываний она не помогает.
- **Не каждый ход заканчивается `Stop`.** Его нет после отказа «No» и после прерывания
  клавишей Esc — во время команды, во время ответа и до него. Во всех случаях не приходит
  вообще ничего, и игра продолжает считать, что агент работает. Надёжный признак, что
  прошлый ход закончился, — `UserPromptSubmit` с новым `prompt_id`.
- **Прерванная команда не даёт `PostToolUseFailure`.** Поля `is_interrupt` и
  `interrupted` есть, но `true` в них не было ни разу. Прерывание ответа иногда видно по
  `MessageDisplay` с `final: false`, за которым не пришёл `final: true`, но полагаться на
  это нельзя: если Esc нажать раньше первого текста, `MessageDisplay` нет вовсе.
- **Claude Code сам блокирует некоторые команды.** `sleep 30` он отклонил ещё до
  `PreToolUse`: вызов есть только в `PostToolBatch.tool_calls`, а его `tool_response`
  начинается с `<tool_use_error>Blocked`.
- **Отказ «No» не оставляет следов.** `tool_use_id` отклонённого вызова больше не
  встречается нигде: ни в `Post*`, ни в `PostToolBatch`. Отказ можно вывести только задним
  числом: пришёл `UserPromptSubmit`, а `PermissionRequest` так и остался без ответа.
- **`MessageDisplay`** — текст агента кусками (`index`, `final`). Можно отдавать в игру
  как «агент говорит», без текста.

## Ожидание: пауза и продолжение

- **Начало паузы** — `PermissionRequest` (разрешение или `AskUserQuestion`). В
  баннере можно показать имя инструмента.
- **Конец паузы** — следующее событие этой же сессии **без `agent_id`**, обычно
  `PostToolUse`, `PostToolUseFailure` или `PostToolBatch`. События с `agent_id` паузу не
  снимают: фоновый сабагент шлёт события, пока главный агент ждёт ответа. Сюда же
  относится и `SubagentStop`.
- **После отказа «No» события нет.** Агент стоит и ждёт нового промпта, а игра всё ещё
  видит `PermissionRequest`. Пауза снимется только на следующем `UserPromptSubmit`.
  Поэтому кнопка «Продолжить» в баннере обязательна, это не запасной вариант.
- **Агент молчит.** После Esc игра думает, что агент работает, и сигнала об обратном не
  будет. Решение — пауза «Агент молчит» после порога без событий (90 с по умолчанию,
  меняется в настройках хаба). Матч по таймауту не завершается. Подробности в PLAN.md
  3.4.
- **Конец задачи** — `Stop` с пустым `background_tasks`. Дальше сессия ждёт новый
  промпт; паузы нет, начинается финал матча.
- В режиме `auto` разрешения не запрашиваются, поэтому `PermissionRequest` придёт
  только на `AskUserQuestion`.

## Что не наблюдалось и требует проверки

| Что | Почему важно |
|---|---|
| `PermissionDenied` (отказ автомода) | автомод ничего не запретил, даже `git push --force`; ловить по факту на этапе 1 |
| `StopFailure` | ход оборвался с ошибкой API — вызвать сложно, ловить по факту |
| `TaskCreated` / `TaskCompleted` | инструмента для списка задач нет, см. выше |
| `PreCompact` / `PostCompact` с `trigger: auto` | был только ручной `/compact` |
| хук с `async: true` | не проверялся: решили запускать хук синхронно (PLAN.md 3.3) |
| `UserPromptExpansion`, `CwdChanged`, `FileChanged`, `DirectoryAdded`, `ConfigChange`, `Setup`, `Pre/PostModelSwitch`, `Worktree*`, `Elicitation*`, `TeammateIdle` | имена приняты (настройки загрузились без ошибок), но события не возникали; для игры не нужны |
| `WebSearch`, `WebFetch`, `NotebookEdit` | не вызывались |
| сабагент, запущенный синхронно (не в фоне) | видели только фоновый |

## Сопоставление с игровыми событиями (PLAN.md 3.2)

| `kind` | Источник |
|---|---|
| `session_start` | `SessionStart` с `source: startup` (`compact` — не новая сессия) |
| `session_end` | `SessionEnd` |
| `prompt` | `UserPromptSubmit` с новым `prompt_id` |
| `tool` | `PostToolUse`; `action` — по `tool_name` |
| `tool_error` | `PostToolUseFailure` |
| `blocked` | `PostToolBatch.tool_calls[].tool_use_id`, для которого не было ни `PostToolUse`, ни `PostToolUseFailure` (запрет правилом и блокировка Claude Code); `UserPromptSubmit` при неснятой паузе (отказ «No», задним числом); плюс `PermissionDenied`, когда его подтвердят |
| `waiting` | `PermissionRequest` |
| `resumed` | первое событие той же сессии без `agent_id` после `waiting`, в том числе `UserPromptSubmit` |
| `compact` | `PreCompact` (начало) и `SessionStart(compact)` / `PostCompact` (конец) |
| `subagent_start` / `subagent_stop` | `SubagentStart` / `SubagentStop` с непустым `agent_type` |
| `todo` | источника нет (см. выше) |
| `stop` | `Stop`; финал — только при пустом `background_tasks` |
| `unknown` | всё остальное |

Выводы для плана (решения — в PLAN.md, раздел 9):

- **`Grep` / `Glob` нет**, разведка идёт через `Bash`. Решено: категория `Bash`-команды
  `search` (`grep`, `rg`, `find`, `ls`, `cat`, …) с `action: scout`.
