// Two languages for the whole page: ru and en, no DOM needed except in apply(). The
// language comes from the core (settings "lang", also Sidequest.info.lang); like the
// Python side, texts are written in place:
//   SidequestI18n.set("en")
//   SidequestI18n.t("Играть", "Play")                  // -> "Play"
//   SidequestI18n.field(upgrade, "name")                // upgrade.name_en in English
//   SidequestI18n.pick({ru: "Матчей", en: "Matches"})   // a pair from saved data
//   SidequestI18n.apply(document)   // elements with data-en: Russian is in the markup
"use strict";

(function (root) {
  const LANGS = ["ru", "en"];
  let lang = "en";

  const I18n = {
    LANGS,
    get lang() { return lang; },
    set(value) { lang = LANGS.includes(value) ? value : "en"; },
    t(ru, en) { return lang === "en" ? en : ru; },
    // obj[name + "_en"] in English when it exists, otherwise obj[name].
    field(obj, name) {
      const en = obj[name + "_en"];
      return lang === "en" && en !== undefined ? en : obj[name];
    },
    pick(value) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return value[lang] !== undefined ? value[lang] : value.ru;
      }
      return value;
    },
    // Static texts: <button data-en="Play">Играть</button>, <x title=".." data-en-title="..">.
    // The Russian original is kept in data-ru, so switching back and forth works.
    apply(doc) {
      for (const node of doc.querySelectorAll("[data-en]")) {
        if (node.dataset.ru === undefined) node.dataset.ru = node.textContent;
        node.textContent = lang === "en" ? node.dataset.en : node.dataset.ru;
      }
      for (const node of doc.querySelectorAll("[data-en-title]")) {
        if (node.dataset.ruTitle === undefined) node.dataset.ruTitle = node.title;
        node.title = lang === "en" ? node.dataset.enTitle : node.dataset.ruTitle;
      }
      if (doc.documentElement) doc.documentElement.lang = lang;
    },
  };

  root.SidequestI18n = I18n;
})(typeof window !== "undefined" ? window : globalThis);
