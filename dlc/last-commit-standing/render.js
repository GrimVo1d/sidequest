// Last Commit Standing: drawing the arena. Stage 2 look: squares and circles only.
// The canvas is small (balance.view) and scaled up in whole device pixels, so pixels stay sharp.
"use strict";

(function (root) {
  const ENEMY_COLORS = {grunt: "#c8443c", runner: "#e89a4a", tank: "#8a5bd0", boss: "#e8c14a"};

  function createRenderer(canvas, balance) {
    const VW = balance.view.width, VH = balance.view.height;
    const W = balance.arena.width, H = balance.arena.height;
    canvas.width = VW;
    canvas.height = VH;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;

    // Whole steps in device pixels: on a Retina screen the scale goes 1, 1.5, 2, ...
    function fit() {
      const dpr = devicePixelRatio || 1;
      const scale = Math.max(1, Math.floor(Math.min(innerWidth / VW, innerHeight / VH) * dpr)) / dpr;
      canvas.style.width = VW * scale + "px";
      canvas.style.height = VH * scale + "px";
    }
    addEventListener("resize", fit);
    fit();

    const px = (v) => Math.round(v);

    function rect(x, y, w, h, color) {
      ctx.fillStyle = color;
      ctx.fillRect(px(x - w / 2), px(y - h / 2), w, h);
    }

    function ring(x, y, r, color, alpha, width) {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = width || 1;
      ctx.beginPath();
      ctx.arc(px(x), px(y), Math.max(1, r), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    function label(x, y, value, color, alpha) {
      ctx.globalAlpha = alpha === undefined ? 1 : alpha;
      ctx.font = "8px Menlo, monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "#0d0d1a";
      ctx.fillText(value, px(x) + 1, px(y) + 1);
      ctx.fillStyle = color;
      ctx.fillText(value, px(x), px(y));
      ctx.globalAlpha = 1;
    }

    function draw(s, avatar) {
      const p = s.player;
      const camX = Math.max(0, Math.min(W - VW, p.x - VW / 2));
      const camY = Math.max(0, Math.min(H - VH, p.y - VH / 2));
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#14142a";
      ctx.fillRect(0, 0, VW, VH);
      ctx.setTransform(1, 0, 0, 1, -Math.round(camX), -Math.round(camY));

      // Floor grid and arena edge.
      ctx.fillStyle = "#1c1c38";
      for (let x = Math.floor(camX / 32) * 32; x < camX + VW; x += 32) ctx.fillRect(x, camY, 1, VH);
      for (let y = Math.floor(camY / 32) * 32; y < camY + VH; y += 32) ctx.fillRect(camX, y, VW, 1);
      ctx.strokeStyle = "#3f3f7a";
      ctx.lineWidth = 2;
      ctx.strokeRect(0, 0, W, H);

      const visible = (o, m) => o.x > camX - m && o.x < camX + VW + m && o.y > camY - m && o.y < camY + VH + m;

      for (const fx of s.effects) {
        const k = fx.t / fx.life;
        if (fx.type === "ring") ring(fx.x, fx.y, fx.r * (0.4 + 0.6 * k), fx.color, 1 - k, 2);
        else if (fx.type === "pop") rect(fx.x, fx.y, fx.r * 2 * (1 + k), fx.r * 2 * (1 + k), fx.color + "");
        else if (fx.type === "ult") ring(fx.x, fx.y, fx.r * k, fx.color, 1 - k, 6);
        else if (fx.type === "beam") {
          ctx.globalAlpha = 1 - k;
          ctx.strokeStyle = fx.color;
          ctx.lineWidth = fx.r * (1 - k) + 1;
          ctx.beginPath();
          ctx.moveTo(px(fx.x), px(fx.y));
          ctx.lineTo(px(fx.x2), px(fx.y2));
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }

      for (const e of s.enemies) {
        if (!visible(e, 30)) continue;
        const size = e.r * 2;
        rect(e.x, e.y, size + 2, size + 2, s.rage > 0 ? "#ff3030" : "#0d0d1a");
        rect(e.x, e.y, size, size, e.flash > 0 ? "#ffffff" : ENEMY_COLORS[e.type]);
        if (e.slow > 0) rect(e.x, e.y, size, Math.max(2, size / 3), "#7fb3e0");
        if (e.type === "tank" || e.type === "boss") {
          rect(e.x, e.y - e.r - 4, size, 2, "#0d0d1a");
          ctx.fillStyle = "#d9534f";
          ctx.fillRect(px(e.x - e.r), px(e.y - e.r - 5), Math.max(0, Math.round(size * e.hp / e.maxHp)), 2);
        }
      }

      for (const sh of s.shots) {
        if (visible(sh, 10)) rect(sh.x, sh.y, sh.r * 2, sh.r * 2, sh.color);
      }

      for (const a of s.allies) {
        if (a.state === "gone") continue;
        const alpha = a.state === "leaving" ? Math.max(0, a.leave / 1.5) : 1;
        ctx.globalAlpha = alpha;
        const size = a.r * 2;
        rect(a.x, a.y, size + 2, size + 2, "#0d0d1a");
        rect(a.x, a.y, size, size, a.stun > 0 ? "#6a6a80" : a.color);
        rect(a.x - 2, a.y - 1, 2, 2, "#0d0d1a");
        rect(a.x + 2, a.y - 1, 2, 2, "#0d0d1a");
        ctx.globalAlpha = 1;
        if (a.stun > 0) label(a.x + 6, a.y - 6, "z", "#c8c8d4");
        if (a.blocked > 0) rect(a.x + 9, a.y, 3, size + 8, "#7fe0e0");
        if (a.meditate > 0) ring(a.x, a.y, a.r + 4 + Math.sin(s.time * 4) * 2, "#e8e6f0", 0.7);
        for (const sp of a.spirits.values()) {
          rect(sp.x, sp.y, 6, 6, "#0d0d1a");
          rect(sp.x, sp.y, 4, 4, "#f4f2fa");
        }
      }

      // The player: the profile avatar. Blinks while invulnerable, greyed out while dead.
      // A picture avatar (256 px) is shrunk smoothly; pixel ones stay sharp.
      ctx.imageSmoothingEnabled = avatar.width > 32;
      const blink = p.invulnerable > 0 && Math.floor(s.time * 10) % 2 === 0;
      if (p.dead > 0) {
        ctx.globalAlpha = 0.35;
        ctx.drawImage(avatar, px(p.x - 8), px(p.y - 8), 16, 16);
        ctx.globalAlpha = 1;
        label(p.x, p.y - 12, Math.ceil(p.dead) + "", "#e8e6f0");
      } else if (!blink) {
        rect(p.x, p.y, 18, 18, "#0d0d1a");
        ctx.drawImage(avatar, px(p.x - 8), px(p.y - 8), 16, 16);
      }
      ctx.imageSmoothingEnabled = false;
      if (s.immortal) ring(p.x, p.y, 12, "#e8c14a", 0.6);

      for (const t of s.texts) {
        label(t.x, t.y - t.t * 12, t.text, t.color, 1 - t.t / t.life);
      }

      // Arrows to allies that are off screen.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      for (const a of s.allies) {
        if (a.state !== "active" || visible(a, -4)) continue;
        const x = Math.max(4, Math.min(VW - 4, a.x - camX)), y = Math.max(4, Math.min(VH - 4, a.y - camY));
        rect(x, y, 5, 5, a.color);
      }
    }

    return {draw};
  }

  root.LCSRender = {createRenderer};
})(typeof window !== "undefined" ? window : globalThis);
