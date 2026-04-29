/**
 * player.js — PADMAVYUH: VOICES OF DHARMA
 * ─────────────────────────────────────────────────────────────────────────────
 * Player class.
 * Tracks position, velocity, current speed, and a short positional history
 * used by the Renderer to draw the light-trail behind the player.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import CONFIG from './config.js';

export default class Player {
  /**
   * @param {number} x  – initial world X (pixels)
   * @param {number} y  – initial world Y (pixels)
   */
  constructor(x, y) {
    // ── Position ────────────────────────────────────────────────────────────
    this.x = x;
    this.y = y;

    // ── Velocity (pixels per logical frame, set by Game each update) ────────
    this.vx = 0;
    this.vy = 0;

    // ── Scalar speed (magnitude of velocity vector, pixels/frame) ───────────
    // Updated every frame by Game._update().  Used by the stillness ring
    // mechanic and by the Renderer to scale the glow intensity.
    this.speed = 0;

    // ── Position history for the light trail ────────────────────────────────
    // Stores up to CONFIG.RENDER.TRAIL_LENGTH {x, y} snapshots.
    // The most-recent entry is at index 0 (head); oldest at the tail.
    this._trailMaxLength = CONFIG.RENDER.TRAIL_LENGTH;
    this.trail = [];          // Array<{x: number, y: number}>

    // ── Cumulative distance travelled (used for ambient audio pulsing) ───────
    this.distanceTravelled = 0;

    // ── Facing angle (radians) — updated whenever the player moves ───────────
    // Defaults to "upward" (−π/2) so the glow faces the right way on spawn.
    this.facingAngle = -Math.PI / 2;

    // ── Frame counter (incremented every update, wraps at 10 000) ────────────
    this._frame = 0;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Apply a movement delta.  Called by Game after collision resolution so
   * `dx`/`dy` already represent the *allowed* displacement.
   *
   * @param {number} dx
   * @param {number} dy
   */
  applyMovement(dx, dy) {
    // Push current position onto the trail before moving.
    this._recordTrail();

    this.x += dx;
    this.y += dy;

    // Keep velocity for external reads (e.g. renderer glow scaling).
    this.vx = dx;
    this.vy = dy;

    // Scalar speed (magnitude).
    this.speed = Math.sqrt(dx * dx + dy * dy);

    // Update facing angle only when actually moving (avoids snapping to 0
    // when the player releases all keys).
    if (this.speed > 0.001) {
      this.facingAngle = Math.atan2(dy, dx);
    }

    this.distanceTravelled += this.speed;
    this._frame = (this._frame + 1) % 10000;
  }

  /**
   * Teleport the player without recording trail history.
   * Used on initial placement and scene resets.
   *
   * @param {number} x
   * @param {number} y
   */
  teleport(x, y) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.speed = 0;
    this.trail = [];
    this.distanceTravelled = 0;
  }

  /**
   * Returns the player's angle from an arbitrary world point (usually the
   * maze centre).  Useful for spatial-audio pan calculations.
   *
   * @param {number} cx  – reference X
   * @param {number} cy  – reference Y
   * @returns {number} angle in radians (-π … π)
   */
  angleFrom(cx, cy) {
    return Math.atan2(this.y - cy, this.x - cx);
  }

  /**
   * Returns the straight-line distance from an arbitrary world point.
   *
   * @param {number} cx
   * @param {number} cy
   * @returns {number} pixels
   */
  distanceFrom(cx, cy) {
    const dx = this.x - cx;
    const dy = this.y - cy;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Returns a value in [0, 1] representing how fast the player is currently
   * moving relative to the configured maximum speed.  Used by the renderer
   * to scale glow intensity and by Game to detect stillness-ring breaches.
   *
   * @returns {number}
   */
  get normalizedSpeed() {
    return Math.min(1, this.speed / CONFIG.WORLD.PLAYER.SPEED);
  }

  /**
   * Returns true when the player has been effectively still for at least
   * one frame (speed below a negligible threshold).
   *
   * @returns {boolean}
   */
  get isStill() {
    return this.speed < 0.05;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Push the current position to the front of the trail array and trim
   * the array to the configured maximum length.
   */
  _recordTrail() {
    this.trail.unshift({ x: this.x, y: this.y });
    if (this.trail.length > this._trailMaxLength) {
      this.trail.length = this._trailMaxLength;
    }
  }
}
