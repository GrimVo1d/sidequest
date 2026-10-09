"""Command line: python -m sidequest <command>."""
import argparse
import os
import shutil
import sys

from . import claude_settings, paths, replay, selfcheck
from .db import Store
from .receiver import AlreadyRunning, Receiver


def _ask(question, assume_yes):
    if assume_yes:
        return True
    try:
        return input(question + " [y/N] ").strip().lower() in ("y", "yes", "д", "да")
    except EOFError:
        return False


def _open_store():
    paths.ensure_data_dir()
    return Store(paths.DB_PATH)


def cmd_install(args):
    emit = paths.EMIT_SCRIPT
    os.chmod(emit, 0o755)

    def confirm(changes):
        print(f"В {args.settings} будут добавлены хуки Sidequest:")
        print(f"  скрипт: {emit}")
        for event, what in changes:
            print(f"  {event}: {what}")
        return _ask("Продолжить?", args.yes)

    changes, backup = claude_settings.apply(
        args.settings, lambda s: claude_settings.plan_install(s, emit), confirm)
    store = _open_store()
    store.set_meta("emit_hash", selfcheck.file_hash(emit))
    store.close()
    if not changes:
        print("Sidequest уже подключён, ничего не изменилось.")
        return 0
    if backup:
        print(f"Резервная копия: {backup}")
    print("Готово. Уже открытые сессии Claude Code, возможно, нужно перезапустить.")
    return 0


def cmd_uninstall(args):
    def confirm(changes):
        print(f"Из {args.settings} будут удалены записи Sidequest:")
        for event, _ in changes:
            print(f"  {event}")
        return _ask("Продолжить?", args.yes)

    changes, backup = claude_settings.apply(
        args.settings, claude_settings.plan_uninstall, confirm)
    if not changes:
        print("Записей Sidequest в settings.json нет.")
    else:
        if backup:
            print(f"Резервная копия: {backup}")
        print("Sidequest отключён от Claude Code.")
    if args.delete_core_data and _ask("Удалить профиль и общую статистику?", args.yes):
        if os.path.exists(paths.DB_PATH):
            os.unlink(paths.DB_PATH)
        print("Данные ядра удалены.")
    if args.delete_dlc_data is not None:
        ids = args.delete_dlc_data or (os.listdir(paths.DLC_DATA_DIR)
                                       if os.path.isdir(paths.DLC_DATA_DIR) else [])
        for dlc_id in ids:
            target = os.path.join(paths.DLC_DATA_DIR, os.path.basename(dlc_id))
            if os.path.isdir(target) and _ask(f"Удалить данные DLC {dlc_id}?", args.yes):
                shutil.rmtree(target)
                print(f"Данные DLC {dlc_id} удалены.")
    return 0


def _print_result(result):
    mark = "✗" if not result.ok else ("!" if result.warn else "✓")
    print(f"{mark} {result.name}: {result.detail}")
    if result.fix and (not result.ok or result.warn):
        print(f"    → {result.fix}")


def cmd_check(args):
    store = _open_store()
    results = [selfcheck.check_hooks(args.settings, paths.EMIT_SCRIPT,
                                      store.get_meta("emit_hash"))]
    version_result, _ = selfcheck.check_version(store.verified_version())
    results.append(version_result)
    store.close()
    # Pipeline: only possible here when the app is not running (it owns the socket).
    probe = selfcheck.PipelineProbe()
    receiver = Receiver(paths.SOCKET_PATH, lambda payload, ts: probe.offer(payload))
    try:
        receiver.start()
    except AlreadyRunning:
        results.append(selfcheck.Result("Конвейер", True,
                                        "Sidequest запущен — проверка в окне (кнопка «Проверить»)",
                                        warn=True))
    else:
        try:
            results.append(selfcheck.check_pipeline(paths.EMIT_SCRIPT, probe))
        finally:
            receiver.stop()
    for result in results:
        _print_result(result)
    return 0 if all(r.ok for r in results) else 1


def cmd_sessions(args):
    store = _open_store()
    for s in store.sessions(args.limit):
        print(f"{s['id']}  {s['project'] or '?'}  started={s['started_at']:.0f}"
              f"{'  (присоединилась)' if s['joined'] else ''}")
    store.close()
    return 0


def cmd_export(args):
    store = _open_store()
    try:
        path = replay.export_session(store, args.session, paths.RECORDINGS_DIR, args.name)
    finally:
        store.close()
    print(f"Запись сохранена: {path}")
    return 0


def cmd_run(args):
    try:
        import webview  # noqa: F401
    except ImportError:
        print("Нет pywebview. Запускайте через .venv/bin/python -m sidequest", file=sys.stderr)
        return 1
    from . import app
    try:
        app.run(dev=args.dev, settings_path=args.settings)
    except AlreadyRunning:
        print("Sidequest уже запущен.", file=sys.stderr)
        return 1
    return 0


def main(argv=None):
    os.umask(0o077)  # every file Sidequest creates is private (600 / 700)
    parser = argparse.ArgumentParser(prog="python -m sidequest")
    parser.add_argument("--dev", action="store_true", help="панель разработчика")
    parser.add_argument("--settings", default=paths.CLAUDE_SETTINGS,
                        help="путь к settings.json Claude Code")
    parser.set_defaults(func=cmd_run)
    sub = parser.add_subparsers(dest="command")

    p = sub.add_parser("run", help="открыть окно (по умолчанию)")
    p.add_argument("--dev", action="store_true", help="панель разработчика")
    p.add_argument("--settings", default=paths.CLAUDE_SETTINGS)
    p.set_defaults(func=cmd_run)

    p = sub.add_parser("install", help="подключить хуки к Claude Code")
    p.add_argument("--settings", default=paths.CLAUDE_SETTINGS,
                   help="путь к settings.json (для тестов — временная копия)")
    p.add_argument("--yes", action="store_true", help="не спрашивать подтверждение")
    p.set_defaults(func=cmd_install)

    p = sub.add_parser("uninstall", help="отключить хуки от Claude Code")
    p.add_argument("--settings", default=paths.CLAUDE_SETTINGS)
    p.add_argument("--yes", action="store_true")
    p.add_argument("--delete-core-data", action="store_true",
                   help="удалить профиль и общую статистику")
    p.add_argument("--delete-dlc-data", nargs="*", metavar="DLC",
                   help="удалить данные DLC (без списка — всех)")
    p.set_defaults(func=cmd_uninstall)

    p = sub.add_parser("check", help="быстрая самопроверка")
    p.add_argument("--settings", default=paths.CLAUDE_SETTINGS)
    p.set_defaults(func=cmd_check)

    p = sub.add_parser("sessions", help="последние сессии")
    p.add_argument("--limit", type=int, default=20)
    p.set_defaults(func=cmd_sessions)

    p = sub.add_parser("export", help="сохранить сессию как запись в dev/recordings/")
    p.add_argument("session")
    p.add_argument("--name")
    p.set_defaults(func=cmd_export)

    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except (claude_settings.SettingsError, ValueError) as e:
        print(f"Ошибка: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
