import json
from pathlib import Path

from app.music import (
    composition_to_midi_bytes,
    composition_to_notation_text,
    normalize_chord_symbol,
    validate_composition,
)
from app.schemas import Composition


def load_golden() -> Composition:
    payload = json.loads(Path(__file__).with_name("golden_composition.json").read_text())
    return Composition.model_validate(payload)


def test_normalize_chord_symbol_accepts_common_symbols() -> None:
    assert normalize_chord_symbol(" Am ") == "Am"
    assert normalize_chord_symbol("Fmaj7") == "Fmaj7"
    assert normalize_chord_symbol("Bbmin7") == "Bbm7"


def test_golden_composition_validates_cleanly() -> None:
    composition = load_golden()
    assert validate_composition(composition) == []


def test_notation_export_contains_core_sections() -> None:
    composition = load_golden()
    notation = composition_to_notation_text(composition)
    assert "Title: Rain Trace" in notation
    assert "[Verse]" in notation
    assert "Chords: Am | Fmaj7 | C | G" in notation
    assert "Disclaimer:" in notation


def test_midi_export_produces_bytes() -> None:
    composition = load_golden()
    midi = composition_to_midi_bytes(composition)
    assert midi[:4] == b"MThd"
    assert len(midi) > 100
