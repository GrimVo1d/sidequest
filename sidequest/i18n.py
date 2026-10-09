"""Two languages for everything the user reads: ru and en.

The setting "language" is "auto", "ru" or "en"; "auto" follows the system. Python code
writes both texts in place: t("Хуки", "Hooks"). The hub and the DLC get the chosen
language from the core (settings "lang"), so the window and the terminal always agree.
"""
import os

LANGS = ("ru", "en")
_lang = "ru"


def system_language():
    for name in ("LC_ALL", "LC_MESSAGES", "LANG"):
        value = os.environ.get(name, "")
        if value and value not in ("C", "POSIX") and not value.startswith("C."):
            return "ru" if value.lower().startswith("ru") else "en"
    try:
        from Foundation import NSLocale  # macOS, comes with pywebview
        preferred = NSLocale.preferredLanguages()
        if preferred and str(preferred[0]).lower().startswith("ru"):
            return "ru"
    except Exception:  # no PyObjC (plain python3): fall back to English
        pass
    return "en"


def resolve(setting):
    return setting if setting in LANGS else system_language()


def set_language(lang):
    global _lang
    _lang = lang if lang in LANGS else "ru"


def language():
    return _lang


def t(ru, en):
    return en if _lang == "en" else ru
