import json
from typing import Any, Dict

import httpx
from pydantic import ValidationError

from .config import Settings
from .schemas import ComposeRequest, Composition


SYSTEM_PROMPT = """
You are an expert music composition agent. Generate original, editable symbolic song drafts.
Return JSON only. Do not include markdown, commentary, or code fences.
The composition must be practical for MIDI export and human editing.
Avoid quoting existing lyrics or recognizable melodies.
""".strip()


def build_user_prompt(request: ComposeRequest) -> str:
    return f"""
Create a concise song draft with this exact JSON shape:
{{
  "title": "short original title",
  "style": "{request.style}",
  "mood": "{request.mood}",
  "key": "{request.key}",
  "tempo_bpm": {request.tempo_bpm},
  "time_signature": "{request.time_signature}",
  "sections": [
    {{
      "name": "Verse",
      "bars": 4,
      "chords": ["Am", "F", "C", "G"],
      "melody": [
        {{"pitch": "A4", "duration_beats": 1, "lyric_syllable": "rain"}}
      ],
      "lyric_lines": ["line one", "line two"]
    }}
  ],
  "lyrics": ["line one", "line two"],
  "style_notes": ["specific arrangement/style detail"],
  "originality_notes": ["what makes this draft generic enough to edit"],
  "disclaimer": "Generated music may resemble existing works. Review and clear rights before commercial use."
}}

Rules:
- Total section bars should be close to {request.bars}.
- Use only parseable chord symbols like C, G, Am, Fmaj7, Dm7, G7.
- Use melody pitches like C4, D#4, Bb4, or "rest".
- Use duration_beats only from 0.25, 0.5, 1, 1.5, 2, 3, 4.
- Make melody fit the requested style and key.
- Make lyrics match style "{request.style}", mood "{request.mood}", and theme "{request.theme}".
- Instrumentation direction: {request.instrumentation}.
- Keep output compact enough for a first draft.
""".strip()


def extract_json_object(text: str) -> Dict[str, Any]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        cleaned = cleaned.removeprefix("json").strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("NIM response did not contain a JSON object.")
    return json.loads(cleaned[start : end + 1])


class NimClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def compose(self, request: ComposeRequest) -> Composition:
        if not self.settings.nim_api_key:
            raise RuntimeError("NVIDIA_API_KEY is not configured.")

        payload = {
            "model": self.settings.nim_model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": build_user_prompt(request)},
            ],
            "temperature": request.creativity,
            "top_p": 0.9,
            "max_tokens": 2200,
        }

        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                f"{self.settings.normalized_nim_base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.settings.nim_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            response.raise_for_status()
            data = response.json()

        content = data["choices"][0]["message"]["content"]
        parsed = extract_json_object(content)
        try:
            return Composition.model_validate(parsed)
        except ValidationError as exc:
            raise ValueError(f"NIM returned invalid composition JSON: {exc}") from exc
