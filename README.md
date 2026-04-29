# पद्मव्यूह — PADMAVYUH: VOICES OF DHARMA

> *"In this world, in this moment, your son is still inside."*

A voice-first browser game built for the **ElevenHacks hackathon** (Zed × ElevenLabs).

You are Arjuna. Your son Abhimanyu is trapped at the heart of the Padmavyuh — the spiral military formation of the Kurukshetra war. He entered knowing only the way in, not the way out. Navigate five concentric rings of an invisible maze guided entirely by sound. At the centre, speak to your son and bring him home.

**Wear headphones. Allow microphone access. The game cannot be won in silence.**

---

## What this uses from ElevenLabs

| Feature | How it's used |
|---|---|
| **Text-to-Speech** | Krishna, Abhimanyu, Subhadra, and the dead warriors all have distinct voices generated at load time |
| **Sound Effects API** | Each collectible item (Gandiva, Sudarshana Chakra, Panchajanya, etc.) has a unique ambient sound generated from a text prompt |
| **Spatial audio (Web Audio API)** | Abhimanyu's voice comes from the maze centre — it gets louder and shifts pan as you approach |
| **Voice modulation** | Krishna's directional hints are panned left/right toward the actual gap in each ring |
| **Conversational AI** | At the centre, you speak to Abhimanyu out loud. He responds. The game ends when he recognises you. |

---

## Quick start

### 1. Get an ElevenLabs API key

Sign up free at [elevenlabs.io](https://elevenlabs.io) → **Profile → API Keys → Create API Key**.

### 2. (Optional but recommended) Set up the Conversational AI agent

1. Go to [elevenlabs.io/conversational-ai](https://elevenlabs.io/conversational-ai)
2. Create a new agent
3. In the **System Prompt** field, paste the prompt from `CONFIG.ABHIMANYU_AGENT_SYSTEM_PROMPT` in `js/config.js`
4. Set the agent's voice to something young and emotional (Charlie or a custom voice)
5. Copy the **Agent ID** — you'll need it in step 3

> **If you skip this step**, the game uses a scripted fallback conversation that preserves the full emotional arc. The game is still completable without a live agent.

### 3. Configure `js/config.js`

Open `js/config.js` and fill in your credentials:

```js
ELEVENLABS_API_KEY: 'your_key_here',
AGENT_ID: 'your_agent_id_here',   // optional — see step 2
```

Or leave them blank and enter your API key when the game prompts you at startup.

### 4. Serve the files locally

The game uses ES modules (`type="module"`), which require an HTTP server — you cannot open `index.html` directly as a `file://` URL.

**Option A — Python (no install)**
```sh
cd path/to/game
python -m http.server 8080
```
Then open `http://localhost:8080` in your browser.

**Option B — Node (npx serve)**
```sh
npx serve .
```

**Option C — VS Code Live Server**
Install the Live Server extension, right-click `index.html` → *Open with Live Server*.

### 5. Play

- Put on headphones
- Click **Begin** and allow microphone access
- Use **WASD** or **Arrow keys** to move
- Navigate inward through five rings by finding and passing through the rotating gaps
- Listen for item sounds and move toward them to collect weapons and blessings
- **Reach the centre** — speak to your son

---

## Gameplay mechanics

### The five rings

Each ring is a circular wall with one rotating gap. You can only pass through the gap.

| Ring | Zone | Name | Special mechanic |
|---|---|---|---|
| 5 (outer) | Zone 5→4 | The Outer Spiral | Learning zone — wide gap, slow rotation |
| 4 | Zone 4→3 | The Whirlwind | Gap rotates faster — time your crossing |
| 3 | Zone 3→2 | The Test of Stillness | **Moving too fast seals the gap** — be still |
| 2 | Zone 2→1 | The Voices of the Dead | False voices whisper from the wrong direction |
| 1 (inner) | Zone 1→0 | The Inner Sanctum | Abhimanyu's voice is very close now |

### Items

Five mythological objects are scattered through the rings. Each emits a unique ambient sound. Move toward the sound to collect it. The rarer items (Sudarshana Chakra, Gandiva) are deeper in the maze.

- **Panchajanya** (conch) — breathy, deep resonance
- **Kavacha** (armour) — metallic clink
- **Gandiva** (bow) — divine string vibration
- **Sage's Blessing** — Sanskrit chant echo
- **Sudarshana Chakra** — high cosmic hum

### The climax

At the centre, the game transitions to a conversation. Abhimanyu is confused and scared. To unlock the ending:

- Say his name
- Tell him who you are
- Tell him about his mother, Subhadra

Once he recognises you and rises, click **Lead him home →**.

---

## Architecture

```
game/
├── index.html            # Canvas + UI overlay structure
├── style.css             # Dark, atmospheric styling
└── js/
    ├── main.js           # Entry point — boots game, wires buttons
    ├── config.js         # All constants, dialogue, voice IDs, ring geometry
    ├── game.js           # State machine + main game loop
    ├── world.js          # Ring/item state, collision resolution, zone detection
    ├── player.js         # Player position, velocity, trail history
    ├── renderer.js       # Canvas rendering (rings, particles, glow, player)
    ├── audio.js          # Web Audio API wrapper (spatial audio, loops, synth)
    ├── elevenlabs.js     # ElevenLabs REST API (TTS + SFX), preloader, cache
    ├── conversation.js   # ElevenLabs Conversational AI + scripted fallback
    └── ui.js             # DOM manager (screens, dialogue, HUD, fades)
```

### Key design decisions

**Audio is the gameplay** — the rings are barely visible. Krishna's voice pans toward the gap. Abhimanyu's voice gets louder as you approach the centre. Items are inaudible beyond 420 px. You cannot win by looking.

**Silent mode** — if no API key is provided, the game falls back to Web Audio API synthesised tones (each item gets a unique oscillator frequency and waveform) and text-only dialogue. The game is fully playable without ElevenLabs.

**No build step** — pure ES modules loaded directly in the browser. Works with any static file server.

---

## Customising voices

Open `js/config.js` and change the voice IDs in `CONFIG.VOICES`:

```js
VOICES: {
  KRISHNA:   'pNInz6obpgDQGcFmaJgB',  // Adam — deep, authoritative
  ABHIMANYU: 'IKne3meq5aSn9XLyUdCD',  // Charlie — young, emotional
  SUBHADRA:  'EXAVITQu4vr4xnSDxMaL',  // Bella — warm, maternal
  DECEIVER:  'VR6AewLTigWG4xSOukaG',  // Arnold — hollow, echoing
},
```

Find voice IDs in the ElevenLabs Voice Library. For the best demo experience, use ElevenLabs Voice Design to create custom voices matching each character's description — Krishna should be calm and deep; Abhimanyu raw and young; Subhadra warm and breaking.

---

## Tuning

All gameplay constants are in `js/config.js`:

| Setting | Where | What it controls |
|---|---|---|
| Ring radii | `CONFIG.WORLD.RINGS[n].radius` | How large each ring is |
| Gap width | `CONFIG.WORLD.RINGS[n].gapWidth` | How wide the passage is (radians) |
| Rotation speed | `CONFIG.WORLD.RINGS[n].rotationSpeed` | How fast the gap moves |
| Player speed | `CONFIG.WORLD.PLAYER.SPEED` | Movement speed (pixels/frame at 60 fps) |
| Stillness threshold | `CONFIG.AUDIO.STILLNESS_SPEED_THRESHOLD` | How slow you must go in ring 3 |
| Item falloff | `CONFIG.AUDIO.ITEM_FALLOFF_DISTANCE` | Max audible range for items |
| Krishna hint interval | `CONFIG.AUDIO.KRISHNA_HINT_INTERVAL` | How often Krishna speaks unprompted |

---

## Hackathon context

**Event:** ElevenHacks — Zed × ElevenLabs  
**Theme:** Build a game using Zed and ElevenLabs APIs  
**Scoring:** Quality of gameplay + viral video submission

### Why this game is different

Every other submission will use ElevenLabs for background music or narration. This game uses it for **five distinct purposes**, each essential:

1. **TTS** — character voices with different emotional settings per character
2. **SFX generation** — item sounds created from mythological text prompts
3. **Spatial audio** — Web Audio API panning driven by ElevenLabs-generated content
4. **Dynamic voice guidance** — Krishna's direction hints pan toward the actual gap
5. **Conversational AI** — the game literally cannot be won without speaking to your son

The emotional arc: wonder (the formation) → tension (the navigation) → nostalgia (the mythology) → joy (the homecoming). All four feelings the brief asks for.

The demo clip writes itself: a player in headphones, tense, listening — then speaking softly to their lost son, voice cracking — and a young warrior's voice answering them.

---

## Credits

Built in [Zed](https://zed.dev) for the ElevenHacks hackathon.  
Voices and audio powered by [ElevenLabs](https://elevenlabs.io).  
Inspired by the Mahabharata — specifically the story of Abhimanyu and the Padmavyuh, the one moment in the epic where a different choice might have changed everything.

---

*Tag: #ElevenHacks @zeddotdev @elevenlabsio*