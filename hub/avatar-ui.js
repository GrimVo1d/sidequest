// Avatar editor in the hub: presets, the builder and an uploaded picture or GIF.
// Uses the hub helpers from hub.js (el, button, clear, modal, closeModal, api).
"use strict";

const AV = window.SidequestAvatar;

function openAvatarEditor(current, onSaved) {
  let draft = current ? AV.resolve(current) : null;   // null = the default avatar
  let stopPreview = () => {};
  let tab = draft && draft.source === "upload" ? "upload" : draft && draft.source === "builder"
    ? "builder" : "presets";
  let parts = Object.assign({}, AV.DEFAULT_PARTS, draft && draft.parts);
  let loaded = null;

  const preview = el("canvas", null, "av-preview");
  const status = el("p", "", "hint");
  const tabs = el("div", null, "av-tabs");
  const content = el("div", null, "av-content");

  function show(next) {
    draft = next;
    stopPreview();
    stopPreview = AV.animate(preview, draft);
    if (draft && AV.isPicture(draft)) {
      status.textContent = `${draft.size}×${draft.size}, кадров: ${draft.frames.length}`;
    } else {
      status.textContent = draft && (draft.frames.length > 1 || draft.source === "upload")
        ? `кадров: ${draft.frames.length}, цветов: ${draft.palette.length}` : "";
    }
  }

  function finish() { stopPreview(); closeModal(); }

  // --- presets ---

  function renderPresets() {
    const grid = el("div", null, "av-presets");
    for (const p of AV.PRESETS) {
      const value = AV.preset(p.id);
      const canvas = el("canvas");
      AV.draw(canvas, value);
      const b = button("", () => { show(value); renderTab(); });
      b.appendChild(canvas);
      b.appendChild(el("span", p.name));
      if (draft && draft.source === "preset" && draft.preset === p.id) b.classList.add("on");
      grid.appendChild(b);
    }
    content.appendChild(grid);
  }

  // --- builder ---

  function renderBuilder() {
    for (const o of AV.OPTIONS) {
      const row = el("div", null, "av-row");
      row.appendChild(el("span", o.label, "label"));
      for (const c of o.choices) {
        const pick = () => { parts[o.key] = c.id; show(AV.compose(parts)); renderTab(); };
        let b;
        if (o.type === "color") {
          b = button("", pick, "av-swatch" + (c.color ? "" : " none"));
          if (c.color) b.style.backgroundColor = c.color;   // constant from sdk/avatar.js
          b.title = c.label;
        } else {
          b = button(c.label, pick);
        }
        if (parts[o.key] === c.id) b.classList.add("on");
        row.appendChild(b);
      }
      content.appendChild(row);
    }
    content.appendChild(button("Случайно", () => {
      for (const o of AV.OPTIONS) {
        parts[o.key] = o.choices[Math.floor(Math.random() * o.choices.length)].id;
      }
      show(AV.compose(parts));
      renderTab();
    }));
    if (!draft || draft.source !== "builder") show(AV.compose(parts));
  }

  // --- upload ---

  const options = {style: "picture", size: 32, colors: 16, mode: "crop"};

  function select(values, key) {
    const s = el("select");
    for (const [value, label] of values) {
      const o = el("option", label);
      o.value = value;
      o.selected = String(options[key]) === String(value);
      s.appendChild(o);
    }
    s.addEventListener("change", () => {
      options[key] = key === "mode" || key === "style" ? s.value : Number(s.value);
      if (key === "style") renderTab();
      reconvert();
    });
    return s;
  }

  function reconvert() {
    if (!loaded) return;
    try {
      show(AvatarImport.convert(loaded, options));
    } catch (e) {
      status.textContent = "Не получилось: " + (e.message || e);
    }
  }

  function renderUpload() {
    const input = el("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/gif,image/webp";
    input.hidden = true;
    const name = el("span", loaded ? loaded.name : "файл не выбран", "tag");
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      name.textContent = file.name;
      status.textContent = "Обработка…";
      try {
        loaded = Object.assign(await AvatarImport.load(file), {name: file.name});
        reconvert();
      } catch (e) {
        loaded = null;
        status.textContent = "Не получилось: " + (e.message || e);
      }
    });
    content.appendChild(el("p", "PNG, JPEG, WebP или GIF (с анимацией) до 8 МБ. Картинка " +
      "уменьшается прямо здесь; сохраняется только результат, сам файл — нет.", "hint"));
    const pickRow = el("div", null, "av-row");
    pickRow.appendChild(input);
    pickRow.appendChild(button("Выбрать файл…", () => input.click(), "primary"));
    pickRow.appendChild(name);
    content.appendChild(pickRow);
    const row = el("div", null, "av-row");
    row.appendChild(select([["picture", "как есть"], ["pixels", "в пиксели"]], "style"));
    row.appendChild(select([["crop", "обрезать по центру"], ["fit", "вписать целиком"]], "mode"));
    if (options.style === "pixels") {
      row.appendChild(select([[32, "32×32"], [16, "16×16"]], "size"));
      row.appendChild(select([[4, "4 цвета"], [8, "8 цветов"], [16, "16 цветов"], [32, "32 цвета"]],
                             "colors"));
    }
    content.appendChild(row);
  }

  // --- layout ---

  const TABS = [["presets", "Готовые", renderPresets], ["builder", "Конструктор", renderBuilder],
                ["upload", "Своя картинка", renderUpload]];

  function renderTab() {
    clear(tabs);
    clear(content);
    for (const [id, label, render] of TABS) {
      const b = button(label, () => { tab = id; renderTab(); });
      if (id === tab) { b.classList.add("on"); render(); }
      tabs.appendChild(b);
    }
  }

  const side = el("div", null, "av-side");
  side.appendChild(preview);
  side.appendChild(status);
  const main = el("div", null, "av-main");
  main.appendChild(tabs);
  main.appendChild(content);
  const editor = el("div", null, "av-editor");
  editor.appendChild(side);
  editor.appendChild(main);

  async function save(value) {
    try {
      await api.set_avatar(value);
      finish();
      onSaved();
    } catch (e) {
      status.textContent = "Не сохранилось: " + (e.message || e);
    }
  }

  modal("Аватарка", [editor], [
    ["По умолчанию", () => save(null)],
    ["Отмена", finish],
    ["Сохранить", () => save(draft), "primary"],
  ], {wide: true});
  show(draft);
  renderTab();
}
