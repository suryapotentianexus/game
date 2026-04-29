/**
 * game.js — PADMAVYUH: VOICES OF DHARMA
 * ─────────────────────────────────────────────────────────────────────────────
 * Game — central state machine and main game loop.
 *
 * State flow:
 *   TITLE → LOADING → INTRO → PLAYING → CONVERSATION → OUTRO
 *
 * Gameplay sub-zones (currentZone):
 *   5 = outside all rings (spawn area)
 *   4 = between ring[4] and ring[3]
 *   3 = between ring[3] and ring[2]
 *   2 = between ring[2] and ring[1]   ← stillness mechanic
 *   1 = between ring[1] and ring[0]   ← deception mechanic
 *   0 = inside ring[0]  (centre, Abhimanyu's location)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import CONFIG from "./config.js";
import UI from "./ui.js";
import AudioManager from "./audio.js";
import ElevenLabs from "./elevenlabs.js";
import World from "./world.js";
import Player from "./player.js";
import Renderer from "./renderer.js";
import ConversationManager from "./conversation.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Promise-based setTimeout */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Normalise an angle difference into (-π, π].
 * @param {number} diff
 * @returns {number}
 */
function wrapAngle(diff) {
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff <= -Math.PI) diff += 2 * Math.PI;
  return diff;
}

/** Pick a random integer in [0, n) */
function randInt(n) {
  return Math.floor(Math.random() * n);
}

/** Pick a random float in [min, max] */
function randBetween(min, max) {
  return min + Math.random() * (max - min);
}

// ─── Game class ───────────────────────────────────────────────────────────────

export default class Game {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");

    // ── World dimensions ────────────────────────────────────────────────────
    this.cx = canvas.width;
    this.cy = canvas.height;
    this._resizeCanvas();

    // ── Core modules (initialised in start()) ───────────────────────────────
    /** @type {World} */ this.world = null;
    /** @type {Player} */ this.player = null;
    /** @type {Renderer} */ this.renderer = null;

    // ── State machine ────────────────────────────────────────────────────────
    // 'TITLE' | 'LOADING' | 'INTRO' | 'PLAYING' | 'CONVERSATION' | 'OUTRO'
    this.state = "TITLE";

    // ── Input ────────────────────────────────────────────────────────────────
    this.keys = { up: false, down: false, left: false, right: false };
    this._setupKeys();

    // ── Game-loop handles ────────────────────────────────────────────────────
    this._animFrame = null;
    this._lastFrameTime = 0;

    // ── Zone / ring tracking ─────────────────────────────────────────────────
    /** Current zone index: 0 (centre) … 5 (outside all rings) */
    this.currentZone = 5;

    /** Set of collected item ids */
    this.collectedItems = new Set();

    // ── Proximity tracking (for item-nearby hint) ────────────────────────────
    /** Whether Krishna has recently hinted about a nearby item */
    this._itemHintPending = false;
    /** Cooldown (ms) before another item hint can fire */
    this._itemHintCooldown = 0;

    // ── Timer accumulators (milliseconds) ───────────────────────────────────
    this._krishnaHintTimer = CONFIG.AUDIO.KRISHNA_HINT_INTERVAL;
    this._abhimanyuCallTimer = 4000; // first call fires 4 s after gameplay starts
    this._abhimanyuCallIndex = 0;

    // ── Stillness ring state ─────────────────────────────────────────────────
    /** timestamp (ms) when the stillness penalty expires — 0 = no penalty */
    this._stillnessPenaltyEnd = 0;
    /** Whether the stillness warning UI is currently visible */
    this._stillnessWarningShown = false;

    // ── Deception ring state ──────────────────────────────────────────────────
    this._deceiverTimer = 0; // ms until next false voice
    this._deceiverActive = false;

    // ── Centre arrival guard ─────────────────────────────────────────────────
    this._centreReached = false;

    // ── Ring-enter guard (prevent multiple firings on the same crossing) ─────
    this._lastRingEnterZone = 5;

    // ── Resize handling ──────────────────────────────────────────────────────
    this._setupResize();
  }

  // ─── Public: boot ─────────────────────────────────────────────────────────

  /**
   * Called by main.js when the player clicks "Begin".
   * Initialises audio, loads all ElevenLabs assets, then plays the intro.
   *
   * @returns {Promise<void>}
   */
  async start() {
    this.state = "LOADING";
    UI.showLoading();

    // ── Audio context (must be created from a user-gesture) ─────────────────
    AudioManager.init();
    AudioManager.resume();

    // ── Provide AudioContext + API key to ElevenLabs ─────────────────────────
    ElevenLabs.init(CONFIG.ELEVENLABS_API_KEY, AudioManager.ctx);

    // ── Build world, player, renderer ───────────────────────────────────────
    this._resizeCanvas();
    this.world = new World(this.cx, this.cy);
    // rings[4].radius is already scaled by World; offset is scaled too
    const spawnDist =
      this.world.rings[4].radius +
      CONFIG.WORLD.PLAYER.START_RING_OFFSET * this.world.scale;
    this.player = new Player(
      this.cx + Math.cos(CONFIG.WORLD.PLAYER.START_ANGLE) * spawnDist,
      this.cy + Math.sin(CONFIG.WORLD.PLAYER.START_ANGLE) * spawnDist,
    );
    this.renderer = new Renderer(this.canvas, this.ctx);

    // Start the render loop immediately so the canvas is never black
    this._lastFrameTime = performance.now();
    this._animFrame = requestAnimationFrame((ts) => this._mainLoop(ts));

    // ── Preload all ElevenLabs audio ─────────────────────────────────────────
    await ElevenLabs.preloadAll((current, total, label) => {
      UI.updateLoading(current, total, label);
    });

    // ── Start item ambient loops (silent; will be updated spatially each frame)
    for (const item of this.world.items) {
      const buffer = ElevenLabs.getSFX(item.id);
      AudioManager.startItemLoop(item.id, buffer, { volume: 0 });
    }

    // ── Play intro cinematic ─────────────────────────────────────────────────
    await this._playIntro();
  }

  /**
   * Called by main.js when the player clicks "Lead him home →".
   * Ends the conversation and plays the outro.
   *
   * @returns {Promise<void>}
   */
  async onConversationEnd() {
    if (this.state !== "CONVERSATION") return;

    await ConversationManager.stop();

    await UI.fadeToBlack(2000);
    await sleep(400);

    await this._playOutro();
  }

  // ─── Intro cinematic ──────────────────────────────────────────────────────

  /**
   * Full intro sequence:
   *   black → Subhadra line → Krishna intro → Abhimanyu distant call → gameplay
   *
   * @returns {Promise<void>}
   */
  async _playIntro() {
    this.state = "INTRO";

    // Hide loading screen and activate cinematic bars
    UI.showIntro();

    await sleep(600);
    await UI.fadeFromBlack(1800);
    await sleep(500);

    // ── Subhadra's opening line ──────────────────────────────────────────────
    const subhadraBuffer = ElevenLabs.getSpeech("SUBHADRA_OPENING");
    if (subhadraBuffer) {
      AudioManager.play(subhadraBuffer, { volume: 0.95 });
    } else {
      AudioManager.playSynthDialogue("SUBHADRA");
    }
    UI.showDialogue("SUBHADRA", CONFIG.DIALOGUE.SUBHADRA_OPENING, 6000);
    await sleep(3500);

    // ── Krishna's introduction ───────────────────────────────────────────────
    const krishnaBuffer = ElevenLabs.getSpeech("KRISHNA_INTRO");
    if (krishnaBuffer) {
      AudioManager.play(krishnaBuffer, { volume: 0.9 });
    } else {
      AudioManager.playSynthDialogue("KRISHNA");
    }
    UI.showDialogue("KRISHNA", CONFIG.DIALOGUE.KRISHNA_INTRO, 13000);
    await sleep(5000);
    UI.hideDialogue();

    // ── Abhimanyu's first call from the maze centre (spatial) ───────────────
    await sleep(500);
    this._playAbhimanyuCall(0);
    await sleep(1500);

    // ── Transition into gameplay ─────────────────────────────────────────────
    await UI.fadeToBlack(900);
    UI.setCinematicMode(false);
    UI.showHUD();
    UI.updateRingIndicator([], 4); // no rings passed yet, current = outermost
    UI.updateRingName(CONFIG.WORLD.RINGS[4].name);
    UI.updateItems(0, CONFIG.WORLD.ITEMS.length);
    await sleep(200);

    this._startGameLoop();

    await sleep(100);
    UI.fadeFromBlack(1200);
  }

  // ─── Game loop ────────────────────────────────────────────────────────────

  /**
   * Begin the requestAnimationFrame loop.
   */
  _startGameLoop() {
    // Just flip to PLAYING — _mainLoop() is already running from start()
    this.state = "PLAYING";
    this._krishnaHintTimer = CONFIG.AUDIO.KRISHNA_HINT_INTERVAL;
    this._abhimanyuCallTimer = 4000;
    // cancel any old frame that may have been set by the old _loop pattern
  }

  /**
   * Core loop — called ~60 fps.
   * @param {number} timestamp – performance.now()
   */
  _mainLoop(ts) {
    const rawDt = Math.min(ts - this._lastFrameTime, 100);
    this._lastFrameTime = ts;
    const dt = rawDt / 16.667;

    // Update game logic only during active gameplay
    if (this.state === "PLAYING") {
      this._update(dt, ts);
    }

    // Render EVERY frame regardless of state
    this._renderFrame(ts);

    // Keep looping forever (game never stops the rAF)
    this._animFrame = requestAnimationFrame((t) => this._mainLoop(t));
  }

  /**
   * Update all game logic for one frame.
   * @param {number} dt         – delta-time multiplier
   * @param {number} timestamp  – performance.now()
   */
  _update(dt, timestamp) {
    if (this.state !== "PLAYING") return;

    AudioManager.resume(); // ensure context isn't suspended

    // ── 1. Compute desired velocity from held keys ───────────────────────────
    let ix = 0,
      iy = 0;
    if (this.keys.left) ix -= 1;
    if (this.keys.right) ix += 1;
    if (this.keys.up) iy -= 1;
    if (this.keys.down) iy += 1;

    // Normalise diagonal so speed is consistent in all directions
    if (ix !== 0 && iy !== 0) {
      ix *= 0.7071;
      iy *= 0.7071;
    }

    const speed = CONFIG.WORLD.PLAYER.SPEED * dt;
    const attemptDx = ix * speed;
    const attemptDy = iy * speed;

    const oldX = this.player.x;
    const oldY = this.player.y;

    // ── 2. Advance ring gap rotations ────────────────────────────────────────
    this.world.tick(dt);

    // ── 3. Stillness ring penalty — may seal ring[2]'s gap ──────────────────
    this._updateStillness(timestamp, ix, iy, speed);

    // ── 4. Resolve collisions and apply movement ─────────────────────────────
    const {
      x: nx,
      y: ny,
      blocked,
    } = this.world.resolveCollisions(
      oldX,
      oldY,
      oldX + attemptDx,
      oldY + attemptDy,
    );

    const actualDx = nx - oldX;
    const actualDy = ny - oldY;
    this.player.applyMovement(actualDx, actualDy);

    // ── 5. Zone detection ────────────────────────────────────────────────────
    const newZone = this.world.getZone(this.player.x, this.player.y);

    if (newZone < this.currentZone && newZone !== this._lastRingEnterZone) {
      this._onEnterRing(newZone);
      this._lastRingEnterZone = newZone;
    }
    // Allow re-detection if player moves outward and inward again
    if (newZone > this._lastRingEnterZone) {
      this._lastRingEnterZone = newZone;
    }

    this.currentZone = newZone;

    // ── 6. Centre detection ───────────────────────────────────────────────────
    if (!this._centreReached) {
      const distToCenter = this.player.distanceFrom(this.cx, this.cy);
      if (distToCenter < this.world.rings[0].radius * 0.45) {
        this._centreReached = true;
        // Stop the loop before async work so we don't double-fire
        cancelAnimationFrame(this._animFrame);
        this._animFrame = null;
        this._onReachCentre();
        return;
      }
    }

    // ── 7. Item collection ───────────────────────────────────────────────────
    const nearby = this.world.getNearbyItems(
      this.player.x,
      this.player.y,
      CONFIG.WORLD.ITEM_COLLECT_RADIUS,
    );
    for (const item of nearby) {
      this._onCollectItem(item);
    }

    // ── 8. Item proximity hint (tell player something is close) ─────────────
    this._updateItemProximityHint(timestamp);

    // ── 9. Update spatial audio for all item loops ───────────────────────────
    this._updateAudio(timestamp);

    // ── 10. Krishna hint timer ───────────────────────────────────────────────
    this._krishnaHintTimer -= rawDt; // use real ms
    if (this._krishnaHintTimer <= 0) {
      this._playKrishnaHint();
      this._krishnaHintTimer =
        CONFIG.AUDIO.KRISHNA_HINT_INTERVAL +
        randBetween(0, CONFIG.AUDIO.KRISHNA_HINT_JITTER);
    }

    // ── 11. Abhimanyu call timer ──────────────────────────────────────────────
    this._abhimanyuCallTimer -= rawDt;
    if (this._abhimanyuCallTimer <= 0) {
      this._playAbhimanyuCall();
      this._abhimanyuCallTimer = randBetween(
        CONFIG.AUDIO.ABHIMANYU_CALL_MIN_INTERVAL,
        CONFIG.AUDIO.ABHIMANYU_CALL_MAX_INTERVAL,
      );
    }

    // ── 12. Deception ring (ring[1]) false voices ────────────────────────────
    if (this.currentZone <= 1) {
      if (!this._deceiverActive) {
        this._deceiverActive = true;
        this._deceiverTimer = randBetween(
          CONFIG.AUDIO.DECEIVER_MIN_INTERVAL,
          CONFIG.AUDIO.DECEIVER_MAX_INTERVAL,
        );
      }
      this._deceiverTimer -= rawDt;
      if (this._deceiverTimer <= 0) {
        this._playDeceiverVoice();
        this._deceiverTimer = randBetween(
          CONFIG.AUDIO.DECEIVER_MIN_INTERVAL,
          CONFIG.AUDIO.DECEIVER_MAX_INTERVAL,
        );
      }
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  /**
   * Delegate rendering to the Renderer module.
   */
  _renderFrame(ts = performance.now()) {
    if (!this.renderer) return;
    this.renderer.renderFrame({
      state: this.state,
      cx: this.cx,
      cy: this.cy,
      rings: this.world ? this.world.rings : [],
      items: this.world ? this.world.items : [],
      player: this.player,
      collectedItems: this.collectedItems,
      currentZone: this.currentZone,
      timestamp: ts,
    });
  }

  // ─── Ring mechanics ────────────────────────────────────────────────────────

  /**
   * Called when the player crosses inward into a new zone.
   * @param {number} newZone – zone the player just entered
   */
  _onEnterRing(newZone) {
    // Determine which ring wall was just crossed (= ring at index newZone,
    // since crossing from zone N+1 into zone N means passing through ring[N]).
    const crossedRingIndex = newZone;
    const ringCfg = CONFIG.WORLD.RINGS[crossedRingIndex];

    // Mark ring as crossed
    if (this.world.rings[crossedRingIndex]) {
      this.world.rings[crossedRingIndex].crossed = true;
    }

    // ── Visual flash ──────────────────────────────────────────────────────────
    if (this.renderer) {
      const flashColors = [
        "#ffd700", // ring 0 — gold
        "#9955dd", // ring 1 — purple
        "#cc6633", // ring 2 — amber-red
        "#ff9922", // ring 3 — orange
        "#6699cc", // ring 4 — blue
      ];
      this.renderer.triggerCrossEffect(
        flashColors[crossedRingIndex] ?? "#e8d5a3",
      );
    }

    // ── HUD update ────────────────────────────────────────────────────────────
    // passedRings = indices of rings fully inside the player's current zone
    const passedRings = [];
    for (let i = this.world.rings.length - 1; i > crossedRingIndex; i--) {
      passedRings.push(i);
    }
    UI.updateRingIndicator(passedRings, crossedRingIndex);
    if (ringCfg) UI.updateRingName(ringCfg.name);

    // ── Ring-enter SFX ────────────────────────────────────────────────────────
    const ringEnterBuffer = ElevenLabs.getSFX("RING_ENTER");
    if (ringEnterBuffer) {
      AudioManager.play(ringEnterBuffer, { volume: 0.55 });
    } else {
      AudioManager.playSynthTone(220 + crossedRingIndex * 60, 0.6, 0.35);
    }

    // ── Krishna entry line (slight delay so it doesn't clash with SFX) ───────
    if (ringCfg && ringCfg.krishnaLines.length > 0) {
      const speechKey = `KRISHNA_RING_${crossedRingIndex}_0`;
      const lineText = ringCfg.krishnaLines[0];

      setTimeout(() => {
        if (this.state !== "PLAYING") return;

        const buf = ElevenLabs.getSpeech(speechKey);
        if (buf) {
          AudioManager.play(buf, { volume: 0.82 });
        } else {
          AudioManager.playSynthDialogue("KRISHNA");
        }
        UI.showDialogue("KRISHNA", lineText, 5500);
      }, 1200);
    }

    // ── Zone-specific special setup ───────────────────────────────────────────
    if (newZone === 1) {
      // Entering the deception ring zone — arm the timer
      this._deceiverActive = false; // reset so the check in _update triggers it
    }
  }

  /**
   * Called when the player reaches the exact centre of the maze.
   * Transitions to CONVERSATION state.
   */
  async _onReachCentre() {
    this.state = "CONVERSATION";

    // Stop all item audio loops
    AudioManager.stopAllLoops();

    // Play Krishna's "you found him" line
    const buf = ElevenLabs.getSpeech("GAME_WIN_KRISHNA");
    if (buf) {
      AudioManager.play(buf, { volume: 0.9 });
    } else {
      AudioManager.playSynthDialogue("KRISHNA");
    }
    UI.showDialogue("KRISHNA", CONFIG.DIALOGUE.GAME_WIN_KRISHNA, 9000);

    await sleep(9500);
    UI.hideDialogue();
    await sleep(600);

    // Hand off to ConversationManager
    ConversationManager.onReadyToEnd = () => {
      /* unlock button already shown by CM */
    };
    await ConversationManager.start();
  }

  // ─── Item collection ──────────────────────────────────────────────────────

  /**
   * Collect an item: stop its audio loop, update UI, trigger visual flash.
   * @param {object} item – live item object from World
   */
  _onCollectItem(item) {
    // Guard against double-collection
    if (this.collectedItems.has(item.id)) return;

    this.collectedItems.add(item.id);
    this.world.collectItem(item.id);

    // Stop the spatial audio loop
    AudioManager.fadeOutLoop(item.id);

    // Visual flash at item position
    if (this.renderer) {
      this.renderer.triggerFlash(item.worldX, item.worldY, item.color);
    }

    // HUD update
    UI.updateItems(this.collectedItems.size, CONFIG.WORLD.ITEMS.length);

    // Item-collect SFX sting
    const collectSfx = ElevenLabs.getSFX("ITEM_COLLECT");
    if (collectSfx) {
      AudioManager.play(collectSfx, { volume: 0.65 });
    } else {
      AudioManager.playSynthTone(880, 0.25, 0.5);
    }

    // Krishna confirmation line (short delay)
    setTimeout(() => {
      if (this.state !== "PLAYING") return;
      const buf = ElevenLabs.getSpeech("KRISHNA_ITEM_COLLECTED");
      if (buf) {
        AudioManager.play(buf, { volume: 0.8 });
      } else {
        AudioManager.playSynthDialogue("KRISHNA");
      }
      UI.showDialogue("KRISHNA", CONFIG.DIALOGUE.KRISHNA_ITEM_COLLECTED, 3500);
    }, 600);

    // Reset item-hint cooldown so it can trigger again for the next item
    this._itemHintCooldown = 0;
    this._itemHintPending = false;
  }

  // ─── Stillness ring ────────────────────────────────────────────────────────

  /**
   * Ring[2] (zone 2 / 3 boundary) has a special mechanic: rushing seals the gap.
   *
   * Called every update frame.
   *
   * @param {number} timestamp  – performance.now()
   * @param {number} ix         – horizontal input component (-1…1)
   * @param {number} iy         – vertical input component
   * @param {number} speed      – attempted movement speed (pixels/frame)
   */
  _updateStillness(timestamp, ix, iy, speed) {
    // Only relevant when the player is in or approaching ring[2]'s zone
    if (this.currentZone > 3) {
      // Outside the stillness zone — clear any lingering penalty
      if (this._stillnessPenaltyEnd > 0) {
        this._clearStillnessPenalty();
      }
      return;
    }

    const ring2 = this.world.rings[2];
    if (!ring2) return;

    const inputSpeed = Math.sqrt(ix * ix + iy * iy) * CONFIG.WORLD.PLAYER.SPEED;

    // ── Trigger penalty ────────────────────────────────────────────────────
    if (
      inputSpeed > CONFIG.AUDIO.STILLNESS_SPEED_THRESHOLD &&
      this._stillnessPenaltyEnd === 0
    ) {
      this._stillnessPenaltyEnd =
        timestamp + CONFIG.AUDIO.STILLNESS_PENALTY_DURATION;

      // Seal the gap
      ring2.effectiveGapWidth = 0;

      // Show warning UI
      UI.showStillnessWarning();
      this._stillnessWarningShown = true;

      // Play breach audio
      const breachBuf = ElevenLabs.getSpeech("STILLNESS_BREACH");
      if (breachBuf) {
        AudioManager.play(breachBuf, { volume: 0.85 });
      } else {
        AudioManager.playSynthDialogue("KRISHNA");
      }
      UI.showDialogue("KRISHNA", CONFIG.DIALOGUE.STILLNESS_BREACH, 4000);

      // Ring-close SFX
      const closeSfx = ElevenLabs.getSFX("RING_CLOSE");
      if (closeSfx) AudioManager.play(closeSfx, { volume: 0.5 });
    }

    // ── Lift penalty once timer expires ────────────────────────────────────
    if (
      this._stillnessPenaltyEnd > 0 &&
      timestamp >= this._stillnessPenaltyEnd
    ) {
      this._clearStillnessPenalty();
    }
  }

  /**
   * Remove the stillness penalty: restore ring gap and hide warning UI.
   */
  _clearStillnessPenalty() {
    this._stillnessPenaltyEnd = 0;

    const ring2 = this.world.rings[2];
    if (ring2) {
      ring2.effectiveGapWidth = CONFIG.WORLD.RINGS[2].gapWidth;
    }

    if (this._stillnessWarningShown) {
      UI.hideStillnessWarning();
      this._stillnessWarningShown = false;
    }
  }

  // ─── Audio updates ─────────────────────────────────────────────────────────

  /**
   * Update spatial audio for all item loops and set Abhimanyu volume by zone.
   * Called every frame.
   * @param {number} timestamp
   */
  _updateAudio(timestamp) {
    const px = this.player.x;
    const py = this.player.y;
    const fa = this.player.facingAngle;
    // Use the world-scaled falloff distance so audio range matches visual size
    const falloff = this.world.itemFalloffDistance;
    const baseVol = CONFIG.AUDIO.ITEM_BASE_VOLUME;

    // ── Item ambient loops ─────────────────────────────────────────────────
    for (const item of this.world.items) {
      if (item.collected) {
        // Already fading out — skip
        continue;
      }
      AudioManager.updateLoopSpatial(
        item.id,
        item.worldX,
        item.worldY,
        px,
        py,
        falloff,
        baseVol,
        fa,
      );
    }
  }

  // ─── Proximity hint ────────────────────────────────────────────────────────

  /**
   * Fire a Krishna hint when the player is moderately close to an uncollected
   * item for the first time (hints them that something is nearby without
   * immediately giving the position).
   *
   * @param {number} timestamp
   */
  _updateItemProximityHint(timestamp) {
    if (this._itemHintCooldown > timestamp) return;

    const HINT_DIST = CONFIG.AUDIO.ITEM_FALLOFF_DISTANCE * 0.55;

    for (const item of this.world.items) {
      if (item.collected) continue;
      const d = Math.hypot(
        item.worldX - this.player.x,
        item.worldY - this.player.y,
      );
      if (d < HINT_DIST) {
        // Something is close — play the hint once
        const buf = ElevenLabs.getSpeech("KRISHNA_ITEM_NEARBY");
        if (buf) {
          AudioManager.play(buf, { volume: 0.75 });
        } else {
          AudioManager.playSynthDialogue("KRISHNA");
        }
        UI.showDialogue("KRISHNA", CONFIG.DIALOGUE.KRISHNA_ITEM_NEARBY, 4000);

        // Cooldown: don't hint again for 20 s
        this._itemHintCooldown = timestamp + 20000;
        break;
      }
    }
  }

  // ─── Krishna hints ─────────────────────────────────────────────────────────

  /**
   * Play a contextual Krishna hint — either directional guidance toward the
   * nearest ring gap, or a ring-specific flavour line.
   */
  _playKrishnaHint() {
    if (this.state !== "PLAYING") return;

    // ── Decide what to say ────────────────────────────────────────────────
    // 50 % chance: directional hint toward the current inward-facing ring gap
    // 50 % chance: flavour line from the current ring
    const useDirectional = Math.random() < 0.55;

    let lineText;
    let speechKey;
    let pan = 0;

    if (useDirectional) {
      // Find which ring the player is currently trying to cross (the innermost
      // ring just outside the player's current position).
      const targetRingIndex = Math.max(0, this.currentZone - 1);
      const ring = this.world.rings[targetRingIndex];

      if (ring) {
        const playerAngle = this.player.angleFrom(this.cx, this.cy);
        const gapAngle = ring.currentGapAngle;
        const diff = wrapAngle(gapAngle - playerAngle);

        // Pan Krishna's voice toward the gap direction
        pan = Math.max(-0.7, Math.min(0.7, Math.sin(diff) * 1.2));

        if (Math.abs(diff) < 0.25) {
          lineText = CONFIG.DIALOGUE.KRISHNA_NAVIGATE_CLOSE;
          speechKey = "KRISHNA_NAVIGATE_CLOSE";
        } else if (diff > 0) {
          // Gap is counter-clockwise from player
          lineText = CONFIG.DIALOGUE.KRISHNA_NAVIGATE_CCW;
          speechKey = "KRISHNA_NAVIGATE_CCW";
        } else {
          // Gap is clockwise from player
          lineText = CONFIG.DIALOGUE.KRISHNA_NAVIGATE_CW;
          speechKey = "KRISHNA_NAVIGATE_CW";
        }
      }
    }

    // Fallback (or flavour): pick a random line from the current ring
    if (!lineText) {
      const ringIdx = Math.min(this.currentZone, CONFIG.WORLD.RINGS.length - 1);
      const ringCfg = CONFIG.WORLD.RINGS[ringIdx];
      if (ringCfg && ringCfg.krishnaLines.length > 0) {
        const pick = randInt(ringCfg.krishnaLines.length);
        lineText = ringCfg.krishnaLines[pick];
        speechKey = `KRISHNA_RING_${ringIdx}_${pick <= 1 ? pick : 0}`;
      }
    }

    if (!lineText) return;

    // ── Speak it ──────────────────────────────────────────────────────────
    const buf = ElevenLabs.getSpeech(speechKey);
    if (buf) {
      AudioManager.play(buf, { volume: 0.78, pan });
    } else {
      AudioManager.playSynthDialogue("KRISHNA");
    }
    UI.showDialogue("KRISHNA", lineText, 4500);
  }

  // ─── Abhimanyu calls ───────────────────────────────────────────────────────

  /**
   * Play one of Abhimanyu's distant calls with spatial audio from the centre.
   *
   * @param {number} [forceIndex] – if provided, use this line index (for intro)
   */
  _playAbhimanyuCall(forceIndex) {
    const calls = CONFIG.DIALOGUE.ABHIMANYU_CALLS;
    const index =
      forceIndex !== undefined
        ? forceIndex
        : this._abhimanyuCallIndex++ % calls.length;

    // Volume by current zone: louder the closer the player is to centre
    const volByZone = CONFIG.AUDIO.ABHIMANYU_VOLUME_BY_ZONE;
    const zoneClamp = Math.min(this.currentZone, volByZone.length - 1);
    const baseVol = volByZone[zoneClamp];

    // Spatial pan from centre direction
    const angleToCenter = Math.atan2(
      this.cy - this.player.y,
      this.cx - this.player.x,
    );
    const pan = Math.max(-0.8, Math.min(0.8, Math.sin(angleToCenter) * 0.9));

    const buf = ElevenLabs.getSpeech(`ABHIMANYU_${index}`);
    if (buf) {
      AudioManager.play(buf, { volume: baseVol, pan });
    } else {
      // Synth fallback — a descending, melancholy tone
      AudioManager.playSynthTone(349 - index * 20, 0.5, baseVol * 0.6, pan);
    }
  }

  // ─── Deception voices ──────────────────────────────────────────────────────

  /**
   * Play a false directional voice from the wrong side of the player.
   * Used in ring[1] (the Voices of the Dead zone).
   */
  _playDeceiverVoice() {
    if (this.state !== "PLAYING") return;

    const lines = CONFIG.DIALOGUE.DEAD_WARRIORS;
    const index = randInt(lines.length);
    const key = `DEAD_WARRIOR_${index}`;

    // Pan to the WRONG side (opposite of the real gap)
    const ring = this.world.rings[1];
    const realGapAngle = ring ? ring.currentGapAngle : 0;
    const wrongAngle = realGapAngle + Math.PI + randBetween(-0.4, 0.4);
    const wrongPan = Math.max(
      -0.85,
      Math.min(0.85, Math.sin(wrongAngle) * 0.9),
    );

    const buf = ElevenLabs.getSpeech(key);
    if (buf) {
      AudioManager.play(buf, { volume: 0.38, pan: wrongPan });
    } else {
      AudioManager.playSynthDialogue("DECEIVER");
    }
    // No UI dialogue for deceivers — they are heard, not read
  }

  // ─── Outro sequence ────────────────────────────────────────────────────────

  /**
   * Play the ending sequence after the conversation.
   */
  async _playOutro() {
    this.state = "OUTRO";

    AudioManager.stopAllLoops();

    // ── "You emerged." ────────────────────────────────────────────────────────
    UI.showOutro(CONFIG.DIALOGUE.OUTRO_LINE_1, "", 0);
    await UI.fadeFromBlack(2000);
    await sleep(3500);

    await UI.fadeToBlack(1800);
    await sleep(600);

    // ── "He was with you." ────────────────────────────────────────────────────
    UI.showOutro(CONFIG.DIALOGUE.OUTRO_LINE_2, "", 0);
    await UI.fadeFromBlack(2200);
    await sleep(3000);

    await UI.fadeToBlack(1600);
    await sleep(500);

    // ── Subhadra: "Beta." ──────────────────────────────────────────────────────
    const betaBuf = ElevenLabs.getSpeech("SUBHADRA_FINAL");
    if (betaBuf) {
      AudioManager.play(betaBuf, { volume: 1.0 });
    } else {
      AudioManager.playSynthDialogue("SUBHADRA");
    }

    UI.showOutro("Beta.", "", 0);
    await UI.fadeFromBlack(3000);
    await sleep(5000);

    await UI.fadeToBlack(2500);
    await sleep(800);

    // ── Final reflection text ──────────────────────────────────────────────────
    UI.showOutro(CONFIG.DIALOGUE.OUTRO_TEXT, CONFIG.DIALOGUE.OUTRO_SUBTEXT, 0);
    await UI.fadeFromBlack(3500);
  }

  // ─── Setup helpers ─────────────────────────────────────────────────────────

  /**
   * Resize the canvas to fill the browser window and update world centre.
   */
  _resizeCanvas() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.cx = this.canvas.width / 2;
    this.cy = this.canvas.height / 2;

    if (this.world) {
      this.world.updateCenter(this.cx, this.cy);
    }

    // Invalidate vignette cache (handled internally by Renderer)
  }

  /**
   * Attach the window resize listener.
   */
  _setupResize() {
    window.addEventListener("resize", () => {
      this._resizeCanvas();
    });
  }

  /**
   * Attach keyboard listeners for WASD and Arrow keys.
   */
  _setupKeys() {
    const isUp = (k) => k === "ArrowUp" || k === "w" || k === "W";
    const isDown = (k) => k === "ArrowDown" || k === "s" || k === "S";
    const isLeft = (k) => k === "ArrowLeft" || k === "a" || k === "A";
    const isRight = (k) => k === "ArrowRight" || k === "d" || k === "D";
    const isMove = (k) => isUp(k) || isDown(k) || isLeft(k) || isRight(k);

    window.addEventListener("keydown", (e) => {
      const isUp = e.key === "ArrowUp" || e.key === "w" || e.key === "W";
      const isDown = e.key === "ArrowDown" || e.key === "s" || e.key === "S";
      const isLeft = e.key === "ArrowLeft" || e.key === "a" || e.key === "A";
      const isRight = e.key === "ArrowRight" || e.key === "d" || e.key === "D";
      const isMove = isUp || isDown || isLeft || isRight;

      if (isMove) {
        e.preventDefault();
        AudioManager.resume();
        // If still in intro, skip it immediately
        if (this.state === "INTRO") {
          this._skipIntro();
          return;
        }
        if (isUp) this.keys.up = true;
        if (isDown) this.keys.down = true;
        if (isLeft) this.keys.left = true;
        if (isRight) this.keys.right = true;
      }
    });

    window.addEventListener("keyup", (e) => {
      if (isUp(e.key)) this.keys.up = false;
      if (isDown(e.key)) this.keys.down = false;
      if (isLeft(e.key)) this.keys.left = false;
      if (isRight(e.key)) this.keys.right = false;
    });

    // Lose focus: release all keys so player doesn't get stuck
    window.addEventListener("blur", () => {
      this.keys.up = this.keys.down = this.keys.left = this.keys.right = false;
    });
  }

  /** Skip the intro cinematic and go straight to gameplay. */
  _skipIntro() {
    if (this.state !== "INTRO") return;
    UI.hideDialogue();
    UI.setCinematicMode(false);
    UI.showHUD();
    UI.updateRingIndicator([], 4);
    UI.updateRingName(CONFIG.WORLD.RINGS[4].name);
    UI.updateItems(0, CONFIG.WORLD.ITEMS.length);
    this._startGameLoop();
    UI.fadeFromBlack(600);
  }
}
