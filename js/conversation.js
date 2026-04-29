/**
 * conversation.js — PADMAVYUH: VOICES OF DHARMA
 * ─────────────────────────────────────────────────────────────────────────────
 * ConversationManager — singleton.
 *
 * Manages the emotional climax of the game: Arjuna (the player, speaking into
 * their microphone) converses with Abhimanyu at the heart of the Padmavyuh.
 *
 * Two modes:
 *
 *   LIVE MODE   — Uses ElevenLabs Conversational AI (requires AGENT_ID in
 *                 config.js).  The ElevenLabs client SDK (loaded via CDN as a
 *                 UMD script) handles microphone capture, VAD, and streaming
 *                 audio output automatically.
 *
 *   SCRIPTED MODE — Fallback used when no AGENT_ID is configured, the SDK
 *                 fails to load, or the user denies microphone permission.
 *                 A pre-written script plays out with timed pauses, preserving
 *                 the full emotional arc without requiring API access.
 *
 * The manager communicates back to Game via callbacks set before start().
 * ─────────────────────────────────────────────────────────────────────────────
 */

import CONFIG from './config.js';
import UI     from './ui.js';

// ─── Scripted fallback conversation ──────────────────────────────────────────
//
// Each entry plays in sequence.  `delay` is milliseconds after the previous
// entry resolved (not from conversation start).
//
// speaker: 'abhimanyu' | 'player_prompt' | 'system'
//   • 'abhimanyu'     — Abhimanyu's line, shown left-aligned, warm
//   • 'player_prompt' — Gentle prompt shown to the real player (right, muted)
//   • 'system'        — Italicised stage-direction, centered, very muted

const SCRIPTED_LINES = [
  {
    speaker: 'abhimanyu',
    text:    'Who… who is there? I cannot see — the walls keep spinning…',
    delay:   1800,
  },
  {
    speaker: 'player_prompt',
    text:    '(Say his name. "Abhimanyu.")',
    delay:   3200,
  },
  {
    speaker: 'abhimanyu',
    text:    'That name… someone said my name. Who are you? Show yourself!',
    delay:   3500,
  },
  {
    speaker: 'player_prompt',
    text:    '(Tell him who you are. "I am your father. I am Arjuna.")',
    delay:   3500,
  },
  {
    speaker: 'abhimanyu',
    text:    'Pitashri…? No — that is not possible. You were outside. You could not enter.',
    delay:   3800,
  },
  {
    speaker: 'abhimanyu',
    text:    'But… your voice. I know your voice. Pitashri — is it truly you?',
    delay:   3500,
  },
  {
    speaker: 'player_prompt',
    text:    '(Tell him about his mother. "Your mother is waiting. Subhadra is waiting for you.")',
    delay:   4000,
  },
  {
    speaker: 'abhimanyu',
    text:    'Mataji…',
    delay:   2200,
  },
  {
    speaker: 'abhimanyu',
    text:    'She is alive. She is… waiting.',
    delay:   2800,
  },
  {
    speaker: 'abhimanyu',
    text:    'I think I can rise. I think — I can walk. Lead me out of here, Pitashri. Lead me home.',
    delay:   4000,
  },
  {
    speaker: 'system',
    text:    '— He rises. —',
    delay:   2500,
  },
];

// How many Abhimanyu responses must occur before the "Lead him home" button appears
const RESPONSES_TO_UNLOCK = 4;

// ─── ConversationManager ──────────────────────────────────────────────────────

class ConversationManager {
  constructor() {
    /** @type {object|null}  ElevenLabs Conversation session handle */
    this._session = null;

    /** @type {'idle'|'starting'|'live'|'scripted'|'ended'} */
    this._mode = 'idle';

    /** Count of Abhimanyu responses received (for unlock logic) */
    this._abhimanyuResponseCount = 0;

    /** Whether the "Lead him home" button has already been shown */
    this._unlockShown = false;

    /** Scripted-mode timeout handles (so we can cancel on stop()) */
    this._scriptedTimers = [];

    /** Callback invoked when conversation is ready for the player to end */
    this.onReadyToEnd = null;

    /** Callback invoked on any fatal error */
    this.onError = null;
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  /**
   * Start the conversation.
   *
   * Attempts live ElevenLabs Conversational AI first; falls back to the
   * scripted sequence if anything goes wrong.
   *
   * @returns {Promise<void>}
   */
  async start() {
    if (this._mode !== 'idle') {
      console.warn('[ConversationManager] start() called while already running.');
      return;
    }

    this._mode = 'starting';
    this._abhimanyuResponseCount = 0;
    this._unlockShown = false;
    this._scriptedTimers = [];

    UI.showConversation();

    // Brief pause before the first line so the screen transition settles.
    await _sleep(800);

    const hasAgentId  = Boolean(CONFIG.AGENT_ID && CONFIG.AGENT_ID.trim());
    const hasSilent   = Boolean(CONFIG.SILENT_MODE);
    const hasApiKey   = Boolean(CONFIG.ELEVENLABS_API_KEY && CONFIG.ELEVENLABS_API_KEY.trim());

    if (!hasSilent && hasAgentId && hasApiKey) {
      try {
        await this._startLive();
        return;
      } catch (err) {
        console.warn('[ConversationManager] Live mode failed, falling back to scripted:', err.message);
        // Clean up any partial session state before falling back.
        await this._cleanupSession();
      }
    } else {
      const reason = hasSilent
        ? 'silent mode'
        : !hasAgentId
          ? 'no AGENT_ID configured'
          : 'no API key';
      console.info(`[ConversationManager] Using scripted mode (${reason}).`);
    }

    await this._startScripted();
  }

  /**
   * End the conversation and release all resources.
   *
   * @returns {Promise<void>}
   */
  async stop() {
    if (this._mode === 'idle' || this._mode === 'ended') return;

    this._mode = 'ended';

    // Cancel any pending scripted timers.
    for (const handle of this._scriptedTimers) {
      clearTimeout(handle);
    }
    this._scriptedTimers = [];

    await this._cleanupSession();

    UI.setMicStatus(false);
  }

  /**
   * Returns true if the conversation is currently active (live or scripted).
   * @returns {boolean}
   */
  get isActive() {
    return this._mode === 'live' || this._mode === 'scripted';
  }

  // ─── Live mode ────────────────────────────────────────────────────────────────

  /**
   * Start a live ElevenLabs Conversational AI session.
   *
   * The ElevenLabs UMD client is expected at window.ElevenLabsClient
   * (loaded via the CDN <script> tag in index.html).
   *
   * @returns {Promise<void>}
   * @throws {Error} if the session cannot be established
   */
  async _startLive() {
    // ── Locate the SDK ────────────────────────────────────────────────────
    const SDK = this._resolveSDK();
    if (!SDK) {
      throw new Error('ElevenLabs client SDK not found on window.');
    }

    // ── Request microphone permission early so we can give a clear error ─
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (permErr) {
      throw new Error(`Microphone permission denied: ${permErr.message}`);
    }

    UI.setMicStatus(false); // waiting to connect
    UI.addConversationLine('system', '— Connecting… —');

    // ── Start the session ─────────────────────────────────────────────────
    this._session = await SDK.startSession({
      agentId: CONFIG.AGENT_ID,

      // ── Event handlers ──────────────────────────────────────────────────

      onConnect: ({ conversationId }) => {
        console.info('[ConversationManager] Connected. ID:', conversationId);
        this._mode = 'live';
        UI.setMicStatus(true);
        // Remove the connecting message and add Abhimanyu's opening.
        UI.addConversationLine('abhimanyu',
          'Who… who is there? The walls — they keep moving…');
        this._countAbhimanyuResponse();
      },

      onDisconnect: () => {
        console.info('[ConversationManager] Disconnected.');
        UI.setMicStatus(false);
        if (this._mode === 'live') {
          // Session ended unexpectedly — ensure unlock button is shown.
          this._maybeShowUnlock();
        }
      },

      onMessage: ({ message, source }) => {
        if (source === 'ai') {
          // Abhimanyu spoke
          UI.addConversationLine('abhimanyu', message);
          this._countAbhimanyuResponse();
        }
        // source === 'user' messages are the transcribed player speech
        if (source === 'user' && message && message.trim()) {
          UI.addConversationLine('player', message);
        }
      },

      onModeChange: ({ mode }) => {
        // mode.mode: 'listening' | 'speaking' | 'processing'
        if (mode && mode.mode) {
          UI.setMicStatus(mode.mode === 'listening');
        }
      },

      onError: (error, info) => {
        const msg = (error && error.message) ? error.message : String(error);
        console.error('[ConversationManager] Session error:', msg, info);
        UI.setMicStatus(false);

        // If the session hasn't even connected yet, propagate so we fall back.
        if (this._mode === 'starting') {
          throw new Error(`Session error before connect: ${msg}`);
        }

        // Already running — degrade gracefully rather than crashing.
        UI.addConversationLine('system',
          '— The connection falters. Words still reach him. —');
        this._maybeShowUnlock();

        if (typeof this.onError === 'function') {
          this.onError(msg);
        }
      },
    });
  }

  /**
   * Locate the ElevenLabs Conversation class from the UMD bundle.
   *
   * The CDN script may expose the API in slightly different shapes depending
   * on the package version.  We check all known locations.
   *
   * @returns {{ startSession: function }|null}
   */
  _resolveSDK() {
    const candidates = [
      window.ElevenLabsClient?.Conversation,
      window.ElevenLabs?.Conversation,
      window.Conversation,
      window.ElevenLabsClient,
    ];

    for (const candidate of candidates) {
      if (candidate && typeof candidate.startSession === 'function') {
        return candidate;
      }
    }

    return null;
  }

  /**
   * Clean up the ElevenLabs session handle.
   * @returns {Promise<void>}
   */
  async _cleanupSession() {
    if (!this._session) return;
    try {
      if (typeof this._session.endSession === 'function') {
        await this._session.endSession();
      } else if (typeof this._session.close === 'function') {
        await this._session.close();
      }
    } catch (_) {
      // Session may already be closed — ignore.
    }
    this._session = null;
  }

  // ─── Scripted mode ────────────────────────────────────────────────────────────

  /**
   * Play the scripted conversation sequence.
   * Lines appear with timed delays to simulate a real exchange.
   *
   * @returns {Promise<void>}
   */
  async _startScripted() {
    this._mode = 'scripted';

    // Show a note that this is the scripted experience.
    UI.setMicStatus(false);
    UI.addConversationLine('system',
      '— Speak to him. He hears something beyond silence. —');

    let cumulativeDelay = 500;

    for (let i = 0; i < SCRIPTED_LINES.length; i++) {
      const line = SCRIPTED_LINES[i];
      cumulativeDelay += line.delay;

      const handle = setTimeout(() => {
        // Guard: don't continue if stop() was called.
        if (this._mode === 'ended') return;

        UI.addConversationLine(line.speaker, line.text);

        if (line.speaker === 'abhimanyu') {
          this._countAbhimanyuResponse();
        }
      }, cumulativeDelay);

      this._scriptedTimers.push(handle);
    }

    // After all scripted lines have played, ensure the unlock button appears.
    const totalDuration = cumulativeDelay + 1500;
    const finalHandle = setTimeout(() => {
      if (this._mode !== 'ended') {
        this._maybeShowUnlock(true); // force = true
      }
    }, totalDuration);
    this._scriptedTimers.push(finalHandle);
  }

  // ─── Shared helpers ────────────────────────────────────────────────────────

  /**
   * Increment the Abhimanyu response counter and check whether to show
   * the "Lead him home" unlock button.
   */
  _countAbhimanyuResponse() {
    this._abhimanyuResponseCount++;
    if (this._abhimanyuResponseCount >= RESPONSES_TO_UNLOCK) {
      this._maybeShowUnlock();
    }
  }

  /**
   * Show the "Lead him home" button if it hasn't been shown already.
   *
   * @param {boolean} [force=false] – show regardless of response count
   */
  _maybeShowUnlock(force = false) {
    if (this._unlockShown) return;
    if (!force && this._abhimanyuResponseCount < RESPONSES_TO_UNLOCK) return;

    this._unlockShown = true;

    UI.showEndConversationButton(() => {
      // The click handler is wired up in main.js → game._onConversationEnd()
      // UI.showEndConversationButton calls the callback on click.
      // We don't need to do anything here — Game handles the transition.
    });

    if (typeof this.onReadyToEnd === 'function') {
      this.onReadyToEnd();
    }
  }
}

// ─── Utility ─────────────────────────────────────────────────────────────────

/**
 * Promise-based setTimeout.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Export singleton ─────────────────────────────────────────────────────────

const conversationManager = new ConversationManager();
export default conversationManager;
