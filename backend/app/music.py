import math
import shutil
import struct
import subprocess
import tempfile
import wave
from io import BytesIO
from pathlib import Path
import re
from typing import Iterable, List, Tuple

from music21 import chord as m21_chord
from music21 import duration, instrument, meter, note, stream, tempo
from music21.metadata import Metadata

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

MAJOR_SCALE = {0, 2, 4, 5, 7, 9, 11}
MINOR_SCALE = {0, 2, 3, 5, 7, 8, 10}
ROOT_TO_PC = {
    "C": 0,
    "C#": 1,
    "Db": 1,
    "D": 2,
    "D#": 3,
    "Eb": 3,
    "E": 4,
    "F": 5,
    "F#": 6,
    "Gb": 6,
    "G": 7,
    "G#": 8,
    "Ab": 8,
    "A": 9,
    "A#": 10,
    "Bb": 10,
    "B": 11,
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


def _beats_per_bar(time_signature: str) -> float:
    numerator, denominator = time_signature.split("/")
    return int(numerator) * (4 / int(denominator))


def _key_pitch_classes(key_name: str) -> set[int]:
    parts = key_name.strip().replace("minor", "minor").replace("major", "major").split()
    if not parts:
        return set()
    root = parts[0]
    if root not in ROOT_TO_PC:
        return set()
    mode = "minor" if any(part.lower().startswith("min") for part in parts[1:]) else "major"
    scale = MINOR_SCALE if mode == "minor" else MAJOR_SCALE
    return {(ROOT_TO_PC[root] + interval) % 12 for interval in scale}


def validate_composition(composition: Composition) -> List[str]:
    warnings: List[str] = []
    key_pitch_classes = _key_pitch_classes(composition.key)
    beats_per_bar = _beats_per_bar(composition.time_signature)
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
                    parsed_note = note.Note(melody_note.pitch)
                    if key_pitch_classes and parsed_note.pitch.pitchClass not in key_pitch_classes:
                        warnings.append(
                            f"{section.name} melody pitch {melody_note.pitch} is outside {composition.key}; keep if intentional."
                        )
                except Exception:
                    warnings.append(f"Invalid melody pitch: {melody_note.pitch}")
        melody_beats = sum(float(melody_note.duration_beats) for melody_note in section.melody)
        target_beats = section.bars * beats_per_bar
        if melody_beats > target_beats:
            warnings.append(
                f"{section.name} melody is {melody_beats:g} beats but section capacity is {target_beats:g}; export may overflow."
            )
        elif melody_beats < target_beats * 0.75:
            warnings.append(
                f"{section.name} melody covers {melody_beats:g}/{target_beats:g} beats; consider adding rests or notes."
            )
    return warnings


def _nearest_pitch_class(source: int, allowed: set[int]) -> int:
    if source in allowed:
        return source
    best = source
    best_distance = 99
    best_shift = 99
    for candidate in sorted(allowed):
        upward = (candidate - source) % 12
        downward = -((source - candidate) % 12)
        shift = upward if upward <= abs(downward) else downward
        distance = abs(shift)
        if distance < best_distance or (distance == best_distance and shift > best_shift):
            best = candidate
            best_distance = distance
            best_shift = shift
    return best


def _snap_note_to_key(pitch_name: str, key_pitch_classes: set[int]) -> str:
    if pitch_name == "rest" or not key_pitch_classes:
        return pitch_name
    parsed = note.Note(pitch_name)
    target_pc = _nearest_pitch_class(parsed.pitch.pitchClass, key_pitch_classes)
    shift = (target_pc - parsed.pitch.pitchClass) % 12
    if shift > 6:
        shift -= 12
    return parsed.transpose(shift).nameWithOctave


def optimize_generated_composition(composition: Composition) -> Composition:
    optimized = composition.model_copy(deep=True)
    key_pitch_classes = _key_pitch_classes(optimized.key)
    beats_per_bar = _beats_per_bar(optimized.time_signature)
    for section in optimized.sections:
        if section.chords:
            section.chords = [section.chords[index % len(section.chords)] for index in range(section.bars)]
        for melody_note in section.melody:
            if melody_note.pitch != "rest":
                try:
                    melody_note.pitch = _snap_note_to_key(melody_note.pitch, key_pitch_classes)
                except Exception:
                    pass
        target_beats = section.bars * beats_per_bar
        trimmed_melody = []
        used_beats = 0.0
        for melody_note in section.melody:
            if used_beats >= target_beats:
                break
            note_duration = float(melody_note.duration_beats)
            if used_beats + note_duration > target_beats:
                note_duration = target_beats - used_beats
                if note_duration not in {0.25, 0.5, 1, 1.5, 2, 3, 4}:
                    break
                melody_note = melody_note.model_copy(update={"duration_beats": note_duration})
            trimmed_melody.append(melody_note)
            used_beats += note_duration
        section.melody = trimmed_melody or [MelodyNote(pitch="rest", duration_beats=target_beats if target_beats in {0.25, 0.5, 1, 1.5, 2, 3, 4} else 4)]
        used_beats = sum(float(melody_note.duration_beats) for melody_note in section.melody)
        remaining = target_beats - used_beats
        while remaining > 0:
            rest_duration = 4 if remaining >= 4 else 2 if remaining >= 2 else 1 if remaining >= 1 else 0.5
            if rest_duration > remaining:
                rest_duration = remaining
            section.melody.append(MelodyNote(pitch="rest", duration_beats=rest_duration))
            remaining -= rest_duration
    return optimized


def composition_validation_report(composition: Composition) -> dict:
    return {
        "warnings": validate_composition(composition),
        "total_sections": len(composition.sections),
        "total_bars": sum(section.bars for section in composition.sections),
        "total_chords": sum(len(section.chords) for section in composition.sections),
        "total_melody_notes": sum(len(section.melody) for section in composition.sections),
        "lyric_lines": len(composition.lyrics),
    }


def _chord_pitches(symbol: str) -> List[str]:
    normalized = normalize_chord_symbol(symbol)
    root_match = re.match(r"^([A-G](?:#|b)?)(.*)$", normalized)
    if not root_match:
        return ["C3", "E3", "G3"]
    root, quality = root_match.groups()
    quality_lower = quality.lower()
    intervals = [0, 4, 7]
    if quality_lower.startswith("m") and not quality_lower.startswith("maj"):
        intervals = [0, 3, 7]
    if "sus2" in quality_lower:
        intervals = [0, 2, 7]
    if "sus4" in quality_lower or quality_lower.startswith("sus"):
        intervals = [0, 5, 7]
    if "dim" in quality_lower:
        intervals = [0, 3, 6]
    if "aug" in quality_lower:
        intervals = [0, 4, 8]
    if "b5" in quality_lower and intervals[-1] == 7:
        intervals[-1] = 6
    if "#5" in quality_lower and intervals[-1] == 7:
        intervals[-1] = 8
    if "maj7" in quality_lower or "ma7" in quality_lower:
        intervals.append(11)
    elif "7" in quality_lower:
        intervals.append(10)
    elif "6" in quality_lower:
        intervals.append(9)
    if "9" in quality_lower:
        intervals.append(14)
    if "11" in quality_lower:
        intervals.append(17)
    if "13" in quality_lower:
        intervals.append(21)
    intervals = list(dict.fromkeys(intervals))[:6]
    base = note.Note(f"{root}3")
    return [base.transpose(interval).nameWithOctave for interval in intervals]


def _chord_root_pitch(symbol: str, octave: int = 2) -> str:
    normalized = normalize_chord_symbol(symbol)
    root_match = re.match(r"^([A-G](?:#|b)?)(.*)$", normalized)
    if not root_match:
        return f"C{octave}"
    return f"{root_match.group(1)}{octave}"


def _power_chord_pitches(symbol: str) -> List[str]:
    normalized = normalize_chord_symbol(symbol)
    root_match = re.match(r"^([A-G](?:#|b)?)(.*)$", normalized)
    if not root_match:
        return ["C3", "G3", "C4"]
    root = root_match.group(1)
    base = note.Note(f"{root}3")
    return [base.nameWithOctave, base.transpose(7).nameWithOctave, base.transpose(12).nameWithOctave]


def _melody_elements(notes: Iterable[MelodyNote]) -> List[note.NotRest]:
    elements: List[note.NotRest] = []
    for melody_note in notes:
        if melody_note.pitch == "rest":
            item = note.Rest()
        else:
            item = note.Note(melody_note.pitch)
            item.volume.velocity = 100
        item.duration = duration.Duration(float(melody_note.duration_beats))
        elements.append(item)
    return elements


TICKS_PER_BEAT = 480
DRUM_CHANNEL = 9

STYLE_PROGRAMS = {
    "rock": {"harmony": 30, "bass": 33, "melody": 29, "pad": 30},
    "edm": {"harmony": 90, "bass": 38, "melody": 81, "pad": 88},
    "jazz": {"harmony": 0, "bass": 32, "melody": 65, "pad": 4},
    "folk": {"harmony": 25, "bass": 32, "melody": 22, "pad": 25},
    "cinematic": {"harmony": 48, "bass": 43, "melody": 50, "pad": 89},
    "r&b": {"harmony": 4, "bass": 38, "melody": 54, "pad": 89},
    "lo-fi": {"harmony": 4, "bass": 33, "melody": 11, "pad": 89},
}

STYLE_VOLUME = {
    "rock": {"harmony": 104, "bass": 106, "melody": 104, "pad": 74},
    "edm": {"harmony": 100, "bass": 112, "melody": 108, "pad": 82},
    "jazz": {"harmony": 92, "bass": 104, "melody": 98, "pad": 74},
    "folk": {"harmony": 96, "bass": 92, "melody": 96, "pad": 70},
    "cinematic": {"harmony": 94, "bass": 108, "melody": 96, "pad": 102},
    "r&b": {"harmony": 92, "bass": 106, "melody": 104, "pad": 88},
    "lo-fi": {"harmony": 90, "bass": 96, "melody": 92, "pad": 82},
}


def _varlen(value: int) -> bytes:
    value = max(0, int(value))
    buffer = value & 0x7F
    value >>= 7
    while value:
        buffer <<= 8
        buffer |= (value & 0x7F) | 0x80
        value >>= 7
    output = bytearray()
    while True:
        output.append(buffer & 0xFF)
        if buffer & 0x80:
            buffer >>= 8
        else:
            break
    return bytes(output)


def _track_chunk(events: list[tuple[int, int, bytes]]) -> bytes:
    data = bytearray()
    previous_tick = 0
    for tick, _order, payload in sorted(events, key=lambda item: (item[0], item[1])):
        data.extend(_varlen(max(0, tick - previous_tick)))
        data.extend(payload)
        previous_tick = tick
    data.extend(_varlen(0))
    data.extend(b"\xff\x2f\x00")
    return b"MTrk" + struct.pack(">I", len(data)) + bytes(data)


def _meta_track(composition: Composition) -> bytes:
    tempo_microseconds = int(60_000_000 / max(1, composition.tempo_bpm))
    numerator, denominator = composition.time_signature.split("/")
    denominator_power = int(math.log2(max(1, int(denominator))))
    events = [
        (0, 0, b"\xff\x03" + bytes([len(composition.title[:48])]) + composition.title[:48].encode("ascii", "ignore")),
        (0, 1, b"\xff\x51\x03" + tempo_microseconds.to_bytes(3, "big")),
        (0, 2, b"\xff\x58\x04" + bytes([int(numerator), denominator_power, 24, 8])),
    ]
    return _track_chunk(events)


def _midi_bytes_from_tracks(composition: Composition, tracks: list[bytes]) -> bytes:
    chunks = [_meta_track(composition), *tracks]
    header = b"MThd" + struct.pack(">IHHH", 6, 1, len(chunks), TICKS_PER_BEAT)
    return header + b"".join(chunks)


def _pitch_to_midi(pitch_name: str) -> int | None:
    if pitch_name == "rest":
        return None
    try:
        return int(note.Note(pitch_name).pitch.midi)
    except Exception:
        return None


def _pitch_name_at_octave(pitch_name: str, octave: int) -> str:
    parsed = note.Note(pitch_name)
    parsed.octave = octave
    return parsed.nameWithOctave


def _chord_midis(symbol: str, octave: int = 3, power: bool = False) -> list[int]:
    pitch_names = _power_chord_pitches(symbol) if power else _chord_pitches(symbol)
    notes = []
    for pitch_name in pitch_names:
        try:
            notes.append(_pitch_to_midi(_pitch_name_at_octave(pitch_name, octave)))
        except Exception:
            continue
    return [item for item in notes if item is not None]


def _root_midi(symbol: str, octave: int = 2) -> int:
    return _pitch_to_midi(_chord_root_pitch(symbol, octave=octave)) or 36


def _add_note(
    events: list[tuple[int, int, bytes]],
    *,
    channel: int,
    start_tick: int,
    duration_ticks: int,
    pitch: int | None,
    velocity: int,
    order: int = 20,
) -> None:
    if pitch is None or duration_ticks <= 0:
        return
    pitch = max(0, min(127, int(pitch)))
    velocity = max(1, min(127, int(velocity)))
    start_tick = max(0, int(start_tick))
    duration_ticks = max(1, int(duration_ticks))
    events.append((start_tick, order, bytes([0x90 + channel, pitch, velocity])))
    events.append((start_tick + duration_ticks, order + 1, bytes([0x80 + channel, pitch, 0])))


def _add_chord(
    events: list[tuple[int, int, bytes]],
    *,
    channel: int,
    start_tick: int,
    duration_ticks: int,
    pitches: list[int],
    velocity: int,
    strum_ticks: int = 0,
) -> None:
    for index, pitch in enumerate(pitches):
        _add_note(
            events,
            channel=channel,
            start_tick=start_tick + index * strum_ticks,
            duration_ticks=max(1, duration_ticks - index * strum_ticks),
            pitch=pitch,
            velocity=max(1, velocity - index * 3),
            order=20 + index,
        )


def _control_events(channel: int, *, program: int, volume: int, pan: int) -> list[tuple[int, int, bytes]]:
    return [
        (0, 0, bytes([0xC0 + channel, max(0, min(127, program))])),
        (0, 1, bytes([0xB0 + channel, 7, max(0, min(127, volume))])),
        (0, 2, bytes([0xB0 + channel, 10, max(0, min(127, pan))])),
        (0, 3, bytes([0xB0 + channel, 91, 24])),
    ]


def _drum(events: list[tuple[int, int, bytes]], start_tick: int, beats: float, drum_note: int, velocity: int) -> None:
    _add_note(
        events,
        channel=DRUM_CHANNEL,
        start_tick=start_tick,
        duration_ticks=max(24, int(beats * TICKS_PER_BEAT)),
        pitch=drum_note,
        velocity=velocity,
        order=30,
    )


def _section_offsets(composition: Composition) -> list[tuple[int, object]]:
    offsets = []
    cursor = 0
    beats_per_bar = _beats_per_bar(composition.time_signature)
    for section in composition.sections:
        offsets.append((cursor, section))
        cursor += int(section.bars * beats_per_bar * TICKS_PER_BEAT)
    return offsets


def _style_programs(family: str) -> dict[str, int]:
    return STYLE_PROGRAMS.get(family, STYLE_PROGRAMS["lo-fi"])


def _style_volumes(family: str) -> dict[str, int]:
    return STYLE_VOLUME.get(family, STYLE_VOLUME["lo-fi"])


def _arrange_harmony_and_bass(
    composition: Composition,
    *,
    family: str,
    harmony_events: list[tuple[int, int, bytes]],
    bass_events: list[tuple[int, int, bytes]],
    pad_events: list[tuple[int, int, bytes]],
) -> None:
    beats_per_bar = _beats_per_bar(composition.time_signature)
    bar_ticks = int(beats_per_bar * TICKS_PER_BEAT)
    half = TICKS_PER_BEAT // 2
    quarter = TICKS_PER_BEAT

    for section_tick, section in _section_offsets(composition):
        for bar_index in range(section.bars):
            symbol = section.chords[bar_index % len(section.chords)]
            bar_tick = section_tick + bar_index * bar_ticks
            chord_full = _chord_midis(symbol, octave=3, power=False)
            chord_high = _chord_midis(symbol, octave=4, power=False)
            chord_power = _chord_midis(symbol, octave=3, power=True)
            root = _root_midi(symbol, octave=2)
            fifth = root + 7
            octave = root + 12

            if family == "rock":
                for step in range(int(beats_per_bar * 2)):
                    tick = bar_tick + step * half
                    velocity = 106 if step in {0, 4} else 84
                    _add_chord(harmony_events, channel=0, start_tick=tick, duration_ticks=int(half * 0.82), pitches=chord_power, velocity=velocity, strum_ticks=8)
                    _add_note(bass_events, channel=1, start_tick=tick, duration_ticks=int(half * 0.88), pitch=root if step % 4 else octave, velocity=102)
                continue

            if family == "edm":
                for beat in range(int(beats_per_bar)):
                    _add_note(bass_events, channel=1, start_tick=bar_tick + beat * quarter, duration_ticks=int(quarter * 0.72), pitch=root if beat % 2 == 0 else octave, velocity=112)
                for beat in (0, 2):
                    if beat < beats_per_bar:
                        _add_chord(harmony_events, channel=0, start_tick=bar_tick + beat * quarter, duration_ticks=int(quarter * 0.72), pitches=chord_high[:4], velocity=94, strum_ticks=0)
                _add_chord(pad_events, channel=3, start_tick=bar_tick, duration_ticks=int(bar_ticks * 0.96), pitches=chord_full[:4], velocity=54)
                continue

            if family == "jazz":
                walking = [root, root + 4, fifth, root + 10]
                if "m" in symbol.lower() and "maj" not in symbol.lower():
                    walking[1] = root + 3
                for beat, pitch in enumerate(walking[: int(beats_per_bar)]):
                    _add_note(bass_events, channel=1, start_tick=bar_tick + beat * quarter, duration_ticks=int(quarter * 0.88), pitch=pitch, velocity=92)
                for beat in (0, 2):
                    if beat < beats_per_bar:
                        _add_chord(harmony_events, channel=0, start_tick=bar_tick + beat * quarter + 28, duration_ticks=int(quarter * 1.32), pitches=chord_full[:5], velocity=78, strum_ticks=3)
                continue

            if family == "folk":
                arpeggio = (chord_full + [root + 12, fifth + 12])[:6] or [root, fifth, octave]
                for step in range(int(beats_per_bar * 2)):
                    pitch = arpeggio[step % len(arpeggio)]
                    _add_note(harmony_events, channel=0, start_tick=bar_tick + step * half, duration_ticks=int(half * 0.74), pitch=pitch, velocity=82 if step % 2 == 0 else 68)
                _add_note(bass_events, channel=1, start_tick=bar_tick, duration_ticks=int(quarter * 0.9), pitch=root, velocity=76)
                _add_note(bass_events, channel=1, start_tick=bar_tick + 2 * quarter, duration_ticks=int(quarter * 0.9), pitch=fifth, velocity=72)
                continue

            if family == "cinematic":
                _add_chord(harmony_events, channel=0, start_tick=bar_tick, duration_ticks=int(bar_ticks * 0.98), pitches=chord_full[:5], velocity=82, strum_ticks=18)
                _add_chord(pad_events, channel=3, start_tick=bar_tick, duration_ticks=int(bar_ticks * 0.98), pitches=[pitch + 12 for pitch in chord_full[:4]], velocity=70, strum_ticks=22)
                for beat in (0, 2):
                    if beat < beats_per_bar:
                        _add_note(bass_events, channel=1, start_tick=bar_tick + beat * quarter, duration_ticks=int(quarter * 1.75), pitch=root - 12, velocity=104)
                continue

            # Lo-fi and R&B lean on softer electric keys plus more space.
            strum = 18 if family == "lo-fi" else 6
            _add_chord(harmony_events, channel=0, start_tick=bar_tick + 18, duration_ticks=int(bar_ticks * 0.82), pitches=chord_full[:5], velocity=76 if family == "lo-fi" else 86, strum_ticks=strum)
            if family == "r&b":
                for beat, pitch in [(0, root), (1.5, octave), (2.5, fifth)]:
                    _add_note(bass_events, channel=1, start_tick=bar_tick + int(beat * quarter), duration_ticks=int(quarter * 0.82), pitch=pitch, velocity=98)
            else:
                _add_note(bass_events, channel=1, start_tick=bar_tick, duration_ticks=int(quarter * 1.2), pitch=root, velocity=84)
                _add_note(bass_events, channel=1, start_tick=bar_tick + int(2.5 * quarter), duration_ticks=int(quarter * 0.72), pitch=fifth, velocity=74)


def _arrange_drums(composition: Composition, *, family: str, drum_events: list[tuple[int, int, bytes]]) -> None:
    beats_per_bar = _beats_per_bar(composition.time_signature)
    bar_ticks = int(beats_per_bar * TICKS_PER_BEAT)
    quarter = TICKS_PER_BEAT
    eighth = TICKS_PER_BEAT // 2

    for section_tick, section in _section_offsets(composition):
        for bar_index in range(section.bars):
            bar_tick = section_tick + bar_index * bar_ticks
            if bar_index == 0:
                _drum(drum_events, bar_tick, 0.5, 49 if family in {"rock", "edm"} else 51, 84)

            if family == "rock":
                for beat in (0, 2):
                    _drum(drum_events, bar_tick + beat * quarter, 0.18, 36, 118)
                for beat in (1, 3):
                    if beat < beats_per_bar:
                        _drum(drum_events, bar_tick + beat * quarter, 0.12, 38, 112)
                for step in range(int(beats_per_bar * 2)):
                    _drum(drum_events, bar_tick + step * eighth, 0.06, 42, 70 if step % 2 else 86)
                continue

            if family == "edm":
                for beat in range(int(beats_per_bar)):
                    _drum(drum_events, bar_tick + beat * quarter, 0.16, 36, 124)
                for beat in (1, 3):
                    if beat < beats_per_bar:
                        _drum(drum_events, bar_tick + beat * quarter, 0.1, 39, 104)
                for step in range(int(beats_per_bar * 2)):
                    _drum(drum_events, bar_tick + int((step + 0.5) * eighth), 0.04, 42 if step % 2 else 46, 68)
                continue

            if family == "jazz":
                for beat in range(int(beats_per_bar)):
                    _drum(drum_events, bar_tick + beat * quarter, 0.08, 51, 66 if beat % 2 else 78)
                _drum(drum_events, bar_tick + 2 * quarter, 0.12, 38, 52)
                continue

            if family == "folk":
                _drum(drum_events, bar_tick, 0.14, 36, 76)
                if beats_per_bar > 2:
                    _drum(drum_events, bar_tick + 2 * quarter, 0.12, 38, 64)
                for step in range(int(beats_per_bar)):
                    _drum(drum_events, bar_tick + step * quarter, 0.04, 42, 42)
                continue

            if family == "cinematic":
                _drum(drum_events, bar_tick, 0.24, 41, 98)
                if bar_index % 2 == 1:
                    _drum(drum_events, bar_tick + 3 * quarter, 0.18, 45, 86)
                continue

            if family == "r&b":
                _drum(drum_events, bar_tick, 0.14, 36, 96)
                _drum(drum_events, bar_tick + int(1.75 * quarter), 0.1, 38, 74)
                _drum(drum_events, bar_tick + 2 * quarter, 0.14, 36, 82)
                _drum(drum_events, bar_tick + 3 * quarter, 0.1, 38, 92)
                for step in range(int(beats_per_bar * 2)):
                    _drum(drum_events, bar_tick + step * eighth, 0.035, 42, 48 if step % 2 else 58)
                continue

            _drum(drum_events, bar_tick, 0.14, 36, 78)
            if beats_per_bar > 2:
                _drum(drum_events, bar_tick + 2 * quarter, 0.1, 38, 68)
            _drum(drum_events, bar_tick + int(2.75 * quarter), 0.08, 36, 62)
            for step in range(int(beats_per_bar * 2)):
                if step % 2 == 1:
                    _drum(drum_events, bar_tick + step * eighth, 0.035, 42, 38)


def _arrange_melody(composition: Composition, *, family: str, melody_events: list[tuple[int, int, bytes]]) -> None:
    channel = 2
    beat_ticks = TICKS_PER_BEAT
    for section_tick, section in _section_offsets(composition):
        cursor = section_tick
        for melody_note in section.melody:
            duration_ticks = int(float(melody_note.duration_beats) * beat_ticks)
            pitch = _pitch_to_midi(melody_note.pitch)
            if pitch is not None:
                if family in {"rock", "edm"}:
                    pitch += 12 if pitch < 72 else 0
                velocity = 102 if family in {"rock", "edm", "r&b"} else 88
                _add_note(
                    melody_events,
                    channel=channel,
                    start_tick=cursor,
                    duration_ticks=int(duration_ticks * 0.9),
                    pitch=pitch,
                    velocity=velocity,
                )
            cursor += duration_ticks


def _composition_to_arranged_midi_bytes(composition: Composition) -> bytes:
    family = _style_family(composition)
    programs = _style_programs(family)
    volumes = _style_volumes(family)

    harmony_events = _control_events(0, program=programs["harmony"], volume=volumes["harmony"], pan=48)
    bass_events = _control_events(1, program=programs["bass"], volume=volumes["bass"], pan=42)
    melody_events = _control_events(2, program=programs["melody"], volume=volumes["melody"], pan=74)
    pad_events = _control_events(3, program=programs["pad"], volume=volumes["pad"], pan=64)
    drum_events = [(0, 0, bytes([0xB0 + DRUM_CHANNEL, 7, 110])), (0, 1, bytes([0xB0 + DRUM_CHANNEL, 10, 64]))]

    _arrange_harmony_and_bass(
        composition,
        family=family,
        harmony_events=harmony_events,
        bass_events=bass_events,
        pad_events=pad_events,
    )
    _arrange_drums(composition, family=family, drum_events=drum_events)
    _arrange_melody(composition, family=family, melody_events=melody_events)

    tracks = [
        _track_chunk(harmony_events),
        _track_chunk(bass_events),
        _track_chunk(melody_events),
        _track_chunk(pad_events),
        _track_chunk(drum_events),
    ]
    return _midi_bytes_from_tracks(composition, tracks)


def build_score(composition: Composition) -> stream.Score:
    score = stream.Score()
    score.metadata = Metadata()
    score.metadata.title = composition.title
    score.insert(0, tempo.MetronomeMark(number=composition.tempo_bpm))
    score.insert(0, meter.TimeSignature(composition.time_signature))

    family = _style_family(composition)
    chord_part = stream.Part(id="chords")
    if family == "rock":
        chord_part.insert(0, instrument.ElectricGuitar())
    elif family == "folk":
        chord_part.insert(0, instrument.AcousticGuitar())
    elif family in {"r&b", "lo-fi"}:
        chord_part.insert(0, instrument.ElectricPiano())
    else:
        chord_part.insert(0, instrument.Piano())
    bass_part = stream.Part(id="bass")
    bass_part.insert(0, instrument.ElectricBass() if family in {"rock", "edm", "r&b"} else instrument.AcousticBass())
    melody_part = stream.Part(id="melody")
    melody_part.insert(0, instrument.ElectricGuitar() if family == "rock" else instrument.Vocalist())
    drum_part = stream.Part(id="drums")
    drum_part.insert(0, instrument.Percussion())

    for section in composition.sections:
        for bar_index in range(section.bars):
            symbol = section.chords[bar_index % len(section.chords)]
            chord_obj = m21_chord.Chord(_power_chord_pitches(symbol) if family == "rock" else _chord_pitches(symbol))
            chord_obj.duration = duration.Duration(4)
            chord_obj.volume.velocity = 76
            chord_obj.addLyric(section.name if bar_index == 0 else "")
            chord_part.append(chord_obj)

            bass_note = note.Note(_chord_root_pitch(symbol))
            bass_note.duration = duration.Duration(4)
            bass_note.volume.velocity = 92
            bass_part.append(bass_note)

            drum_events = [("C2", 1), ("D2", 1), ("C2", 1), ("D2", 1)] if family == "rock" else [("C2", 2), ("D2", 2)]
            for drum_pitch, drum_duration in drum_events:
                drum_note = note.Note(drum_pitch)
                drum_note.duration = duration.Duration(drum_duration)
                drum_note.volume.velocity = 96 if drum_pitch == "C2" else 82
                drum_part.append(drum_note)
        for item in _melody_elements(section.melody):
            melody_part.append(item)

    score.append(chord_part)
    score.append(bass_part)
    score.append(drum_part)
    score.append(melody_part)
    return score


def composition_to_midi_bytes(composition: Composition) -> bytes:
    return _composition_to_arranged_midi_bytes(composition)


def composition_to_soundfont_wav_bytes(
    composition: Composition,
    *,
    fluidsynth_path: str,
    soundfont_path: str,
    sample_rate: int = 44100,
) -> bytes:
    renderer = fluidsynth_path or shutil.which("fluidsynth")
    if not renderer:
        raise RuntimeError("FluidSynth is not configured.")
    renderer_path = Path(renderer)
    soundfont = Path(soundfont_path)
    if not renderer_path.exists() and not shutil.which(renderer):
        raise RuntimeError(f"FluidSynth executable not found: {renderer}")
    if not soundfont.exists():
        raise RuntimeError(f"SoundFont not found: {soundfont}")

    temp_dir = Path(tempfile.mkdtemp())
    try:
        midi_path = temp_dir / "composition.mid"
        wav_path = temp_dir / "composition.wav"
        midi_path.write_bytes(composition_to_midi_bytes(composition))
        subprocess.run(
            [
                str(renderer_path if renderer_path.exists() else renderer),
                "-ni",
                "-F",
                str(wav_path),
                "-r",
                str(sample_rate),
                str(soundfont),
                str(midi_path),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return wav_path.read_bytes()
    finally:
        for child in temp_dir.glob("*"):
            child.unlink(missing_ok=True)
        temp_dir.rmdir()


def _pitch_frequency(pitch_name: str) -> float | None:
    if pitch_name == "rest":
        return None
    try:
        return float(note.Note(pitch_name).pitch.frequency)
    except Exception:
        return None


def _triangle_wave(phase: float) -> float:
    return (2 / math.pi) * math.asin(math.sin(phase))


def _saw_wave(phase: float) -> float:
    cycle = (phase / (2 * math.pi)) % 1
    return 2 * cycle - 1


def _mix_tone(
    samples: List[float],
    *,
    frequency: float | None,
    start_seconds: float,
    duration_seconds: float,
    sample_rate: int,
    amplitude: float,
    waveform: str = "sine",
) -> None:
    if not frequency or duration_seconds <= 0:
        return

    start = max(0, int(start_seconds * sample_rate))
    end = min(len(samples), int((start_seconds + duration_seconds) * sample_rate))
    if end <= start:
        return

    attack = min(int(0.025 * sample_rate), max(1, (end - start) // 4))
    release = min(int(0.08 * sample_rate), max(1, (end - start) // 3))
    two_pi_frequency = 2 * math.pi * frequency

    for index in range(start, end):
        local = index - start
        remaining = end - index
        envelope = 1.0
        if local < attack:
            envelope = local / attack
        if remaining < release:
            envelope = min(envelope, remaining / release)

        t = index / sample_rate
        phase = two_pi_frequency * t
        if waveform == "triangle":
            value = _triangle_wave(phase)
        elif waveform == "saw":
            value = _saw_wave(phase)
        elif waveform == "square":
            value = 1.0 if math.sin(phase) >= 0 else -1.0
        elif waveform == "distorted":
            raw = math.sin(phase) + 0.42 * math.sin(phase * 2) + 0.18 * math.sin(phase * 3)
            value = math.tanh(raw * 2.2)
        else:
            value = math.sin(phase) + 0.22 * math.sin(phase * 2)

        samples[index] += value * amplitude * envelope


def _noise_value(index: int, seed: int = 0) -> float:
    value = math.sin((index + 1 + seed * 977) * 12.9898) * 43758.5453
    return (value - math.floor(value)) * 2 - 1


def _mix_noise(
    samples: List[float],
    *,
    start_seconds: float,
    duration_seconds: float,
    sample_rate: int,
    amplitude: float,
    seed: int = 0,
    body_frequency: float | None = None,
) -> None:
    start = max(0, int(start_seconds * sample_rate))
    end = min(len(samples), int((start_seconds + duration_seconds) * sample_rate))
    if end <= start:
        return

    length = end - start
    for index in range(start, end):
        progress = (index - start) / max(1, length)
        envelope = (1 - progress) ** 2
        noise_value = _noise_value(index, seed)
        body = 0.0
        if body_frequency:
            local_seconds = (index - start) / sample_rate
            body = math.sin(2 * math.pi * body_frequency * local_seconds) * 0.45
        samples[index] += (noise_value + body) * amplitude * envelope


def _mix_kick(
    samples: List[float],
    *,
    start_seconds: float,
    duration_seconds: float,
    sample_rate: int,
    amplitude: float,
) -> None:
    start = max(0, int(start_seconds * sample_rate))
    end = min(len(samples), int((start_seconds + duration_seconds) * sample_rate))
    if end <= start:
        return

    length = end - start
    phase = 0.0
    for index in range(start, end):
        progress = (index - start) / max(1, length)
        frequency = 115 - 70 * progress
        phase += 2 * math.pi * frequency / sample_rate
        envelope = (1 - progress) ** 3
        click = _noise_value(index, 31) * max(0.0, 1 - progress * 22) * 0.15
        samples[index] += (math.sin(phase) + click) * amplitude * envelope


def _style_family(composition: Composition) -> str:
    style = composition.style.strip().lower()
    if style in {"rock", "edm", "jazz", "folk", "cinematic", "r&b", "lo-fi"}:
        return style
    if style in {"lofi", "lo fi"}:
        return "lo-fi"
    if style in {"rnb", "r and b"}:
        return "r&b"
    text = " ".join(
        [
            composition.style,
            composition.mood,
            " ".join(composition.style_notes),
        ]
    ).lower()
    if "rock" in text or "guitar" in text or "riff" in text:
        return "rock"
    if "edm" in text or "drop" in text or "sidechain" in text:
        return "edm"
    if "jazz" in text or "swing" in text or "walking" in text:
        return "jazz"
    if "folk" in text or "acoustic" in text:
        return "folk"
    if "cinematic" in text or "strings" in text:
        return "cinematic"
    if "r&b" in text or "groove" in text:
        return "r&b"
    return "lo-fi"


def _mix_drum_pattern(
    samples: List[float],
    *,
    family: str,
    bar_start: float,
    beats_per_bar: float,
    beat_seconds: float,
    sample_rate: int,
) -> None:
    beat_count = max(1, int(beats_per_bar))

    if family == "edm":
        for beat in range(beat_count):
            _mix_kick(samples, start_seconds=bar_start + beat * beat_seconds, duration_seconds=0.22, sample_rate=sample_rate, amplitude=0.22)
        for beat in (1, 3):
            if beat < beat_count:
                _mix_noise(samples, start_seconds=bar_start + beat * beat_seconds, duration_seconds=0.16, sample_rate=sample_rate, amplitude=0.11, seed=beat, body_frequency=190)
        for step in range(beat_count * 2):
            _mix_noise(samples, start_seconds=bar_start + (step + 0.5) * beat_seconds / 2, duration_seconds=0.045, sample_rate=sample_rate, amplitude=0.035, seed=step + 50)
        return

    if family == "rock":
        for beat in (0, 2):
            if beat < beat_count:
                _mix_kick(samples, start_seconds=bar_start + beat * beat_seconds, duration_seconds=0.2, sample_rate=sample_rate, amplitude=0.2)
        for beat in (1, 3):
            if beat < beat_count:
                _mix_noise(samples, start_seconds=bar_start + beat * beat_seconds, duration_seconds=0.18, sample_rate=sample_rate, amplitude=0.15, seed=beat + 10, body_frequency=210)
        for step in range(beat_count * 2):
            _mix_noise(samples, start_seconds=bar_start + step * beat_seconds / 2, duration_seconds=0.035, sample_rate=sample_rate, amplitude=0.028, seed=step + 90)
        return

    if family in {"lo-fi", "r&b", "jazz"}:
        _mix_kick(samples, start_seconds=bar_start, duration_seconds=0.18, sample_rate=sample_rate, amplitude=0.11)
        if beat_count > 2:
            _mix_noise(samples, start_seconds=bar_start + 2 * beat_seconds, duration_seconds=0.14, sample_rate=sample_rate, amplitude=0.07, seed=21, body_frequency=160)
        for step in range(beat_count):
            _mix_noise(samples, start_seconds=bar_start + (step + 0.5) * beat_seconds, duration_seconds=0.025, sample_rate=sample_rate, amplitude=0.015, seed=step + 120)


def composition_to_wav_bytes(composition: Composition, sample_rate: int = 44100, stem: str = "full") -> bytes:
    beat_seconds = 60 / composition.tempo_bpm
    beats_per_bar = _beats_per_bar(composition.time_signature)
    family = _style_family(composition)
    include_drums = stem in {"full", "rhythm", "drums"}
    include_bass = stem in {"full", "rhythm", "bass"}
    include_harmony = stem in {"full", "harmony"}
    include_melody = stem in {"full", "melody"}
    total_seconds = sum(section.bars * beats_per_bar * beat_seconds for section in composition.sections)
    total_samples = max(1, int((total_seconds + 0.25) * sample_rate))
    samples: List[float] = [0.0] * total_samples

    cursor = 0.0
    for section in composition.sections:
        section_start = cursor
        bar_seconds = beats_per_bar * beat_seconds

        for bar_index in range(section.bars):
            symbol = section.chords[bar_index % len(section.chords)]
            bar_start = section_start + bar_index * bar_seconds
            if include_drums:
                _mix_drum_pattern(
                    samples,
                    family=family,
                    bar_start=bar_start,
                    beats_per_bar=beats_per_bar,
                    beat_seconds=beat_seconds,
                    sample_rate=sample_rate,
                )
            if include_bass:
                _mix_tone(
                    samples,
                    frequency=_pitch_frequency(_chord_root_pitch(symbol, octave=2)),
                    start_seconds=bar_start,
                    duration_seconds=bar_seconds,
                    sample_rate=sample_rate,
                    amplitude=0.18 if family in {"rock", "edm"} else 0.12,
                    waveform="saw" if family in {"rock", "edm"} else "triangle",
                )

            chord_pitches = _power_chord_pitches(symbol) if family == "rock" else _chord_pitches(symbol)
            chord_waveform = "distorted" if family == "rock" else "saw" if family == "edm" else "triangle"
            chord_amplitude = 0.065 if family == "rock" else 0.045 if family == "edm" else 0.035
            if include_harmony:
                for chord_index, chord_pitch in enumerate(chord_pitches):
                    strum_offset = chord_index * 0.018 if family == "rock" else 0.0
                    _mix_tone(
                        samples,
                        frequency=_pitch_frequency(chord_pitch),
                        start_seconds=bar_start + strum_offset,
                        duration_seconds=bar_seconds * 0.96,
                        sample_rate=sample_rate,
                        amplitude=chord_amplitude,
                        waveform=chord_waveform,
                    )

        melody_cursor = section_start
        for melody_note in section.melody:
            note_seconds = float(melody_note.duration_beats) * beat_seconds
            if include_melody:
                _mix_tone(
                    samples,
                    frequency=_pitch_frequency(melody_note.pitch),
                    start_seconds=melody_cursor,
                    duration_seconds=note_seconds * 0.94,
                    sample_rate=sample_rate,
                    amplitude=0.16,
                    waveform="sine",
                )
            melody_cursor += note_seconds

        cursor = section_start + section.bars * bar_seconds

    peak = max(max(abs(value) for value in samples), 0.001)
    gain = 0.88 / peak if peak > 0.88 else 1.0
    pcm = bytearray()
    for value in samples:
        clipped = max(-1.0, min(1.0, value * gain))
        pcm.extend(struct.pack("<h", int(clipped * 32767)))

    output = BytesIO()
    with wave.open(output, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(bytes(pcm))
    return output.getvalue()


def composition_to_musicxml_bytes(composition: Composition) -> bytes:
    score = build_score(composition)
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".musicxml", delete=False) as temp_file:
            temp_path = Path(temp_file.name)
        score.write("musicxml", fp=str(temp_path))
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
