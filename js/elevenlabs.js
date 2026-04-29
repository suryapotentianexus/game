/**
 * elevenlabs.js — PADMAVYUH: VOICES OF DHARMA
 * ─────────────────────────────────────────────────────────────────────────────
 * ElevenLabs API wrapper — singleton.
 *
 * Responsibilities:
 *   • Text-to-Speech (TTS) via POST /v1/text-to-speech/{voice_id}
 *   • Sound Effect generation via POST /v1/sound-generation
 *   • Bulk preloader that runs at game startup with progress callbacks
 *   • In-memory AudioBuffer cache so each asset is only fetched once
 *   • Silent-mode fallback: when no API key is set (or a call fails) the
 *     game continues with no buffer — AudioManager's synth tones fill the gap
 *
 * Usage:
 *   import ElevenLabs from './elevenlabs.js';
 *   await ElevenLabs.preloadAll((current, total, label) => { ... });
 *   const buf = ElevenLabs.getSpeech('KRISHNA_INTRO');  // AudioBuffer | null
 *   const sfx = ElevenLabs.getSFX('chakra');            // AudioBuffer | null
 * ─────────────────────────────────────────────────────────────────────────────
 */

import CONFIG from './config.js';

// ─── ElevenLabs REST endpoints ────────────────────────────────────────────────

const BASE_URL           = 'https://api.elevenlabs.io/v1';
const TTS_URL            = (voiceId) => `${BASE_URL}/text-to-speech/${voiceId}`;
const SFX_URL            = `${BASE_URL}/sound-generation`;

// ─── Concurrency limiter ──────────────────────────────────────────────────────
// ElevenLabs free tier allows ~2 concurrent requests; starter allows more.
// We serialise calls in batches to stay within limits and respect rate caps.
const BATCH_SIZE = 2;

// ─── Retry settings ───────────────────────────────────────────────────────────
const MAX_RETRIES   = 2;
const RETRY_DELAY   = 1200; // ms between retries

// ─── ElevenLabs singleton ─────────────────────────────────────────────────────

class ElevenLabsManager {
  constructor() {
    /** @type {AudioContext|null} Set by init() */
    this._ctx = null;

    /** @type {string} ElevenLabs API key */
    this._apiKey = '';

    /** @type {boolean} */
    this._silentMode = false;

    /**
     * Speech cache: key → AudioBuffer | null
     * null = fetch was attempted but failed (game continues without audio)
     * @type {Map<string, AudioBuffer|null>}
     */
    this._speechCache = new Map();

    /**
     * SFX cache: key → AudioBuffer | null
     * @type {Map<string, AudioBuffer|null>}
     */
    this._sfxCache = new Map();

    /** Total assets attempted during preload (for progress reporting) */
    this._totalAssets  = 0;
    this._loadedAssets = 0;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Provide the AudioContext and API key before preloading.
   * Called by Game.start() after AudioManager.init().
   *
   * @param {string}       apiKey
   * @param {AudioContext} audioCtx
   */
  init(apiKey, audioCtx) {
    this._apiKey     = apiKey || '';
    this._ctx        = audioCtx;
    this._silentMode = CONFIG.SILENT_MODE || !apiKey;

    if (this._silentMode) {
      console.info('[ElevenLabs] Silent mode — skipping API calls, synth audio will be used.');
    }
  }

  // ─── Public cache accessors ──────────────────────────────────────────────────

  /**
   * Return a preloaded speech AudioBuffer by key, or null if unavailable.
   * @param {string} key
   * @returns {AudioBuffer|null}
   */
  getSpeech(key) {
    return this._speechCache.get(key) ?? null;
  }

  /**
   * Return a preloaded SFX AudioBuffer by key, or null if unavailable.
   * @param {string} key
   * @returns {AudioBuffer|null}
   */
  getSFX(key) {
    return this._sfxCache.get(key) ?? null;
  }

  // ─── Bulk preloader ──────────────────────────────────────────────────────────

  /**
   * Preload all game audio assets.
   *
   * Builds a manifest of every TTS line and SFX prompt, then fetches them
   * in small parallel batches (to respect rate limits) while reporting
   * progress via the callback.
   *
   * In silent mode the function resolves immediately after a brief artificial
   * delay so the loading screen renders at least one frame.
   *
   * @param {function(current: number, total: number, label: string): void} onProgress
   * @returns {Promise<void>}
   */
  async preloadAll(onProgress = () => {}) {
    // ── Build manifest ────────────────────────────────────────────────────────
    const manifest = this._buildManifest();
    this._totalAssets  = manifest.length;
    this._loadedAssets = 0;

    onProgress(0, this._totalAssets, 'Preparing…');

    if (this._silentMode || !this._apiKey) {
      // Simulate brief loading so the UI isn't jarring.
      for (let i = 0; i < this._totalAssets; i++) {
        await _sleep(18);
        onProgress(i + 1, this._totalAssets, manifest[i]?.label ?? '…');
      }
      return;
    }

    // ── Fetch in batches ──────────────────────────────────────────────────────
    for (let i = 0; i < manifest.length; i += BATCH_SIZE) {
      const batch = manifest.slice(i, i + BATCH_SIZE);

      await Promise.all(batch.map(async (task) => {
        let buffer = null;
        try {
          buffer = task.type === 'speech'
            ? await this._fetchSpeech(task.text, task.voiceId, task.voiceSettings)
            : await this._fetchSFX(task.prompt, task.duration);
        } catch (err) {
          console.warn(`[ElevenLabs] Failed to load "${task.label}": ${err.message}`);
        }

        // Store result (null = failed, game continues without this audio).
        if (task.type === 'speech') {
          this._speechCache.set(task.key, buffer);
        } else {
          this._sfxCache.set(task.key, buffer);
        }

        this._loadedAssets++;
        onProgress(this._loadedAssets, this._totalAssets, task.label);
      }));

      // Small pause between batches to avoid hitting rate limits.
      if (i + BATCH_SIZE < manifest.length) {
        await _sleep(200);
      }
    }
  }

  // ─── On-demand generation ────────────────────────────────────────────────────

  /**
   * Generate a single TTS line on demand and return an AudioBuffer.
   * Useful for dynamic lines that weren't known at preload time.
   *
   * Results are cached using `cacheKey` so repeated calls are free.
   *
   * @param {string} text
   * @param {string} voiceId
   * @param {object} [voiceSettings]
   * @param {string} [cacheKey]   – optional key to cache the result under
   * @returns {Promise<AudioBuffer|null>}
   */
  async generateSpeech(text, voiceId, voiceSettings, cacheKey) {
    if (this._silentMode || !this._apiKey) return null;
    if (cacheKey && this._speechCache.has(cacheKey)) {
      return this._speechCache.get(cacheKey);
    }
    try {
      const buffer = await this._fetchSpeech(text, voiceId, voiceSettings);
      if (cacheKey) this._speechCache.set(cacheKey, buffer);
      return buffer;
    } catch (err) {
      console.warn('[ElevenLabs] generateSpeech failed:', err.message);
      return null;
    }
  }

  /**
   * Generate a single SFX on demand and return an AudioBuffer.
   *
   * @param {string} prompt
   * @param {number} [durationSeconds=3]
   * @param {string} [cacheKey]
   * @returns {Promise<AudioBuffer|null>}
   */
  async generateSFX(prompt, durationSeconds = 3, cacheKey) {
    if (this._silentMode || !this._apiKey) return null;
    if (cacheKey && this._sfxCache.has(cacheKey)) {
      return this._sfxCache.get(cacheKey);
    }
    try {
      const buffer = await this._fetchSFX(prompt, durationSeconds);
      if (cacheKey) this._sfxCache.set(cacheKey, buffer);
      return buffer;
    } catch (err) {
      console.warn('[ElevenLabs] generateSFX failed:', err.message);
      return null;
    }
  }

  // ─── Private — HTTP helpers ──────────────────────────────────────────────────

  /**
   * Fetch a TTS audio buffer from ElevenLabs.
   *
   * @param {string} text
   * @param {string} voiceId
   * @param {object} [voiceSettings]
   * @returns {Promise<AudioBuffer>}
   */
  async _fetchSpeech(text, voiceId, voiceSettings) {
    const settings = voiceSettings ?? CONFIG.VOICE_SETTINGS.KRISHNA;

    const body = JSON.stringify({
      text,
      model_id: CONFIG.TTS_MODEL,
      voice_settings: {
        stability:         settings.stability         ?? 0.7,
        similarity_boost:  settings.similarity_boost  ?? 0.8,
        style:             settings.style             ?? 0.0,
        use_speaker_boost: settings.use_speaker_boost ?? true,
      },
    });

    return this._fetchAudio(TTS_URL(voiceId), {
      method: 'POST',
      headers: {
        'xi-api-key':    this._apiKey,
        'Content-Type':  'application/json',
        'Accept':        'audio/mpeg',
      },
      body,
    });
  }

  /**
   * Fetch a generated SFX audio buffer from ElevenLabs.
   *
   * @param {string} prompt
   * @param {number} durationSeconds
   * @returns {Promise<AudioBuffer>}
   */
  async _fetchSFX(prompt, durationSeconds = 3) {
    const body = JSON.stringify({
      text:              prompt,
      duration_seconds:  Math.min(22, Math.max(0.5, durationSeconds)),
      prompt_influence:  0.35,
    });

    return this._fetchAudio(SFX_URL, {
      method: 'POST',
      headers: {
        'xi-api-key':   this._apiKey,
        'Content-Type': 'application/json',
        'Accept':       'audio/mpeg',
      },
      body,
    });
  }

  /**
   * Core fetch + decode helper with retry logic.
   *
   * @param {string}      url
   * @param {RequestInit} fetchOptions
   * @returns {Promise<AudioBuffer>}
   */
  async _fetchAudio(url, fetchOptions) {
    let lastErr;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await _sleep(RETRY_DELAY * attempt);
      }

      try {
        const response = await fetch(url, fetchOptions);

        if (!response.ok) {
          const errText = await response.text().catch(() => response.statusText);
          // 429 = rate limit — always worth retrying
          if (response.status === 429) {
            lastErr = new Error(`Rate limited (429): ${errText}`);
            continue;
          }
          // 401/403 = bad API key — no point retrying
          if (response.status === 401 || response.status === 403) {
            throw new Error(`Auth error (${response.status}): check your ELEVENLABS_API_KEY in config.js`);
          }
          throw new Error(`HTTP ${response.status}: ${errText}`);
        }

        const arrayBuffer = await response.arrayBuffer();

        if (!arrayBuffer || arrayBuffer.byteLength === 0) {
          throw new Error('Empty audio response received');
        }

        if (!this._ctx) {
          throw new Error('AudioContext not initialised — call ElevenLabs.init() first');
        }

        // decodeAudioData is Promise-based in modern browsers.
        const audioBuffer = await this._ctx.decodeAudioData(arrayBuffer.slice(0));
        return audioBuffer;

      } catch (err) {
        lastErr = err;
        // Non-retryable errors bubble immediately
        if (err.message.startsWith('Auth error') ||
            err.message.startsWith('AudioContext')) {
          throw err;
        }
      }
    }

    throw lastErr ?? new Error('Unknown fetch error');
  }

  // ─── Private — manifest builder ──────────────────────────────────────────────

  /**
   * Build the full list of audio assets to preload.
   *
   * Returns an array of task objects:
   *   { type: 'speech'|'sfx', key, label, ... }
   *
   * The order is:
   *   1. Critical story beats (Subhadra, Krishna intro, Abhimanyu calls)
   *   2. Gameplay voice lines (navigation, items, ring entries)
   *   3. Item SFX loops
   *   4. General SFX stings
   *
   * @returns {object[]}
   */
  _buildManifest() {
    const D = CONFIG.DIALOGUE;
    const V = CONFIG.VOICES;
    const VS = CONFIG.VOICE_SETTINGS;

    const manifest = [];

    // ── 1. Critical narrative speech ──────────────────────────────────────────

    manifest.push({
      type: 'speech', key: 'SUBHADRA_OPENING',
      label: 'Subhadra — opening',
      text: D.SUBHADRA_OPENING,
      voiceId: V.SUBHADRA, voiceSettings: VS.SUBHADRA,
    });

    manifest.push({
      type: 'speech', key: 'KRISHNA_INTRO',
      label: 'Krishna — introduction',
      text: D.KRISHNA_INTRO,
      voiceId: V.KRISHNA, voiceSettings: VS.KRISHNA,
    });

    // Abhimanyu's calls (spatial audio from the maze centre)
    D.ABHIMANYU_CALLS.forEach((text, i) => {
      manifest.push({
        type: 'speech', key: `ABHIMANYU_${i}`,
        label: `Abhimanyu — call ${i + 1}`,
        text,
        voiceId: V.ABHIMANYU, voiceSettings: VS.ABHIMANYU,
      });
    });

    // ── 2. Krishna navigation hints ───────────────────────────────────────────

    manifest.push({
      type: 'speech', key: 'KRISHNA_NAVIGATE_CW',
      label: 'Krishna — turn right',
      text: D.KRISHNA_NAVIGATE_CW,
      voiceId: V.KRISHNA, voiceSettings: VS.KRISHNA,
    });

    manifest.push({
      type: 'speech', key: 'KRISHNA_NAVIGATE_CCW',
      label: 'Krishna — turn left',
      text: D.KRISHNA_NAVIGATE_CCW,
      voiceId: V.KRISHNA, voiceSettings: VS.KRISHNA,
    });

    manifest.push({
      type: 'speech', key: 'KRISHNA_NAVIGATE_CLOSE',
      label: 'Krishna — passage close',
      text: D.KRISHNA_NAVIGATE_CLOSE,
      voiceId: V.KRISHNA, voiceSettings: VS.KRISHNA,
    });

    manifest.push({
      type: 'speech', key: 'KRISHNA_ITEM_NEARBY',
      label: 'Krishna — item nearby',
      text: D.KRISHNA_ITEM_NEARBY,
      voiceId: V.KRISHNA, voiceSettings: VS.KRISHNA,
    });

    manifest.push({
      type: 'speech', key: 'KRISHNA_ITEM_COLLECTED',
      label: 'Krishna — item collected',
      text: D.KRISHNA_ITEM_COLLECTED,
      voiceId: V.KRISHNA, voiceSettings: VS.KRISHNA,
    });

    // ── 3. Ring-specific Krishna entry lines (first line of each ring) ────────

    CONFIG.WORLD.RINGS.forEach((ring, i) => {
      if (ring.krishnaLines && ring.krishnaLines.length > 0) {
        manifest.push({
          type: 'speech', key: `KRISHNA_RING_${i}_0`,
          label: `Krishna — ring ${i} entry`,
          text: ring.krishnaLines[0],
          voiceId: V.KRISHNA, voiceSettings: VS.KRISHNA,
        });
        // Preload second line too if available
        if (ring.krishnaLines[1]) {
          manifest.push({
            type: 'speech', key: `KRISHNA_RING_${i}_1`,
            label: `Krishna — ring ${i} hint`,
            text: ring.krishnaLines[1],
            voiceId: V.KRISHNA, voiceSettings: VS.KRISHNA,
          });
        }
      }
    });

    // ── 4. Stillness ring breach ───────────────────────────────────────────────

    manifest.push({
      type: 'speech', key: 'STILLNESS_BREACH',
      label: 'Krishna — stillness breach',
      text: D.STILLNESS_BREACH,
      voiceId: V.KRISHNA, voiceSettings: {
        ...VS.KRISHNA,
        stability: 0.90,   // more measured and deliberate
        style: 0.05,
      },
    });

    // ── 5. Deception ring — dead warriors ────────────────────────────────────

    D.DEAD_WARRIORS.forEach((text, i) => {
      manifest.push({
        type: 'speech', key: `DEAD_WARRIOR_${i}`,
        label: `Dead warrior — voice ${i + 1}`,
        text,
        voiceId: V.DECEIVER, voiceSettings: VS.DECEIVER,
      });
    });

    // ── 6. Centre / win ────────────────────────────────────────────────────────

    manifest.push({
      type: 'speech', key: 'GAME_WIN_KRISHNA',
      label: 'Krishna — you found him',
      text: D.GAME_WIN_KRISHNA,
      voiceId: V.KRISHNA, voiceSettings: VS.KRISHNA,
    });

    // ── 7. Outro ──────────────────────────────────────────────────────────────

    manifest.push({
      type: 'speech', key: 'SUBHADRA_FINAL',
      label: 'Subhadra — Beta',
      text: D.SUBHADRA_FINAL,
      voiceId: V.SUBHADRA, voiceSettings: {
        ...VS.SUBHADRA,
        stability: 0.55,
        style: 0.40,  // maximum emotion on the single word "Beta"
      },
    });

    // ── 8. Item SFX loops ─────────────────────────────────────────────────────

    CONFIG.WORLD.ITEMS.forEach((item) => {
      manifest.push({
        type: 'sfx', key: item.id,
        label: `SFX — ${item.name}`,
        prompt: item.sfxPrompt,
        duration: item.sfxDuration,
      });
    });

    // ── 9. General SFX stings ─────────────────────────────────────────────────

    Object.entries(CONFIG.SFX_PROMPTS).forEach(([key, prompt]) => {
      manifest.push({
        type: 'sfx', key,
        label: `SFX — ${key}`,
        prompt,
        duration: key === 'GAME_WIN' ? 5 : 3,
      });
    });

    return manifest;
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

/**
 * Promise-based setTimeout.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Export singleton ─────────────────────────────────────────────────────────

const ElevenLabs = new ElevenLabsManager();
export default ElevenLabs;
