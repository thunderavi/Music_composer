import json
import logging
import asyncio
from typing import Any, Dict, List, Optional, TypedDict
from pydantic import ValidationError

from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from langgraph.graph import StateGraph, END

from .config import get_settings
from .schemas import ComposeRequest, Composition, SongSection, MelodyNote
from .music import validate_composition, optimize_generated_composition
from .commercial import commercial_review
from .evaluation import evaluate_composition
from .nim_client import (
    _style_blueprint,
    _normalize_plan,
    _normalize_chords,
    _normalize_melody,
    _normalize_lines,
    extract_json_object,
    build_critic_agent_prompt,
    build_mix_agent_prompt,
    build_safety_agent_prompt,
)

logger = logging.getLogger("music-composer")

# ── Music-theory guide per style ───────────────────────────────────────────────
# Each entry tells the Theorist Agent what idiomatic progressions, rhythms, and
# chord extensions to use — modelled on real song analysis (Chordify-style).
CHORD_PROGRESSIONS: Dict[str, Dict[str, str]] = {
    "lo-fi": {
        "progressions": "i-VII-VI-VII | i-III-VII-VI | I-V-vi-IV | ii-V-Imaj7",
        "rhythm": "4 beats per chord (one per bar). Optionally split the last bar 2+2 for motion.",
        "extensions": "Freely add 7ths and 9ths: Am7, Fmaj7, Cmaj9, Dm9, G7sus4.",
        "vibe": "Looping, hypnotic, mellow — gentle dominant tension only when resolving softly.",
        "example": '[{"chord":"Am7","duration_beats":4},{"chord":"Fmaj7","duration_beats":4},{"chord":"Cmaj7","duration_beats":4},{"chord":"G7","duration_beats":4}]',
    },
    "pop": {
        "progressions": "I-V-vi-IV | vi-IV-I-V | I-IV-I-V | I-vi-IV-V",
        "rhythm": "Verse: 4 beats each. Chorus: 2+2 beat split on last pair for energy lift.",
        "extensions": "sus2, add9 on I and IV. Radio-clean. Avoid harsh dissonance.",
        "vibe": "Strong tonic arrival on chorus. Mild tension in pre-chorus.",
        "example": '[{"chord":"C","duration_beats":4},{"chord":"G","duration_beats":4},{"chord":"Am","duration_beats":4},{"chord":"F","duration_beats":4}]',
    },
    "rock": {
        "progressions": "I-IV-V-I | i-VII-IV-i | I-V-IV-I | vi-IV-I-V",
        "rhythm": "Power chords can be 2 beats each (2 per bar). Intro may hold 1 chord for 2 bars.",
        "extensions": "Power chords (A5, E5, D5). Add occasional maj or min color. Avoid heavy jazz.",
        "vibe": "Driving energy, clear downbeats, strong cadences.",
        "example": '[{"chord":"E5","duration_beats":4},{"chord":"D5","duration_beats":4},{"chord":"A5","duration_beats":2},{"chord":"B5","duration_beats":2}]',
    },
    "edm": {
        "progressions": "i-VII-VI-VII | vi-IV-I-V | i-III-VII-IV",
        "rhythm": "Loop-based: 4 or 8 beats per chord. Simple triads for pad texture. Very loopable.",
        "extensions": "Triads or sus2 for synth pads. Keep it minimal — energy comes from arrangement.",
        "vibe": "Hypnotic repetition. One chord per 2 bars on build sections.",
        "example": '[{"chord":"Am","duration_beats":8},{"chord":"F","duration_beats":8},{"chord":"C","duration_beats":8},{"chord":"G","duration_beats":8}]',
    },
    "jazz": {
        "progressions": "ii-V-I | I-VI-ii-V | iii-VI-ii-V | I-IV-iii-VI-ii-V-I",
        "rhythm": "Jazz may have 2 chords per bar (2 beats each). Turnarounds use quick ii-V.",
        "extensions": "7th, 9th, 11th, 13th freely: Dm9, G13, Cmaj9, Am11. Voice-leading is key.",
        "vibe": "Sophisticated, smooth. Avoid raw triads unless intentionally stark.",
        "example": '[{"chord":"Dm9","duration_beats":4},{"chord":"G13","duration_beats":4},{"chord":"Cmaj9","duration_beats":4},{"chord":"Am11","duration_beats":4}]',
    },
    "r&b": {
        "progressions": "i-III-VII-IV | I-V-vi-IV | ii-V-I | i-VII-VI-VII",
        "rhythm": "Groove-driven: 4 beats each. Occasional 2+2 split for syncopation feel.",
        "extensions": "m7, maj7, 9, 11 — soulful extended harmony. Smooth voice-leading.",
        "vibe": "Warm groove, emotional color, clear hook landing on the I chord.",
        "example": '[{"chord":"Am9","duration_beats":4},{"chord":"Cmaj7","duration_beats":4},{"chord":"Fmaj9","duration_beats":4},{"chord":"G7","duration_beats":4}]',
    },
    "folk": {
        "progressions": "I-IV-V-I | I-vi-IV-V | I-IV-I-V | I-V-vi-iii",
        "rhythm": "Simple 4 beats per chord. Easy acoustic strum patterns. Plain guitar shapes.",
        "extensions": "sus4 or sus2 for subtle color. No jazz voicings.",
        "vibe": "Storytelling, authentic, breathable. Resolution on I feels warm.",
        "example": '[{"chord":"G","duration_beats":4},{"chord":"C","duration_beats":4},{"chord":"D","duration_beats":4},{"chord":"G","duration_beats":4}]',
    },
    "cinematic": {
        "progressions": "i-VII-VI-VII | i-v-VI-VII | I-II-IV-I | i-III-VII-VI",
        "rhythm": "Long chords: 8 beats (2 bars) for epic feel. Short 2-beat chords for tension peaks.",
        "extensions": "Pedal tones, sus chords, add9, wide voicings. Strings love maj7 and sus4.",
        "vibe": "Epic, dramatic, wide emotional arc. Long resolution pays off tension.",
        "example": '[{"chord":"Am","duration_beats":8},{"chord":"F","duration_beats":8},{"chord":"C","duration_beats":4},{"chord":"E","duration_beats":4}]',
    },
}

class AgentState(TypedDict):
    request: ComposeRequest
    reference_patterns: Optional[Dict[str, Any]]
    plan: Optional[Dict[str, Any]]
    chords: Optional[Dict[str, Any]]
    melody: Optional[Dict[str, Any]]
    lyrics: Optional[Dict[str, Any]]
    ai_lyrics: Optional[Dict[str, Any]]
    arrangement: Optional[Dict[str, Any]]
    
    # Outputs
    safe_composition: Optional[Composition]
    balanced_composition: Optional[Composition]
    wild_composition: Optional[Composition]

def get_llm(temperature: float = 0.7) -> ChatOpenAI:
    settings = get_settings()
    if not settings.nim_api_key:
        raise RuntimeError("NVIDIA_API_KEY is not configured.")
    return ChatOpenAI(
        model=settings.nim_model,
        openai_api_key=settings.nim_api_key,
        openai_api_base=settings.normalized_nim_base_url,
        temperature=temperature,
        max_tokens=4096,
        request_timeout=settings.nim_timeout_seconds,
    )

async def _chat_json(llm: ChatOpenAI, system_prompt: str, user_prompt: str, repair_goal: str) -> Dict[str, Any]:
    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_prompt),
    ]
    response = await llm.ainvoke(messages)
    content = str(response.content)
    try:
        return extract_json_object(content)
    except (json.JSONDecodeError, ValueError) as exc:
        logger.warning("JSON parsing failed, attempting repair for %s: %s", repair_goal, exc)
        # Truncated JSON: if content is very long and ends abruptly, try to close it first
        truncated_hint = ""
        if len(content) > 2000 and not content.rstrip().endswith("}"):
            truncated_hint = " The JSON appears truncated — close all open arrays and objects to make it valid."
        repair_system = (
            "You are a JSON repair assistant. Fix the invalid JSON text so it matches the required schema perfectly. "
            "Return valid JSON only, without commentary or markdown code fences."
            + truncated_hint
        )
        repair_user = (
            f"Repair this output into valid JSON for this goal: {repair_goal}.\n\n"
            f"Invalid output:\n{content[:3000]}\n\nError:\n{exc}"
        )
        settings = get_settings()
        repair_llm = ChatOpenAI(
            model=llm.model_name,
            openai_api_key=llm.openai_api_key,
            openai_api_base=llm.openai_api_base,
            temperature=0.1,
            max_tokens=4096,
            request_timeout=settings.nim_timeout_seconds,
        )
        repair_response = await repair_llm.ainvoke([
            SystemMessage(content=repair_system),
            HumanMessage(content=repair_user)
        ])
        return extract_json_object(str(repair_response.content))

# ----------------- Prompt Builders -----------------

def build_reference_prompt(request: ComposeRequest) -> str:
    blueprint = _style_blueprint(request.style)
    return f"""
AGENT: Reference & Coordinator Agent.
Simulate searching music databases for 2-3 real songs that match style "{request.style}", mood "{request.mood}", and theme "{request.theme}".
Analyze their structures, key ranges, tempos, characteristic chord progressions, and lyric motifs.
Then, create a coordinator plan for the new song.

Return JSON only:
{{
  "reference_songs": [
    {{"title": string, "artist": string, "key": string, "tempo_bpm": integer, "chord_traits": string}}
  ],
  "patterns": {{
    "key_profile": string,
    "style_signatures": [string],
    "common_chords": [string]
  }},
  "plan": {{
    "title": string,
    "brief": string,
    "sections": [
      {{"name": string, "bars": integer, "purpose": string}}
    ]
  }}
}}

Requirements:
- Style: {request.style}
- Mood: {request.mood}
- Theme: {request.theme}
- Key: {request.key}
- Tempo: {request.tempo_bpm}
- Total plan bars must equal {request.bars}.
- Use 2-4 sections, max 16 bars each.
- Section names must be chosen from style vocabulary: {blueprint["sections"]}.
""".strip()

def build_theorist_prompt(request: ComposeRequest, state: AgentState) -> str:
    blueprint = _style_blueprint(request.style)
    patterns_json = json.dumps(state.get("reference_patterns") or {})
    plan_json = json.dumps(state.get("plan") or {})
    prog_guide = CHORD_PROGRESSIONS.get(request.style.lower(), CHORD_PROGRESSIONS.get("pop", {}))
    try:
        beats_per_bar = int(request.time_signature.split("/")[0])
    except (ValueError, IndexError):
        beats_per_bar = 4

    return f"""
AGENT: Theorist Agent — Music Theory & Harmony Expert.
Generate professional, idiomatic chord progressions with precise beat timing per section.

Output JSON ONLY using this schema:
{{
  "sections": [
    {{
      "name": string,
      "bars": integer,
      "chord_events": [
        {{"chord": string, "duration_beats": number}}
      ],
      "chords": [string]
    }}
  ],
  "harmony_notes": [string]
}}

COMPOSITION CONTEXT:
- Key: {request.key}
- Style: {request.style} | Mood: {request.mood}
- Time signature: {request.time_signature} = {beats_per_bar} beats per bar
- Total bars per section: see coordinator plan

STYLE GUIDE FOR {request.style.upper()}:
- Idiomatic progressions: {prog_guide.get("progressions", "Use genre-appropriate chords")}
- Chord rhythm pattern: {prog_guide.get("rhythm", "4 beats per chord")}
- Recommended extensions: {prog_guide.get("extensions", "Use appropriate chord extensions")}
- Vibe/intent: {prog_guide.get("vibe", "Match the mood")}
- Example chord_events: {prog_guide.get("example", "")}

SECTION ROLE GUIDANCE:
- Intro/Outro: Simple 1-2 chord loop that establishes the mood. Low complexity.
- Verse/A-Section: Establish tonal center, build narrative tension, forward motion.
- Pre-Chorus/Build: Increased tension, often lands on V or iv before resolution.
- Chorus/Hook/Drop: Maximum energy and resolution. Strong tonic (I) arrival.
- Bridge/Break/Solo: Maximum harmonic contrast. Consider parallel minor, borrowed chords.

THEORY RULES:
1. ALL chords must be diatonic to {request.key} or tastefully borrowed (e.g., bVII, bVI, iv in major).
2. chord_events duration_beats for each section MUST sum to exactly: bars × {beats_per_bar}.
3. Use only parseable chord symbols: C, Am, G7, Fmaj7, Dm9, Esus4, A5, Bb, etc.
4. The flat "chords" array must list chord names in the same order as chord_events.
5. Avoid clichéd default progressions unless they genuinely suit the style.
6. Add rhythmic variety — mix 4-beat and 2-beat chords where appropriate to the style.
7. the lyrics should be properly define with the chord supposedly an example:     Em       C  
Dehleez pe mere dil ki jo rakhe hain tune qadam  
G        D        Em       C  
Tere naam pe meri zindagi likh di, mere humdum  


Reference patterns from analyzed songs:
{patterns_json}

Coordinator plan:
{plan_json}
""".strip()

def build_composer_prompt(request: ComposeRequest, state: AgentState) -> str:
    blueprint = _style_blueprint(request.style)
    plan_json = json.dumps(state.get("plan") or {})
    chord_json = json.dumps(state.get("chords") or {})
    return f"""
AGENT: Composer Agent.
Write symbolic melody notes for each section. Return JSON only:
{{
  "sections": [
    {{
      "name": string,
      "melody": [
        {{"pitch": string, "duration_beats": number, "lyric_syllable": string or null}}
      ]
    }}
  ],
  "melody_notes": [string]
}}

Coordinator plan:
{plan_json}

Theorist chord progression:
{chord_json}

Rules:
- Style: {request.style}; Key: {request.key}; Tempo: {request.tempo_bpm}; Time: {request.time_signature}.
- Melody direction for {request.style}: {blueprint["melody"]}.
- Use pitch names like C4, D#4, Bb4, or "rest".
- Use duration_beats only from 0.25, 0.5, 1, 1.5, 2, 3, 4.
- Each section melody should cover most of that section's bars.
""".strip()

def build_lyricist_prompt(request: ComposeRequest, state: AgentState) -> str:
    blueprint = _style_blueprint(request.style)
    plan_json = json.dumps(state.get("plan") or {})
    custom_lyrics = request.custom_lyrics or ""
    if custom_lyrics.strip():
        return f"""
AGENT: Lyricist Agent.
The user has provided their own custom lyrics. Your task is to:
1. Divide these custom lyrics cleanly across the planned sections of the coordinator plan.
   Do not rewrite their words or add new lines. Just partition their lines to fit the planned sections.
   Output this as a JSON object under "mapped".
2. Generate completely original AI lyrics from scratch matching style "{request.style}", mood "{request.mood}", and theme "{request.theme}".
   Output this as a JSON object under "ai".

Return JSON only:
{{
  "mapped": {{
    "sections": [
      {{"name": string, "lyric_lines": [string]}}
    ],
    "lyrics": [string]
  }},
  "ai": {{
    "sections": [
      {{"name": string, "lyric_lines": [string]}}
    ],
    "lyrics": [string]
  }},
  "lyric_notes": [string]
}}

User custom lyrics:
{custom_lyrics}

Coordinator plan:
{plan_json}
""".strip()
    else:
        return f"""
AGENT: Lyricist Agent.
Write lyric lines for each section. Return JSON only:
{{
  "sections": [
    {{"name": string, "lyric_lines": [string]}}
  ],
  "lyrics": [string],
  "lyric_notes": [string]
}}

Coordinator plan:
{plan_json}

Rules:
- Style: {request.style}; Mood: {request.mood}; Theme: {request.theme}.
- Lyric direction for {request.style}: {blueprint["lyrics"]}.
- Keep lyric lines short enough for a first draft.
""".strip()

def build_improvisor_prompt(request: ComposeRequest, state: AgentState) -> str:
    plan_json = json.dumps(state.get("plan") or {})
    chord_json = json.dumps(state.get("chords") or {})
    melody_json = json.dumps(state.get("melody") or {})
    return f"""
AGENT: Improvisor Agent.
Improvise on the chords and melody. Add variations, embellishments, fills, and write bassline/drum pattern guidance.
Return JSON only:
{{
  "sections": [
    {{
      "name": string,
      "improvised_chords": [string],
      "improvised_melody": [
        {{"pitch": string, "duration_beats": number, "lyric_syllable": string or null}}
      ]
    }}
  ],
  "drum_pattern": [string],
  "bassline": [string],
  "style_notes": [string],
  "originality_notes": [string],
  "instrumentation_notes": [string]
}}

Coordinator plan:
{plan_json}

Base chords:
{chord_json}

Base melody:
{melody_json}

Rules:
- Enhance chord voicings (e.g. C -> Cmaj7 or Cadd9 if appropriate for {request.style}).
- Add small melodic fills or rhythm adjustments.
- Bassline and drum pattern guidance should match {request.style} at {request.tempo_bpm} BPM.
""".strip()

def build_director_prompt(request: ComposeRequest, state: AgentState, tier: str, lyrics: Dict[str, Any]) -> str:
    plan = state.get("plan") or {}
    chords = state.get("chords") or {}
    melody = state.get("melody") or {}
    improv = state.get("arrangement") or {}
    
    sections_data = []
    for section in plan.get("sections", []):
        name = section["name"]
        sec_key = name.lower().strip()
        
        chord_list = chords.get("sections", [])
        chord_section = next((s for s in chord_list if s["name"].lower().strip() == sec_key), {})
        
        melody_list = melody.get("sections", [])
        melody_section = next((s for s in melody_list if s["name"].lower().strip() == sec_key), {})
        
        lyric_list = lyrics.get("sections", [])
        lyric_section = next((s for s in lyric_list if s["name"].lower().strip() == sec_key), {})
        
        improv_list = improv.get("sections", [])
        improv_section = next((s for s in improv_list if s["name"].lower().strip() == sec_key), {})
        
        # Use improvised chords/melody if available, falling back to base
        final_chords = improv_section.get("improvised_chords") or chord_section.get("chords") or []
        final_melody = improv_section.get("improvised_melody") or melody_section.get("melody") or []
        # Carry chord_events (timed) from Theorist output; regenerate from flat chords if missing
        final_chord_events = chord_section.get("chord_events") or [
            {"chord": c, "duration_beats": 4} for c in final_chords
        ]

        sections_data.append({
            "name": name,
            "bars": section["bars"],
            "chord_events": final_chord_events,
            "chords": final_chords,
            "melody": final_melody[:12],  # keep concise
            "lyric_lines": lyric_section.get("lyric_lines") or []
        })
        
    context = {
        "title": plan.get("title", f"{request.style} composition"),
        "style": request.style,
        "mood": request.mood,
        "key": request.key,
        "tempo_bpm": request.tempo_bpm,
        "time_signature": request.time_signature,
        "sections": sections_data,
        "lyrics": lyrics.get("lyrics", []),
        "drum_pattern": improv.get("drum_pattern", []),
        "bassline": improv.get("bassline", []),
        "style_notes": (improv.get("style_notes", []) + improv.get("instrumentation_notes", []))[:12],
        "originality_notes": improv.get("originality_notes", [])[:12]
    }
    
    return f"""
AGENT: Director Agent ({tier.upper()} variant).
Your task is to compile the final composition JSON for the {tier.upper()} tier.

Theme details:
Style: {request.style}
Mood: {request.mood}
Key: {request.key}

Input musical draft:
{json.dumps(context)}

Tier guidelines for {tier.upper()}:
{"- SAFE: Enforce strict diatonic scale limits. Correct any chord or pitch out of key. Use simple standard triads. Make melody highly stepwise and conservative." if tier == "safe" else ""}
{"- BALANCED: Retain tasteful improvised extensions (like maj7, add9, sus4). Maintain structural cohesion while keeping interesting melodic hooks." if tier == "balanced" else ""}
{"- WILD: Extreme creativity. Add unexpected modal changes, experimental chords, or chromatic passing melody notes. Make lyrics highly abstract and experimental." if tier == "wild" else ""}

Output the final song draft using this schema exactly:
{{
  "title": string,
  "style": "{request.style}",
  "mood": "{request.mood}",
  "key": "{request.key}",
  "tempo_bpm": {request.tempo_bpm},
  "time_signature": "{request.time_signature}",
  "sections": [
    {{
      "name": string,
      "bars": integer,
      "chord_events": [
        {{"chord": string, "duration_beats": number}}
      ],
      "chords": [string],
      "melody": [
        {{"pitch": string, "duration_beats": number, "lyric_syllable": string or null}}
      ],
      "lyric_lines": [string],
      "lyric_chord_lines": [string]
    }}
  ],
  "lyrics": [string],
  "style_notes": [string],
  "originality_notes": [string],
  "disclaimer": "Generated music may resemble existing works. Review and clear rights before commercial use."
}}

HOW TO GENERATE lyric_chord_lines:
- For each lyric line, place [ChordName] inline at the word where that chord begins.
- Use the SAME chords from chord_events — do not invent new ones.
- Each chord from chord_events should appear once per lyric line (roughly proportional to its duration).
- Format: "[Am]Zindagi chalti [G]jaaye, [F]gham bhi [C]hote hain saath"
- If a section has 4 chords and 2 lyric lines, distribute ~2 chords per line.
- lyric_chord_lines must have the SAME number of entries as lyric_lines.

CRITICAL OUTPUT RULES:
- Output ONLY valid JSON. No markdown fences, no commentary, no extra text.
- chord_events durations must sum to bars × beats_per_bar for each section.
- chord_events and chords must stay in sync (same chords, same order).
- melody: max 12 notes per section. lyric_lines and lyric_chord_lines: max 6 per section.
- lyrics: max 16 total. style_notes + originality_notes: max 6 each.
""".strip()

# ----------------- LangGraph Nodes -----------------

async def reference_node(state: AgentState) -> Dict[str, Any]:
    logger.info("Running Reference Agent (Ag0)")
    llm = get_llm(temperature=0.6)
    prompt = build_reference_prompt(state["request"])
    system_prompt = "You are an expert musicologist and song structure coordinator. Output JSON only."
    raw_doc = await _chat_json(llm, system_prompt, prompt, "reference patterns & song plan")
    
    plan = _normalize_plan(raw_doc.get("plan", {}), state["request"])
    return {
        "reference_patterns": raw_doc.get("patterns"),
        "plan": plan
    }

async def theorist_node(state: AgentState) -> Dict[str, Any]:
    logger.info("Running Theorist Agent (Ag1)")
    llm = get_llm(temperature=state["request"].creativity)
    prompt = build_theorist_prompt(state["request"], state)
    system_prompt = "You are a expert music theory agent. Write chords. Output JSON only."
    raw_doc = await _chat_json(llm, system_prompt, prompt, "theorist chords")
    return {"chords": raw_doc}

async def composer_node(state: AgentState) -> Dict[str, Any]:
    logger.info("Running Composer Agent (Ag2)")
    llm = get_llm(temperature=state["request"].creativity)
    prompt = build_composer_prompt(state["request"], state)
    system_prompt = "You are an expert composer agent. Write symbolic melodies. Output JSON only."
    raw_doc = await _chat_json(llm, system_prompt, prompt, "composer melody")
    return {"melody": raw_doc}

async def lyricist_node(state: AgentState) -> Dict[str, Any]:
    logger.info("Running Lyricist Agent (Ag3)")
    llm = get_llm(temperature=state["request"].creativity)
    prompt = build_lyricist_prompt(state["request"], state)
    system_prompt = "You are a professional lyricist. Write or structure song lyrics. Output JSON only."
    raw_doc = await _chat_json(llm, system_prompt, prompt, "lyricist lyrics")
    
    if state["request"].custom_lyrics and state["request"].custom_lyrics.strip():
        mapped_lyrics = raw_doc.get("mapped", {})
        ai_lyrics = raw_doc.get("ai", {})
        mapped_lyrics["lyric_notes"] = raw_doc.get("lyric_notes", [])
        ai_lyrics["lyric_notes"] = raw_doc.get("lyric_notes", [])
        return {
            "lyrics": mapped_lyrics,
            "ai_lyrics": ai_lyrics
        }
    else:
        return {
            "lyrics": raw_doc,
            "ai_lyrics": raw_doc
        }

async def improvisor_node(state: AgentState) -> Dict[str, Any]:
    logger.info("Running Improvisor Agent (Ag4)")
    llm = get_llm(temperature=max(0.4, state["request"].creativity - 0.05))
    prompt = build_improvisor_prompt(state["request"], state)
    system_prompt = "You are a creative session musician. Embellish and improvise on melody and chords. Output JSON only."
    raw_doc = await _chat_json(llm, system_prompt, prompt, "improvisor arrangement")
    return {"arrangement": raw_doc}

async def _compile_tier(
    state: AgentState,
    tier: str,
    temperature: float,
    lyrics_source: Dict[str, Any],
    *,
    run_reviews: bool = True,
) -> Composition:
    logger.info("Director compiling tier: %s", tier)
    llm = get_llm(temperature=temperature)
    prompt = build_director_prompt(state["request"], state, tier, lyrics_source)
    system_prompt = f"You are the Director Agent ({tier.upper()} mode). Assemble the final composition. Output JSON only."
    
    raw_doc = await _chat_json(llm, system_prompt, prompt, f"director {tier} composition")
    
    # 1. Parse and validate base composition model
    composition = optimize_generated_composition(Composition.model_validate(raw_doc))
    
    # 2. Enrich with additional items from Improvisor
    arrangement = state.get("arrangement") or {}
    composition.drum_pattern = _normalize_lines(arrangement.get("drum_pattern"), f"genre groove matching {state['request'].tempo_bpm} BPM")[:16]
    composition.bassline = _normalize_lines(arrangement.get("bassline"), "genre bassline following roots")[:16]
    
    base_trace = [
        "Ag0 Reference Agent analyzed reference patterns.",
        "Ag1 Theorist Agent generated progressions.",
        "Ag2 Composer Agent wrote melody.",
        "Ag3 Lyricist Agent wrote lyric lines.",
        "Ag4 Improvisor Agent embellished parts.",
        f"Ag5 Director Agent compiled {tier.upper()} variant.",
    ]

    if run_reviews:
        critic_doc = await _chat_json(
            get_llm(temperature=0.2),
            "You are a critical music editor. Review for style adherence. Output JSON only.",
            build_critic_agent_prompt(composition),
            f"critic review ({tier})"
        )
        mix_doc = await _chat_json(
            get_llm(temperature=0.35),
            "You are an expert audio mixing engineer. Write stem mixing notes. Output JSON only.",
            build_mix_agent_prompt(state["request"], composition),
            f"mix review ({tier})"
        )
        safety_doc = await _chat_json(
            get_llm(temperature=0.2),
            "You are a commercial licensing safety agent. Output JSON only.",
            build_safety_agent_prompt(state["request"], composition),
            f"safety review ({tier})"
        )

        critic_notes = _normalize_lines(critic_doc.get("improvements"), "Critic agent approved the editable draft.")
        if critic_doc.get("warnings"):
            critic_notes.extend(_normalize_lines(critic_doc.get("warnings"), "Review warnings before release."))

        composition.originality_notes = (composition.originality_notes + critic_notes)[:12]
        composition.mix_notes = _normalize_lines(mix_doc.get("mix_notes"), "Balance sections before export.")[:16]
        composition.commercial_notes = (
            _normalize_lines(safety_doc.get("commercial_notes"), "Use human review before commercial release.")
            + _normalize_lines(safety_doc.get("risk_warnings"), "No major commercial safety warnings returned.")
        )[:16]
        composition.agent_trace = (
            base_trace
            + [
                "Critic Agent reviewed style adherence.",
                "Mix Agent generated audio stem notes.",
                "Safety Agent audited rights risks.",
            ]
        )[:16]
    else:
        composition.mix_notes = _normalize_lines(
            composition.mix_notes,
            "Balance sections before export.",
        )[:16]
        composition.commercial_notes = _normalize_lines(
            composition.commercial_notes,
            "Use human review before commercial release.",
        )[:16]
        composition.agent_trace = base_trace[:16]
    
    return composition

async def director_node(state: AgentState) -> Dict[str, Any]:
    logger.info("Running Director Agent (Ag5) compiling 3 creative tiers")
    user_lyrics = state.get("lyrics") or {}
    ai_lyrics = state.get("ai_lyrics") or {}
    
    safe_task = _compile_tier(state, "safe", 0.15, user_lyrics, run_reviews=False)
    balanced_task = _compile_tier(state, "balanced", 0.6, user_lyrics, run_reviews=True)
    wild_task = _compile_tier(state, "wild", 0.95, ai_lyrics, run_reviews=False)
    
    safe_comp, balanced_comp, wild_comp = await asyncio.gather(safe_task, balanced_task, wild_task)
    return {
        "safe_composition": safe_comp,
        "balanced_composition": balanced_comp,
        "wild_composition": wild_comp
    }

# ----------------- Build and Compile Graph -----------------

def create_workflow() -> StateGraph:
    workflow = StateGraph(AgentState)
    
    # Add Nodes
    workflow.add_node("reference", reference_node)
    workflow.add_node("theorist", theorist_node)
    workflow.add_node("composer", composer_node)
    workflow.add_node("lyricist", lyricist_node)
    workflow.add_node("improvisor", improvisor_node)
    workflow.add_node("director", director_node)
    
    # Set Entry Point and Edges
    workflow.set_entry_point("reference")
    workflow.add_edge("reference", "theorist")
    workflow.add_edge("theorist", "composer")
    workflow.add_edge("composer", "lyricist")
    workflow.add_edge("lyricist", "improvisor")
    workflow.add_edge("improvisor", "director")
    workflow.add_edge("director", END)
    
    return workflow

# Compile Workflow Graph
workflow_app = create_workflow().compile()

async def run_composition_workflow(request: ComposeRequest) -> Dict[str, Composition]:
    initial_state = {
        "request": request,
        "reference_patterns": None,
        "plan": None,
        "chords": None,
        "melody": None,
        "lyrics": None,
        "ai_lyrics": None,
        "arrangement": None,
        "safe_composition": None,
        "balanced_composition": None,
        "wild_composition": None,
    }
    
    final_state = await workflow_app.ainvoke(initial_state)
    return {
        "safe": final_state["safe_composition"],
        "balanced": final_state["balanced_composition"],
        "wild": final_state["wild_composition"]
    }
