// The "Hero" screen: the look of the hero who runs the arena. A live preview that walks,
// shoots and lowers the gun; the parts and colors by tabs, ready looks and "random". Rare
// choices open with achievements (balance.character.unlocks) and carry a rarity, the color
// of their frame; a locked one is gray and says what opens it. Nothing is saved until "Save".
//   LCSCharacter.open({look, owned, balance, got, save, close})   // the screen must be visible
//   LCSCharacter.cancel()                                  // Esc
"use strict";

(function (root) {
  const $ = (id) => document.getElementById(id);
  const t = SidequestI18n.t, tf = SidequestI18n.field;
  const HERO = root.LCSHero;
  const SCALE = 6;      // preview pixels per hero pixel
  const PRESET_SCALE = 2;

  const TABS = [
    {id: "looks", name: ["Внешность", "Looks"],
     slots: ["skin", "hair", "hair_color", "eyes", "mouth", "face"]},
    {id: "clothes", name: ["Одежда", "Clothes"],
     slots: ["top", "top_color", "bottom", "bottom_color", "shoes", "shoes_color", "hat"]},
    {id: "presets", name: ["Готовые", "Presets"]},
  ];
  const RARITY = {rare: ["Редкое", "Rare"], epic: ["Эпическое", "Epic"],
                  legendary: ["Легендарное", "Legendary"]};
  // The preview's loop, in seconds: walking, standing and shooting, the gun lowered.
  const WALK = 2, SHOOT = 4, LOOP = 5, SHOT_EVERY = 0.4, RECOIL = 0.06;

  let opts = null;       // what open() got, while the screen is open
  let draft = null;      // the look being edited
  let tab = "looks";
  let raf = 0;
  let shown = "";        // the preview frame on the canvas: draw only when it changes
  let saving = false;

  function el(tag, text, cls) {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = String(text);
    if (cls) node.className = cls;
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  // One frame of the hero onto a canvas of its own size, scaled up by CSS.
  function paint(canvas, look, anim, n, gun, scale) {
    const f = HERO.frame(look, anim, n, gun);
    const img = LCSSprites.decodeRows(f.rows, f.palette);
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext("2d").putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
    canvas.style.width = img.width * scale + "px";
    canvas.style.height = img.height * scale + "px";
  }

  function animate(now) {
    raf = requestAnimationFrame(animate);
    const s = (now / 1000) % LOOP;
    const walk = s < WALK, anim = walk ? "walk" : "idle";
    const n = Math.floor(s * HERO.ANIMS[anim].fps);
    const gun = walk ? {} : {recoil: s < SHOOT && (s - WALK) % SHOT_EVERY < RECOIL, rest: s >= SHOOT};
    const key = `${JSON.stringify(draft)}|${anim}|${n % HERO.ANIMS[anim].frames}|${!!gun.recoil}|${!!gun.rest}`;
    if (key === shown) return;
    shown = key;
    paint($("char-preview"), draft, anim, n, gun, SCALE);
  }

  const unlocks = () => (opts.balance.character || {}).unlocks;
  const isOpen = (key, id) => HERO.isOpen(unlocks(), opts.got, key, id, opts.owned);

  // "Opens with the achievement «…»" for a locked choice.
  function lockText(key, id) {
    const a = opts.balance.achievements.find((x) => x.id === HERO.lockedBy(unlocks(), key, id));
    const name = a ? tf(a, "name") : "?";
    return t(`Откроется за ачивку «${name}»`, `Opens with the achievement "${name}"`);
  }

  // The line under the preview: what the focused choice is, or what opens it. The keys'
  // hint has its own line under the buttons.
  function status(text) { $("char-status").textContent = text; }

  // A choice button: a part by name or a color swatch; a locked one only tells what opens it.
  function choiceButton(key, id) {
    const color = HERO.isColor(key);
    const name = t(...HERO.choiceName(key, id));
    const b = el("button", color ? "" : name, color ? "char-swatch" : "");
    if (color) {
      b.style.backgroundColor = HERO.swatch(key, id);   // a constant from avatar.js / hero.js
      b.title = name;
    }
    const open = isOpen(key, id), rare = HERO.rarity(unlocks(), key, id);
    if (!open) b.classList.add("locked");
    if (rare !== "common") b.classList.add("rarity-" + rare);
    if (draft[key] === id) b.classList.add("on");
    // "Epic · crown" for an open rare choice, what opens it for a locked one.
    const tell = () => {
      const kind = RARITY[rare] ? t(...RARITY[rare]) + " · " : "";
      status(kind + (open ? name : lockText(key, id)));
    };
    b.addEventListener("focus", tell);
    b.addEventListener("mouseenter", tell);
    b.addEventListener("click", () => {
      if (!open) { tell(); return; }
      draft = Object.assign({}, draft, {[key]: id});
      render();
    });
    return b;
  }

  function renderSlots(rows, slots) {
    for (const key of slots) {
      const row = el("div", null, "char-row");
      row.appendChild(el("span", t(...HERO.slotName(key)), "label"));
      const list = el("div", null, "choices");
      for (const id of HERO.choiceIds(key)) list.appendChild(choiceButton(key, id));
      row.appendChild(list);
      rows.appendChild(row);
    }
  }

  function renderPresets(rows) {
    const grid = el("div", null, "char-presets");
    for (const p of HERO.PRESETS) {
      const look = HERO.clean(p.look);
      const b = el("button");
      const pic = el("canvas");
      paint(pic, look, "idle", 0, {rest: true}, PRESET_SCALE);
      b.appendChild(pic);
      b.appendChild(el("span", tf(p, "name")));
      if (HERO.SLOTS.every((s) => draft[s.key] === look[s.key])) b.classList.add("on");
      b.addEventListener("click", () => { draft = look; render(); });
      grid.appendChild(b);
    }
    rows.appendChild(grid);
  }

  // Redraws the tabs and the rows; the focus stays on the button at the same place. Enter
  // gets this from keynav.js too, a mouse click only from here.
  function render() {
    const focused = document.activeElement, all = [...$("character").querySelectorAll("button")];
    const at = all.indexOf(focused);
    const tabs = $("char-tabs");
    clear(tabs);
    for (const x of TABS) {
      const b = el("button", t(...x.name), x.id === tab ? "on" : "");
      b.addEventListener("click", () => { tab = x.id; render(); });
      tabs.appendChild(b);
    }
    const rows = $("char-rows");
    clear(rows);
    const current = TABS.find((x) => x.id === tab);
    if (current.slots) renderSlots(rows, current.slots);
    else renderPresets(rows);
    if (at >= 0 && !document.contains(focused)) {
      const again = [...$("character").querySelectorAll("button")];
      const to = again[Math.min(at, again.length - 1)];
      if (to) to.focus({preventScroll: true});
    }
  }

  function close() {
    if (!opts) return;
    cancelAnimationFrame(raf);
    raf = 0;
    const done = opts.close;
    opts = null;
    done();
  }

  function open(options) {
    opts = options;
    saving = false;
    shown = "";
    draft = HERO.clean(options.look);
    tab = "looks";
    status("");
    render();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(animate);
    $("char-rows").scrollTop = 0;
    $("btn-char-save").focus({preventScroll: true});
  }

  // Esc and "Cancel"; also while a save is on its way: the look is written anyway.
  function cancel() { close(); }

  $("btn-char-random").addEventListener("click", () => {
    draft = HERO.random(unlocks(), opts.got, Math.random, opts.owned);
    render();
  });
  // A held Enter or a double click must not save twice or close a screen opened again since.
  $("btn-char-save").addEventListener("click", async () => {
    const o = opts;
    if (!o || saving) return;
    saving = true;
    try {
      await o.save(draft);
    } catch (e) {
      status(t("Не сохранилось: ", "Not saved: ") + (e.message || e));
      return;
    } finally {
      saving = false;
    }
    if (opts === o) close();
  });
  $("btn-char-back").addEventListener("click", cancel);

  root.LCSCharacter = {open, cancel};
})(typeof window !== "undefined" ? window : globalThis);
