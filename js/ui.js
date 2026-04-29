/**
 * ui.js — PADMAVYUH: VOICES OF DHARMA
 * ─────────────────────────────────────────────────────────────────────────────
 * ES Module UI Manager (singleton).
 * Handles every DOM interaction in the game: screens, dialogue, HUD,
 * cinematic bars, conversation UI, loading bar, fade overlays, etc.
 *
 * All elements referenced here are expected to exist in index.html.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Element references (resolved lazily after DOMContentLoaded) ──────────────

const el = {
  // Screens
  titleScreen: () => document.getElementById("title-screen"),
  loadingScreen: () => document.getElementById("loading-screen"),
  loadingBar: () => document.getElementById("loading-bar"),
  loadingText: () => document.querySelector("#loading-screen .loading-text"),
  loadingMessage: () => document.getElementById("loading-message"),
  conversationUI: () => document.getElementById("conversation-ui"),
  outroScreen: () => document.getElementById("outro-screen"),
  outroText: () => document.getElementById("outro-text"),
  outroSubtext: () => document.getElementById("outro-subtext"),

  // Cinematic bars
  cinematicTop: () => document.querySelector(".cinematic-bar.top"),
  cinematicBottom: () => document.querySelector(".cinematic-bar.bottom"),

  // Dialogue
  dialogueBox: () => document.getElementById("dialogue-box"),
  speakerName: () => document.getElementById("speaker-name"),
  dialogueText: () => document.getElementById("dialogue-text"),

  // HUD
  hud: () => document.getElementById("hud"),
  ringIndicator: () => document.getElementById("ring-indicator"),
  controlsHint: () => document.getElementById("controls-hint"),
  hudItems: () => document.getElementById("hud-items"),
  hudRingName: () => document.getElementById("hud-ring-name"),

  // Stillness warning
  stillnessWarning: () => document.getElementById("stillness-warning"),

  // Conversation
  abhimanyuLines: () => document.getElementById("abhimanyu-lines"),
  micStatusDot: () => document.getElementById("mic-status-dot"),
  micStatusText: () => document.getElementById("mic-status-text"),
  endConvBtn: () => document.getElementById("end-conversation-btn"),
};

// ─── Internal state ───────────────────────────────────────────────────────────

let _dialogueTimeout = null; // Timer handle for auto-hide dialogue
let _fadeOverlay = null; // The black-overlay div used for fade transitions
let _ringDots = []; // Cached list of ring dot elements

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Add one or more CSS classes to an element.
 */
function addClass(elem, ...classes) {
  if (elem) elem.classList.add(...classes);
}

/**
 * Remove one or more CSS classes from an element.
 */
function removeClass(elem, ...classes) {
  if (elem) elem.classList.remove(...classes);
}

/**
 * Show an element by removing the 'hidden' class.
 */
function show(elem) {
  removeClass(elem, "hidden");
}

/**
 * Hide an element by adding the 'hidden' class.
 */
function hide(elem) {
  addClass(elem, "hidden");
}

/**
 * Build the five ring-dot elements inside #ring-indicator if they have not
 * been created yet, then cache them in _ringDots.
 */
function ensureRingDots() {
  const container = el.ringIndicator();
  if (!container) return;

  if (_ringDots.length === 0) {
    // Clear any placeholder content
    container.innerHTML = "";
    for (let i = 0; i < 5; i++) {
      const dot = document.createElement("span");
      dot.className = "ring-dot";
      dot.setAttribute("data-ring", i);
      container.appendChild(dot);
      _ringDots.push(dot);
    }
  }
}

/**
 * Ensure the black fade overlay exists in the DOM and return it.
 * The overlay sits above everything (z-index 9999).
 */
function ensureFadeOverlay() {
  if (!_fadeOverlay) {
    _fadeOverlay = document.createElement("div");
    _fadeOverlay.id = "fade-overlay";
    Object.assign(_fadeOverlay.style, {
      position: "fixed",
      inset: "0",
      background: "#000",
      opacity: "0",
      zIndex: "9999",
      pointerEvents: "none",
      transition: "opacity 0s", // overridden per call
    });
    document.body.appendChild(_fadeOverlay);
  }
  return _fadeOverlay;
}

// ─── Public UI Manager ────────────────────────────────────────────────────────

const UI = {
  // ── Title Screen ─────────────────────────────────────────────────────────

  /**
   * Make the title screen visible and hide everything else that might be
   * lingering from a previous state.
   */
  showTitle() {
    show(el.titleScreen());
    hide(el.loadingScreen());
    hide(el.conversationUI());
    hide(el.outroScreen());
    hide(el.dialogueBox());
    hide(el.hud());
    hide(el.ringIndicator());
    hide(el.controlsHint());
    hide(el.stillnessWarning());
  },

  // ── Loading Screen ───────────────────────────────────────────────────────

  /**
   * Transition from title → loading screen.
   * @param {number} steps - Total number of loading steps (used for bar math).
   */
  showLoading(steps) {
    hide(el.titleScreen());
    show(el.loadingScreen());

    // Reset loading bar to 0 %
    const bar = el.loadingBar();
    if (bar) bar.style.width = "0%";

    const txt = el.loadingText();
    if (txt) txt.textContent = "Summoning voices…";
  },

  /**
   * Advance the loading bar.
   * @param {number} current  - Current step index (0-based).
   * @param {number} total    - Total number of steps.
   * @param {string} message  - Optional status message to display.
   */
  updateLoading(current, total, message) {
    const bar = el.loadingBar();
    if (bar) {
      const pct =
        total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
      bar.style.width = `${pct}%`;
    }
    if (message) {
      // #loading-message is the smaller dynamic step text beneath the
      // static pulsing "Summoning voices…" label (.loading-text).
      const msgEl = el.loadingMessage();
      if (msgEl) msgEl.textContent = message;
    }
  },

  // ── Intro / Cinematic ────────────────────────────────────────────────────

  /**
   * Hide loading screen, activate cinematic bars, reveal the game canvas.
   * The actual intro narration is triggered externally (audio engine).
   */
  showIntro() {
    hide(el.loadingScreen());
    this.setCinematicMode(true);
  },

  /**
   * Toggle the cinematic letter-box bars at the top and bottom of the screen.
   * @param {boolean} active
   */
  setCinematicMode(active) {
    const top = el.cinematicTop();
    const bottom = el.cinematicBottom();
    if (active) {
      addClass(top, "active");
      addClass(bottom, "active");
    } else {
      removeClass(top, "active");
      removeClass(bottom, "active");
    }
  },

  // ── HUD ──────────────────────────────────────────────────────────────────

  /**
   * Show the heads-up display elements (ring indicator + controls hint).
   */
  showHUD() {
    show(el.hud());
    show(el.ringIndicator());
    show(el.controlsHint());
    ensureRingDots();
  },

  /**
   * Update which ring dots are filled / current / future.
   * @param {number[]} passedRings - Array of ring indices (0-4) already passed.
   * @param {number}   currentRing - Index of the ring the player is in right now.
   */
  updateRingIndicator(passedRings, currentRing) {
    ensureRingDots();
    _ringDots.forEach((dot, i) => {
      dot.classList.remove("passed", "current");
      if (passedRings.includes(i)) {
        dot.classList.add("passed");
      } else if (i === currentRing) {
        dot.classList.add("current");
      }
    });
  },

  /**
   * Update the item-count text in the HUD.
   * @param {number} count - Items collected so far.
   * @param {number} max   - Total items available.
   */
  updateItems(count, max) {
    const elem = el.hudItems();
    if (elem) elem.textContent = `${count} / ${max} relics`;
  },

  /**
   * Update the current ring name label in the HUD.
   * @param {string} name - Display name of the current ring.
   */
  updateRingName(name) {
    const elem = el.hudRingName();
    if (elem) elem.textContent = name;
  },

  // ── Dialogue Box ─────────────────────────────────────────────────────────

  /**
   * Display dialogue with an optional auto-hide after `duration` ms.
   * If a new dialogue is shown before the previous one expires, the old
   * timeout is cancelled.
   *
   * @param {string} speaker  - Character name (displayed in gold above text).
   * @param {string} text     - Dialogue body text.
   * @param {number} [duration] - If provided, auto-hides after this many ms.
   */
  showDialogue(speaker, text, duration) {
    // Cancel any pending auto-hide from a previous call
    if (_dialogueTimeout !== null) {
      clearTimeout(_dialogueTimeout);
      _dialogueTimeout = null;
    }

    const box = el.dialogueBox();
    const nameEl = el.speakerName();
    const textEl = el.dialogueText();

    if (nameEl) nameEl.textContent = speaker ? speaker.toUpperCase() : "";
    nameEl.dataset.char = speaker;
    box.dataset.speaker = speaker;
    if (textEl) textEl.textContent = text || "";

    if (box) {
      // Fade the box in via CSS opacity transition
      box.style.opacity = "0";
      show(box);
      // Allow the browser to register the display change before animating
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          box.style.opacity = "1";
        });
      });
    }

    if (duration && duration > 0) {
      _dialogueTimeout = setTimeout(() => this.hideDialogue(), duration);
    }
  },

  /**
   * Fade out and hide the dialogue box immediately.
   */
  hideDialogue() {
    if (_dialogueTimeout !== null) {
      clearTimeout(_dialogueTimeout);
      _dialogueTimeout = null;
    }

    const box = el.dialogueBox();
    if (!box) return;

    box.style.opacity = "0";
    // Wait for the CSS opacity transition to finish, then display:none
    const onTransitionEnd = () => {
      hide(box);
      box.removeEventListener("transitionend", onTransitionEnd);
    };
    box.addEventListener("transitionend", onTransitionEnd);
  },

  // ── Stillness Warning (Ring 3) ────────────────────────────────────────────

  /**
   * Show the pulsing "Be still. Breathe." overlay for the silent ring.
   */
  showStillnessWarning() {
    show(el.stillnessWarning());
  },

  /**
   * Remove the stillness warning.
   */
  hideStillnessWarning() {
    hide(el.stillnessWarning());
  },

  // ── Conversation UI (Climax) ──────────────────────────────────────────────

  /**
   * Swap into the full-screen conversation UI used during the Abhimanyu climax.
   * Hides the game HUD and cinematic bars so the conversation takes full focus.
   */
  showConversation() {
    this.setCinematicMode(false);
    hide(el.hud());
    hide(el.ringIndicator());
    hide(el.controlsHint());
    hide(el.dialogueBox());
    hide(el.stillnessWarning());

    // Clear previous conversation history
    const lines = el.abhimanyuLines();
    if (lines) lines.innerHTML = "";

    show(el.conversationUI());
  },

  /**
   * Append a line of dialogue to the scrollable conversation history.
   * @param {'player'|'abhimanyu'} speaker - Controls alignment & styling.
   * @param {string} text - The line of dialogue.
   */
  addConversationLine(speaker, text) {
    const container = el.abhimanyuLines();
    if (!container) return;

    const entry = document.createElement("div");
    entry.className = `conv-entry ${speaker}`;

    // Label
    // .conv-speaker matches the CSS selector `.conv-entry .conv-speaker`
    const label = document.createElement("span");
    label.className = "conv-speaker";
    label.textContent = speaker === "player" ? "Arjuna" : "Abhimanyu";

    // Text body
    const body = document.createElement("p");
    body.className = "conv-text";
    body.textContent = text;

    entry.appendChild(label);
    entry.appendChild(body);
    container.appendChild(entry);

    // Auto-scroll to reveal the newest line
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  },

  /**
   * Update the microphone status indicator.
   * @param {boolean} listening - true → green "Listening…", false → dim "Speak to Abhimanyu"
   */
  setMicStatus(listening) {
    const dot = el.micStatusDot();
    const text = el.micStatusText();

    if (dot) {
      dot.classList.toggle("listening", listening);
    }
    if (text) {
      text.textContent = listening ? "Listening…" : "Speak to Abhimanyu";
    }
  },

  /**
   * Reveal the "Lead him home →" button and attach a one-time click handler.
   * @param {Function} onClick - Callback fired when the user clicks the button.
   */
  showEndConversationButton(onClick) {
    const btn = el.endConvBtn();
    if (!btn) return;

    show(btn);

    // Attach once so repeat calls don't stack listeners
    const handler = () => {
      btn.removeEventListener("click", handler);
      if (typeof onClick === "function") onClick();
    };
    btn.addEventListener("click", handler);
  },

  // ── Outro Screen ─────────────────────────────────────────────────────────

  /**
   * Display the ending outro screen.
   * @param {string} mainText   - Large primary text (e.g. character name / epigraph).
   * @param {string} subText    - Smaller secondary text shown after a delay.
   * @param {number} [delay=2000] - Ms to wait before showing subText.
   */
  showOutro(mainText, subText, delay = 2000) {
    hide(el.conversationUI());
    hide(el.hud());
    hide(el.dialogueBox());

    const screen = el.outroScreen();
    const mainEl = el.outroText();
    const subEl = el.outroSubtext();

    if (mainEl) mainEl.textContent = mainText || "";
    if (subEl) {
      subEl.textContent = subText || "";
      subEl.style.opacity = "0";
    }

    show(screen);

    // Fade in the sub-text after the delay
    if (subEl) {
      setTimeout(() => {
        subEl.style.transition = "opacity 2s ease";
        subEl.style.opacity = "1";
      }, delay);
    }
  },

  // ── Screen Fades ─────────────────────────────────────────────────────────

  /**
   * Animate a full-screen fade to black, then invoke an optional callback.
   * @param {number}   duration  - Fade duration in milliseconds.
   * @param {Function} [callback] - Called once the fade is complete.
   */
  fadeToBlack(duration = 1000, callback) {
    const overlay = ensureFadeOverlay();
    overlay.style.pointerEvents = "all"; // block input during fade
    overlay.style.transition = `opacity ${duration}ms ease`;

    // Force reflow so the transition fires from 0 → 1
    overlay.style.opacity = "0";
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        overlay.style.opacity = "1";
      });
    });

    if (typeof callback === "function") {
      setTimeout(callback, duration);
    }
  },

  /**
   * Animate a fade from black back to the game view.
   * @param {number} duration - Fade duration in milliseconds.
   */
  fadeFromBlack(duration = 1000) {
    const overlay = ensureFadeOverlay();
    overlay.style.transition = `opacity ${duration}ms ease`;
    overlay.style.opacity = "0";

    setTimeout(() => {
      overlay.style.pointerEvents = "none"; // restore input
    }, duration);
  },
};

export default UI;
