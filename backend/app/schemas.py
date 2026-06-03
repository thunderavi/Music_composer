from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


Pitch = str
Duration = Literal[0.25, 0.5, 1, 1.5, 2, 3, 4]


class ComposeRequest(BaseModel):
    style: str = Field(..., min_length=2, max_length=80)
    mood: str = Field(..., min_length=2, max_length=80)
    theme: str = Field(..., min_length=2, max_length=160)
    key: str = Field(default="C major", max_length=40)
    tempo_bpm: int = Field(default=90, ge=45, le=220)
    bars: int = Field(default=8, ge=4, le=32)
    time_signature: str = Field(default="4/4", pattern=r"^\d+/\d+$")
    creativity: float = Field(default=0.75, ge=0.0, le=1.0)
    instrumentation: Optional[str] = Field(default="piano, bass, light drums", max_length=120)


class MelodyNote(BaseModel):
    pitch: Pitch = Field(..., min_length=2, max_length=8)
    duration_beats: Duration = 1
    lyric_syllable: Optional[str] = Field(default=None, max_length=24)

    @field_validator("pitch")
    @classmethod
    def clean_pitch(cls, value: str) -> str:
        value = value.strip()
        if value.upper() == "REST":
            return "rest"
        return value


class SongSection(BaseModel):
    name: str = Field(..., min_length=2, max_length=40)
    bars: int = Field(..., ge=1, le=16)
    chords: List[str] = Field(..., min_length=1, max_length=16)
    melody: List[MelodyNote] = Field(..., min_length=1, max_length=128)
    lyric_lines: List[str] = Field(default_factory=list, max_length=12)

    @field_validator("chords")
    @classmethod
    def clean_chords(cls, value: List[str]) -> List[str]:
        return [chord.strip() for chord in value if chord.strip()]


class Composition(BaseModel):
    title: str = Field(..., min_length=2, max_length=80)
    style: str = Field(..., min_length=2, max_length=80)
    mood: str = Field(..., min_length=2, max_length=80)
    key: str = Field(..., min_length=1, max_length=40)
    tempo_bpm: int = Field(..., ge=45, le=220)
    time_signature: str = Field(..., pattern=r"^\d+/\d+$")
    sections: List[SongSection] = Field(..., min_length=1, max_length=8)
    lyrics: List[str] = Field(..., min_length=1, max_length=80)
    style_notes: List[str] = Field(default_factory=list, max_length=12)
    originality_notes: List[str] = Field(default_factory=list, max_length=12)
    disclaimer: str = Field(
        default="Generated music may resemble existing works. Review and clear rights before commercial use."
    )

    @model_validator(mode="after")
    def ensure_lyrics(self) -> "Composition":
        if not self.lyrics:
            self.lyrics = [line for section in self.sections for line in section.lyric_lines]
        return self


class ComposeResponse(BaseModel):
    draft_id: str
    composition: Composition
    warnings: List[str] = Field(default_factory=list)


class DraftSummary(BaseModel):
    draft_id: str
    title: str
    style: str
    mood: str
    updated_at: str


class DraftRecord(BaseModel):
    draft_id: str
    composition: Composition
    created_at: str
    updated_at: str


class ProviderInfo(BaseModel):
    provider: Literal["nvidia_nim"] = "nvidia_nim"
    base_url: str
    model: str
    api_key_configured: bool
