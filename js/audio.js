/**
 * audio.js — PADMAVYUH: VOICES OF DHARMA
 * ─────────────────────────────────────────────────────────────────────────────
 * AudioManager — singleton Web Audio API wrapper.
 *
 * Responsibilities:
 *   • One-shot playback of AudioBuffers (dialogue, SFX stings)
 *   • Looping ambient sound sources (item signatures, background drone)
 *   • Spatial stereo panning + volume falloff by world-space distance
 *   • Smooth gain transitions (no clicks/pops)
 *   • Synth-fallback tone generator used when ElevenLabs audio is unavailable
 *   • Master-volume control + mute toggle
 *
 * Usage:
 *   import AudioManager from './audio.js';
 *   AudioManager.init();
 *   AudioManager.play(buffer, { pan: 0.3, volume: 0.8 });
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Tuning constants ─────────────────────────────────────────────────────────

/** Gain ramp duration (seconds) used for smooth start/stop of loops */
const RAMP_TIME        = 0.08;

/** Gain ramp duration for long, graceful fade-outs (e.g. item collected) */
const FADE_OUT_TIME    = 0.6;

/** Default master volume */
const DEFAULT_MASTER   = 0.9;

// ─── Synth fallback frequencies per item id ────────────────────────────────
// When ElevenLabs SFX is unavailable these oscillator pitches are used so the
// game is still playable purely from synthesised audio.
const SYNTH_ITEM_FREQ = {
  conch:     220.0,   // A3  — low, breathy conch quality
  armor:     180.0,   // slightly below A3 — metallic rattle feel
  gandiva:   440.0,   // A4  — bright, bow-string twang quality
  blessings: 528.0,   // C5-ish — "healing" frequency
  chakra:    963.0,   // B5  — high, cosmic spinning quality
};

// Synth waveforms per item
const SYNTH_ITEM_WAVE = {
  conch:     'sine',
  armor:     'sawtooth',
  gandiva:   'triangle',
  blessings: 'sine',
  chakra:    'sine',
};

// Generic fallback for items not in the map
const SYNTH_DEFAULT_FREQ = 330;
const SYNTH_DEFAULT_WAVE = 'sine';

// ─── AudioManager ─────────────────────────────────────────────────────────────

class AudioManager {
  constructor() {
    /** @type {AudioContext|null} */
    this.ctx = null;

    /** @type {GainNode|null} Master output gain */
    this.masterGain = null;

    /**
     * Active loops keyed by an arbitrary string id.
     * Each entry: { source: AudioBufferSourceNode|OscillatorNode,
     *               gainNode: GainNode,
     *               panNode: StereoPannerNode,
     *               isSynth: boolean }
     */
    this._loops = {};

    /** Whether the context has been initialised */
    this._ready = false;

    /** Muted state */
    this._muted = false;

    /** Stored master volume so mute/unmute can restore it */
    this._masterVolume = DEFAULT_MASTER;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Create the AudioContext and master gain chain.
   * Must be called from a user-gesture handler (e.g. the "Begin" button click)
   * to satisfy browser autoplay policies.
   */
  init() {
    if (this._ready) return;

    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      console.warn('[AudioManager] Web Audio API not supported in this browser.');
      return;
    }

    this.ctx = new Ctx();

    // Master gain → destination
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this._masterVolume;
    this.masterGain.connect(this.ctx.destination);

    this._ready = true;
    console.log('[AudioManager] Initialised. Sample rate:', this.ctx.sampleRate);
  }

  /**
   * Resume a suspended AudioContext.
   * Browsers suspend the context until a user gesture occurs; call this
   * inside any interaction handler to ensure audio can play.
   */
  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  /** Returns true if the AudioManager is ready to play audio. */
  get isReady() {
    return this._ready && this.ctx !== null;
  }

  // ─── One-shot playback ───────────────────────────────────────────────────────

  /**
   * Play an AudioBuffer once (non-looping).
   *
   * @param {AudioBuffer} buffer            – decoded audio to play
   * @param {object}      [opts]
   * @param {number}      [opts.pan=0]      – stereo pan, −1 (left) … +1 (right)
   * @param {number}      [opts.volume=1]   – gain multiplier 0…1
   * @param {number}      [opts.rate=1]     – playback rate (1 = normal)
   * @param {number}      [opts.startTime]  – AudioContext time to start (default: now)
   * @returns {AudioBufferSourceNode|null}
   */
  play(buffer, { pan = 0, volume = 1, rate = 1, startTime } = {}) {
    if (!this._ready || !buffer) return null;
    this.resume();

    const source = this.ctx.createBufferSource();
    source.buffer          = buffer;
    source.playbackRate.value = rate;

    const gainNode = this._makeGain(volume);
    const panNode  = this._makePan(pan);

    source.connect(panNode);
    panNode.connect(gainNode);
    gainNode.connect(this.masterGain);

    source.start(startTime !== undefined ? startTime : this.ctx.currentTime);

    return source;
  }

  /**
   * Play an AudioBuffer with spatial positioning derived from world coordinates.
   *
   * @param {AudioBuffer} buffer
   * @param {number} sourceX   – world X of the sound source
   * @param {number} sourceY   – world Y of the sound source
   * @param {number} playerX   – listener X
   * @param {number} playerY   – listener Y
   * @param {object} [opts]
   * @param {number} [opts.maxDist=420]  – max audible distance (pixels)
   * @param {number} [opts.baseVolume=1] – scale applied before distance falloff
   * @param {number} [opts.listenerAngle=0] – player facing angle for head-relative pan
   * @returns {AudioBufferSourceNode|null}
   */
  playSpatial(buffer, sourceX, sourceY, playerX, playerY, {
    maxDist       = 420,
    baseVolume    = 1,
    listenerAngle = 0,
  } = {}) {
    if (!this._ready || !buffer) return null;

    const { pan, volume } = this._spatialParams(
      sourceX, sourceY, playerX, playerY, maxDist, listenerAngle,
    );
    if (volume <= 0) return null;

    return this.play(buffer, { pan, volume: volume * baseVolume });
  }

  // ─── Looping sources ─────────────────────────────────────────────────────────

  /**
   * Start a looping AudioBuffer sound identified by `id`.
   * If a loop with the same id is already running it is stopped first.
   *
   * @param {string}      id
   * @param {AudioBuffer} buffer
   * @param {object}      [opts]
   * @param {number}      [opts.pan=0]
   * @param {number}      [opts.volume=0]   – start silent; update with updateLoopSpatial
   */
  startLoop(id, buffer, { pan = 0, volume = 0 } = {}) {
    if (!this._ready || !buffer) return;
    this.stopLoop(id);
    this.resume();

    const source  = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop   = true;

    const gainNode = this._makeGain(volume);
    const panNode  = this._makePan(pan);

    source.connect(panNode);
    panNode.connect(gainNode);
    gainNode.connect(this.masterGain);

    source.start();

    this._loops[id] = { source, gainNode, panNode, isSynth: false };
  }

  /**
   * Start a looping synthesised oscillator tone (fallback when no buffer).
   * The oscillator runs indefinitely until stopLoop(id) is called.
   *
   * @param {string} id
   * @param {object} [opts]
   * @param {number} [opts.frequency=330]   – Hz
   * @param {string} [opts.wave='sine']     – OscillatorType
   * @param {number} [opts.pan=0]
   * @param {number} [opts.volume=0]
   */
  startSynthLoop(id, { frequency = SYNTH_DEFAULT_FREQ, wave = SYNTH_DEFAULT_WAVE, pan = 0, volume = 0 } = {}) {
    if (!this._ready) return;
    this.stopLoop(id);
    this.resume();

    const osc = this.ctx.createOscillator();
    osc.type            = wave;
    osc.frequency.value = frequency;

    // Add subtle tremolo via a second LFO so the tone feels organic.
    const lfo      = this.ctx.createOscillator();
    const lfoGain  = this.ctx.createGain();
    lfo.frequency.value   = 3.5 + Math.random() * 2; // 3.5–5.5 Hz tremolo
    lfoGain.gain.value    = frequency * 0.012;         // ±1.2% pitch wobble
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    lfo.start();

    const gainNode = this._makeGain(volume);
    const panNode  = this._makePan(pan);

    osc.connect(panNode);
    panNode.connect(gainNode);
    gainNode.connect(this.masterGain);

    osc.start();

    // Store lfo reference so we can stop it too.
    this._loops[id] = { source: osc, gainNode, panNode, isSynth: true, _lfo: lfo };
  }

  /**
   * Start a loop for an item by id, automatically choosing a real buffer
   * (if provided) or falling back to a synthesised tone.
   *
   * @param {string}           itemId
   * @param {AudioBuffer|null} buffer   – pass null to use synth fallback
   * @param {object}           [opts]
   */
  startItemLoop(itemId, buffer, opts = {}) {
    if (buffer) {
      this.startLoop(itemId, buffer, opts);
    } else {
      this.startSynthLoop(itemId, {
        frequency: SYNTH_ITEM_FREQ[itemId] ?? SYNTH_DEFAULT_FREQ,
        wave:      SYNTH_ITEM_WAVE[itemId] ?? SYNTH_DEFAULT_WAVE,
        ...opts,
      });
    }
  }

  /**
   * Smoothly update the pan and volume of a running loop using world-space
   * coordinates.  Safe to call every frame.
   *
   * @param {string} id
   * @param {number} sourceX
   * @param {number} sourceY
   * @param {number} playerX
   * @param {number} playerY
   * @param {number} [maxDist=420]
   * @param {number} [baseVolume=0.55]
   * @param {number} [listenerAngle=0]
   */
  updateLoopSpatial(id, sourceX, sourceY, playerX, playerY,
    maxDist = 420, baseVolume = 0.55, listenerAngle = 0,
  ) {
    const loop = this._loops[id];
    if (!loop) return;

    const { pan, volume } = this._spatialParams(
      sourceX, sourceY, playerX, playerY, maxDist, listenerAngle,
    );

    this._smoothGain(loop.gainNode, volume * baseVolume);
    this._smoothPan(loop.panNode, pan);
  }

  /**
   * Directly set the volume of a loop (no spatial calculation).
   *
   * @param {string} id
   * @param {number} volume  – 0…1
   */
  setLoopVolume(id, volume) {
    const loop = this._loops[id];
    if (!loop) return;
    this._smoothGain(loop.gainNode, volume);
  }

  /**
   * Fade a loop out over FADE_OUT_TIME seconds, then stop and remove it.
   *
   * @param {string} id
   */
  fadeOutLoop(id) {
    const loop = this._loops[id];
    if (!loop) return;

    const { gainNode } = loop;
    const now = this.ctx.currentTime;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(gainNode.gain.value, now);
    gainNode.gain.linearRampToValueAtTime(0, now + FADE_OUT_TIME);

    setTimeout(() => this.stopLoop(id), (FADE_OUT_TIME + 0.1) * 1000);
  }

  /**
   * Immediately stop and remove a loop.
   *
   * @param {string} id
   */
  stopLoop(id) {
    const loop = this._loops[id];
    if (!loop) return;

    try { loop.source.stop(); } catch (_) { /* already stopped */ }
    if (loop._lfo) {
      try { loop._lfo.stop(); } catch (_) { /* already stopped */ }
    }

    delete this._loops[id];
  }

  /**
   * Stop and remove all active loops.
   */
  stopAllLoops() {
    for (const id of Object.keys(this._loops)) {
      this.stopLoop(id);
    }
  }

  // ─── Synth fallback — one-shot tones ─────────────────────────────────────────

  /**
   * Play a short synthesised "ping" tone — used as a fallback click/confirm
   * sound when no real audio buffer is available.
   *
   * @param {number} [frequency=660]
   * @param {number} [duration=0.3]   – seconds
   * @param {number} [volume=0.4]
   * @param {number} [pan=0]
   */
  playSynthTone(frequency = 660, duration = 0.3, volume = 0.4, pan = 0) {
    if (!this._ready) return;
    this.resume();

    const osc      = this.ctx.createOscillator();
    const gainNode = this._makeGain(0);
    const panNode  = this._makePan(pan);
    const now      = this.ctx.currentTime;

    osc.type            = 'sine';
    osc.frequency.value = frequency;

    osc.connect(panNode);
    panNode.connect(gainNode);
    gainNode.connect(this.masterGain);

    // Attack → sustain → release envelope
    gainNode.gain.linearRampToValueAtTime(volume,   now + 0.01);
    gainNode.gain.setValueAtTime(volume,            now + duration * 0.6);
    gainNode.gain.linearRampToValueAtTime(0,        now + duration);

    osc.start(now);
    osc.stop(now + duration + 0.05);
  }

  /**
   * Play a synth fallback voice-line indicator — a short ascending phrase to
   * signal that dialogue is being "spoken" even without real TTS audio.
   *
   * @param {string} character  – 'KRISHNA' | 'ABHIMANYU' | 'SUBHADRA' | 'DECEIVER'
   */
  playSynthDialogue(character) {
    if (!this._ready) return;
    const profiles = {
      KRISHNA:   { notes: [293, 329, 392], dur: 0.18, vol: 0.25, wave: 'sine'     },
      ABHIMANYU: { notes: [440, 392, 349], dur: 0.16, vol: 0.22, wave: 'triangle' },
      SUBHADRA:  { notes: [523, 587, 523], dur: 0.20, vol: 0.22, wave: 'sine'     },
      DECEIVER:  { notes: [220, 196, 165], dur: 0.22, vol: 0.18, wave: 'sawtooth' },
    };
    const p = profiles[character] ?? profiles.KRISHNA;
    let delay = 0;
    for (const freq of p.notes) {
      setTimeout(() => this.playSynthTone(freq, p.dur, p.vol), delay * 1000);
      delay += p.dur * 0.9;
    }
  }

  // ─── Master volume ────────────────────────────────────────────────────────────

  /**
   * Set master volume (0…1).
   * @param {number} v
   */
  setMasterVolume(v) {
    this._masterVolume = Math.max(0, Math.min(1, v));
    if (this.masterGain && !this._muted) {
      this._smoothGain(this.masterGain, this._masterVolume);
    }
  }

  /** Toggle mute / unmute. */
  toggleMute() {
    this._muted = !this._muted;
    if (this.masterGain) {
      this._smoothGain(
        this.masterGain,
        this._muted ? 0 : this._masterVolume,
        0.15,
      );
    }
    return this._muted;
  }

  /** Returns true if currently muted. */
  get isMuted() { return this._muted; }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  /**
   * Create a GainNode connected to nothing yet.
   * @param {number} initialGain
   * @returns {GainNode}
   */
  _makeGain(initialGain) {
    const g = this.ctx.createGain();
    g.gain.value = Math.max(0, initialGain);
    return g;
  }

  /**
   * Create a StereoPannerNode.  Falls back gracefully on browsers that don't
   * support it by returning a do-nothing gain node.
   * @param {number} pan  – −1 … +1
   * @returns {AudioNode}
   */
  _makePan(pan) {
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      return p;
    }
    // Graceful fallback: just a pass-through gain node
    return this._makeGain(1);
  }

  /**
   * Schedule a smooth gain ramp to avoid zipper noise.
   * @param {GainNode} gainNode
   * @param {number}   targetValue
   * @param {number}   [rampTime=RAMP_TIME]  – seconds
   */
  _smoothGain(gainNode, targetValue, rampTime = RAMP_TIME) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const clamped = Math.max(0, Math.min(1, targetValue));
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(gainNode.gain.value, now);
    gainNode.gain.linearRampToValueAtTime(clamped, now + rampTime);
  }

  /**
   * Schedule a smooth pan ramp.
   * @param {AudioNode} panNode
   * @param {number}    targetPan  – −1 … +1
   */
  _smoothPan(panNode, targetPan) {
    if (!this.ctx || !panNode.pan) return; // fallback gain nodes have no .pan
    const now    = this.ctx.currentTime;
    const clamped = Math.max(-1, Math.min(1, targetPan));
    panNode.pan.cancelScheduledValues(now);
    panNode.pan.setValueAtTime(panNode.pan.value, now);
    panNode.pan.linearRampToValueAtTime(clamped, now + RAMP_TIME);
  }

  /**
   * Compute { pan, volume } for a source at world position (sx, sy)
   * heard by a listener at (px, py).
   *
   * Pan is head-relative (uses listenerAngle) — so "left" means to the
   * left of whichever direction the listener is facing.
   *
   * @param {number} sx
   * @param {number} sy
   * @param {number} px
   * @param {number} py
   * @param {number} maxDist
   * @param {number} listenerAngle  – radians
   * @returns {{ pan: number, volume: number }}
   */
  _spatialParams(sx, sy, px, py, maxDist, listenerAngle = 0) {
    const dx   = sx - px;
    const dy   = sy - py;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist >= maxDist) return { pan: 0, volume: 0 };

    // Angle from listener to source in world space
    const worldAngle = Math.atan2(dy, dx);

    // Head-relative angle: rotate by negative listenerAngle
    let relAngle = worldAngle - listenerAngle;
    // Normalise to (−π, π]
    while (relAngle >  Math.PI) relAngle -= 2 * Math.PI;
    while (relAngle <= -Math.PI) relAngle += 2 * Math.PI;

    // sin(relAngle) gives +1 for directly right, −1 for directly left
    const pan    = Math.max(-1, Math.min(1, Math.sin(relAngle)));

    // Linear falloff — squared falloff would be more physical but linear
    // sounds better for a game where audio IS the gameplay.
    const volume = 1 - dist / maxDist;

    return { pan, volume: Math.max(0, volume) };
  }
}

// ─── Export singleton ─────────────────────────────────────────────────────────

const audioManager = new AudioManager();
export default audioManager;
