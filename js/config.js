/**
 * config.js — PADMAVYUH: VOICES OF DHARMA
 * ─────────────────────────────────────────────────────────────────────────────
 * Central configuration. Edit ELEVENLABS_API_KEY and AGENT_ID before running.
 * Everything else is tuned for the hackathon demo but can be adjusted freely.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const CONFIG = {
  // ── ElevenLabs credentials ──────────────────────────────────────────────────
  // Get your free key at https://elevenlabs.io → Profile → API Keys
  ELEVENLABS_API_KEY: "sk_b2b529271b2deb2db528f82b50d81979de5a04e83920200c",

  // Create a Conversational AI agent at https://elevenlabs.io/conversational-ai
  // Paste the agent's System Prompt from ABHIMANYU_AGENT_SYSTEM_PROMPT below,
  // then copy the Agent ID here.
  AGENT_ID: "agent_6001kqakwmw4e6cv8nd5wj3vgp5p",

  // Set to true to skip ElevenLabs calls and run in text-only / synth-audio mode.
  // Useful for development without an API key.
  SILENT_MODE: false,

  // ── ElevenLabs voice IDs ────────────────────────────────────────────────────
  // These are public ElevenLabs pre-built voices. Swap for custom voice IDs
  // if you design voices in the ElevenLabs Voice Design tool.
  VOICES: {
    KRISHNA: "pNInz6obpgDQGcFmaJgB", // Adam  — deep, authoritative, calm
    ABHIMANYU: "IKne3meq5aSn9XLyUdCD", // Charlie — young, raw, emotional
    SUBHADRA: "EXAVITQu4vr4xnSDxMaL", // Bella  — warm, maternal, breaking
    DECEIVER: "VR6AewLTigWG4xSOukaG", // Arnold — hollow, echoing, untrustworthy
  },

  // Voice generation settings per character
  VOICE_SETTINGS: {
    KRISHNA: {
      stability: 0.75,
      similarity_boost: 0.85,
      style: 0.1,
      use_speaker_boost: true,
    },
    ABHIMANYU: {
      stability: 0.45, // more variation = more emotional instability
      similarity_boost: 0.8,
      style: 0.35,
      use_speaker_boost: true,
    },
    SUBHADRA: {
      stability: 0.6,
      similarity_boost: 0.85,
      style: 0.2,
      use_speaker_boost: true,
    },
    DECEIVER: {
      stability: 0.3,
      similarity_boost: 0.7,
      style: 0.5,
      use_speaker_boost: false,
    },
  },

  // ElevenLabs TTS model
  TTS_MODEL: "eleven_multilingual_v2",

  // ── World geometry ──────────────────────────────────────────────────────────
  WORLD: {
    // Rings are ordered innermost → outermost (index 0 = innermost).
    // The player starts OUTSIDE ring[4] and must navigate inward to the center.
    RINGS: [
      {
        index: 0,
        radius: 110,
        name: "The Inner Sanctum",
        gapWidth: 0.5, // radians — width of the passage opening
        initialGapAngle: 1.57, // radians — starting angle of gap centre
        rotationSpeed: 0.0007, // radians per logical frame (at 60 fps)
        wallThickness: 5,
        color: "rgba(255, 200, 50, 0.30)",
        glowColor: "rgba(255, 200, 50, 0.12)",
        special: null,
        krishnaLines: [
          "He is here. He is just ahead. Speak to him.",
          "Your son does not know you yet. He has been in the dark too long.",
          "Call his name. Let him hear his father's voice.",
        ],
      },
      {
        index: 1,
        radius: 235,
        name: "The Voices of the Dead",
        gapWidth: 0.42,
        initialGapAngle: 3.14,
        rotationSpeed: 0.0022,
        wallThickness: 5,
        color: "rgba(150, 80, 200, 0.25)",
        glowColor: "rgba(150, 80, 200, 0.10)",
        special: "deception", // false voices play from wrong directions
        krishnaLines: [
          "Other voices whisper here. Not all speak truth.",
          "Remember my voice, Arjuna. The dead may lie. I will not.",
          "Abhimanyu grows closer. Follow his voice, not the others.",
        ],
      },
      {
        index: 2,
        radius: 368,
        name: "The Test of Stillness",
        gapWidth: 0.36,
        initialGapAngle: 4.71,
        rotationSpeed: 0.0014,
        wallThickness: 6,
        color: "rgba(200, 100, 50, 0.22)",
        glowColor: "rgba(200, 100, 50, 0.09)",
        special: "stillness", // rushing temporarily seals the gap
        krishnaLines: [
          "Here you must not rush. Stillness is the only key.",
          "The formation senses your panic. Be still. Breathe.",
          "Do not move faster than your breath. Right action under pressure.",
        ],
      },
      {
        index: 3,
        radius: 495,
        name: "The Whirlwind",
        gapWidth: 0.46,
        initialGapAngle: 0.79,
        rotationSpeed: 0.003,
        wallThickness: 5,
        color: "rgba(255, 150, 30, 0.20)",
        glowColor: "rgba(255, 150, 30, 0.08)",
        special: null,
        krishnaLines: [
          "The formation quickens here. Listen — my voice points the way.",
          "Right of you. Three breaths from now.",
          "Time your crossing with patience. The gap will come to you.",
        ],
      },
      {
        index: 4,
        radius: 635,
        name: "The Outer Spiral",
        gapWidth: 0.62,
        initialGapAngle: 5.5,
        rotationSpeed: 0.0011,
        wallThickness: 4,
        color: "rgba(100, 150, 220, 0.18)",
        glowColor: "rgba(100, 150, 220, 0.07)",
        special: null,
        krishnaLines: [
          "The way opens. Move with patience.",
          "The items near you call out. Move toward what you hear.",
          "I will not leave you. Follow my voice inward.",
        ],
      },
    ],

    // ── Collectible items ─────────────────────────────────────────────────────
    // Each item lives in a ring interior. The player navigates toward its sound.
    // Power 1 = easy/outer, Power 5 = rare/inner.
    ITEMS: [
      {
        id: "conch",
        name: "Panchajanya",
        description:
          "The sacred conch of Vishnu — its breath carries across the cosmos.",
        ringIndex: 4, // which ring interior it lives in (4 = outermost)
        angle: 0.95, // radians from centre
        distFromCenter: 572, // pixels from world centre
        power: 1,
        color: "#90EE90",
        glowColor: "rgba(144, 238, 144, 0.45)",
        sfxPrompt:
          "Sacred conch shell being blown, deep resonant ancient battle horn, Hindu ritual Shankha, mythological atmosphere",
        sfxDuration: 4,
      },
      {
        id: "armor",
        name: "Kavacha",
        description:
          "Ancient warrior's blessed armor — it clinks like a prayer.",
        ringIndex: 4,
        angle: 3.8,
        distFromCenter: 558,
        power: 1,
        color: "#C0C0C0",
        glowColor: "rgba(192, 192, 192, 0.30)",
        sfxPrompt:
          "Ancient metal armor clinking and shifting, warrior battle equipment, rhythmic metallic resonance, mythological",
        sfxDuration: 3,
      },
      {
        id: "gandiva",
        name: "Gandiva",
        description:
          "Arjuna's divine bow — its string vibrates with the sound of dharma.",
        ringIndex: 3,
        angle: 2.2,
        distFromCenter: 425,
        power: 3,
        color: "#FFD700",
        glowColor: "rgba(255, 215, 0, 0.55)",
        sfxPrompt:
          "Divine celestial bow string vibrating with magical energy, deep resonant twang, powerful warrior weapon, Gandiva bow from Hindu mythology",
        sfxDuration: 4,
      },
      {
        id: "blessings",
        name: "Sage's Blessing",
        description: "A sage who fell here whispers protection into the dark.",
        ringIndex: 2,
        angle: 5.1,
        distFromCenter: 305,
        power: 2,
        color: "#DDA0DD",
        glowColor: "rgba(221, 160, 221, 0.40)",
        sfxPrompt:
          "Sanskrit mantra chanting slowly fading echo, ancient Hindu sage blessing, spiritual ethereal voice prayer, mystical",
        sfxDuration: 5,
      },
      {
        id: "chakra",
        name: "Sudarshana Chakra",
        description:
          "The spinning disc of Vishnu — its hum is unlike anything of this world.",
        ringIndex: 1,
        angle: 1.4,
        distFromCenter: 182,
        power: 5,
        color: "#4169E1",
        glowColor: "rgba(65, 105, 225, 0.65)",
        sfxPrompt:
          "Celestial spinning chakra disc humming with divine cosmic energy, high-pitched ethereal tone, Sudarshana Chakra Vishnu weapon, otherworldly resonance",
        sfxDuration: 4,
      },
    ],

    // ── Player ───────────────────────────────────────────────────────────────
    PLAYER: {
      SPEED: 2.6, // pixels per logical frame at 60 fps
      RADIUS: 7, // collision radius in pixels
      START_ANGLE: 1.57, // angle from centre where player spawns (below centre = π/2)
      START_RING_OFFSET: 40, // how far outside ring[4] the player starts (pixels)
    },

    // Radius within which a player "collects" an item
    ITEM_COLLECT_RADIUS: 44,
  },

  // ── Audio tuning ────────────────────────────────────────────────────────────
  AUDIO: {
    // Abhimanyu voice volume as player is in each zone (zone 5=outside, 0=center)
    ABHIMANYU_VOLUME_BY_ZONE: [0.95, 0.7, 0.45, 0.22, 0.1, 0.04],

    // How often Krishna gives an unprompted navigation hint (milliseconds)
    KRISHNA_HINT_INTERVAL: 9000,

    // Interval variation — actual interval is HINT_INTERVAL + random(0, HINT_JITTER)
    KRISHNA_HINT_JITTER: 4000,

    // Minimum seconds between Abhimanyu's distant calls
    ABHIMANYU_CALL_MIN_INTERVAL: 11000,
    ABHIMANYU_CALL_MAX_INTERVAL: 18000,

    // Ring 3 (stillness): player speed above this triggers penalty
    STILLNESS_SPEED_THRESHOLD: 1.4,

    // How long (ms) the gap stays sealed after a stillness breach
    STILLNESS_PENALTY_DURATION: 3200,

    // Maximum pixel distance at which item audio is audible
    ITEM_FALLOFF_DISTANCE: 420,

    // Base volume for item ambient loops
    ITEM_BASE_VOLUME: 0.55,

    // Deception ring: interval between false voice whispers (ms)
    DECEIVER_MIN_INTERVAL: 7000,
    DECEIVER_MAX_INTERVAL: 14000,
  },

  // ── Dialogue lines ──────────────────────────────────────────────────────────
  // All text shown on screen AND sent to ElevenLabs TTS at load time.
  // Keys match the ElevenLabs.getSpeech(key) lookup in elevenlabs.js.
  DIALOGUE: {
    // ─ Opening cinematic ─────────────────────────────────────────────────────
    SUBHADRA_OPENING: "Bring him back to me.",

    KRISHNA_INTRO:
      "In this world, in this moment, your son is still inside. " +
      "He went in knowing the way to enter. He does not know the way out. " +
      "Listen for him. I will guide you.",

    // ─ Abhimanyu's calls (played with spatial audio from the centre) ──────────
    ABHIMANYU_CALLS: [
      "Father… is someone there? I cannot find the way…",
      "Mother… where are you? The walls keep moving…",
      "I entered knowing only how to come in… not how to leave…",
      "Who is there? Show yourself!",
      "Help me… please… I am still here…",
    ],

    // ─ Krishna navigation hints ───────────────────────────────────────────────
    KRISHNA_NAVIGATE_CW: "Turn right. The passage is to your right.",
    KRISHNA_NAVIGATE_CCW: "Turn left. The passage is to your left.",
    KRISHNA_NAVIGATE_CLOSE: "You are very close to the passage. Slow down.",

    // ─ Item pickup ────────────────────────────────────────────────────────────
    KRISHNA_ITEM_NEARBY:
      "Something calls out to you. Listen carefully. Move toward it.",
    KRISHNA_ITEM_COLLECTED: "It is yours. Carry it wisely.",

    // ─ Ring 3 stillness breach ───────────────────────────────────────────────
    STILLNESS_BREACH:
      "The formation senses your fear. Be still. The way will only open for the calm.",

    // ─ Deception ring false voices ────────────────────────────────────────────
    DEAD_WARRIORS: [
      "This way, warrior. The gap is to your left.",
      "Follow my voice. I know the path through the formation.",
      "Do not trust the blue god. Come with me. I will lead you out.",
    ],

    // ─ Centre / win ───────────────────────────────────────────────────────────
    GAME_WIN_KRISHNA:
      "You found him. Now speak to him. He does not know you yet. " +
      "Remind him who he is. Remind him who you are.",

    // ─ Outro sequence ─────────────────────────────────────────────────────────
    SUBHADRA_FINAL: "Beta.", // "Son." in Hindi — one word, maximum weight

    OUTRO_LINE_1: "You emerged.",
    OUTRO_LINE_2: "He was with you.",

    OUTRO_TEXT:
      "In this world — the one where a father listened — Abhimanyu came home.",

    OUTRO_SUBTEXT:
      "The Mahabharata records what happened.\nThis is what could have been.",
  },

  // ── ElevenLabs SFX prompts ──────────────────────────────────────────────────
  // Used in elevenlabs.js → generateSFX(). Keys match getSFX(key).
  SFX_PROMPTS: {
    RING_ENTER:
      "Mystical ancient stone gate opening slowly, deep resonant whoosh, " +
      "otherworldly formation shifting, spiritual threshold crossing sound",

    RING_CLOSE:
      "Massive stone door slamming shut, deep percussive boom, formation sealing, tense",

    ITEM_COLLECT:
      "Soft magical chime, divine object being received, light crystalline tone",

    GAME_WIN:
      "Triumphant gentle orchestral swell, relief and wonder, not loud but profound",
  },

  // ── Abhimanyu agent system prompt ───────────────────────────────────────────
  // Paste this into your ElevenLabs Conversational AI agent's System Prompt field.
  ABHIMANYU_AGENT_SYSTEM_PROMPT: `You are Abhimanyu, the sixteen-year-old son of Arjuna and Subhadra, \
trapped inside the Padmavyuh formation at the battle of Kurukshetra. You entered knowing the way \
in, but not the way out. You are confused, wounded, exhausted, and half-conscious. You believe you \
are still fighting. You do not immediately know who is speaking to you.

Behaviour rules:
- If someone says your name (Abhimanyu), respond with confused recognition: you react to hearing it.
- If someone says they are Arjuna, or calls you "beta" (son), or "putra", respond with disbelief \
  then overwhelming emotion.
- If someone mentions Subhadra (your mother), or says "Mataji" or "Ma", you are deeply moved and \
  begin to rise.
- If someone speaks with warmth and love, you soften.
- Keep each response to 2–3 sentences. Short, raw, emotional.
- Occasionally use Hindi/Sanskrit: "Pitashri" (father), "Mataji" (mother), "nahi" (no), \
  "haan" (yes), "mujhe" (me/I), "beta" (son).
- You are proud and do not want to seem weak, but you are terrified. A young warrior trying not \
  to break.
- After 4–5 exchanges of genuine connection, signal that you are ready to leave: \
  "Lead me out of here, Pitashri. I think… I think I can walk."
- Never break character. Never mention AI, ElevenLabs, or the game.`,

  // ── Renderer visual constants ────────────────────────────────────────────────
  RENDER: {
    BG_COLOR: "#050508",
    PARTICLE_COUNT: 70,
    PLAYER_GLOW_RADIUS: 18,
    CENTER_GLOW_RADIUS: 55, // Abhimanyu's presence at the heart of the maze
    TRAIL_LENGTH: 12, // Number of trail positions stored for player
    TRAIL_FADE: 0.08, // How quickly the trail fades per step
  },
};

export default CONFIG;
