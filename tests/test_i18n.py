"""Two languages: the setting, the system language and the texts in place."""
import os
import unittest
from unittest import mock

from sidequest import i18n, selfcheck


class I18nTest(unittest.TestCase):
    def setUp(self):
        self.addCleanup(i18n.set_language, i18n.language())

    def test_text_follows_the_language(self):
        i18n.set_language("en")
        self.assertEqual(i18n.t("Хуки", "Hooks"), "Hooks")
        i18n.set_language("ru")
        self.assertEqual(i18n.t("Хуки", "Hooks"), "Хуки")
        i18n.set_language("de")  # unknown: Russian, like before there was a choice
        self.assertEqual(i18n.language(), "ru")

    def test_auto_follows_the_system(self):
        with mock.patch.dict(os.environ, {"LC_ALL": "", "LC_MESSAGES": "", "LANG": "ru_RU.UTF-8"}):
            self.assertEqual(i18n.resolve("auto"), "ru")
            self.assertEqual(i18n.resolve("en"), "en")
        with mock.patch.dict(os.environ, {"LC_ALL": "en_US.UTF-8"}):
            self.assertEqual(i18n.resolve("auto"), "en")
            self.assertEqual(i18n.resolve("ru"), "ru")

    def test_self_check_speaks_english(self):
        i18n.set_language("en")
        result = selfcheck.check_hooks("/nonexistent/settings.json", "/nonexistent/emit.sh", None)
        self.assertEqual(result.name, "Hooks")
        self.assertFalse(result.ok)
        self.assertNotRegex(result.detail + result.fix, "[А-Яа-я]")


if __name__ == "__main__":
    unittest.main()
