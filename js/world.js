/**
 * world.js — PADMAVYUH: VOICES OF DHARMA
 * ─────────────────────────────────────────────────────────────────────────────
 * World class.
 *
 * Owns two mutable collections derived from CONFIG:
 *   • this.rings  — live ring objects (gap angle rotates each frame)
 *   • this.items  — live item objects (world-space position, collected flag)
 *
 * Also exposes pure helper functions for ring-collision resolution and
 * angle arithmetic that Game._update() relies on.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import CONFIG from "./config.js";

// ─── Angle helpers (exported as named functions too, for Game use) ────────────

/**
 * Wrap an angle into the range (-π, π].
 * @param {number} a – angle in radians
 * @returns {number}
 */
export function normalizeAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}

/**
 * Signed shortest-path difference between two angles.
 * Result is in (-π, π].
 * @param {number} a
 * @param {number} b
 * @returns {number}  a − b, wrapped
 */
export function angleDiff(a, b) {
  return normalizeAngle(a - b);
}

/**
 * Absolute angular distance between two angles (always ≥ 0).
 * @param {number} a
 * @param {number} b
 * @returns {number}  value in [0, π]
 */
export function absAngleDiff(a, b) {
  return Math.abs(normalizeAngle(a - b));
}

// ─── World class ──────────────────────────────────────────────────────────────

export default class World {
  /**
   * @param {number} cx – world-centre X in canvas pixels
   * @param {number} cy – world-centre Y in canvas pixels
   */
  constructor(cx, cy) {
    this.cx = cx;
    this.cy = cy;

    // ── Dynamic scaling ───────────────────────────────────────────────────
    // The config radii were authored at a "reference" size (635 px outer ring).
    // Scale everything down so the outermost ring fits within 78 % of the
    // smaller canvas half-dimension, guaranteeing the maze is always fully
    // visible regardless of screen resolution.  We never scale UP (cap 1.0).
    const outerRadius =
      CONFIG.WORLD.RINGS[CONFIG.WORLD.RINGS.length - 1].radius;
    const available = Math.min(cx, cy) * 0.78;
    /** @type {number} Scale factor applied to all radii and distances. */
    this.scale = Math.min(1.0, available / outerRadius);

    // Scaled audio falloff distance (pixels) — used by game.js each frame.
    this.itemFalloffDistance = CONFIG.AUDIO.ITEM_FALLOFF_DISTANCE * this.scale;

    // Build live ring objects from config.
    // Rings are stored innermost-first (index 0 = smallest radius).
    this.rings = CONFIG.WORLD.RINGS.map((cfg) => ({
      // ── identity / geometry ────────────────────────────────────────────
      index: cfg.index,
      radius: cfg.radius * this.scale, // ← scaled
      wallThickness: cfg.wallThickness,
      name: cfg.name,
      special: cfg.special,

      // ── visual ────────────────────────────────────────────────────────
      color: cfg.color,
      glowColor: cfg.glowColor,

      // ── rotation state (mutated every frame by World.tick) ────────────
      currentGapAngle: cfg.initialGapAngle,
      rotationSpeed: cfg.rotationSpeed,

      // ── gap geometry ──────────────────────────────────────────────────
      // effectiveGapWidth may be temporarily set to 0 by the stillness
      // penalty; the canonical width lives in cfg.gapWidth.
      gapWidth: cfg.gapWidth,
      effectiveGapWidth: cfg.gapWidth,

      // ── dialogue ──────────────────────────────────────────────────────
      krishnaLines: cfg.krishnaLines,

      // ── per-ring runtime state ────────────────────────────────────────
      // tracks whether the player has passed through this ring inward
      crossed: false,
    }));

    // Build live item objects from config.
    this.items = CONFIG.WORLD.ITEMS.map((cfg) => {
      const scaledDist = cfg.distFromCenter * this.scale;
      const worldX = cx + Math.cos(cfg.angle) * scaledDist;
      const worldY = cy + Math.sin(cfg.angle) * scaledDist;
      return {
        // ── identity ────────────────────────────────────────────────────
        id: cfg.id,
        name: cfg.name,
        description: cfg.description,
        ringIndex: cfg.ringIndex,
        power: cfg.power,

        // ── world-space position (recalculated if centre changes) ───────
        worldX,
        worldY,

        // ── stored so positions can be rebuilt on resize ─────────────────
        _angle: cfg.angle,
        _distFromCenter: scaledDist, // ← store the already-scaled value

        // ── visual ──────────────────────────────────────────────────────
        color: cfg.color,
        glowColor: cfg.glowColor,

        // ── audio ───────────────────────────────────────────────────────
        sfxPrompt: cfg.sfxPrompt,
        sfxDuration: cfg.sfxDuration,

        // ── state ───────────────────────────────────────────────────────
        collected: false,

        // Pulse phase offset so items don't all throb in sync visually.
        pulseOffset: Math.random() * Math.PI * 2,
      };
    });
  }

  // ─── Frame update ──────────────────────────────────────────────────────────

  /**
   * Advance ring gap rotations by one logical frame.
   * Call once per game-loop iteration, passing the frame delta-time multiplier
   * (1.0 = exactly one 60-fps frame; 2.0 = two frames elapsed, etc.).
   *
   * @param {number} dt  – delta-time multiplier (dimensionless)
   */
  tick(dt) {
    for (const ring of this.rings) {
      ring.currentGapAngle += ring.rotationSpeed * dt;
      // Keep the angle in a tidy range to avoid float drift over long sessions.
      if (ring.currentGapAngle > Math.PI * 2)
        ring.currentGapAngle -= Math.PI * 2;
    }
  }

  // ─── Centre update (on canvas resize) ─────────────────────────────────────

  /**
   * Recalculate all item world positions after the canvas is resized.
   *
   * @param {number} cx
   * @param {number} cy
   */
  updateCenter(cx, cy) {
    this.cx = cx;
    this.cy = cy;

    // Recalculate scale for the new canvas dimensions.
    const outerRadius =
      CONFIG.WORLD.RINGS[CONFIG.WORLD.RINGS.length - 1].radius;
    const available = Math.min(cx, cy) * 0.78;
    this.scale = Math.min(1.0, available / outerRadius);
    this.itemFalloffDistance = CONFIG.AUDIO.ITEM_FALLOFF_DISTANCE * this.scale;

    // Re-scale ring radii.
    CONFIG.WORLD.RINGS.forEach((cfg, i) => {
      this.rings[i].radius = cfg.radius * this.scale;
    });

    // Re-scale item positions.
    CONFIG.WORLD.ITEMS.forEach((cfg, i) => {
      const scaledDist = cfg.distFromCenter * this.scale;
      this.items[i]._distFromCenter = scaledDist;
      this.items[i].worldX = cx + Math.cos(cfg.angle) * scaledDist;
      this.items[i].worldY = cy + Math.sin(cfg.angle) * scaledDist;
    });
  }

  // ─── Zone / ring detection ─────────────────────────────────────────────────

  /**
   * Return the "zone index" for a given world position.
   *
   *   zone 5  – outside all rings (beyond ring[4])
   *   zone 4  – between ring[4] and ring[3]
   *   zone 3  – between ring[3] and ring[2]
   *   zone 2  – between ring[2] and ring[1]
   *   zone 1  – between ring[1] and ring[0]
   *   zone 0  – inside ring[0] (the centre, where Abhimanyu is)
   *
   * @param {number} px
   * @param {number} py
   * @returns {number}  0–5
   */
  getZone(px, py) {
    const d = Math.hypot(px - this.cx, py - this.cy);
    // Rings are innermost-first; iterate outermost-first for zone detection.
    for (let i = this.rings.length - 1; i >= 0; i--) {
      if (d > this.rings[i].radius) {
        // Player is outside ring[i], so zone = i + 1
        return i + 1;
      }
    }
    // Inside all rings → centre zone
    return 0;
  }

  /**
   * Returns the ring object that the player would cross to move from
   * `oldZone` to `newZone`, or null if no ring was crossed.
   *
   * @param {number} oldZone
   * @param {number} newZone
   * @returns {object|null}
   */
  getCrossedRing(oldZone, newZone) {
    if (oldZone === newZone) return null;
    // Moving inward: crossed the ring at index (newZone) — i.e. ring[newZone]
    // Moving outward: crossed the ring at index (oldZone) — i.e. ring[oldZone]
    const ringIdx = newZone < oldZone ? newZone : oldZone;
    return this.rings[ringIdx] ?? null;
  }

  // ─── Collision resolution ──────────────────────────────────────────────────

  /**
   * Resolve all ring collisions for a proposed player movement.
   *
   * Given the player's current position (ox, oy) and the desired new
   * position (nx, ny), returns the position the player is actually
   * allowed to occupy after checking every ring wall.
   *
   * A ring wall blocks movement unless the player's current angle from the
   * world centre falls within the ring's current gap arc.
   *
   * When blocked, the player is projected back onto the near edge of the
   * ring wall (allowing them to slide tangentially — they don't get "stuck").
   *
   * @param {number} ox  – old X
   * @param {number} oy  – old Y
   * @param {number} nx  – proposed new X
   * @param {number} ny  – proposed new Y
   * @returns {{ x: number, y: number, blocked: boolean }}
   */
  resolveCollisions(ox, oy, nx, ny) {
    let x = nx;
    let y = ny;
    let blocked = false;

    const od = Math.hypot(ox - this.cx, oy - this.cy);

    for (const ring of this.rings) {
      const r = ring.radius;
      const nd = Math.hypot(x - this.cx, y - this.cy);

      const crossedInward = od >= r && nd < r;
      const crossedOutward = od <= r && nd > r;

      if (!crossedInward && !crossedOutward) continue;

      // ── Gap check ───────────────────────────────────────────────────────
      // Use the *proposed* new position's angle for the gap test — this
      // means the player's current angle (before move) determines if they
      // can cross the wall.  In practice the difference is sub-pixel at
      // normal speeds, and this avoids corner-case tunnelling.
      const playerAngle = Math.atan2(y - this.cy, x - this.cx);
      const gapCenter = ring.currentGapAngle;
      const gapHalf = ring.effectiveGapWidth / 2;

      const inGap =
        gapHalf > 0 && absAngleDiff(playerAngle, gapCenter) <= gapHalf;

      if (inGap) continue; // passage is open — no collision

      // ── Block and project back to ring edge ─────────────────────────────
      // Keep the player's angle but clamp their radius to just outside the
      // wall they tried to cross.  This lets them slide along the ring.
      blocked = true;
      const half = ring.wallThickness / 2;
      const edgeR = crossedInward
        ? r + half + 0.5 // pushed back to outer edge of wall
        : r - half - 0.5; // pushed back to inner edge of wall

      const pushAngle = Math.atan2(y - this.cy, x - this.cx);
      x = this.cx + Math.cos(pushAngle) * edgeR;
      y = this.cy + Math.sin(pushAngle) * edgeR;
    }

    return { x, y, blocked };
  }

  // ─── Item helpers ──────────────────────────────────────────────────────────

  /**
   * Returns every uncollected item within `radius` pixels of (px, py).
   *
   * @param {number} px
   * @param {number} py
   * @param {number} radius
   * @returns {object[]}
   */
  getNearbyItems(px, py, radius) {
    const r2 = radius * radius;
    return this.items.filter((item) => {
      if (item.collected) return false;
      const dx = item.worldX - px;
      const dy = item.worldY - py;
      return dx * dx + dy * dy <= r2;
    });
  }

  /**
   * Mark an item as collected by id.
   * @param {string} id
   */
  collectItem(id) {
    const item = this.items.find((i) => i.id === id);
    if (item) item.collected = true;
  }

  /**
   * Returns the count of collected items.
   * @returns {number}
   */
  get collectedCount() {
    return this.items.filter((i) => i.collected).length;
  }

  /**
   * Returns true if all items have been collected.
   * @returns {boolean}
   */
  get allCollected() {
    return this.items.every((i) => i.collected);
  }

  // ─── Spatial-audio helpers ─────────────────────────────────────────────────

  /**
   * Compute stereo pan and volume for a sound source at (sx, sy) heard by
   * a listener at (px, py), with a given maximum audible distance.
   *
   * Pan is derived from the angle between listener and source:
   *   fully left (−1) when source is 90° to the left,
   *   fully right (+1) when source is 90° to the right.
   *
   * Volume falls off linearly with distance (1.0 → 0.0 over maxDist).
   *
   * @param {number} sx
   * @param {number} sy
   * @param {number} px
   * @param {number} py
   * @param {number} maxDist
   * @param {number} [listenerFacing=0]  – listener's facing angle (radians).
   *   Pass player.facingAngle for head-relative stereo, or 0 for world-fixed.
   * @returns {{ pan: number, volume: number, dist: number }}
   */
  static spatialParams(sx, sy, px, py, maxDist, listenerFacing = 0) {
    const dx = sx - px;
    const dy = sy - py;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist >= maxDist) return { pan: 0, volume: 0, dist };

    // Angle from listener to source, relative to the listener's facing direction.
    const absAngle = Math.atan2(dy, dx);
    const relAngle = normalizeAngle(absAngle - listenerFacing);

    // Map relative angle to stereo pan: sin gives left/right cleanly.
    // Clamp to avoid floating-point overshoot.
    const pan = Math.max(-1, Math.min(1, Math.sin(relAngle)));
    const volume = Math.max(0, 1 - dist / maxDist);

    return { pan, volume, dist };
  }

  /**
   * Convenience: get spatial params from the world centre (Abhimanyu's
   * position) to the player.
   *
   * @param {number} px
   * @param {number} py
   * @param {number} maxDist
   * @param {number} [listenerFacing=0]
   * @returns {{ pan: number, volume: number, dist: number }}
   */
  centreToPlayer(px, py, maxDist, listenerFacing = 0) {
    return World.spatialParams(
      this.cx,
      this.cy,
      px,
      py,
      maxDist,
      listenerFacing,
    );
  }

  // ─── Debug helpers ─────────────────────────────────────────────────────────

  /**
   * Returns a human-readable summary of the current world state.
   * Useful for console debugging during development.
   * @returns {string}
   */
  debugSummary() {
    const ringLines = this.rings
      .map(
        (r) =>
          `  Ring ${r.index} (r=${r.radius}): gap@${((r.currentGapAngle * 180) / Math.PI).toFixed(1)}° ` +
          `effWidth=${r.effectiveGapWidth.toFixed(2)} crossed=${r.crossed}`,
      )
      .join("\n");

    const itemLines = this.items
      .map(
        (i) =>
          `  ${i.id}: collected=${i.collected} ` +
          `pos=(${i.worldX.toFixed(0)}, ${i.worldY.toFixed(0)})`,
      )
      .join("\n");

    return `World (cx=${this.cx.toFixed(0)}, cy=${this.cy.toFixed(0)}):\nRings:\n${ringLines}\nItems:\n${itemLines}`;
  }
}
