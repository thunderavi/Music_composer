# Music Composition Agent

An editable AI music draft generator that uses NVIDIA NIM only for text generation and Python music tooling for MIDI, WAV, and notation export.

## Features

- Generate chord progressions, symbolic melodies, and lyrics from style, mood, theme, key, tempo, and bar count.
- NVIDIA NIM-only backend using the OpenAI-compatible `/v1/chat/completions` API.
- True multi-agent compose flow: Coordinator, Chord, Lyrics, Arrangement, Drum, Bass, Melody, Critic, Mix, and Commercial Safety agents.
- Structured JSON validation before anything reaches the UI.
- Editable React workspace for chords, melody notes, and lyrics.
- Stronger validation for chord symbols, melody pitches, key fit, and section duration.
- Partial regeneration for chords, melody, lyrics, and arrangement.
- Multi-part MIDI export using `music21` with chords, bass, and melody.
- High-quality SoundFont WAV render with bundled FluidSynth and MuseScore General SoundFont, with procedural synth fallback.
- Style-aware quick preview for direct browser playback.
- Stem ZIP export for rhythm, harmony, melody, bass, and drums.
- Optional MP3 export when FFmpeg is installed locally.
- Commercial readiness review with safety score, audit checklist, agent trace, and release notes.
- MusicXML export for notation tools such as MuseScore.
- Mock notation export for review and documentation.
- Local SQLite draft storage.
- Golden-data tests for parsing and export behavior.
- Clear licensing disclaimer in every generated draft.

## Project Layout

```text
backend/
  app/
    main.py              FastAPI app and routes
    nim_client.py        NVIDIA NIM chat client
    schemas.py           Pydantic request/response models
    music.py             MIDI, WAV, and notation helpers
    storage.py           SQLite draft store
  tests/
frontend/
  src/
    App.jsx              Main editing workspace
    api.js               Backend API calls
    styles.css           UI styling
```

## Requirements

- Python 3.11+
- Node.js 18+
- NVIDIA NIM API key

## Setup

### Backend

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
Copy-Item backend\.env.example backend\.env
```

Edit `backend/.env`:

```text
APP_NAME=Jarvis Backend
HOST=0.0.0.0
PORT=5050
API_PREFIX=/api/v1
NVIDIA_API_KEY=your_nvidia_api_key
NVIDIA_NIM_BASE_URL=https://integrate.api.nvidia.com
NVIDIA_NIM_MODEL=meta/llama-3.1-8b-instruct
NVIDIA_NIM_TIMEOUT_SECONDS=180
NVIDIA_NIM_RETRIES=1
FLUIDSYNTH_PATH=./tools/fluidsynth/dist/fluidsynth-v2.5.4-win10-x64-cpp11/bin/fluidsynth.exe
SOUNDFONT_PATH=./assets/soundfonts/MuseScore_General.sf3
```

Run:

```powershell
.\start-backend.ps1
```

### Frontend

```powershell
cd frontend
npm install
cd ..
.\start-frontend.ps1
```

Open the Vite URL, usually `http://localhost:5173`.

## Environment

The backend uses NVIDIA NIM's OpenAI-compatible API. The app accepts either `https://integrate.api.nvidia.com` or `https://integrate.api.nvidia.com/v1` and normalizes it internally.

```text
https://integrate.api.nvidia.com
```

No OpenAI or Azure OpenAI keys are used.

## API

### Generate Composition

`POST /api/v1/compose`

```json
{
  "style": "Lo-fi",
  "mood": "Relaxed",
  "theme": "Rainy night",
  "key": "A minor",
  "tempo_bpm": 78,
  "bars": 8
}
```

### Update Draft

`PUT /api/v1/drafts/{draft_id}`

### Refine Draft

`POST /api/v1/refine`

```json
{
  "target": "melody",
  "composition": {},
  "instructions": "Make the melody more relaxed and lo-fi."
}
```

### Validate Draft

`POST /api/v1/validate`

### Evaluate Draft

`POST /api/v1/evaluate`

### Export MIDI

`POST /api/v1/export/midi`

### Export Playable Audio

`POST /api/v1/export/wav`

Uses FluidSynth + SoundFont when configured. Falls back to the procedural synth if the renderer is unavailable.

### Export MP3

`POST /api/v1/export/mp3`

Requires FFmpeg on the machine. Use WAV when FFmpeg is unavailable.

### Export Stems

`POST /api/v1/export/stems`

### Export MusicXML

`POST /api/v1/export/musicxml`

### Export Notation Mock

`POST /api/v1/export/notation`

### Export Full Package

`POST /api/v1/export/package`

### Commercial Review

`POST /api/v1/commercial-review`

## Disclaimer

Generated music may resemble existing works. Review, edit, and clear rights before commercial use.
