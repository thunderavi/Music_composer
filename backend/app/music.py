import re
import tempfile
from typing import Iterable, List, Tuple
from pathlib import Path

from music21 import chord as m21_chord
from music21 import duration, instrument, meter, note, stream, tempo

from .schemas import Composition, MelodyNote


CHORD_ROOTS = {
    "C",
    "C#",
    "Db",
    "D",
    "D#",
    "Eb",
    "E",
    "F",
    "F#",
    "Gb",
    "G",
    "G#",
    "Ab",
    "A",
    "A#",
    "Bb",
    "B",
}


def normalize_chord_symbol(symbol: str) -> str:
    cleaned = symbol.strip().replace("min", "m").replace(" ", "")
    match = re.match(r"^([A-G](?:#|b)?)(.*)$", cleaned)
    if not match:
        raise ValueError(f"Invalid chord symbol: {symbol}")
    root, quality = match.groups()
    if root not in CHORD_ROOTS:
        raise ValueError(f"Invalid chord root: {symbol}")
    return f"{root}{quality}"


def validate_composition(composition: Composition) -> List[str]:
    warnings: List[str] = []
    for section in composition.sections:
        if len(section.chords) != section.bars:
            warnings.append(
                f"{section.name} has {len(section.chords)} chords for {section.bars} bars; chords will be looped."
            )
        for chord_symbol in section.chords:
            try:
                normalize_chord_symbol(chord_symbol)
            except ValueError as exc:
                warnings.append(str(exc))
        for melody_note in section.melody:
            if melody_note.pitch != "rest":
                try:
                    note.Note(melody_note.pitch)
                except Exception:
                    warnings.append(f"Invalid melody pitch: {melody_note.pitch}")
    return warnings


def _chord_pitches(symbol: str) -> List[str]:
    normalized = normalize_chord_symbol(symbol)
    root_match = re.match(r"^([A-G](?:#|b)?)(.*)$", normalized)
    if not root_match:
        return ["C3", "E3", "G3"]
    root, quality = root_match.groups()
    intervals = [0, 4, 7]
    if quality.startswith("m") and not quality.startswith("maj"):
        intervals = [0, 3, 7]
    if "dim" in quality:
        intervals = [0, 3, 6]
    if "aug" in quality:
        intervals = [0, 4, 8]
    base = note.Note(f"{root}3")
    return [base.transpose(interval).nameWithOctave for interval in intervals]


def _melody_elements(notes: Iterable[MelodyNote]) -> List[note.NotRest]:
    elements: List[note.NotRest] = []
    for melody_note in notes:
        if melody_note.pitch == "rest":
            item = note.Rest()
        else:
            item = note.Note(melody_note.pitch)
        item.duration = duration.Duration(float(melody_note.duration_beats))
        elements.append(item)
    return elements


def build_score(composition: Composition) -> stream.Score:
    score = stream.Score()
    score.insert(0, tempo.MetronomeMark(number=composition.tempo_bpm))
    score.insert(0, meter.TimeSignature(composition.time_signature))

    chord_part = stream.Part(id="chords")
    chord_part.insert(0, instrument.Piano())
    melody_part = stream.Part(id="melody")
    melody_part.insert(0, instrument.Vocalist())

    for section in composition.sections:
        for bar_index in range(section.bars):
            symbol = section.chords[bar_index % len(section.chords)]
            chord_obj = m21_chord.Chord(_chord_pitches(symbol))
            chord_obj.duration = duration.Duration(4)
            chord_obj.addLyric(section.name if bar_index == 0 else "")
            chord_part.append(chord_obj)
        for item in _melody_elements(section.melody):
            melody_part.append(item)

    score.append(chord_part)
    score.append(melody_part)
    return score


def composition_to_midi_bytes(composition: Composition) -> bytes:
    score = build_score(composition)
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".mid", delete=False) as temp_file:
            temp_path = Path(temp_file.name)
        score.write("midi", fp=str(temp_path))
        return temp_path.read_bytes()
    finally:
        if temp_path and temp_path.exists():
            temp_path.unlink()


def composition_to_notation_text(composition: Composition) -> str:
    lines = [
        f"Title: {composition.title}",
        f"Style: {composition.style}",
        f"Mood: {composition.mood}",
        f"Key: {composition.key}",
        f"Tempo: {composition.tempo_bpm} BPM",
        f"Time: {composition.time_signature}",
        "",
    ]
    for section in composition.sections:
        lines.append(f"[{section.name}]")
        lines.append("Chords: " + " | ".join(section.chords))
        melody = " ".join(f"{item.pitch}:{item.duration_beats}" for item in section.melody)
        lines.append("Melody: " + melody)
        if section.lyric_lines:
            lines.append("Lyrics:")
            lines.extend(section.lyric_lines)
        lines.append("")
    lines.append("Disclaimer: " + composition.disclaimer)
    return "\n".join(lines)


def flatten_chords(composition: Composition) -> List[Tuple[str, str]]:
    return [(section.name, chord_symbol) for section in composition.sections for chord_symbol in section.chords]
