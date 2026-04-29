/**
 * main.js — PADMAVYUH: VOICES OF DHARMA
 * ─────────────────────────────────────────────────────────────────────────────
 * Entry point.
 *
 * Responsibilities:
 *   • Wait for DOM ready
 *   • Show the title screen
 *   • Handle the "Begin" button: prompt for API key if absent, then boot Game
 *   • Wire the "Lead him home" button to Game.onConversationEnd()
 *   • Expose the Game instance on window (useful for browser-console debugging)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import Game   from './game.js';
import UI     from './ui.js';
import CONFIG from './config.js';

// ─── Boot ─────────────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {

  // ── Canvas ──────────────────────────────────────────────────────────────────
  const canvas = document.getElementById('gameCanvas');

  if (!canvas) {
    console.error('[main] <canvas id="gameCanvas"> not found in DOM.');
    return;
  }

  // ── Game instance ────────────────────────────────────────────────────────────
  const game = new Game(canvas);

  // Expose for debugging in the browser console
  window.__game = game;

  // ── Title screen ─────────────────────────────────────────────────────────────
  UI.showTitle();

  // ── "Begin" button ───────────────────────────────────────────────────────────
  const startBtn = document.getElementById('start-btn');

  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      // Resolve API key ─────────────────────────────────────────────────────────
      // Priority:
      //   1. Already set in config.js (developer filled it in)
      //   2. Stored in sessionStorage from a previous prompt this session
      //   3. Prompted from the player right now
      //   4. Player skips → silent / synth-audio mode

      if (!CONFIG.ELEVENLABS_API_KEY || !CONFIG.ELEVENLABS_API_KEY.trim()) {

        // Check sessionStorage so we don't re-prompt on hot-reloads
        const cached = sessionStorage.getItem('el_api_key');
        if (cached && cached.trim()) {
          CONFIG.ELEVENLABS_API_KEY = cached.trim();
        } else {
          const answer = window.prompt(
            'Enter your ElevenLabs API key to enable voice & sound effects.\n' +
            '(Get a free key at elevenlabs.io → Profile → API Keys)\n\n' +
            'Leave blank to play in silent mode — synth audio will be used instead.',
          );

          if (answer && answer.trim()) {
            CONFIG.ELEVENLABS_API_KEY = answer.trim();
            // Cache for the duration of this browser session
            try {
              sessionStorage.setItem('el_api_key', CONFIG.ELEVENLABS_API_KEY);
            } catch (_) {
              // sessionStorage blocked (e.g. private browsing with strict settings) — ignore
            }
          } else {
            // Player opted out — run in silent mode
            CONFIG.SILENT_MODE = true;
          }
        }
      }

      // Resolve Agent ID ────────────────────────────────────────────────────────
      // The Conversational AI climax requires an agent created at
      // elevenlabs.io/conversational-ai.  If not configured, the scripted
      // fallback conversation plays instead — the emotional arc is preserved.
      if (!CONFIG.AGENT_ID || !CONFIG.AGENT_ID.trim()) {
        const cachedAgent = sessionStorage.getItem('el_agent_id');
        if (cachedAgent && cachedAgent.trim()) {
          CONFIG.AGENT_ID = cachedAgent.trim();
        }
        // We don't prompt for the agent ID — the scripted fallback is seamless.
        // Developers who want live AI can set AGENT_ID in config.js directly.
      }

      // Boot ────────────────────────────────────────────────────────────────────
      try {
        await game.start();
      } catch (err) {
        console.error('[main] game.start() threw an unexpected error:', err);
        // Attempt graceful recovery: drop back to title
        UI.showTitle();
      }
    });
  } else {
    console.warn('[main] #start-btn not found — game cannot be started via UI.');
  }

  // ── "Lead him home" button ────────────────────────────────────────────────────
  // This button is revealed by ConversationManager once enough dialogue has
  // occurred.  Clicking it ends the conversation and triggers the outro.
  const endConvBtn = document.getElementById('end-conversation-btn');

  if (endConvBtn) {
    endConvBtn.addEventListener('click', async () => {
      try {
        await game.onConversationEnd();
      } catch (err) {
        console.error('[main] onConversationEnd() threw:', err);
      }
    });
  }

  // ── Global error handler ──────────────────────────────────────────────────────
  // Catch unhandled promise rejections so they surface clearly during development.
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[main] Unhandled promise rejection:', event.reason);
  });

  // ── Prevent default arrow-key scrolling on the page ──────────────────────────
  // (also handled per-key in Game._setupKeys, but belt-and-braces here)
  window.addEventListener('keydown', (e) => {
    const scrollKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '];
    if (scrollKeys.includes(e.key)) {
      e.preventDefault();
    }
  }, { passive: false });

});
