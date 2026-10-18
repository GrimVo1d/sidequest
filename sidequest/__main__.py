"""Command line: python -m sidequest <command>."""

import argparse
import os
import sys

from . import claude_settings, i18n, paths, replay, selfcheck
from .db import Store
from .i18n import t
from .receiver import MAX_SOCKET_PATH, AlreadyRunningError, Receiver, SocketPathTooLongError


def _ask(question: str, assume_yes: bool) -> bool:
    if assume_yes:
        return True
    try:
        return input(question + " [y/N] ").strip().lower() in ("y", "yes", "д", "да")
    except EOFError:
        return False


def _stored_language() -> str:
    # Read only: the CLI must not create the database just to learn the language.
    if not os.path.exists(paths.DB_PATH):
        return "en"
    try:
        store = Store(paths.DB_PATH)
        try:
            language: str = store.get_setting("language")
            return language
        finally:
            store.close()
    except Exception:
        return "en"


def _open_store() -> Store:
    paths.ensure_data_dir()
    return Store(paths.DB_PATH)


def cmd_install(args: argparse.Namespace) -> int:
    emit = paths.EMIT_SCRIPT
    os.chmod(emit, 0o755)

    def confirm(changes: list[claude_settings.Change]) -> bool:
        print(
            t(
                f"В {args.settings} будут добавлены хуки Sidequest:",
                f"Sidequest hooks will be added to {args.settings}:",
            )
        )
        print(t(f"  скрипт: {emit}", f"  script: {emit}"))
        for event, what in changes:
            print(f"  {event}: {what}")
        return _ask(t("Продолжить?", "Continue?"), args.yes)

    changes, backup = claude_settings.apply(
        args.settings, lambda s: claude_settings.plan_install(s, emit), confirm
    )
    if paths.is_claude_settings(args.settings):  # a copy says nothing about the real install
        store = _open_store()
        store.set_meta("emit_hash", selfcheck.file_hash(emit))
        store.close()
    if not changes:
        print(
            t(
                "Sidequest уже подключён, ничего не изменилось.",
                "Sidequest is already connected, nothing changed.",
            )
        )
        return 0
    if backup:
        print(t(f"Резервная копия: {backup}", f"Backup: {backup}"))
    print(
        t(
            "Готово. Уже открытые сессии Claude Code, возможно, нужно перезапустить.",
            "Done. Claude Code sessions that are already open may need a restart.",
        )
    )
    return 0


def cmd_uninstall(args: argparse.Namespace) -> int:
    def confirm(changes: list[claude_settings.Change]) -> bool:
        print(
            t(
                f"Из {args.settings} будут удалены записи Sidequest:",
                f"Sidequest entries will be removed from {args.settings}:",
            )
        )
        for event, _ in changes:
            print(f"  {event}")
        return _ask(t("Продолжить?", "Continue?"), args.yes)

    changes, backup = claude_settings.apply(args.settings, claude_settings.plan_uninstall, confirm)
    if not changes:
        print(t("Записей Sidequest в settings.json нет.", "No Sidequest entries in settings.json."))
    else:
        if backup:
            print(t(f"Резервная копия: {backup}", f"Backup: {backup}"))
        print(
            t("Sidequest отключён от Claude Code.", "Sidequest is disconnected from Claude Code.")
        )
    if args.delete_core_data and _ask(
        t("Удалить профиль и общую статистику?", "Delete the profile and the shared stats?"),
        args.yes,
    ):
        if os.path.exists(paths.DB_PATH):
            os.unlink(paths.DB_PATH)
        print(t("Данные ядра удалены.", "Core data deleted."))
    if args.delete_game_data and _ask(
        t(
            "Удалить сохранения игры: рекорды, ачивки, персонажа?",
            "Delete the game's saves: records, achievements, the character?",
        ),
        args.yes,
    ):
        paths.delete_game_data(paths.GAME_DATA_DIR)
        print(t("Сохранения игры удалены.", "The game's saves are deleted."))
    return 0


def _print_result(result: selfcheck.Result) -> None:
    mark = "✗" if not result.ok else ("!" if result.warn else "✓")
    print(f"{mark} {result.name}: {result.detail}")
    if result.fix and (not result.ok or result.warn):
        print(f"    → {result.fix}")


def _path_too_long_message() -> str:
    return t(
        f"Путь к папке Sidequest слишком длинный для сокета (больше {MAX_SOCKET_PATH} байт):"
        f" {paths.SOCKET_PATH}. Перенесите папку проекта поближе к корню диска.",
        f"The path to the Sidequest folder is too long for a socket (over {MAX_SOCKET_PATH}"
        f" bytes): {paths.SOCKET_PATH}. Move the project folder closer to the disk root.",
    )


def cmd_check(args: argparse.Namespace) -> int:
    store = _open_store()
    results = [selfcheck.check_hooks(args.settings, paths.EMIT_SCRIPT, store.get_meta("emit_hash"))]
    version_result, _ = selfcheck.check_version(store.verified_version())
    results.append(version_result)
    store.close()
    # Pipeline: only possible here when the app is not running (it owns the socket).
    probe = selfcheck.PipelineProbe()
    receiver = Receiver(paths.SOCKET_PATH, lambda payload, ts: probe.offer(payload))
    try:
        receiver.start()
    except AlreadyRunningError:
        results.append(
            selfcheck.Result(
                t("Конвейер", "Pipeline"),
                True,
                t(
                    "Sidequest запущен — проверка в окне (кнопка «Проверить»)",
                    "Sidequest is running — check in the window (the “Check” button)",
                ),
                warn=True,
            )
        )
    except SocketPathTooLongError:
        results.append(selfcheck.Result(t("Конвейер", "Pipeline"), False, _path_too_long_message()))
    else:
        try:
            results.append(selfcheck.check_pipeline(paths.EMIT_SCRIPT, probe))
        finally:
            receiver.stop()
    for result in results:
        _print_result(result)
    return 0 if all(r.ok for r in results) else 1


def cmd_sessions(args: argparse.Namespace) -> int:
    store = _open_store()
    for s in store.sessions(args.limit):
        print(
            f"{s['id']}  {s['project'] or '?'}  started={s['started_at']:.0f}"
            + (t("  (присоединилась)", "  (joined)") if s["joined"] else "")
        )
    store.close()
    return 0


def cmd_export(args: argparse.Namespace) -> int:
    store = _open_store()
    try:
        path = replay.export_session(store, args.session, paths.RECORDINGS_DIR, args.name)
    finally:
        store.close()
    print(t(f"Запись сохранена: {path}", f"Recording saved: {path}"))
    return 0


def cmd_run(args: argparse.Namespace) -> int:
    try:
        import webview  # noqa: F401
    except ImportError:
        print(
            t(
                "Нет pywebview. Запускайте через .venv/bin/python -m sidequest",
                "No pywebview. Run with .venv/bin/python -m sidequest",
            ),
            file=sys.stderr,
        )
        return 1
    from . import app

    try:
        app.run(dev=args.dev, settings_path=args.settings)
    except AlreadyRunningError:
        print(t("Sidequest уже запущен.", "Sidequest is already running."), file=sys.stderr)
        return 1
    except SocketPathTooLongError:
        print(_path_too_long_message(), file=sys.stderr)
        return 1
    return 0


def main(argv: list[str] | None = None) -> int:
    os.umask(0o077)  # every file Sidequest creates is private (600 / 700)
    i18n.set_language(i18n.resolve(_stored_language()))
    parser = argparse.ArgumentParser(prog="python -m sidequest")
    parser.add_argument(
        "--dev", action="store_true", help=t("панель разработчика", "developer panel")
    )
    parser.add_argument(
        "--settings",
        default=paths.CLAUDE_SETTINGS,
        help=t("путь к settings.json Claude Code", "path to Claude Code settings.json"),
    )
    parser.set_defaults(func=cmd_run)
    sub = parser.add_subparsers(dest="command")

    p = sub.add_parser("run", help=t("открыть окно (по умолчанию)", "open the window (default)"))
    p.add_argument("--dev", action="store_true", help=t("панель разработчика", "developer panel"))
    p.add_argument("--settings", default=paths.CLAUDE_SETTINGS)
    p.set_defaults(func=cmd_run)

    p = sub.add_parser(
        "install", help=t("подключить хуки к Claude Code", "connect the hooks to Claude Code")
    )
    p.add_argument(
        "--settings",
        default=paths.CLAUDE_SETTINGS,
        help=t(
            "путь к settings.json (для тестов — временная копия)",
            "path to settings.json (a temporary copy for tests)",
        ),
    )
    p.add_argument(
        "--yes", action="store_true", help=t("не спрашивать подтверждение", "do not ask to confirm")
    )
    p.set_defaults(func=cmd_install)

    p = sub.add_parser(
        "uninstall",
        help=t("отключить хуки от Claude Code", "disconnect the hooks from Claude Code"),
    )
    p.add_argument("--settings", default=paths.CLAUDE_SETTINGS)
    p.add_argument("--yes", action="store_true")
    p.add_argument(
        "--delete-core-data",
        action="store_true",
        help=t("удалить профиль и общую статистику", "delete the profile and the shared stats"),
    )
    p.add_argument(
        "--delete-game-data",
        action="store_true",
        help=t("удалить сохранения игры", "delete the game's saves"),
    )
    p.set_defaults(func=cmd_uninstall)

    p = sub.add_parser("check", help=t("быстрая самопроверка", "quick self-check"))
    p.add_argument("--settings", default=paths.CLAUDE_SETTINGS)
    p.set_defaults(func=cmd_check)

    p = sub.add_parser("sessions", help=t("последние сессии", "recent sessions"))
    p.add_argument("--limit", type=int, default=20)
    p.set_defaults(func=cmd_sessions)

    p = sub.add_parser(
        "export",
        help=t(
            "сохранить сессию как запись в dev/recordings/",
            "save a session as a recording in dev/recordings/",
        ),
    )
    p.add_argument("session")
    p.add_argument("--name")
    p.set_defaults(func=cmd_export)

    args = parser.parse_args(argv)
    try:
        code: int = args.func(args)  # one of the cmd_* functions above
        return code
    except (claude_settings.SettingsError, ValueError) as e:
        print(t(f"Ошибка: {e}", f"Error: {e}"), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
