/**
 * renderer.js — PADMAVYUH: VOICES OF DHARMA
 * 2.5D Isometric Renderer — Clash of Clans-inspired mythological aesthetic.
 *
 * Visual language:
 *  • Cabinet projection: y-axis compressed to 0.52 to simulate a ~30° tilt
 *  • Ring walls rendered as 3-D cylinders (shadow, side-face, top-edge)
 *  • Warm amber divine light at center cooling to blue-gray at the outer edge
 *  • Detailed 2.5D character silhouettes (Krishna, Abhimanyu, Arjuna, Subhadra)
 *  • Hexagonal stone floor with glowing rune cracks
 *  • Layered particle system (embers, dust, divine motes)
 */

import CONFIG from "./config.js";

// ─── Projection constants ─────────────────────────────────────────────────────
const IY = 0.52; // y-axis compression (isometric tilt)
const WALL_H = 22; // wall height in screen pixels
const TWO_PI = Math.PI * 2;
const PLAYER_R = CONFIG.WORLD.PLAYER.RADIUS;

// ─── Ring palette (outer → inner: cool blue → warm gold) ─────────────────────
const RING_PALETTE = [
  { top: "#ffd700", side: "#b8860b", glow: "rgba(255,215,0,0.45)" }, // 0 innermost
  { top: "#e87040", side: "#7a3010", glow: "rgba(220,100,40,0.35)" }, // 1
  { top: "#cc4488", side: "#661040", glow: "rgba(200,60,120,0.32)" }, // 2
  { top: "#4488dd", side: "#1a3066", glow: "rgba(80,140,220,0.30)" }, // 3
  { top: "#88aacc", side: "#2a3a50", glow: "rgba(120,160,200,0.25)" }, // 4 outermost
];

// ─── Ground tone per zone (inside ring[n] → outside all) ─────────────────────
const GROUND_COLORS = [
  "#1a0d03", // zone 0 — centre, warm amber earth
  "#150c08", // zone 1
  "#100a0c", // zone 2
  "#080a14", // zone 3
  "#05080f", // zone 4
  "#020408", // zone 5 — outer, cold dark
];

export default class Renderer {
  constructor(canvas, ctx) {
    this.canvas = canvas;
    this.ctx = ctx;

    // Particle pools
    this._embers = []; // orange fire embers near wall torches
    this._dust = []; // golden motes drifting upward
    this._runes = []; // floating rune glyphs at center

    this._flashes = [];
    this._crossAlpha = 0;
    this._crossColor = "#e8d5a3";
    this._frame = 0;

    this._vigCanvas = null;
    this._vigW = 0;
    this._vigH = 0;

    this._initParticles();
  }

  // ─── ISO PROJECTION ────────────────────────────────────────────────────────
  /** Project a world-space point to screen space (cabinet isometric). */
  _iso(wx, wy, cx, cy, wz = 0) {
    return {
      sx: wx,
      sy: cy + (wy - cy) * IY - wz,
    };
  }

  // ─── TOP-LEVEL DISPATCH ────────────────────────────────────────────────────
  renderFrame(state) {
    const { ctx } = this;
    const W = this.canvas.width,
      H = this.canvas.height;
    this._frame = (this._frame + 1) % 1_000_000;

    // ── Background ──────────────────────────────────────────────────────────
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#010208");
    bg.addColorStop(1, "#020510");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // ── Stars ───────────────────────────────────────────────────────────────
    this._drawStars(W, H, state.timestamp);

    // ── Particles ──────────────────────────────────────────────────────────
    this._tickParticles(W, H, state.cx, state.cy, state.timestamp);
    this._drawDust();

    // ── Scene dispatch ──────────────────────────────────────────────────────
    switch (state.state) {
      case "LOADING":
        this._sceneLoading(state);
        break;
      case "INTRO":
        this._sceneIntro(state);
        break;
      case "PLAYING":
        this._scenePlaying(state);
        break;
      case "CONVERSATION":
        this._sceneConversation(state);
        break;
      case "OUTRO":
        this._sceneOutro(state);
        break;
      default:
        this._sceneLoading(state);
    }

    this._drawEmbers();
    this._drawVignette(W, H);
  }

  // ─── SCENE: LOADING ────────────────────────────────────────────────────────
  _sceneLoading({ cx, cy, timestamp }) {
    const { ctx } = this;
    const p = 0.6 + 0.4 * Math.sin(timestamp * 0.0012);
    // Lotus pulse
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TWO_PI;
      const r = 60 * p;
      const grd = ctx.createRadialGradient(
        cx + Math.cos(a) * r * 0.5,
        cy + Math.sin(a) * r * 0.25,
        0,
        cx + Math.cos(a) * r * 0.5,
        cy + Math.sin(a) * r * 0.25,
        r * 0.55,
      );
      grd.addColorStop(0, `rgba(184,134,11,${0.22 * p})`);
      grd.addColorStop(1, "rgba(0,0,0,0)");
      ctx.beginPath();
      ctx.ellipse(
        cx + Math.cos(a) * r * 0.5,
        cy + Math.sin(a) * r * IY * 0.5,
        r * 0.5,
        r * 0.28,
        a,
        0,
        TWO_PI,
      );
      ctx.fillStyle = grd;
      ctx.fill();
    }
    // Central glow
    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 80 * p);
    cg.addColorStop(0, `rgba(255,180,40,${0.4 * p})`);
    cg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    ctx.arc(cx, cy, 80 * p, 0, TWO_PI);
    ctx.fillStyle = cg;
    ctx.fill();
  }

  // ─── SCENE: INTRO ──────────────────────────────────────────────────────────
  _sceneIntro({ cx, cy, timestamp }) {
    const { ctx } = this;
    // Draw faint rotating maze in background
    const fakeRings = CONFIG.WORLD.RINGS.map((cfg, i) => {
      const maxR = CONFIG.WORLD.RINGS[CONFIG.WORLD.RINGS.length - 1].radius;
      const avail = Math.min(cx, cy) * 0.78;
      const s = Math.min(1, avail / maxR);
      return {
        index: i,
        radius: cfg.radius * s,
        currentGapAngle:
          cfg.initialGapAngle + timestamp * cfg.rotationSpeed * 0.001,
        effectiveGapWidth: cfg.gapWidth,
        wallThickness: cfg.wallThickness,
        color: cfg.color,
        glowColor: cfg.glowColor,
      };
    });
    ctx.globalAlpha = 0.22;
    this._drawGroundFloor(cx, cy, fakeRings, timestamp);
    fakeRings.forEach((r) => this._drawIsoRingWall(r, cx, cy, timestamp));
    ctx.globalAlpha = 1;

    // Characters
    this._drawKrishna(cx * 0.28, cy, 1.0, timestamp);
    this._drawAbhimanyu(
      cx,
      cy,
      0.45 + 0.1 * Math.sin(timestamp * 0.0015),
      timestamp,
    );

    // Skip hint
    ctx.save();
    ctx.globalAlpha = 0.5 + 0.3 * Math.sin(timestamp * 0.003);
    ctx.fillStyle = "rgba(184,134,11,0.7)";
    ctx.font = "13px Georgia";
    ctx.textAlign = "center";
    ctx.fillText("Press any arrow key or WASD to begin", cx, cy * 2 - 30);
    ctx.restore();
  }

  // ─── SCENE: PLAYING ────────────────────────────────────────────────────────
  _scenePlaying(state) {
    const { cx, cy, rings, items, player, currentZone, timestamp } = state;
    if (!rings || !player) return;

    // Ground
    this._drawGroundFloor(cx, cy, rings, timestamp);

    // Rune cracks at center
    this._drawCentreRunes(cx, cy, currentZone, timestamp);

    // Rings (back to front: draw larger rings first for proper depth)
    [...rings]
      .reverse()
      .forEach((r) => this._drawIsoRingWall(r, cx, cy, timestamp));

    // Gap threshold arches
    rings.forEach((r) => this._drawGapArch(r, cx, cy, timestamp));

    // Items
    items.forEach((item) => {
      if (!item.collected) this._drawItem(item, player, cx, cy, timestamp);
    });

    // Player shadow
    this._drawEntityShadow(player.x, cy + (player.y - cy) * IY, 14);

    // Abhimanyu at center (grows clearer as player approaches)
    const abAlpha = Math.max(0.12, (5 - currentZone) / 5) * 0.7;
    this._drawAbhimanyu(cx, cy, abAlpha, timestamp);

    // Player (drawn over Abhimanyu if at center)
    this._drawPlayerFigure(player, cx, cy, timestamp);

    // Krishna aura in inner zones
    if (currentZone <= 2) {
      const ka = ((3 - currentZone) / 3) * 0.35;
      this._drawKrishnaAura(cx * 0.22, cy * 0.32, ka, timestamp);
    }

    // Flashes & cross overlay
    this._drawFlashEffects(cx, cy);
    this._drawCrossOverlay(this.canvas.width, this.canvas.height);
  }

  // ─── SCENE: CONVERSATION ───────────────────────────────────────────────────
  _sceneConversation({ cx, cy, timestamp }) {
    const { ctx } = this;
    // Full ground with all rings faint
    const p = 0.7 + 0.3 * Math.sin(timestamp * 0.0008);

    // Warm floor glow
    const fg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 200);
    fg.addColorStop(0, `rgba(255,160,40,${0.35 * p})`);
    fg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    ctx.arc(cx, cy, 200, 0, TWO_PI);
    ctx.fillStyle = fg;
    ctx.fill();

    this._drawCentreRunes(cx, cy, 0, timestamp);
    this._drawAbhimanyu(cx, cy, 1.0, timestamp);

    // Abhimanyu standing light pillar
    const lg = ctx.createLinearGradient(cx, cy - 180, cx, cy + 100);
    lg.addColorStop(0, "rgba(255,200,80,0)");
    lg.addColorStop(0.4, `rgba(255,200,80,${0.22 * p})`);
    lg.addColorStop(1, "rgba(255,160,40,0)");
    ctx.fillStyle = lg;
    ctx.fillRect(cx - 50, cy - 180, 100, 280);

    // Krishna
    this._drawKrishna(cx * 0.22, cy * 0.38, 0.75, timestamp);
  }

  // ─── SCENE: OUTRO ──────────────────────────────────────────────────────────
  _sceneOutro({ cx, cy, timestamp }) {
    const p = 0.7 + 0.3 * Math.sin(timestamp * 0.0009);
    const { ctx } = this;
    const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, 350 * p);
    grd.addColorStop(0, `rgba(255,220,100,${0.3 * p})`);
    grd.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    ctx.arc(cx, cy, 350 * p, 0, TWO_PI);
    ctx.fillStyle = grd;
    ctx.fill();

    this._drawArjuna(cx - 80, cy + 20, 1.0, timestamp);
    this._drawAbhimanyu(cx + 10, cy + 20, 1.0, timestamp);
    this._drawSubhadra(cx + 110, cy + 20, 1.0, timestamp);
  }

  // ─── GROUND FLOOR ──────────────────────────────────────────────────────────
  _drawGroundFloor(cx, cy, rings, ts) {
    const { ctx } = this;
    // Draw filled ellipses from outermost inward (each zone a slightly different tone)
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i].radius;
      const col = GROUND_COLORS[i] || GROUND_COLORS[0];
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grd.addColorStop(0, _lighten(col, 0.12));
      grd.addColorStop(1, col);
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * IY, 0, 0, TWO_PI);
      ctx.fillStyle = grd;
      ctx.fill();
    }
    // Stone tile lines (subtle hex pattern)
    ctx.strokeStyle = "rgba(255,200,80,0.04)";
    ctx.lineWidth = 0.5;
    const outerR = rings.length > 0 ? rings[rings.length - 1].radius : 400;
    for (let r2 = 40; r2 < outerR; r2 += 40) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, r2, r2 * IY, 0, 0, TWO_PI);
      ctx.stroke();
    }
    // Radial lines
    for (let a = 0; a < TWO_PI; a += Math.PI / 6) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * outerR, cy + Math.sin(a) * outerR * IY);
      ctx.stroke();
    }
  }

  // ─── CENTRE RUNES ─────────────────────────────────────────────────────────
  _drawCentreRunes(cx, cy, zone, ts) {
    const { ctx } = this;
    const intensity = Math.max(0.15, (5 - zone) / 5);
    const p = 0.7 + 0.3 * Math.sin(ts * 0.0015);
    const rot = ts * 0.0003;

    // Outer rune circle
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.strokeStyle = `rgba(255,180,40,${0.25 * intensity * p})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, 55, 55 * IY, 0, 0, TWO_PI);
    ctx.stroke();

    // 8-pointed star
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TWO_PI;
      ctx.strokeStyle = `rgba(255,200,80,${0.18 * intensity * p})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * 50, Math.sin(a) * 50 * IY);
      ctx.stroke();
    }

    // Inner small circle
    ctx.strokeStyle = `rgba(255,220,100,${0.4 * intensity * p})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(0, 0, 18, 18 * IY, 0, 0, TWO_PI);
    ctx.stroke();

    // Core dot
    const cg = ctx.createRadialGradient(0, 0, 0, 0, 0, 12 * p);
    cg.addColorStop(0, `rgba(255,220,120,${0.95 * intensity})`);
    cg.addColorStop(1, "rgba(255,140,40,0)");
    ctx.beginPath();
    ctx.arc(0, 0, 12 * p, 0, TWO_PI);
    ctx.fillStyle = cg;
    ctx.fill();

    ctx.restore();
  }

  // ─── ISO RING WALL ─────────────────────────────────────────────────────────
  _drawIsoRingWall(ring, cx, cy, ts) {
    const { ctx } = this;
    const {
      radius: r,
      currentGapAngle: gapC,
      effectiveGapWidth: gapW,
      index,
    } = ring;
    const palette =
      RING_PALETTE[index] || RING_PALETTE[RING_PALETTE.length - 1];
    const breathe = 1 + 0.025 * Math.sin(ts * 0.0009 + index * 0.8);
    const rb = r * breathe;
    const gapHalf = gapW / 2;
    const STEPS = 240;

    // ── Front face of wall (3D depth) ──────────────────────────────────────
    // We draw the wall face by filling a shape between the top and bottom iso arcs.
    // Only the "front-facing" portion (lower half, facing the viewer) is drawn.
    const facePoints = [];
    for (let i = 0; i <= STEPS; i++) {
      const angle = (i / STEPS) * TWO_PI;
      if (Math.abs(_wrapAngle(angle - gapC)) < gapHalf) continue;
      // Only draw front face where sin(angle) > -0.3 (facing viewer)
      if (Math.sin(angle) > -0.25) {
        facePoints.push({
          angle,
          x: cx + rb * Math.cos(angle),
          top: cy + rb * Math.sin(angle) * IY,
        });
      }
    }

    if (facePoints.length > 1) {
      // Build the side face polygon: top arc + reversed bottom arc
      ctx.beginPath();
      facePoints.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.top);
        else ctx.lineTo(p.x, p.top);
      });
      // Bottom edge (shifted down by WALL_H * IY)
      [...facePoints].reverse().forEach((p) => {
        ctx.lineTo(p.x, p.top + WALL_H * IY);
      });
      ctx.closePath();

      // Gradient: top bright → bottom dark
      const grad = ctx.createLinearGradient(
        cx,
        cy - rb,
        cx,
        cy + rb * IY + WALL_H * IY,
      );
      grad.addColorStop(0, palette.top);
      grad.addColorStop(0.35, palette.side);
      grad.addColorStop(1, "#050408");
      ctx.fillStyle = grad;
      ctx.globalAlpha = 0.75;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // ── Shadow beneath wall ────────────────────────────────────────────────
    ctx.beginPath();
    let shadowStarted = false;
    for (let i = 0; i <= STEPS; i++) {
      const angle = (i / STEPS) * TWO_PI;
      if (Math.abs(_wrapAngle(angle - gapC)) < gapHalf) {
        shadowStarted = false;
        continue;
      }
      const x = cx + rb * Math.cos(angle);
      const y = cy + rb * Math.sin(angle) * IY + WALL_H * IY + 4;
      if (!shadowStarted) {
        ctx.moveTo(x, y);
        shadowStarted = true;
      } else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.lineWidth = 6;
    ctx.stroke();

    // ── Top edge (bright glow) ─────────────────────────────────────────────
    // First: outer glow
    ctx.beginPath();
    shadowStarted = false;
    for (let i = 0; i <= STEPS; i++) {
      const angle = (i / STEPS) * TWO_PI;
      if (Math.abs(_wrapAngle(angle - gapC)) < gapHalf) {
        shadowStarted = false;
        continue;
      }
      const x = cx + rb * Math.cos(angle);
      const y = cy + rb * Math.sin(angle) * IY;
      if (!shadowStarted) {
        ctx.moveTo(x, y);
        shadowStarted = true;
      } else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = palette.glow;
    ctx.lineWidth = 10;
    ctx.stroke();

    // Then: sharp bright top edge
    ctx.beginPath();
    shadowStarted = false;
    for (let i = 0; i <= STEPS; i++) {
      const angle = (i / STEPS) * TWO_PI;
      if (Math.abs(_wrapAngle(angle - gapC)) < gapHalf) {
        shadowStarted = false;
        continue;
      }
      const x = cx + rb * Math.cos(angle);
      const y = cy + rb * Math.sin(angle) * IY;
      if (!shadowStarted) {
        ctx.moveTo(x, y);
        shadowStarted = true;
      } else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = palette.top;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // ── Torches (small orange glow at every 60° that isn't a gap) ─────────
    for (let ti = 0; ti < 6; ti++) {
      const ta = (ti / 6) * TWO_PI + ts * 0.0001;
      if (Math.abs(_wrapAngle(ta - gapC)) < gapHalf + 0.3) continue;
      const tx2 = cx + rb * Math.cos(ta);
      const ty2 = cy + rb * Math.sin(ta) * IY;
      const flicker = 0.7 + 0.3 * Math.sin(ts * 0.008 + ti * 2.3);
      const tg = ctx.createRadialGradient(tx2, ty2, 0, tx2, ty2, 14 * flicker);
      tg.addColorStop(0, `rgba(255,180,40,${0.6 * flicker})`);
      tg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.beginPath();
      ctx.arc(tx2, ty2, 14 * flicker, 0, TWO_PI);
      ctx.fillStyle = tg;
      ctx.fill();
    }
  }

  // ─── GAP ARCH ──────────────────────────────────────────────────────────────
  _drawGapArch(ring, cx, cy, ts) {
    const { ctx } = this;
    const {
      radius: r,
      currentGapAngle: gapC,
      effectiveGapWidth: gapW,
      index,
    } = ring;
    if (gapW <= 0) return;

    const palette = RING_PALETTE[index] || RING_PALETTE[4];
    const pulse = 0.6 + 0.4 * Math.sin(ts * 0.003 + index * 1.3);

    // Portal glow at the gap opening
    const gx = cx + r * Math.cos(gapC);
    const gy = cy + r * Math.sin(gapC) * IY;

    const archGrad = ctx.createRadialGradient(
      gx,
      gy,
      0,
      gx,
      gy,
      r * gapW * 0.9,
    );
    archGrad.addColorStop(0, `rgba(255,245,180,${0.95 * pulse})`);
    archGrad.addColorStop(0.3, `rgba(255,215,80,${0.55 * pulse})`);
    archGrad.addColorStop(1, "rgba(0,0,0,0)");

    ctx.beginPath();
    ctx.arc(gx, gy, r * gapW * 0.9, 0, TWO_PI);
    ctx.fillStyle = archGrad;
    ctx.fill();

    // Arc over the opening — the "gate frame"
    const half = gapW / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, gapC - half - 0.08, gapC + half + 0.08); // iso approximation
    ctx.strokeStyle = `rgba(255,240,150,${0.8 * pulse})`;
    ctx.lineWidth = 4;
    ctx.stroke();

    // Wall top caps either side of gap
    for (const side of [-1, 1]) {
      const capA = gapC + side * (half + 0.05);
      const capX = cx + r * Math.cos(capA);
      const capY = cy + r * Math.sin(capA) * IY;
      const cg = ctx.createRadialGradient(capX, capY, 0, capX, capY, 10);
      cg.addColorStop(0, palette.top);
      cg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.beginPath();
      ctx.arc(capX, capY, 10, 0, TWO_PI);
      ctx.fillStyle = cg;
      ctx.fill();
    }
  }

  // ─── ITEM ──────────────────────────────────────────────────────────────────
  _drawItem(item, player, cx, cy, ts) {
    const { ctx } = this;
    const dx = item.worldX - player.x;
    const dy = item.worldY - player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const vis = Math.max(0, 1 - dist / 220);
    if (vis <= 0.01) return;

    const ix = item.worldX;
    const iy2 = cy + (item.worldY - cy) * IY; // iso y
    const pulse = 0.7 + 0.3 * Math.sin(ts * 0.002 + item.pulseOffset);
    const alpha = vis * pulse;

    // Ground halo
    const hg = ctx.createRadialGradient(ix, iy2, 0, ix, iy2, 36 * vis);
    hg.addColorStop(0, item.glowColor.replace(/[\d.]+\)$/, `${0.6 * alpha})`));
    hg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    ctx.ellipse(ix, iy2, 36 * vis, 18 * vis * IY, 0, 0, TWO_PI);
    ctx.fillStyle = hg;
    ctx.fill();

    // Item body (floating jewel)
    const floatY = iy2 - 8 - 4 * Math.sin(ts * 0.003 + item.pulseOffset);
    const shadow_g = ctx.createRadialGradient(ix, iy2, 0, ix, iy2, 12);
    shadow_g.addColorStop(0, "rgba(0,0,0,0.4)");
    shadow_g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    ctx.ellipse(ix, iy2, 10, 5, 0, 0, TWO_PI);
    ctx.fillStyle = shadow_g;
    ctx.fill();

    // Gem body
    ctx.save();
    ctx.translate(ix, floatY);
    const gm = ctx.createRadialGradient(0, -3, 0, 0, 0, 10 * pulse);
    gm.addColorStop(0, _withAlpha(item.color, alpha));
    gm.addColorStop(0.6, _withAlpha(item.color, alpha * 0.7));
    gm.addColorStop(1, "rgba(0,0,0,0)");
    // Diamond shape
    ctx.beginPath();
    ctx.moveTo(0, -10 * pulse);
    ctx.lineTo(8 * pulse, 0);
    ctx.lineTo(0, 8 * pulse);
    ctx.lineTo(-8 * pulse, 0);
    ctx.closePath();
    ctx.fillStyle = gm;
    ctx.fill();
    ctx.strokeStyle = _withAlpha("#ffffff", alpha * 0.7);
    ctx.lineWidth = 1;
    ctx.stroke();
    // Sparkle
    ctx.fillStyle = _withAlpha("#ffffff", alpha * 0.9);
    ctx.beginPath();
    ctx.arc(-3, -5, 2 * pulse, 0, TWO_PI);
    ctx.fill();
    ctx.restore();
  }

  // ─── PLAYER FIGURE ─────────────────────────────────────────────────────────
  _drawPlayerFigure(player, cx, cy, ts) {
    const { ctx } = this;
    const sx = player.x;
    const sy = cy + (player.y - cy) * IY;

    // Trail (iso-projected)
    (player.trail || []).forEach((p, i) => {
      const t = 1 - i / (player.trail.length || 1);
      const a = t * 0.45;
      if (a < 0.02) return;
      const tx2 = p.x,
        ty2 = cy + (p.y - cy) * IY;
      const g = ctx.createRadialGradient(tx2, ty2, 0, tx2, ty2, 9);
      g.addColorStop(0, `rgba(180,220,255,${a * 0.55})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.beginPath();
      ctx.arc(tx2, ty2, 9, 0, TWO_PI);
      ctx.fillStyle = g;
      ctx.fill();
    });

    const pulse = 0.85 + 0.15 * Math.sin(ts * 0.003);
    const ns = player.normalizedSpeed || 0;

    // Outer halo
    const hr = (PLAYER_R * 4 + ns * PLAYER_R * 3) * pulse;
    const hg = ctx.createRadialGradient(sx, sy, 0, sx, sy, hr);
    hg.addColorStop(0, `rgba(160,210,255,${0.55 * pulse})`);
    hg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    ctx.arc(sx, sy, hr, 0, TWO_PI);
    ctx.fillStyle = hg;
    ctx.fill();

    // Arjuna figure (2.5D isometric micro-character)
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(1, IY); // squish into iso perspective

    // Shadow
    ctx.beginPath();
    ctx.ellipse(0, 4, 10, 5 / IY, 0, 0, TWO_PI);
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fill();

    // Body silhouette
    ctx.fillStyle = "#e8e8f0";
    // Legs
    ctx.fillRect(-5, 8, 4, 14);
    ctx.fillRect(1, 8, 4, 14);
    // Torso
    ctx.beginPath();
    ctx.roundRect(-7, -8, 14, 18, 2);
    ctx.fill();
    // Armor highlights
    ctx.fillStyle = "rgba(140,170,220,0.7)";
    ctx.fillRect(-5, -6, 10, 3);
    // Head
    ctx.fillStyle = "#e8e8f0";
    ctx.beginPath();
    ctx.ellipse(0, -16, 7, 8, 0, 0, TWO_PI);
    ctx.fill();
    // Bow (left arm)
    ctx.strokeStyle = "#ffd700";
    ctx.lineWidth = 2 / IY;
    ctx.beginPath();
    ctx.arc(-14, -5, 12, -Math.PI * 0.5, Math.PI * 0.5);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,200,0.6)";
    ctx.lineWidth = 0.8 / IY;
    ctx.beginPath();
    ctx.moveTo(-14, -17);
    ctx.lineTo(-14, 7);
    ctx.stroke();
    // Glow on figure
    const fg2 = ctx.createRadialGradient(0, -8, 0, 0, -8, 22);
    fg2.addColorStop(0, `rgba(180,220,255,${0.35 * pulse})`);
    fg2.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = fg2;
    ctx.beginPath();
    ctx.arc(0, -8, 22, 0, TWO_PI);
    ctx.fill();

    ctx.restore();

    // Movement dust
    if (ns > 0.2) {
      this._spawnDust(sx + (Math.random() - 0.5) * 8, sy + 6, ns);
    }
  }

  // ─── ENTITY SHADOW ─────────────────────────────────────────────────────────
  _drawEntityShadow(sx, sy, r) {
    const { ctx } = this;
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
    g.addColorStop(0, "rgba(0,0,0,0.5)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    ctx.ellipse(sx, sy, r, r * 0.4, 0, 0, TWO_PI);
    ctx.fillStyle = g;
    ctx.fill();
  }

  // ─── CHARACTER: KRISHNA ────────────────────────────────────────────────────
  _drawKrishna(x, y, alpha, ts) {
    if (alpha < 0.01) return;
    const { ctx } = this;
    const sway = 0.018 * Math.sin(ts * 0.0009);
    const p = 0.88 + 0.12 * Math.sin(ts * 0.0007);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(sway);
    ctx.scale(1, IY); // isometric squish

    // Aura
    const aura = ctx.createRadialGradient(0, -90 / IY, 15, 0, -90 / IY, 140);
    aura.addColorStop(0, `rgba(50,100,220,${0.45 * p})`);
    aura.addColorStop(0.5, `rgba(20,50,140,${0.2 * p})`);
    aura.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    ctx.arc(0, -90 / IY, 140, 0, TWO_PI);
    ctx.fillStyle = aura;
    ctx.fill();

    ctx.fillStyle = "#0a1428";

    // Legs / dhoti
    ctx.beginPath();
    ctx.moveTo(-22, 10 / IY);
    ctx.bezierCurveTo(-30, 50 / IY, -28, 90 / IY, -18, 100 / IY);
    ctx.lineTo(18, 100 / IY);
    ctx.bezierCurveTo(28, 90 / IY, 30, 50 / IY, 22, 10 / IY);
    ctx.closePath();
    ctx.fill();
    // Dhoti gold trim
    ctx.strokeStyle = "#b8860b";
    ctx.lineWidth = 2 / IY;
    ctx.beginPath();
    ctx.moveTo(-22, 10 / IY);
    ctx.lineTo(22, 10 / IY);
    ctx.stroke();

    // Torso
    ctx.fillStyle = "#0a1428";
    ctx.beginPath();
    ctx.moveTo(-20, -28 / IY);
    ctx.lineTo(20, -28 / IY);
    ctx.lineTo(22, 10 / IY);
    ctx.lineTo(-22, 10 / IY);
    ctx.closePath();
    ctx.fill();
    // Necklace
    ctx.strokeStyle = "#ffd700";
    ctx.lineWidth = 1.5 / IY;
    ctx.beginPath();
    ctx.arc(0, -20 / IY, 14, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();

    // Head
    ctx.fillStyle = "#0d1e30";
    ctx.beginPath();
    ctx.ellipse(0, -55 / IY, 17, 20 / IY, 0, 0, TWO_PI);
    ctx.fill();
    // Face — blue skin highlight
    ctx.fillStyle = "rgba(40,80,180,0.5)";
    ctx.beginPath();
    ctx.ellipse(0, -56 / IY, 12, 14 / IY, 0, 0, TWO_PI);
    ctx.fill();
    // Eyes (divine, slightly glowing)
    ctx.fillStyle = "rgba(180,220,255,0.9)";
    ctx.beginPath();
    ctx.ellipse(-5, -57 / IY, 3, 3.5 / IY, 0, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(5, -57 / IY, 3, 3.5 / IY, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(-4, -57.5 / IY, 1, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(6, -57.5 / IY, 1, 0, TWO_PI);
    ctx.fill();

    // Crown — mukut
    ctx.fillStyle = "#b8860b";
    ctx.fillRect(-20, -73 / IY, 40, 6 / IY);
    [
      [-12, 22],
      [0, 32],
      [12, 22],
    ].forEach(([ox, h]) => {
      ctx.beginPath();
      ctx.moveTo(ox - 5, -73 / IY);
      ctx.lineTo(ox, -(73 + h) / IY);
      ctx.lineTo(ox + 5, -73 / IY);
      ctx.closePath();
      ctx.fill();
    });
    ctx.fillStyle = "rgba(255,200,80,0.8)";
    ctx.beginPath();
    ctx.arc(0, -96 / IY, 4, 0, TWO_PI);
    ctx.fill();

    // Peacock feather
    ctx.strokeStyle = "#2a7a2a";
    ctx.lineWidth = 2 / IY;
    ctx.beginPath();
    ctx.moveTo(8, -88 / IY);
    ctx.bezierCurveTo(30, -98 / IY, 60, -78 / IY, 55, -52 / IY);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(53, -54 / IY, 7, 10 / IY, 0.3, 0, TWO_PI);
    ctx.strokeStyle = "#4444ff";
    ctx.lineWidth = 1.5 / IY;
    ctx.stroke();
    ctx.fillStyle = "#2222cc";
    ctx.beginPath();
    ctx.ellipse(53, -54 / IY, 3.5, 5 / IY, 0.3, 0, TWO_PI);
    ctx.fill();

    // Flute
    ctx.strokeStyle = "#8B6914";
    ctx.lineWidth = 3 / IY;
    ctx.beginPath();
    ctx.moveTo(-22, -18 / IY);
    ctx.lineTo(28, -28 / IY);
    ctx.stroke();
    ctx.strokeStyle = "#0a1428";
    ctx.lineWidth = 1.5 / IY;
    [-8, -2, 4, 10, 16].forEach((ox) => {
      ctx.beginPath();
      ctx.moveTo(ox, -22 / IY);
      ctx.lineTo(ox, -17 / IY);
      ctx.stroke();
    });

    // Arms
    ctx.fillStyle = "#0a1428";
    // Left arm
    ctx.beginPath();
    ctx.moveTo(-20, -25 / IY);
    ctx.lineTo(-20, -18 / IY);
    ctx.lineTo(-8, -14 / IY);
    ctx.lineTo(-8, -22 / IY);
    ctx.closePath();
    ctx.fill();
    // Right arm
    ctx.beginPath();
    ctx.moveTo(20, -25 / IY);
    ctx.lineTo(20, -18 / IY);
    ctx.lineTo(28, -22 / IY);
    ctx.lineTo(28, -28 / IY);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  _drawKrishnaAura(x, y, alpha, ts) {
    if (alpha < 0.01) return;
    const { ctx } = this;
    const p = 0.75 + 0.25 * Math.sin(ts * 0.001);
    ctx.save();
    ctx.globalAlpha = alpha * p;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 90);
    g.addColorStop(0, "rgba(60,100,220,0.65)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    ctx.arc(x, y, 90, 0, TWO_PI);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
  }

  // ─── CHARACTER: ABHIMANYU ──────────────────────────────────────────────────
  _drawAbhimanyu(x, y, alpha, ts) {
    if (alpha < 0.01) return;
    const { ctx } = this;
    const sway = 0.025 * Math.sin(ts * 0.0007);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(sway);
    ctx.scale(1, IY);

    // Aura
    const aura = ctx.createRadialGradient(0, -80 / IY, 8, 0, -80 / IY, 120);
    aura.addColorStop(0, `rgba(255,140,30,${0.5})`);
    aura.addColorStop(0.5, `rgba(200,90,15,${0.25})`);
    aura.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    ctx.arc(0, -80 / IY, 120, 0, TWO_PI);
    ctx.fillStyle = aura;
    ctx.fill();

    ctx.fillStyle = "#180a04";

    // Legs (battle stance)
    ctx.beginPath();
    ctx.moveTo(-12, 55 / IY);
    ctx.lineTo(-22, 105 / IY);
    ctx.lineTo(-14, 105 / IY);
    ctx.lineTo(-4, 58 / IY);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(12, 55 / IY);
    ctx.lineTo(20, 105 / IY);
    ctx.lineTo(12, 105 / IY);
    ctx.lineTo(2, 58 / IY);
    ctx.closePath();
    ctx.fill();

    // Torso (armoured)
    ctx.beginPath();
    ctx.moveTo(-18, -12 / IY);
    ctx.lineTo(18, -12 / IY);
    ctx.lineTo(20, 55 / IY);
    ctx.lineTo(-20, 55 / IY);
    ctx.closePath();
    ctx.fill();
    // Armour chevrons
    ctx.strokeStyle = "rgba(220,150,50,0.65)";
    ctx.lineWidth = 2 / IY;
    ctx.strokeRect(-16, -9 / IY, 32, 22 / IY);
    ctx.beginPath();
    ctx.moveTo(0, -9 / IY);
    ctx.lineTo(0, 13 / IY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-16, 5 / IY);
    ctx.lineTo(16, 5 / IY);
    ctx.stroke();

    // Head
    ctx.fillStyle = "#180a04";
    ctx.beginPath();
    ctx.ellipse(0, -36 / IY, 13, 16 / IY, 0, 0, TWO_PI);
    ctx.fill();
    // Helmet
    ctx.fillStyle = "#3a2808";
    ctx.beginPath();
    ctx.moveTo(-13, -40 / IY);
    ctx.lineTo(-15, -60 / IY);
    ctx.lineTo(0, -66 / IY);
    ctx.lineTo(15, -60 / IY);
    ctx.lineTo(13, -40 / IY);
    ctx.closePath();
    ctx.fill();
    // Crest
    ctx.strokeStyle = "#cc8800";
    ctx.lineWidth = 2.5 / IY;
    ctx.beginPath();
    ctx.moveTo(-10, -60 / IY);
    ctx.quadraticCurveTo(0, -78 / IY, 10, -60 / IY);
    ctx.stroke();
    // Plume
    ctx.strokeStyle = "#cc3322";
    ctx.lineWidth = 2 / IY;
    ctx.beginPath();
    ctx.moveTo(0, -78 / IY);
    ctx.lineTo(2, -68 / IY);
    ctx.stroke();

    // Bow (left hand)
    ctx.strokeStyle = "#8B5E14";
    ctx.lineWidth = 3 / IY;
    ctx.beginPath();
    ctx.arc(-34, -8 / IY, 26, -Math.PI * 0.65, Math.PI * 0.28);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,220,100,0.65)";
    ctx.lineWidth = 1 / IY;
    const bx1 = -34 + 26 * Math.cos(-Math.PI * 0.65),
      by1 = -8 / IY + 26 * Math.sin(-Math.PI * 0.65);
    const bx2 = -34 + 26 * Math.cos(Math.PI * 0.28),
      by2 = -8 / IY + 26 * Math.sin(Math.PI * 0.28);
    ctx.beginPath();
    ctx.moveTo(bx1, by1);
    ctx.lineTo(bx2, by2);
    ctx.stroke();

    // Sword (right hand, raised)
    ctx.strokeStyle = "rgba(200,220,255,0.85)";
    ctx.lineWidth = 2.5 / IY;
    ctx.beginPath();
    ctx.moveTo(18, -10 / IY);
    ctx.lineTo(38, -48 / IY);
    ctx.stroke();
    ctx.strokeStyle = "#ffd700";
    ctx.lineWidth = 4 / IY;
    ctx.beginPath();
    ctx.moveTo(28, -28 / IY);
    ctx.lineTo(26, -26 / IY);
    ctx.stroke();

    // Wounds (battle damage — tells the story)
    ctx.fillStyle = "rgba(180,20,20,0.7)";
    ctx.beginPath();
    ctx.ellipse(7, 8 / IY, 5, 3 / IY, 0.3, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-4, 22 / IY, 4, 2.5 / IY, -0.2, 0, TWO_PI);
    ctx.fill();

    // Face — eyes: scared but proud
    ctx.fillStyle = "rgba(255,200,100,0.9)";
    ctx.beginPath();
    ctx.ellipse(-4, -36 / IY, 3, 3.5 / IY, 0, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(4, -36 / IY, 3, 3.5 / IY, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(-4, -36 / IY, 1.5, 2 / IY, 0, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(4, -36 / IY, 1.5, 2 / IY, 0, 0, TWO_PI);
    ctx.fill();

    ctx.restore();
  }

  // ─── CHARACTER: ARJUNA ─────────────────────────────────────────────────────
  _drawArjuna(x, y, alpha, ts) {
    if (alpha < 0.01) return;
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.scale(1, IY);

    const aura = ctx.createRadialGradient(0, -80 / IY, 10, 0, -80 / IY, 110);
    aura.addColorStop(0, "rgba(200,220,255,0.4)");
    aura.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    ctx.arc(0, -80 / IY, 110, 0, TWO_PI);
    ctx.fillStyle = aura;
    ctx.fill();

    ctx.fillStyle = "#0e1520";
    ctx.beginPath();
    ctx.moveTo(-16, 55 / IY);
    ctx.lineTo(-22, 105 / IY);
    ctx.lineTo(-14, 105 / IY);
    ctx.lineTo(-6, 58 / IY);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(16, 55 / IY);
    ctx.lineTo(20, 105 / IY);
    ctx.lineTo(12, 105 / IY);
    ctx.lineTo(4, 58 / IY);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-20, -20 / IY);
    ctx.lineTo(20, -20 / IY);
    ctx.lineTo(22, 55 / IY);
    ctx.lineTo(-22, 55 / IY);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, -40 / IY, 15, 19 / IY, 0, 0, TWO_PI);
    ctx.fill();

    ctx.strokeStyle = "#ffd700";
    ctx.lineWidth = 3.5 / IY;
    ctx.beginPath();
    ctx.arc(-42, -10 / IY, 36, -Math.PI * 0.75, Math.PI * 0.4);
    ctx.stroke();
    const ax1 = -42 + 36 * Math.cos(-Math.PI * 0.75),
      ay1 = -10 / IY + 36 * Math.sin(-Math.PI * 0.75);
    const ax2 = -42 + 36 * Math.cos(Math.PI * 0.4),
      ay2 = -10 / IY + 36 * Math.sin(Math.PI * 0.4);
    ctx.strokeStyle = "rgba(255,255,200,0.5)";
    ctx.lineWidth = 1 / IY;
    ctx.beginPath();
    ctx.moveTo(ax1, ay1);
    ctx.lineTo(ax2, ay2);
    ctx.stroke();

    ctx.restore();
  }

  // ─── CHARACTER: SUBHADRA ───────────────────────────────────────────────────
  _drawSubhadra(x, y, alpha, ts) {
    if (alpha < 0.01) return;
    const { ctx } = this;
    const sway = 0.012 * Math.sin(ts * 0.0012);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(sway);
    ctx.scale(1, IY);

    const aura = ctx.createRadialGradient(0, -75 / IY, 10, 0, -75 / IY, 95);
    aura.addColorStop(0, "rgba(220,100,130,0.35)");
    aura.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    ctx.arc(0, -75 / IY, 95, 0, TWO_PI);
    ctx.fillStyle = aura;
    ctx.fill();

    ctx.fillStyle = "#18080f";
    ctx.beginPath();
    ctx.moveTo(-16, -18 / IY);
    ctx.lineTo(16, -18 / IY);
    ctx.bezierCurveTo(22, 10 / IY, 25, 50 / IY, 20, 100 / IY);
    ctx.lineTo(-20, 100 / IY);
    ctx.bezierCurveTo(-25, 50 / IY, -22, 10 / IY, -16, -18 / IY);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, -37 / IY, 13, 16 / IY, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = "rgba(200,60,80,0.9)";
    ctx.beginPath();
    ctx.arc(0, -43 / IY, 3, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = "rgba(200,150,180,0.5)";
    ctx.lineWidth = 1.5 / IY;
    ctx.beginPath();
    ctx.moveTo(16, -18 / IY);
    ctx.bezierCurveTo(30, 0, 28, 50 / IY, 20, 100 / IY);
    ctx.stroke();
    ctx.fillStyle = "#18080f";
    ctx.beginPath();
    ctx.ellipse(-5, 10 / IY, 8, 5 / IY, 0.3, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(5, 12 / IY, 8, 5 / IY, -0.3, 0, TWO_PI);
    ctx.fill();
    ctx.restore();
  }

  // ─── PARTICLES ─────────────────────────────────────────────────────────────
  _initParticles() {
    const W = this.canvas.width || 1920,
      H = this.canvas.height || 1080;
    for (let i = 0; i < 60; i++) this._dust.push(this._newDust(true, W, H));
  }

  _newDust(anywhere = false, W = 1920, H = 1080) {
    const life = 200 + Math.random() * 300;
    return {
      x: Math.random() * W,
      y: anywhere ? Math.random() * H : H + 5,
      vx: (Math.random() - 0.5) * 0.18,
      vy: -(0.08 + Math.random() * 0.28),
      size: 0.7 + Math.random() * 1.8,
      life,
      maxLife: life,
      hue: 38 + Math.random() * 18,
      sat: 50 + Math.random() * 30,
    };
  }

  _spawnDust(x, y, intensity) {
    for (let i = 0; i < 2; i++) {
      const life = 30 + Math.random() * 40;
      this._dust.push({
        x: x + (Math.random() - 0.5) * 6,
        y,
        vx: (Math.random() - 0.5) * 0.6,
        vy: -Math.random() * 0.4,
        size: 1 + Math.random() * 1.5,
        life,
        maxLife: life,
        hue: 35,
        sat: 60,
      });
    }
  }

  _tickParticles(W, H, cx, cy, ts) {
    for (let i = 0; i < this._dust.length; i++) {
      const p = this._dust[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life--;
      if (p.life <= 0 || p.y < -10 || p.x < -10 || p.x > W + 10)
        this._dust[i] = this._newDust(false, W, H);
    }
  }

  _drawDust() {
    const { ctx } = this;
    for (const p of this._dust) {
      const lr = p.life / p.maxLife;
      let a = lr > 0.85 ? (1 - lr) / 0.15 : lr < 0.15 ? lr / 0.15 : 1;
      a *= 0.2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, TWO_PI);
      ctx.fillStyle = `hsla(${p.hue},${p.sat}%,75%,${a})`;
      ctx.fill();
    }
  }

  _drawEmbers() {
    /* placeholder — could add torch embers here */
  }

  // ─── STARS ─────────────────────────────────────────────────────────────────
  _drawStars(W, H, ts) {
    const { ctx } = this;
    ctx.fillStyle = "rgba(255,255,255,0.0)"; // pre-seed; real stars below
    // Use frame as seed for stable star positions
    if (!this._stars) {
      this._stars = Array.from({ length: 120 }, () => ({
        x: Math.random() * W,
        y: Math.random() * H * 0.55,
        r: 0.4 + Math.random() * 0.9,
        phase: Math.random() * TWO_PI,
      }));
    }
    for (const s of this._stars) {
      const a = 0.15 + 0.1 * Math.sin(ts * 0.0008 + s.phase);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TWO_PI);
      ctx.fillStyle = `rgba(200,220,255,${a})`;
      ctx.fill();
    }
  }

  // ─── FLASH EFFECTS ─────────────────────────────────────────────────────────
  _drawFlashEffects(cx, cy) {
    const { ctx } = this;
    this._flashes = this._flashes.filter((f) => f.alpha > 0.01);
    for (const f of this._flashes) {
      const sy = cy + (f.y - cy) * IY;
      const g = ctx.createRadialGradient(f.x, sy, 0, f.x, sy, f.radius);
      g.addColorStop(0, _withAlpha(f.color, f.alpha));
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.beginPath();
      ctx.arc(f.x, sy, f.radius, 0, TWO_PI);
      ctx.fillStyle = g;
      ctx.fill();
      f.radius += 3;
      f.alpha -= 0.04;
    }
  }

  triggerFlash(x, y, color = "#ffffff") {
    this._flashes.push({ x, y, color, alpha: 0.9, radius: 8 });
  }
  triggerCrossEffect(color = "#e8d5a3") {
    this._crossAlpha = 0.35;
    this._crossColor = color;
  }

  _drawCrossOverlay(W, H) {
    if (this._crossAlpha <= 0.005) return;
    this.ctx.fillStyle = _withAlpha(this._crossColor, this._crossAlpha);
    this.ctx.fillRect(0, 0, W, H);
    this._crossAlpha = Math.max(0, this._crossAlpha - 0.016);
  }

  // ─── VIGNETTE ──────────────────────────────────────────────────────────────
  _drawVignette(W, H) {
    if (this._vigCanvas === null || this._vigW !== W || this._vigH !== H) {
      const oc = document.createElement("canvas");
      oc.width = W;
      oc.height = H;
      const oc2 = oc.getContext("2d");
      const cx = W / 2,
        cy = H / 2,
        r = Math.hypot(cx, cy);
      const g = oc2.createRadialGradient(cx, cy, r * 0.25, cx, cy, r);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,0.78)");
      oc2.fillStyle = g;
      oc2.fillRect(0, 0, W, H);
      this._vigCanvas = oc;
      this._vigW = W;
      this._vigH = H;
    }
    this.ctx.drawImage(this._vigCanvas, 0, 0);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function _withAlpha(color, alpha) {
  const a = Math.max(0, Math.min(1, alpha));
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    const r = parseInt(color.slice(1, 3), 16),
      g = parseInt(color.slice(3, 5), 16),
      b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    const r = parseInt(color[1] + color[1], 16),
      g = parseInt(color[2] + color[2], 16),
      b = parseInt(color[3] + color[3], 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) return `rgba(${m[1]},${m[2]},${m[3]},${a})`;
  return color;
}

function _lighten(hexColor, amount) {
  const r = parseInt(hexColor.slice(1, 3), 16),
    g = parseInt(hexColor.slice(3, 5), 16),
    b = parseInt(hexColor.slice(5, 7), 16);
  const nr = Math.min(255, Math.round(r + (255 - r) * amount));
  const ng = Math.min(255, Math.round(g + (255 - g) * amount));
  const nb = Math.min(255, Math.round(b + (255 - b) * amount));
  return `rgb(${nr},${ng},${nb})`;
}

function _wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
}
