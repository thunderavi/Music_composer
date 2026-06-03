# Music Composition Agent

An editable AI music draft generator that uses NVIDIA NIM only for text generation and Python music tooling for MIDI/notation export.

## Features

- Generate chord progressions, symbolic melodies, and lyrics from style, mood, theme, key, tempo, and bar count.
- NVIDIA NIM-only backend using the OpenAI-compatible `/v1/chat/completions` API.
- Structured JSON validation before anything reaches the UI.
- Editable React workspace for chords, melody notes, and lyrics.
- MIDI export using `music21`.
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
    music.py             MIDI and notation helpers
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
NVIDIA_NIM_MODEL=nvidia/llama-3.1-nemotron-nano-8b-v1
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

### Export MIDI

`POST /api/v1/export/midi`

### Export Notation Mock

`POST /api/v1/export/notation`

## Disclaimer

Generated music may resemble existing works. Review, edit, and clear rights before commercial use.
