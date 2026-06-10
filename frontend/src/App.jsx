import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BadgeCheck,
  ChevronRight,
  Download,
  FileMusic,
  FolderPlus,
  Gauge,
  History,
  Layers,
  Loader2,
  LogOut,
  Moon,
  Music,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Wand2,
  Waves
} from "lucide-react";
import {
  composeSong,
  createProject,
  createDraft,
  createWorkspace,
  downloadExport,
  evaluateComposition,
  exportCompositionBlob,
  getCurrentUser,
  getDraft,
  getProvider,
  listProjects,
  listDrafts,
  listWorkspaces,
  loginUser,
  refineSong,
  registerUser,
  reviewCommercialReadiness,
  saveDraft,
  updateProject,
  validateComposition
} from "./api.js";

const STYLE_OPTIONS = ["Lo-fi", "Pop", "Rock", "EDM", "Jazz", "R&B", "Folk", "Cinematic"];
const MOOD_OPTIONS = ["Relaxed", "Sad", "Hopeful", "Energetic", "Dreamy", "Dark", "Romantic"];
const KEY_OPTIONS = ["C major", "G major", "D major", "A minor", "E minor", "D minor", "F major", "Bb major"];
const SESSION_STORAGE_KEY = "maestro-studio-session";
const WORKSPACE_STORAGE_KEY = "maestro-studio-workspace";
const STYLE_DEFAULTS = {
  "Lo-fi": { tempo_bpm: 78, instrumentation: "warm piano, soft bass, brushed drums", creativity: 0.75 },
  Pop: { tempo_bpm: 112, instrumentation: "bright synth bass, punchy drums, layered vocal hook", creativity: 0.72 },
  Rock: { tempo_bpm: 128, instrumentation: "driven electric guitars, live drums, bass riff", creativity: 0.78 },
  EDM: { tempo_bpm: 126, instrumentation: "four-on-floor kick, sidechain synths, risers, drop bass", creativity: 0.8 },
  Jazz: { tempo_bpm: 116, instrumentation: "piano voicings, walking bass, brushed drums, muted horn lead", creativity: 0.82 },
  "R&B": { tempo_bpm: 88, instrumentation: "electric keys, deep groove bass, soft drums, vocal stacks", creativity: 0.78 },
  Folk: { tempo_bpm: 96, instrumentation: "acoustic guitar, warm bass, light percussion, harmony vocal", creativity: 0.68 },
  Cinematic: { tempo_bpm: 72, instrumentation: "strings, low pulse, wide pads, percussion swells", creativity: 0.8 }
};

const defaultInput = {
  style: "Lo-fi",
  mood: "Relaxed",
  theme: "Rainy night in a quiet city",
  key: "A minor",
  tempo_bpm: 78,
  bars: 8,
  time_signature: "4/4",
  creativity: 0.75,
  instrumentation: "warm piano, soft bass, brushed drums",
  custom_lyrics: ""
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function splitLines(value) {
  return value.split("\n").map((line) => line.trim()).filter(Boolean);
}

function splitChords(value) {
  return value.split(/\s*(?:-|,|\|)\s*/).map((item) => item.trim()).filter(Boolean);
}

function chordEventsFromChords(chords, timeSignature = "4/4") {
  const duration = beatsPerBar(timeSignature);
  return chords.map((chord) => ({ chord, duration_beats: duration }));
}

function parseMelody(value) {
  return value.split(/\s+/).map((token) => token.trim()).filter(Boolean).map((token) => {
    const [pitch, duration = "1"] = token.split(":");
    return { pitch, duration_beats: Number(duration), lyric_syllable: null };
  });
}

function melodyToText(melody) {
  return melody.map((item) => `${item.pitch}:${item.duration_beats}`).join(" ");
}

function beatsPerBar(timeSignature = "4/4") {
  const [top, bottom] = timeSignature.split("/").map(Number);
  return top * (4 / bottom);
}

function sectionBeats(section) {
  return section.melody.reduce((sum, item) => sum + Number(item.duration_beats || 0), 0);
}

function chordEventBeats(section) {
  return (section.chord_events || []).reduce((sum, item) => sum + Number(item.duration_beats || 0), 0);
}

function chordTimelineBeats(section, timeSignature = "4/4") {
  const bpb = beatsPerBar(timeSignature);
  return Math.max(section.bars * bpb, chordEventBeats(section));
}

function formatTimestamp(value) {
  if (!value) return "";
  return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function loadWorkspaceState() {
  try {
    const stored = JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY) || "{}");
    return {
      workspaceName: stored.workspaceName || "",
      projectName: stored.projectName || ""
    };
  } catch {
    return { workspaceName: "", projectName: "" };
  }
}

function loadSessionState() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

function createManualComposition(input, title) {
  const safeTitle = (title || input.theme || "Untitled Project").trim().slice(0, 80);
  const chords = input.key.includes("minor") ? ["Am", "F", "C", "G"] : ["C", "G", "Am", "F"];
  const melody = input.key.includes("minor")
    ? ["A4", "C5", "E5", "G4", "F4", "E4", "C4", "A3"]
    : ["C4", "E4", "G4", "B4", "A4", "G4", "E4", "C4"];
  const lyricLine = input.custom_lyrics?.trim() || input.theme || "Write your lyric line here";
  return {
    title: safeTitle.length >= 2 ? safeTitle : "New Project",
    style: input.style,
    mood: input.mood,
    key: input.key,
    tempo_bpm: input.tempo_bpm,
    time_signature: input.time_signature,
    sections: [
      {
        name: "Intro",
        bars: input.bars,
        chord_events: chordEventsFromChords(chords, input.time_signature),
        chords,
        melody: melody.map((pitch) => ({ pitch, duration_beats: 1, lyric_syllable: null })),
        lyric_lines: splitLines(lyricLine).slice(0, 4),
        lyric_chord_lines: [`[${chords[0]}]${lyricLine}`]
      }
    ],
    lyrics: splitLines(lyricLine).slice(0, 4),
    style_notes: ["Manual project starter. Edit chords, melody, lyrics, and arrangement directly."],
    originality_notes: ["User-created manual draft. Review before release."],
    drum_pattern: ["Add drums in the section editor or regenerate arrangement."],
    bassline: ["Follow the chord roots until a bassline is generated."],
    mix_notes: ["Balance channel levels before export."],
    commercial_notes: [],
    agent_trace: ["Manual composition created inside Maestro Studio."],
    disclaimer: "Generated or manually edited music may resemble existing works. Review and clear rights before commercial use."
  };
}

function localMetrics(composition) {
  if (!composition) return { sections: 0, bars: 0, chords: 0, notes: 0, lyrics: 0 };
  return {
    sections: composition.sections.length,
    bars: composition.sections.reduce((sum, section) => sum + section.bars, 0),
    chords: composition.sections.reduce((sum, section) => sum + section.chords.length, 0),
    notes: composition.sections.reduce((sum, section) => sum + section.melody.length, 0),
    lyrics: composition.lyrics.length
  };
}

function pitchFrequency(pitch) {
  if (!pitch || pitch === "rest") return null;
  const match = pitch.match(/^([A-G])([#b]?)(-?\d)$/);
  if (!match) return null;
  const [, letter, accidental, octaveRaw] = match;
  const semitoneMap = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const accidentalOffset = accidental === "#" ? 1 : accidental === "b" ? -1 : 0;
  const midi = (Number(octaveRaw) + 1) * 12 + semitoneMap[letter] + accidentalOffset;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function chordRootFrequency(chord) {
  const match = chord?.match(/^([A-G])([#b]?)/);
  if (!match) return null;
  return pitchFrequency(`${match[1]}${match[2]}2`);
}

function chordPowerFrequencies(chord) {
  const match = chord?.match(/^([A-G])([#b]?)/);
  if (!match) return [];
  const root = pitchFrequency(`${match[1]}${match[2]}3`);
  if (!root) return [];
  return [root, root * 1.5, root * 2];
}

function styleFamily(composition) {
  const text = [
    composition?.style,
    composition?.mood,
    ...(composition?.style_notes || [])
  ].join(" ").toLowerCase();
  if (text.includes("rock") || text.includes("guitar") || text.includes("riff")) return "rock";
  if (text.includes("edm") || text.includes("drop") || text.includes("sidechain")) return "edm";
  if (text.includes("jazz") || text.includes("swing")) return "jazz";
  return "lo-fi";
}

function ScoreBar({ label, value }) {
  return (
    <div className="score-row">
      <span>{label}</span>
      <div><i style={{ width: `${value}%` }} /></div>
      <strong>{value}</strong>
    </div>
  );
}

/**
 * Chordify-style chord timeline — shows each chord as a proportional-width block
 * aligned to the beat grid. Click any block to edit the chord name inline.
 */
function ChordTimeline({ sections, timeSignature, onChordChange }) {
  const bpb = beatsPerBar(timeSignature);
  const [editKey, setEditKey] = useState(null); // "sectionIdx-eventIdx"

  function getEvents(section) {
    if (section.chord_events && section.chord_events.length > 0) return section.chord_events;
    // Fallback: derive from flat chords assuming equal duration
    return (section.chords || []).map((chord) => ({ chord, duration_beats: bpb }));
  }

  return (
    <div className="chord-timeline">
      {sections.map((section, si) => {
        const events = getEvents(section);
        const totalBeats = chordTimelineBeats(section, timeSignature);
        const rulerBars = Math.max(1, Math.ceil(totalBeats / bpb));
        return (
          <div key={si} className="chord-timeline-row">
            <div className="chord-timeline-section-label">{section.name}</div>
            <div className="chord-timeline-track">
              {events.map((evt, ei) => {
                const widthPct = Math.max(4, (evt.duration_beats / totalBeats) * 100);
                const key = `${si}-${ei}`;
                const isEditing = editKey === key;
                return (
                  <div
                    key={key}
                    className="chord-block"
                    style={{ width: `${widthPct}%` }}
                    onClick={() => setEditKey(key)}
                  >
                    {isEditing ? (
                      <input
                        className="chord-edit"
                        defaultValue={evt.chord}
                        autoFocus
                        onBlur={(e) => {
                          onChordChange(si, ei, e.target.value.trim() || evt.chord);
                          setEditKey(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === "Escape") e.target.blur();
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className="chord-block-name">{evt.chord}</span>
                    )}
                    <span className="chord-block-dur">{evt.duration_beats}♩</span>
                  </div>
                );
              })}
            </div>
            <div className="beat-ruler">
              {Array.from({ length: rulerBars }).map((_, bi) => (
                <div key={bi} className="beat-bar">
                  {Array.from({ length: bpb }).map((_, beat) => (
                    <span key={beat}>{beat + 1}</span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * ChordLyricView - Shows chords above lyrics line by line.
 * Parses [Chord] text annotations dynamically.
 */
function ChordLyricView({ sections }) {
  function parseChordLine(line) {
    if (!line) return [];
    const tokens = [];
    const regex = /\[([^\]]+)\]([^\[]*)/g;
    let match;
    let lastIndex = 0;
    
    if (!line.includes("[")) {
      return [{ chord: null, text: line }];
    }

    while ((match = regex.exec(line)) !== null) {
      if (match.index > lastIndex) {
        const leadingText = line.substring(lastIndex, match.index);
        if (leadingText) {
          tokens.push({ chord: null, text: leadingText });
        }
      }
      tokens.push({ chord: match[1], text: match[2] });
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < line.length) {
      const trailingText = line.substring(lastIndex);
      if (trailingText) {
        tokens.push({ chord: null, text: trailingText });
      }
    }
    return tokens;
  }

  return (
    <div className="chord-lyric-view">
      {sections.map((section, si) => {
        const hasChordLyrics = section.lyric_chord_lines && section.lyric_chord_lines.length > 0;
        const linesToRender = hasChordLyrics ? section.lyric_chord_lines : (section.lyric_lines || []);
        
        return (
          <div key={si} className="chord-lyric-section">
            <h3 className="chord-lyric-section-title">{section.name}</h3>
            <div className="chord-lyric-lines">
              {linesToRender.length === 0 ? (
                <p className="chord-lyric-empty">(No lyrics for this section)</p>
              ) : (
                linesToRender.map((line, li) => {
                  const tokens = parseChordLine(line);
                  return (
                    <div key={li} className="chord-lyric-line">
                      {tokens.map((tok, ti) => (
                        <div key={ti} className="chord-lyric-token">
                          {tok.chord && (
                            <span className="chord-lyric-chord">{tok.chord}</span>
                          )}
                          <span className="chord-lyric-word">
                            {tok.text || "\u00A0"}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ArrangementMap({ composition }) {
  const totalBars = Math.max(1, composition.sections.reduce((sum, section) => sum + section.bars, 0));
  return (
    <section className="arrangement-map">
      <div className="section-toolbar">
        <h2>Arrangement Map</h2>
        <div className="map-legend">
          <span>Sections</span>
          <span>Bars</span>
          <span>Harmony</span>
        </div>
      </div>
      <div className="section-lanes">
        {composition.sections.map((section, index) => {
          const widthPct = Math.max(14, (section.bars / totalBars) * 100);
          const chordCount = section.chord_events?.length || section.chords.length;
          const lyricCount = section.lyric_lines?.length || section.lyric_chord_lines?.length || 0;
          return (
            <div className="section-lane" key={`${section.name}-${index}`} style={{ width: `${widthPct}%` }}>
              <strong>{section.name}</strong>
              <span>{section.bars} bars</span>
              <i>{chordCount} chords / {lyricCount} lines</i>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PianoRoll({ composition }) {
  const rows = ["C5", "B4", "A4", "G4", "F4", "E4", "D4", "C4", "B3", "A3"];
  const notes = [];
  let cursor = 0;
  composition.sections.forEach((section) => {
    section.melody.forEach((item) => {
      const duration = Number(item.duration_beats || 1);
      if (item.pitch && item.pitch !== "rest") {
        const row = rows.findIndex((pitch) => pitch[0] === item.pitch[0] && pitch.at(-1) === item.pitch.at(-1));
        notes.push({
          pitch: item.pitch,
          left: cursor,
          width: Math.max(0.75, duration),
          row: row >= 0 ? row : 5
        });
      }
      cursor += duration;
    });
  });
  const totalBeats = Math.max(8, cursor);

  return (
    <section className="piano-roll-panel">
      <div className="section-toolbar">
        <h2>Piano Roll</h2>
        <div className="map-legend">
          <span>Melody</span>
          <span>Grid</span>
        </div>
      </div>
      <div className="piano-roll">
        <div className="piano-keys">
          {rows.map((row) => <span key={row}>{row}</span>)}
        </div>
        <div className="piano-grid">
          {rows.map((row) => <span key={row} />)}
          {notes.map((item, index) => (
            <button
              key={`${item.pitch}-${index}`}
              className="midi-note"
              style={{
                left: `${(item.left / totalBeats) * 100}%`,
                width: `${(item.width / totalBeats) * 100}%`,
                top: `${item.row * 10}%`
              }}
              title={item.pitch}
            >
              {item.pitch}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function MixerPanel({ composition, onVolumeChange, onPanChange }) {
  const mixer = composition?.mixer || {
    drums: { volume: 74, pan: "C" },
    bass: { volume: 82, pan: "L8" },
    harmony: { volume: 68, pan: "R6" },
    melody: { volume: 88, pan: "C" },
    master: { volume: 78, pan: "C" }
  };

  const channels = [
    { name: "Drums", key: "drums", level: mixer.drums?.volume ?? 74, pan: mixer.drums?.pan ?? "C", color: "cyan" },
    { name: "Bass", key: "bass", level: mixer.bass?.volume ?? 82, pan: mixer.bass?.pan ?? "L8", color: "lime" },
    { name: "Harmony", key: "harmony", level: mixer.harmony?.volume ?? 68, pan: mixer.harmony?.pan ?? "R6", color: "violet" },
    { name: "Melody", key: "melody", level: mixer.melody?.volume ?? 88, pan: mixer.melody?.pan ?? "C", color: "amber" },
    { name: "Master", key: "master", level: mixer.master?.volume ?? 78, pan: mixer.master?.pan ?? "C", color: "master" }
  ];

  return (
    <section className="mixer-panel">
      <div className="section-toolbar">
        <h2>Mixer</h2>
        <div className="map-legend">
          <span>{composition?.sections?.length || 0} sections</span>
          <span>{composition?.tempo_bpm || 120} BPM</span>
        </div>
      </div>
      <div className="mixer-strips">
        {channels.map((channel) => (
          <div className={`mixer-strip ${channel.color}`} key={channel.key}>
            <strong>{channel.name}</strong>
            <div className="mixer-fader-area">
              <span className="mixer-vol-label">{channel.level}</span>
              <div className="mixer-fader-wrapper">
                <div className="mixer-fader-track">
                  <div className="mixer-meter-fill" style={{ height: `${channel.level}%` }} />
                </div>
                <input
                  type="range"
                  className="mixer-fader-input"
                  min="0"
                  max="100"
                  step="1"
                  value={channel.level}
                  onChange={(e) => onVolumeChange(channel.key, Number(e.target.value))}
                  title={`${channel.name} volume: ${channel.level}`}
                />
              </div>
            </div>
            <select
              className="mixer-pan-select"
              value={channel.pan}
              onChange={(e) => onPanChange(channel.key, e.target.value)}
            >
              <option value="L10">L10</option>
              <option value="L8">L8</option>
              <option value="L6">L6</option>
              <option value="L4">L4</option>
              <option value="L2">L2</option>
              <option value="C">C</option>
              <option value="R2">R2</option>
              <option value="R4">R4</option>
              <option value="R6">R6</option>
              <option value="R8">R8</option>
              <option value="R10">R10</option>
            </select>
          </div>
        ))}
      </div>
    </section>
  );
}

function SplashScreen() {
  return (
    <main className="splash-screen" aria-label="Loading Maestro Studio">
      <div className="splash-orb">
        <div className="splash-ring" />
        <div className="brand-mark splash-mark"><Music size={34} /></div>
      </div>
      <div className="splash-title">
        <h1>Maestro Studio</h1>
        <p>Preparing your composition workspace</p>
      </div>
      <div className="splash-bars" aria-hidden="true">
        {Array.from({ length: 12 }).map((_, index) => <span key={index} />)}
      </div>
    </main>
  );
}

function LandingAuth({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [redirecting, setRedirecting] = useState(false);
  const [redirectProgress, setRedirectProgress] = useState(0);

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = mode === "register"
        ? await registerUser(form)
        : await loginUser({ email: form.email, password: form.password });
      
      setRedirecting(true);
      let progress = 0;
      const interval = setInterval(() => {
        progress += 4;
        if (progress >= 100) {
          clearInterval(interval);
          onAuth(response);
        } else {
          setRedirectProgress(progress);
        }
      }, 50); // ~1.25s animation time
    } catch (err) {
      setError(err.message || "Authentication failed.");
      setBusy(false);
    }
  }

  if (redirecting) {
    let subtitle = "Setting up secure workspace...";
    if (redirectProgress > 70) {
      subtitle = "Preparing digital workstation...";
    } else if (redirectProgress > 35) {
      subtitle = "Loading creative history...";
    }

    return (
      <main className="landing-shell redirecting-loader">
        <div className="loader-container">
          <div className="brand-lockup loader-brand">
            <div className="brand-mark"><Music size={32} className="spinning-loader" /></div>
            <h2>Maestro Studio</h2>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${redirectProgress}%` }} />
          </div>
          <div className="loader-status">
            <strong>{redirectProgress}%</strong>
            <span>{subtitle}</span>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="landing-shell">
      <section className="landing-hero">
        <div className="brand-lockup landing-brand">
          <div className="brand-mark"><Music size={24} /></div>
          <div>
            <h1>Maestro Studio</h1>
            <p>AI composition workstation</p>
          </div>
        </div>
        <div className="landing-copy">
          <h2>Compose, arrange, and save every session.</h2>
          <p>Workspaces, projects, melodies, chords, lyrics, and exports stay mapped together for a clean studio workflow.</p>
        </div>
        <div className="landing-console" aria-hidden="true">
          <div className="console-head">
            <span>Workspace</span>
            <span>Project</span>
            <span>Draft</span>
          </div>
          <div className="console-lanes">
            {Array.from({ length: 5 }).map((_, index) => (
              <i key={index} />
            ))}
          </div>
        </div>
        <div className="landing-grid" aria-hidden="true">
          {Array.from({ length: 18 }).map((_, index) => <span key={index} />)}
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-header">
          <strong>{mode === "register" ? "Create account" : "Welcome back"}</strong>
          <span>{mode === "register" ? "Start a mapped studio workspace." : "Open your saved music workspace."}</span>
        </div>
        <div className="auth-tabs">
          <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Login</button>
          <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>Register</button>
        </div>
        <form onSubmit={handleSubmit}>
          {mode === "register" && (
            <label>Name
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
            </label>
          )}
          <label>Email
            <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
          </label>
          <label>Password
            <input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required minLength={6} />
          </label>
          {error && <div className="message error">{error}</div>}
          <button className="primary-button" disabled={busy}>
            {busy ? (
              <span className="button-progress-bar" aria-label="Loading">
                <span className="button-progress-fill" />
              </span>
            ) : mode === "register" ? (
              "Create Account"
            ) : (
              "Login"
            )}
          </button>
        </form>
      </section>
    </main>
  );
}

function UserDashboard({
  session,
  workspaces,
  projects,
  drafts,
  selectedWorkspace,
  selectedProject,
  busyAction,
  onLogout,
  onCreateWorkspace,
  onCreateProject,
  onSelectWorkspace,
  onOpenProject,
  onRenameProject,
  theme,
  onToggleTheme,
  loadingWorkspaces,
  loadingProjects,
  loadingDrafts
}) {
  return (
    <main className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark"><Music size={22} /></div>
          <div className="brand-details">
            <h2>Maestro Studio</h2>
            <span>Project Dashboard</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          <button className="nav-item active">
            <Layers size={18} />
            <span>Dashboard</span>
          </button>
          <button className="nav-item" onClick={onCreateWorkspace} disabled={Boolean(busyAction)}>
            <FolderPlus size={18} />
            <span>New Workspace</span>
          </button>
          <button className="nav-item" onClick={onCreateProject} disabled={!selectedWorkspace || Boolean(busyAction)}>
            <FileMusic size={18} />
            <span>New Project</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-profile">
            <div className="profile-avatar">
              <strong>{(session?.user?.name || "U").slice(0, 1).toUpperCase()}</strong>
            </div>
            <div className="profile-info">
              <h4>{session?.user?.name || "Studio User"}</h4>
              <span>{session?.user?.email || "user@gmail.com"}</span>
            </div>
          </div>
          <button className="logout-btn" onClick={onLogout} title="Logout">
            <LogOut size={16} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      <section className="dashboard-content">
        <header className="content-header">
          <div className="welcome-block">
            <h1>Welcome back, {session?.user?.name || "Artist"}! 👋</h1>
            <p>Your studio workstation is active. Choose a workspace or start a project below.</p>
          </div>
          <div className="header-status">
            <div className="session-active-badge">
              <Activity size={14} className="pulse-icon" />
              <span>Session Active</span>
            </div>
            <button
              className="dash-theme-toggle"
              onClick={onToggleTheme}
              title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </header>

        <div className="stats-row">
          <div className="stat-card">
            <div className="stat-icon workspaces-icon">
              <Layers size={20} />
            </div>
            <div className="stat-data">
              <h3>{workspaces.length}</h3>
              <p>Workspaces</p>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon projects-icon">
              <FileMusic size={20} />
            </div>
            <div className="stat-data">
              <h3>{selectedWorkspace ? projects.length : 0}</h3>
              <p>Active Projects</p>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon drafts-icon">
              <History size={20} />
            </div>
            <div className="stat-data">
              <h3>{drafts.length}</h3>
              <p>Saved Drafts</p>
            </div>
          </div>
        </div>

        <div className="main-grid">
          <section className="dashboard-panel">
            <div className="panel-header">
              <div className="panel-title">
                <Layers size={18} />
                <h2>Workspaces</h2>
              </div>
              <button className="panel-action-btn" onClick={onCreateWorkspace} disabled={Boolean(busyAction)}>
                <Plus size={14} /> Create
              </button>
            </div>
            <div className="panel-list">
              {loadingWorkspaces ? (
                Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className="list-card workspace-card skeleton-item">
                    <div className="card-left">
                      <div className="folder-icon skeleton-element placeholder-icon"></div>
                      <div className="card-info">
                        <div className="skeleton-element text-line main-title"></div>
                        <div className="skeleton-element text-line sub-title"></div>
                      </div>
                    </div>
                  </div>
                ))
              ) : workspaces.length === 0 ? (
                <div className="empty-state">
                  <p>Create a workspace to start mapping projects.</p>
                </div>
              ) : (
                workspaces.map((workspace) => (
                  <button
                    key={workspace.workspace_id}
                    className={`list-card workspace-card ${workspace.workspace_id === selectedWorkspace?.workspace_id ? "active" : ""}`}
                    onClick={() => onSelectWorkspace(workspace)}
                  >
                    <div className="card-left">
                      <div className="folder-icon"><Layers size={16} /></div>
                      <div className="card-info">
                        <strong>{workspace.name}</strong>
                        <span>{formatTimestamp(workspace.updated_at)}</span>
                      </div>
                    </div>
                    <ChevronRight size={16} className="chevron-icon" />
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="dashboard-panel large">
            <div className="panel-header">
              <div className="panel-title">
                <FileMusic size={18} />
                <h2>{selectedWorkspace ? `${selectedWorkspace.name} Projects` : "Projects"}</h2>
              </div>
              <button
                className="panel-action-btn"
                onClick={onCreateProject}
                disabled={!selectedWorkspace || Boolean(busyAction)}
              >
                <Plus size={14} /> Create
              </button>
            </div>
            <div className="panel-list">
              {!selectedWorkspace ? (
                <div className="empty-state">
                  <p>Select or create a workspace first.</p>
                </div>
              ) : loadingProjects ? (
                Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className="list-card project-card skeleton-item">
                    <div className="project-card-left">
                      <div className="music-status-icon skeleton-element placeholder-icon"></div>
                      <div className="card-info">
                        <div className="skeleton-element text-line main-title"></div>
                        <div className="skeleton-element text-line sub-title"></div>
                      </div>
                    </div>
                    <div className="project-actions">
                      <div className="skeleton-element placeholder-button"></div>
                    </div>
                  </div>
                ))
              ) : projects.length === 0 ? (
                <div className="empty-state">
                  <p>Create a project inside this workspace.</p>
                </div>
              ) : (
                projects.map((project) => (
                  <div
                    key={project.project_id}
                    className={`list-card project-card ${project.project_id === selectedProject?.project_id ? "active" : ""}`}
                  >
                    <div className="project-card-left">
                      <div className={`music-status-icon ${project.draft_id ? "has-music" : "empty"}`}>
                        <Music size={16} />
                      </div>
                      <div className="card-info">
                        <strong>{project.title}</strong>
                        <div className="project-meta">
                          <span className={`status-badge ${project.draft_id ? "linked" : "empty"}`}>
                            {project.draft_id ? "Music Linked" : "Empty Project"}
                          </span>
                          <span className="dot">•</span>
                          <span>Updated {formatTimestamp(project.updated_at)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="project-actions">
                      <button className="action-btn text" onClick={() => onRenameProject(project)}>Rename</button>
                      <button className="primary-action-btn" onClick={() => onOpenProject(project)}>
                        Open Studio <ChevronRight size={14} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <section className="dashboard-panel history-panel">
          <div className="panel-header">
            <div className="panel-title">
              <History size={18} />
              <h2>Recent Revisions & Drafts</h2>
            </div>
            <span className="drafts-count">{drafts.length} drafts</span>
          </div>
          <div className="history-grid">
            {loadingDrafts ? (
              Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="history-card skeleton-item">
                  <div className="history-card-header">
                    <div className="skeleton-element placeholder-icon"></div>
                    <div className="skeleton-element placeholder-tag"></div>
                  </div>
                  <div className="skeleton-element text-line main-title"></div>
                  <div className="skeleton-element text-line sub-title"></div>
                </div>
              ))
            ) : drafts.length === 0 ? (
              <div className="empty-state wide">
                <p>No drafts saved yet.</p>
              </div>
            ) : (
              drafts.slice(0, 8).map((draft) => (
                <div key={draft.draft_id} className="history-card">
                  <div className="history-card-header">
                    <Music size={14} />
                    <span className="style-tag">{draft.style}</span>
                    <span className="mood-tag">{draft.mood}</span>
                  </div>
                  <strong>{draft.title}</strong>
                  <span>{formatTimestamp(draft.updated_at)}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

function App() {
  const initialSession = useMemo(() => loadSessionState(), []);
  const [showSplash, setShowSplash] = useState(true);
  const [input, setInput] = useState(defaultInput);
  const [session, setSession] = useState(initialSession);
  const [provider, setProvider] = useState(null);
  const [draftId, setDraftId] = useState("");
  const [composition, setComposition] = useState(null);
  const [quality, setQuality] = useState(null);
  const [evaluation, setEvaluation] = useState(null);
  const [commercialReview, setCommercialReview] = useState(null);
  const [drafts, setDrafts] = useState([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioStopper, setAudioStopper] = useState(null);
  const [renderedAudio, setRenderedAudio] = useState(null);
  const [analysisStamp, setAnalysisStamp] = useState("");
  const [versions, setVersions] = useState(null);
  const [activeTier, setActiveTier] = useState("balanced");
  const [workspaces, setWorkspaces] = useState([]);
  const [projects, setProjects] = useState([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);
  const [studioOpen, setStudioOpen] = useState(false);
  const [activeMenu, setActiveMenu] = useState("");
  const [activeDialog, setActiveDialog] = useState("");
  const [dialogInputText, setDialogInputText] = useState("");
  const [dialogTargetItem, setDialogTargetItem] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem("maestro-studio-theme") || "dark");
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingDrafts, setLoadingDrafts] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("maestro-studio-theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  const token = session?.token || "";
  const workspaceName = selectedWorkspace?.name || "";
  const projectName = selectedProject?.title || "";
  const hasWorkspace = Boolean(selectedWorkspace);
  const hasProject = Boolean(selectedProject);

  useEffect(() => {
    const timer = window.setTimeout(() => setShowSplash(false), 2000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (session) {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }, [session]);

  useEffect(() => {
    if (!activeMenu) return;
    function handleDocumentPointerDown(event) {
      if (!event.target.closest(".daw-menu")) {
        closeMenus();
      }
    }
    function handleDocumentKeyDown(event) {
      if (event.key === "Escape") {
        closeMenus();
      }
    }
    document.addEventListener("pointerdown", handleDocumentPointerDown);
    document.addEventListener("keydown", handleDocumentKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown);
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, [activeMenu]);

  function closeMenus() {
    setActiveMenu("");
  }

  function toggleMenu(menu) {
    setActiveMenu((current) => (current === menu ? "" : menu));
  }

  function requireWorkspaceProject(action = "compose") {
    if (!hasWorkspace) {
      setError("Create a workspace first from File > New Workspace.");
      return false;
    }
    if (!hasProject) {
      setError(`Create a project first from File > New Project before you ${action}.`);
      return false;
    }
    return true;
  }

  function handleNewWorkspace() {
    setDialogInputText("");
    setActiveDialog("create-workspace");
  }

  async function submitCreateWorkspace(e) {
    e?.preventDefault();
    const name = dialogInputText.trim();
    if (!name) return;
    await runWithStatus("workspace-create", async () => {
      stopPreview();
      const workspace = await createWorkspace(token, name);
      setSelectedWorkspace(workspace);
      setProjects([]);
      setSelectedProject(null);
      setStudioOpen(false);
      setDraftId("");
      setComposition(null);
      setVersions(null);
      setRenderedAudio(null);
      setQuality(null);
      setEvaluation(null);
      setCommercialReview(null);
      setStatus(`Workspace "${workspace.name}" created. Now create a project.`);
      setError("");
      setActiveDialog("");
      setDialogInputText("");
      closeMenus();
      await refreshWorkspaces();
    });
  }

  function handleNewProject() {
    if (!hasWorkspace) {
      setError("Create a workspace first from File > New Workspace.");
      return;
    }
    setDialogInputText("");
    setActiveDialog("create-project");
  }

  async function submitCreateProject(e) {
    e?.preventDefault();
    const title = dialogInputText.trim();
    if (!title) return;
    await runWithStatus("project-create", async () => {
      stopPreview();
      const project = await createProject(token, selectedWorkspace.workspace_id, title);
      setSelectedProject(project);
      setStudioOpen(true);
      setDraftId("");
      setComposition(null);
      setVersions(null);
      setRenderedAudio(null);
      setQuality(null);
      setEvaluation(null);
      setCommercialReview(null);
      setInput((current) => ({ ...current, theme: title }));
      setStatus(`Project "${project.title}" created. Compose manually or generate with AI.`);
      setError("");
      setActiveDialog("");
      setDialogInputText("");
      closeMenus();
      await refreshProjects(selectedWorkspace.workspace_id);
    });
  }

  function handleRenameProject(projectToRename = selectedProject) {
    if (!projectToRename) {
      setError("Create or open a project before renaming it.");
      return;
    }
    setDialogInputText(projectToRename.title);
    setDialogTargetItem(projectToRename);
    setActiveDialog("rename-project");
  }

  async function submitRenameProject(e) {
    e?.preventDefault();
    const name = dialogInputText.trim();
    const projectToRename = dialogTargetItem || selectedProject;
    if (!name || !projectToRename) return;
    await runWithStatus("project-rename", async () => {
      const project = await updateProject(token, projectToRename.project_id, { title: name });
      if (selectedProject?.project_id === project.project_id) {
        setSelectedProject(project);
        if (composition) updateCompositionField("title", name);
      }
      setStatus(`Project renamed to "${name}".`);
      setActiveDialog("");
      setDialogInputText("");
      setDialogTargetItem(null);
      closeMenus();
      await refreshProjects(project.workspace_id);
    });
  }

  async function handleManualCompose() {
    if (!requireWorkspaceProject("compose manually")) return;
    await runWithStatus("manual-compose", async () => {
      stopPreview();
      const manual = createManualComposition(input, projectName);
      const record = await createDraft(token, manual);
      const project = await updateProject(token, selectedProject.project_id, { draft_id: record.draft_id, title: record.composition.title });
      setSelectedProject(project);
      setDraftId(record.draft_id);
      setComposition(record.composition);
      setVersions(null);
      setRenderedAudio(null);
      setStatus("Manual composition created and saved as an editable project.");
      setError("");
      closeMenus();
      await refreshQuality(record.composition);
      await refreshDrafts();
    });
  }

  // Update a chord_event in a specific section (from ChordTimeline inline edit)
  function updateChordEvent(sectionIndex, eventIndex, newChord) {
    setRenderedAudio(null);
    setComposition((current) => {
      const next = clone(current);
      const sec = next.sections[sectionIndex];
      if (sec.chord_events && sec.chord_events[eventIndex]) {
        sec.chord_events[eventIndex].chord = newChord;
        // Keep flat chords in sync
        sec.chords = sec.chord_events.map((e) => e.chord);
      } else if (sec.chords[eventIndex] !== undefined) {
        sec.chords[eventIndex] = newChord;
      }
      if (versions) setVersions((prev) => ({ ...prev, [activeTier]: next }));
      return next;
    });
  }

  function handleSelectTier(tier) {
    if (!versions || !versions[tier]) return;
    setActiveTier(tier);
    setComposition(versions[tier]);
    refreshQuality(versions[tier]);
    setRenderedAudio(null);
    stopPreview();
  }

  useEffect(() => {
    getProvider().then(setProvider).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!token) return;
    getCurrentUser(token)
      .then((user) => setSession((current) => ({ ...current, user })))
      .then(refreshWorkspaces)
      .then(refreshDrafts)
      .catch(() => setSession(null));
  }, [token]);

  useEffect(() => {
    return () => {
      if (renderedAudio?.url) URL.revokeObjectURL(renderedAudio.url);
    };
  }, [renderedAudio]);

  const metrics = useMemo(() => localMetrics(composition), [composition]);

  async function runWithStatus(action, fn) {
    setBusyAction(action);
    setError("");
    setStatus("");
    try {
      await fn();
    } catch (err) {
      setError(typeof err.message === "string" ? err.message : "Something went wrong.");
    } finally {
      setBusyAction("");
    }
  }

  function handleAuth(nextSession) {
    setSession(nextSession);
    setError("");
    setStatus("");
  }

  function handleLogout() {
    stopPreview();
    setSession(null);
    setWorkspaces([]);
    setProjects([]);
    setSelectedWorkspace(null);
    setSelectedProject(null);
    setStudioOpen(false);
    setDraftId("");
    setComposition(null);
    setQuality(null);
    setEvaluation(null);
    setCommercialReview(null);
    setRenderedAudio(null);
  }

  async function refreshWorkspaces() {
    if (!token) return;
    setLoadingWorkspaces(true);
    try {
      const records = await listWorkspaces(token);
      setWorkspaces(records);
      setSelectedWorkspace((current) => current || records[0] || null);
      if (!selectedWorkspace && records[0]) {
        await refreshProjects(records[0].workspace_id);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingWorkspaces(false);
    }
  }

  async function refreshProjects(workspaceId = selectedWorkspace?.workspace_id) {
    if (!token || !workspaceId) return;
    setLoadingProjects(true);
    try {
      const records = await listProjects(token, workspaceId);
      setProjects(records);
      setSelectedProject((current) => current || records[0] || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingProjects(false);
    }
  }

  async function selectWorkspace(workspace) {
    await saveCurrentIfPossible();
    stopPreview();
    setSelectedWorkspace(workspace);
    setSelectedProject(null);
    setStudioOpen(false);
    setDraftId("");
    setComposition(null);
    setVersions(null);
    setRenderedAudio(null);
    setQuality(null);
    setEvaluation(null);
    setCommercialReview(null);
    await refreshProjects(workspace.workspace_id);
  }

  async function selectProject(project) {
    await saveCurrentIfPossible();
    stopPreview();
    setSelectedProject(project);
    setVersions(null);
    setRenderedAudio(null);
    setQuality(null);
    setEvaluation(null);
    setCommercialReview(null);
    if (project.draft_id) {
      await openDraft(project.draft_id, project);
    } else {
      setDraftId("");
      setComposition(null);
      setStatus(`Project "${project.title}" selected. Compose manually or generate with AI.`);
    }
  }

  async function openProjectInStudio(project = selectedProject) {
    if (!project) {
      setError("Select or create a project first.");
      return;
    }
    await selectProject(project);
    setStudioOpen(true);
  }

  async function saveCurrentIfPossible() {
    if (!draftId || !composition) return;
    const response = await saveDraft(token, draftId, composition);
    if (selectedProject) {
      const linkedProject = await updateProject(token, selectedProject.project_id, { title: response.composition.title, draft_id: draftId });
      setSelectedProject(linkedProject);
    }
  }

  async function refreshQuality(nextComposition = composition) {
    if (!nextComposition) return;
    const report = await validateComposition(nextComposition);
    setQuality(report);
    const evalReport = await evaluateComposition(nextComposition);
    setEvaluation(evalReport);
    const commercialReport = await reviewCommercialReadiness(nextComposition);
    setCommercialReview(commercialReport);
    setAnalysisStamp(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    return { report, evalReport, commercialReport };
  }

  async function handleAnalyze() {
    if (!composition) return;
    await runWithStatus("analyze", async () => {
      const result = await refreshQuality();
      const score = result?.evalReport?.overall_score ?? evaluation?.overall_score;
      setStatus(score ? `Analysis updated. Readiness score: ${score}/100.` : "Analysis updated.");
    });
  }

  async function refreshDrafts() {
    setLoadingDrafts(true);
    try {
      setDrafts(await listDrafts(token));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingDrafts(false);
    }
  }

  async function openDraft(recordId, linkedProject = null) {
    await runWithStatus("open-draft", async () => {
      try {
        const record = await getDraft(token, recordId);
        if (linkedProject) {
          setSelectedProject(linkedProject);
        } else if (selectedWorkspace && token) {
          const project = await createProject(token, selectedWorkspace.workspace_id, record.composition.title);
          const linked = await updateProject(token, project.project_id, { draft_id: record.draft_id });
          setSelectedProject(linked);
          await refreshProjects(selectedWorkspace.workspace_id);
        }
        setDraftId(record.draft_id);
        setComposition(record.composition);
        setVersions(null);
        setActiveTier("balanced");
        setRenderedAudio(null);
        setStatus("Draft opened.");
        await refreshQuality(record.composition);
      } catch (err) {
        const errMsg = String(err?.message || err || "").toLowerCase();
        if (errMsg.includes("404") || errMsg.includes("not found")) {
          setDraftId("");
          setComposition(null);
          if (linkedProject) {
            const unlinked = await updateProject(token, linkedProject.project_id, { draft_id: null });
            setSelectedProject(unlinked);
            await refreshProjects(linkedProject.workspace_id);
          }
          setStatus("Draft was not found or belongs to another user. Starting a fresh composition.");
        } else {
          throw err;
        }
      }
    });
  }

  async function handleGenerate() {
    if (!requireWorkspaceProject("compose")) return;
    await runWithStatus("generate", async () => {
      const response = await composeSong(token, input);
      const nextComposition = { ...response.composition, title: projectName };
      const linkedProject = await updateProject(token, selectedProject.project_id, { draft_id: response.draft_id, title: nextComposition.title });
      setSelectedProject(linkedProject);
      setDraftId(response.draft_id);
      setComposition(nextComposition);
      setVersions(response.versions || null);
      setActiveTier("balanced");
      setRenderedAudio(null);
      setStatus(response.warnings?.length ? response.warnings.join(" ") : "Draft generated.");
      await refreshQuality(nextComposition);
      await refreshDrafts();
      await refreshProjects(selectedWorkspace.workspace_id);
    });
  }

  function handleStyleChange(style) {
    const defaults = STYLE_DEFAULTS[style] || {};
    setInput((current) => ({
      ...current,
      style,
      tempo_bpm: defaults.tempo_bpm ?? current.tempo_bpm,
      instrumentation: defaults.instrumentation ?? current.instrumentation,
      creativity: defaults.creativity ?? current.creativity
    }));
  }

  async function handleRefine(target) {
    if (!composition) return;
    await runWithStatus(target, async () => {
      const response = await refineSong(token, target, composition, `Optimize ${target} for ${composition.style} ${composition.mood}.`);
      if (selectedProject) {
        const linkedProject = await updateProject(token, selectedProject.project_id, { draft_id: response.draft_id, title: response.composition.title });
        setSelectedProject(linkedProject);
        await refreshProjects(linkedProject.workspace_id);
      }
      setDraftId(response.draft_id);
      setComposition(response.composition);
      setRenderedAudio(null);
      setStatus(response.warnings?.length ? response.warnings.join(" ") : `${target} regenerated.`);
      await refreshQuality(response.composition);
      await refreshDrafts();
    });
  }

  async function handleSave() {
    if (!draftId || !composition) return;
    await runWithStatus("save", async () => {
      const response = await saveDraft(token, draftId, composition);
      if (selectedProject) {
        const linkedProject = await updateProject(token, selectedProject.project_id, { title: response.composition.title, draft_id: draftId });
        setSelectedProject(linkedProject);
        await refreshProjects(linkedProject.workspace_id);
      }
      setComposition(response.composition);
      setStatus("Draft saved.");
      await refreshQuality(response.composition);
      await refreshDrafts();
    });
  }

  async function handleSaveAs() {
    if (!composition || !selectedWorkspace) return;
    const name = window.prompt("Save as project name", `${composition.title} Copy`);
    if (!name?.trim()) return;
    await runWithStatus("save-as", async () => {
      const nextComposition = { ...clone(composition), title: name.trim() };
      const record = await createDraft(token, nextComposition);
      const project = await createProject(token, selectedWorkspace.workspace_id, name.trim());
      const linkedProject = await updateProject(token, project.project_id, { draft_id: record.draft_id, title: name.trim() });
      setSelectedProject(linkedProject);
      setDraftId(record.draft_id);
      setComposition(record.composition);
      setVersions(null);
      setRenderedAudio(null);
      setStudioOpen(true);
      setStatus(`Saved as "${name.trim()}".`);
      await refreshQuality(record.composition);
      await refreshDrafts();
      await refreshProjects(selectedWorkspace.workspace_id);
    });
  }

  async function handleDownload(path, filename) {
    if (!composition) return;
    await runWithStatus(path, async () => {
      await downloadExport(path, composition, filename);
      setStatus("Export ready.");
    });
  }

  async function handleExportCurrent(path, extension) {
    if (!composition) return;
    const exportName = window.prompt("Rename before export", composition.title);
    if (!exportName?.trim()) return;
    await runWithStatus(path, async () => {
      const nextComposition = { ...composition, title: exportName.trim() };
      setComposition(nextComposition);
      if (draftId) {
        await saveDraft(token, draftId, nextComposition);
      }
      if (selectedProject) {
        const linkedProject = await updateProject(token, selectedProject.project_id, { title: exportName.trim(), draft_id: draftId || selectedProject.draft_id });
        setSelectedProject(linkedProject);
        await refreshProjects(linkedProject.workspace_id);
      }
      await downloadExport(path, nextComposition, `${exportName.trim()}.${extension}`);
      setStatus(`Export ready as "${exportName.trim()}".`);
    });
  }

  async function handleExportDraft(recordId, path, filename) {
    await runWithStatus(`export-${recordId}-${path}`, async () => {
      const record = await getDraft(token, recordId);
      const extension = filename.split(".").pop() || "wav";
      const exportName = window.prompt("Rename before export", record.composition.title);
      if (!exportName?.trim()) return;
      await downloadExport(path, { ...record.composition, title: exportName.trim() }, `${exportName.trim()}.${extension}`);
      setStatus(`Exported saved project "${exportName.trim()}".`);
    });
  }

  async function handleRenderAudio() {
    if (!composition) return;
    await runWithStatus("render-audio", async () => {
      const { blob, filename } = await exportCompositionBlob("/export/wav", composition, "composition.wav");
      const url = URL.createObjectURL(blob);
      setRenderedAudio({ url, filename });
      setStatus("Playable WAV rendered.");
    });
  }

  function updateCompositionField(field, value) {
    setRenderedAudio(null);
    setComposition((current) => {
      const next = { ...current, [field]: value };
      if (versions) {
        setVersions((prev) => ({ ...prev, [activeTier]: next }));
      }
      return next;
    });
  }

  function updateMixer(channelKey, field, value) {
    setRenderedAudio(null);
    setComposition((current) => {
      if (!current) return current;
      const next = clone(current);
      if (!next.mixer) {
        next.mixer = {
          drums: { volume: 74, pan: "C" },
          bass: { volume: 82, pan: "L8" },
          harmony: { volume: 68, pan: "R6" },
          melody: { volume: 88, pan: "C" },
          master: { volume: 78, pan: "C" }
        };
      }
      if (!next.mixer[channelKey]) {
        next.mixer[channelKey] = { volume: 80, pan: "C" };
      }
      next.mixer[channelKey][field] = value;
      if (versions) {
        setVersions((prev) => ({ ...prev, [activeTier]: next }));
      }
      return next;
    });
  }

  function updateSection(index, updater) {
    setRenderedAudio(null);
    setComposition((current) => {
      const next = clone(current);
      next.sections[index] = updater(next.sections[index]);
      next.lyrics = next.sections.flatMap((section) => section.lyric_lines);
      if (versions) {
        setVersions((prev) => ({ ...prev, [activeTier]: next }));
      }
      return next;
    });
  }

  function stopPreview() {
    if (audioStopper) {
      audioStopper();
      setAudioStopper(null);
    }
    setIsPlaying(false);
  }

  async function playPreview() {
    if (!composition) return;
    if (isPlaying) {
      stopPreview();
      return;
    }
    await runWithStatus("preview-audio", async () => {
      const { blob, filename } = await exportCompositionBlob("/export/wav", composition, "composition.wav");
      const url = URL.createObjectURL(blob);
      const player = new Audio(url);
      player.onended = () => {
        setAudioStopper(null);
        setIsPlaying(false);
      };
      player.onerror = () => {
        setAudioStopper(null);
        setIsPlaying(false);
        setError("Rendered audio could not be played in this browser.");
      };
      setRenderedAudio({ url, filename });
      setAudioStopper(() => () => {
        player.pause();
        player.currentTime = 0;
      });
      await player.play();
      setIsPlaying(true);
      setStatus("SoundFont preview playing.");
    });
  }

  if (showSplash) {
    return <SplashScreen />;
  }

  if (!session) {
    return <LandingAuth onAuth={handleAuth} />;
  }

  return (
    <>
      {!studioOpen ? (
        <UserDashboard
          session={session}
          workspaces={workspaces}
          projects={projects}
          drafts={drafts}
          selectedWorkspace={selectedWorkspace}
          selectedProject={selectedProject}
          busyAction={busyAction}
          onLogout={handleLogout}
          onCreateWorkspace={handleNewWorkspace}
          onCreateProject={handleNewProject}
          onSelectWorkspace={selectWorkspace}
          onOpenProject={openProjectInStudio}
          onRenameProject={handleRenameProject}
          theme={theme}
          onToggleTheme={toggleTheme}
          loadingWorkspaces={loadingWorkspaces}
          loadingProjects={loadingProjects}
          loadingDrafts={loadingDrafts}
        />
      ) : (
        <main className="studio-shell">
      <header className="topbar">
        <div
          className="brand-lockup clickable-brand"
          title="Return to Dashboard"
          onClick={() => {
            saveCurrentIfPossible().finally(() => setStudioOpen(false));
          }}
        >
          <div className="brand-mark"><Music size={22} /></div>
          <div>
            <h1>Maestro Studio</h1>
            <p>AI composition workstation</p>
          </div>
        </div>
        <nav className="daw-menu" aria-label="Studio navigation">
          <div className="menu-item">
            <button className={activeMenu === "file" ? "active" : ""} onClick={() => toggleMenu("file")}>File</button>
            {activeMenu === "file" && (
              <div className="menu-popover">
                <button onClick={() => { saveCurrentIfPossible().finally(() => setStudioOpen(false)); closeMenus(); }}>Dashboard</button>
                <button onClick={handleNewWorkspace}>New Workspace</button>
                <button onClick={handleNewProject} disabled={!hasWorkspace}>New Project</button>
                <button onClick={() => { setActiveDialog("open"); closeMenus(); }}>Open Saved Project</button>
                <button onClick={() => { setActiveDialog("settings"); closeMenus(); }}>Settings</button>
                <span />
                <button onClick={() => handleExportCurrent("/export/wav", "wav")} disabled={!composition || Boolean(busyAction)}>Export Current WAV</button>
                <button onClick={() => { setActiveDialog("export-old"); closeMenus(); }}>Export Old Music</button>
              </div>
            )}
          </div>
          <div className="menu-item">
            <button className={activeMenu === "edit" ? "active" : ""} onClick={() => toggleMenu("edit")}>Edit</button>
            {activeMenu === "edit" && (
              <div className="menu-popover wide">
                <button onClick={() => { setActiveDialog("open"); closeMenus(); }}>Select Old Saved Project</button>
                <button onClick={handleRenameProject} disabled={!hasProject}>Rename Project Title</button>
                <button onClick={handleSave} disabled={!composition || !draftId || Boolean(busyAction)}>Save Current Project</button>
                <button onClick={handleSaveAs} disabled={!composition || !selectedWorkspace || Boolean(busyAction)}>Save As</button>
                <span />
                {drafts.slice(0, 5).map((draft) => (
                  <button key={draft.draft_id} onClick={() => { openDraft(draft.draft_id); closeMenus(); }}>
                    {draft.title}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="menu-item">
            <button className={activeMenu === "compose" ? "active" : ""} onClick={() => toggleMenu("compose")}>Compose</button>
            {activeMenu === "compose" && (
              <div className="menu-popover">
                <button onClick={handleManualCompose} disabled={!hasWorkspace || !hasProject || Boolean(busyAction)}>Manual Compose</button>
                <button onClick={handleGenerate} disabled={!hasWorkspace || !hasProject || Boolean(busyAction)}>AI Compose Track</button>
                <button onClick={() => handleRefine("melody")} disabled={!composition || Boolean(busyAction)}>Regenerate Melody</button>
                <button onClick={() => handleRefine("lyrics")} disabled={!composition || Boolean(busyAction)}>Regenerate Lyrics</button>
              </div>
            )}
          </div>
          <div className="menu-item">
            <button className={activeMenu === "arrange" ? "active" : ""} onClick={() => toggleMenu("arrange")}>Arrange</button>
            {activeMenu === "arrange" && (
              <div className="menu-popover">
                <button onClick={() => handleRefine("arrangement")} disabled={!composition || Boolean(busyAction)}>Polish Arrangement</button>
                <button onClick={() => handleRefine("chords")} disabled={!composition || Boolean(busyAction)}>Regenerate Chords</button>
                <button onClick={handleAnalyze} disabled={!composition || Boolean(busyAction)}>Analyze Project</button>
              </div>
            )}
          </div>
        </nav>
        <div className="top-status">
          <span>{provider?.model || "Loading provider"}</span>
          {provider?.architecture && <span>{provider.architecture.replaceAll("_", " ")}</span>}
          {provider?.audio_engine && <span>{provider.audio_engine.replaceAll("_", " ")}</span>}
          <strong className={provider?.api_key_configured ? "ok" : "warn"}>
            {provider?.api_key_configured ? "NIM ready" : "key missing"}
          </strong>
          <button
            className="theme-toggle-btn"
            onClick={toggleTheme}
            title="Toggle Theme"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--soft)",
              display: "flex",
              alignItems: "center",
              padding: "6px",
              cursor: "pointer",
              marginLeft: "8px",
              marginRight: "8px"
            }}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button className="status-logout" onClick={handleLogout}>Logout</button>
        </div>
      </header>

      {/* Modal content moved to global container */}

      <section className="studio-layout">
        <aside className="left-rail">
          <div className="browser-tabs" aria-label="Project browser sections">
            <button className="active">Browser</button>
            <button>Clips</button>
            <button>Agents</button>
          </div>
          <div className="project-context">
            <span>User</span>
            <strong>{session?.user?.name || "Logged in"}</strong>
            <span>Workspace</span>
            <strong>{workspaceName || "Create one from File"}</strong>
            <span>Project</span>
            <strong>{projectName || "Create one before composing"}</strong>
          </div>
          <div className="tool-card workspace-browser">
            <div className="card-heading">
              <span><Layers size={16} /> Workspaces</span>
              <button className="icon-button" onClick={handleNewWorkspace} disabled={Boolean(busyAction)} title="New workspace">+</button>
            </div>
            <div className="mini-list">
              {workspaces.length === 0 ? (
                <p>Create your first workspace.</p>
              ) : (
                workspaces.map((workspace) => (
                  <button
                    key={workspace.workspace_id}
                    className={workspace.workspace_id === selectedWorkspace?.workspace_id ? "active" : ""}
                    onClick={() => selectWorkspace(workspace)}
                  >
                    {workspace.name}
                  </button>
                ))
              )}
            </div>
          </div>
          <div className="tool-card workspace-browser">
            <div className="card-heading">
              <span><FileMusic size={16} /> Projects</span>
              <button className="icon-button" onClick={handleNewProject} disabled={!hasWorkspace || Boolean(busyAction)} title="New project">+</button>
            </div>
            <div className="mini-list">
              {!hasWorkspace ? (
                <p>Select a workspace first.</p>
              ) : projects.length === 0 ? (
                <p>Create a project inside this workspace.</p>
              ) : (
                projects.map((project) => (
                  <button
                    key={project.project_id}
                    className={project.project_id === selectedProject?.project_id ? "active" : ""}
                    onClick={() => selectProject(project)}
                  >
                    <strong>{project.title}</strong>
                    <span>{project.draft_id ? "music linked" : "empty project"}</span>
                  </button>
                ))
              )}
            </div>
          </div>
          <div className="tool-card">
            <div className="card-heading"><SlidersHorizontal size={16} /> Composer Engine</div>
            <label>Style
              <select value={input.style} onChange={(event) => handleStyleChange(event.target.value)}>
                {STYLE_OPTIONS.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            <label>Mood
              <select value={input.mood} onChange={(event) => setInput({ ...input, mood: event.target.value })}>
                {MOOD_OPTIONS.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            <label>Theme
              <textarea rows="4" value={input.theme} onChange={(event) => setInput({ ...input, theme: event.target.value })} />
            </label>
            <label>Custom Lyrics (Optional)
              <textarea rows="3" placeholder="Enter your own lyrics..." value={input.custom_lyrics || ""} onChange={(event) => setInput({ ...input, custom_lyrics: event.target.value })} />
            </label>
            <div className="two-fields">
              <label>Key
                <select value={input.key} onChange={(event) => setInput({ ...input, key: event.target.value })}>
                  {KEY_OPTIONS.map((option) => <option key={option}>{option}</option>)}
                </select>
              </label>
              <label>BPM
                <input type="number" min="45" max="220" value={input.tempo_bpm} onChange={(event) => setInput({ ...input, tempo_bpm: Number(event.target.value) })} />
              </label>
            </div>
            <div className="two-fields">
              <label>Bars
                <input type="number" min="4" max="32" value={input.bars} onChange={(event) => setInput({ ...input, bars: Number(event.target.value) })} />
              </label>
              <label>Creativity
                <input type="number" min="0" max="1" step="0.05" value={input.creativity} onChange={(event) => setInput({ ...input, creativity: Number(event.target.value) })} />
              </label>
            </div>
            <label>Instrumentation
              <input value={input.instrumentation} onChange={(event) => setInput({ ...input, instrumentation: event.target.value })} />
            </label>
            <button className="primary-button" onClick={handleGenerate} disabled={!hasWorkspace || !hasProject || Boolean(busyAction)}>
              {busyAction === "generate" ? <Loader2 className="spin" size={18} /> : <Wand2 size={18} />}
              {!hasWorkspace ? "Create Workspace First" : !hasProject ? "Create Project First" : "Compose Track"}
            </button>
          </div>

          <div className="tool-card draft-browser">
            <div className="card-heading">
              <span><History size={16} /> Project Browser</span>
              <button className="icon-button" onClick={refreshDrafts} disabled={Boolean(busyAction)} title="Refresh drafts">
                <RefreshCw size={15} />
              </button>
            </div>
            <div className="draft-list">
              {drafts.length === 0 ? (
                <p>No drafts yet.</p>
              ) : (
                drafts.slice(0, 9).map((draft) => (
                  <button
                    key={draft.draft_id}
                    className={draft.draft_id === draftId ? "active" : ""}
                    onClick={() => openDraft(draft.draft_id)}
                    disabled={Boolean(busyAction)}
                  >
                    <strong>{draft.title}</strong>
                    <span>{draft.style} / {draft.mood}</span>
                    <small>{formatTimestamp(draft.updated_at)}</small>
                  </button>
                ))
              )}
            </div>
          </div>
        </aside>

        <section className="arrangement-pane">
          <div className="transport-bar">
            <div className="transport-main">
              <div className="title-block">
                <p>{workspaceName || "No workspace"} / {projectName || "No project"}</p>
                <input
                  value={composition?.title || projectName || "Untitled composition"}
                  disabled={!hasProject}
                  onChange={(event) => {
                    if (selectedProject && event.target.value.trim().length >= 2) {
                      setSelectedProject({ ...selectedProject, title: event.target.value });
                    }
                    if (composition) updateCompositionField("title", event.target.value);
                  }}
                  onBlur={(event) => {
                    if (selectedProject && event.target.value.trim().length >= 2) {
                      updateProject(token, selectedProject.project_id, { title: event.target.value.trim() })
                        .then((project) => {
                          setSelectedProject(project);
                          refreshProjects(project.workspace_id);
                        })
                        .catch((err) => setError(err.message));
                    }
                  }}
                />
              </div>
              <div className="transport-readout">
                <span><strong>{composition?.tempo_bpm || input.tempo_bpm}</strong><small>BPM</small></span>
                <span><strong>{composition?.key || input.key}</strong><small>Key</small></span>
                <span><strong>{composition?.time_signature || input.time_signature}</strong><small>Meter</small></span>
              </div>
            </div>
            {versions && (
              <div className="tier-selector-tabs">
                <button
                  className={activeTier === "safe" ? "active" : ""}
                  onClick={() => handleSelectTier("safe")}
                >
                  Safe
                </button>
                <button
                  className={activeTier === "balanced" ? "active" : ""}
                  onClick={() => handleSelectTier("balanced")}
                >
                  Balanced
                </button>
                <button
                  className={activeTier === "wild" ? "active" : ""}
                  onClick={() => handleSelectTier("wild")}
                >
                  Wild
                </button>
              </div>
            )}
            <div className="transport-actions">
              <button onClick={() => { saveCurrentIfPossible().finally(() => setStudioOpen(false)); }} disabled={Boolean(busyAction)}>
                <Layers size={17} />
                Dashboard
              </button>
              <button onClick={playPreview} disabled={!composition || Boolean(busyAction)}>
                {busyAction === "preview-audio" ? <Loader2 className="spin" size={17} /> : isPlaying ? <Pause size={17} /> : <Play size={17} />}
                {busyAction === "preview-audio" ? "Rendering" : isPlaying ? "Stop" : "Preview"}
              </button>
              <button onClick={handleAnalyze} disabled={!composition || Boolean(busyAction)}>
                {busyAction === "analyze" ? <Loader2 className="spin" size={17} /> : <ShieldCheck size={17} />}
                Analyze
              </button>
              <button onClick={handleSave} disabled={!composition || !draftId || Boolean(busyAction)}>
                <Save size={17} />
                Save
              </button>
              <button onClick={handleSaveAs} disabled={!composition || !selectedWorkspace || Boolean(busyAction)}>
                <Save size={17} />
                Save As
              </button>
            </div>
          </div>

          {error && <div className="message error" style={{ whiteSpace: "pre-wrap" }}>{error}</div>}
          {status && <div className="message status">{status}</div>}

          {!composition ? (
            <div className="empty-workspace">
              <div className="empty-score-grid" aria-hidden="true">
                {Array.from({ length: 16 }).map((_, index) => <span key={index} />)}
              </div>
              <Sparkles size={40} />
              <h2>{hasWorkspace && hasProject ? "Start a composition draft" : "Create workspace and project"}</h2>
              <p>
                {hasWorkspace && hasProject
                  ? `${input.style} / ${input.mood} / ${input.key} / ${input.tempo_bpm} BPM`
                  : "Use File > New Workspace, then File > New Project before composing."}
              </p>
            </div>
          ) : (
            <div className="arrangement-stack">
              <div className="overview-strip">
                <div><Activity size={17} /><strong>{metrics.sections}</strong><span>sections</span></div>
                <div><Layers size={17} /><strong>{metrics.bars}</strong><span>bars</span></div>
                <div><Music size={17} /><strong>{metrics.chords}</strong><span>chords</span></div>
                <div><Waves size={17} /><strong>{metrics.notes}</strong><span>notes</span></div>
              </div>

              <ArrangementMap composition={composition} />

              <section className="timeline-card">
                <div className="section-toolbar">
                  <h2>Playlist Timeline</h2>
                  <button onClick={() => handleRefine("chords")} disabled={Boolean(busyAction)}>
                    {busyAction === "chords" ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
                    Chords
                  </button>
                </div>
                <ChordTimeline
                  sections={composition.sections}
                  timeSignature={composition.time_signature}
                  onChordChange={updateChordEvent}
                />
              </section>

              <PianoRoll composition={composition} />

              <section className="chord-lyric-card">
                <h2>Chords & Lyrics</h2>
                <ChordLyricView sections={composition.sections} />
              </section>

              <section className="refine-row">
                <button onClick={() => handleRefine("melody")} disabled={Boolean(busyAction)}>
                  {busyAction === "melody" ? <Loader2 className="spin" size={16} /> : <Waves size={16} />}
                  Regenerate Melody
                </button>
                <button onClick={() => handleRefine("lyrics")} disabled={Boolean(busyAction)}>
                  {busyAction === "lyrics" ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
                  Regenerate Lyrics
                </button>
                <button onClick={() => handleRefine("arrangement")} disabled={Boolean(busyAction)}>
                  {busyAction === "arrangement" ? <Loader2 className="spin" size={16} /> : <Layers size={16} />}
                  Polish Arrangement
                </button>
              </section>

              <MixerPanel 
                composition={composition} 
                renderedAudio={renderedAudio} 
                onVolumeChange={(channelKey, val) => updateMixer(channelKey, "volume", val)}
                onPanChange={(channelKey, val) => updateMixer(channelKey, "pan", val)}
              />

              {composition.sections.map((section, index) => {
                const capacity = section.bars * beatsPerBar(composition.time_signature);
                const used = sectionBeats(section);
                const fill = Math.min(100, Math.round((used / capacity) * 100));
                return (
                  <section className="section-editor" key={`${section.name}-${index}`}>
                    <div className="section-editor-head">
                      <input value={section.name} onChange={(event) => updateSection(index, (current) => ({ ...current, name: event.target.value }))} />
                      <label>Bars
                        <input type="number" min="1" max="16" value={section.bars} onChange={(event) => updateSection(index, (current) => ({ ...current, bars: Number(event.target.value) }))} />
                      </label>
                    </div>
                    <div className="section-meter">
                      <span>{used.toFixed(1).replace(".0", "")}/{capacity.toFixed(1).replace(".0", "")} beats</span>
                      <div><i style={{ width: `${fill}%` }} /></div>
                    </div>
                    <label>Chords
                      <div className="chip-editor">
                        {section.chords.map((chord, chordIndex) => (
                          <input
                            key={`${chord}-${chordIndex}`}
                            value={chord}
                            onChange={(event) => updateSection(index, (current) => {
                              const nextChord = event.target.value;
                              const next = { ...current, chords: [...current.chords] };
                              next.chords[chordIndex] = nextChord;
                              next.chord_events = current.chord_events?.length
                                ? current.chord_events.map((evt, evtIndex) => (
                                    evtIndex === chordIndex ? { ...evt, chord: nextChord } : evt
                                  ))
                                : chordEventsFromChords(next.chords, composition.time_signature);
                              return next;
                            })}
                          />
                        ))}
                      </div>
                      <input className="compact-input" value={section.chords.join(" - ")} onChange={(event) => updateSection(index, (current) => {
                        const chords = splitChords(event.target.value);
                        return { ...current, chords, chord_events: chordEventsFromChords(chords, composition.time_signature) };
                      })} />
                    </label>
                    <div className="editor-grid">
                      <label>Melody
                        <textarea rows="4" value={melodyToText(section.melody)} onChange={(event) => updateSection(index, (current) => ({ ...current, melody: parseMelody(event.target.value) }))} />
                      </label>
                      <label>Lyrics (use [Chord] tags for inline chords)
                        <textarea
                          rows="4"
                          value={
                            (section.lyric_chord_lines && section.lyric_chord_lines.length > 0)
                              ? section.lyric_chord_lines.join("\n")
                              : section.lyric_lines.join("\n")
                          }
                          onChange={(event) => {
                            const val = event.target.value;
                            const lines = splitLines(val);
                            const hasBrackets = val.includes("[");
                            updateSection(index, (current) => ({
                              ...current,
                              lyric_chord_lines: hasBrackets ? lines : [],
                              lyric_lines: lines.map((line) => line.replace(/\[[^\]]+\]/g, ""))
                            }));
                          }}
                        />
                      </label>
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </section>

        <aside className="inspector-pane">
          <div className="tool-card compact-meta">
            <div className="card-heading"><Gauge size={16} /> Channel Rack</div>
            {composition ? (
              <div className="meta-grid">
                <label>Style<input value={composition.style} onChange={(event) => updateCompositionField("style", event.target.value)} /></label>
                <label>Mood<input value={composition.mood} onChange={(event) => updateCompositionField("mood", event.target.value)} /></label>
                <label>Key<input value={composition.key} onChange={(event) => updateCompositionField("key", event.target.value)} /></label>
                <label>BPM<input type="number" value={composition.tempo_bpm} onChange={(event) => updateCompositionField("tempo_bpm", Number(event.target.value))} /></label>
              </div>
            ) : (
              <p className="muted-copy">Generate or open a draft to inspect it.</p>
            )}
          </div>

          <div className="tool-card evaluation-card">
            <div className="card-heading">
              <span><ShieldCheck size={16} /> Mastering Meter</span>
              {analysisStamp && <small className="analysis-stamp">{analysisStamp}</small>}
            </div>
            {evaluation ? (
              <>
                <div className="score-dial">
                  <strong>{evaluation.overall_score}</strong>
                  <span>readiness</span>
                </div>
                <ScoreBar label="Chords" value={evaluation.chord_validity} />
                <ScoreBar label="Key fit" value={evaluation.melody_key_fit} />
                <ScoreBar label="Duration" value={evaluation.duration_fit} />
                <ScoreBar label="Style" value={evaluation.style_adherence} />
                <ScoreBar label="Lyrics" value={evaluation.lyrics_score} />
                <ScoreBar label="Export" value={evaluation.export_readiness} />
                <ScoreBar label="Safety" value={evaluation.commercial_safety} />
                <div className="recommendations">
                  {evaluation.recommendations.map((item, index) => <p key={`${item}-${index}`}>{item}</p>)}
                </div>
              </>
            ) : (
              <p className="muted-copy">Analysis appears after generation or draft open.</p>
            )}
          </div>

          {quality?.warnings?.length > 0 && (
            <div className="tool-card warning-card">
              <div className="card-heading">Warnings</div>
              {quality.warnings.map((warning, index) => <p key={`${warning}-${index}`}>{warning}</p>)}
            </div>
          )}

          <div className="tool-card">
            <div className="card-heading"><Download size={16} /> Render Rack</div>
            <div className="export-grid">
              <button onClick={handleRenderAudio} disabled={!composition || Boolean(busyAction)}>
                {busyAction === "render-audio" ? "Rendering" : "Render Player"}
              </button>
              <button onClick={() => handleExportCurrent("/export/wav", "wav")} disabled={!composition || Boolean(busyAction)}>WAV</button>
              <button onClick={() => handleExportCurrent("/export/stems", "zip")} disabled={!composition || Boolean(busyAction)}>Stems</button>
              <button onClick={() => handleExportCurrent("/export/mp3", "mp3")} disabled={!composition || Boolean(busyAction)}>MP3</button>
              <button onClick={() => handleExportCurrent("/export/midi", "mid")} disabled={!composition || Boolean(busyAction)}>MIDI</button>
              <button onClick={() => handleExportCurrent("/export/musicxml", "musicxml")} disabled={!composition || Boolean(busyAction)}>MusicXML</button>
              <button onClick={() => handleExportCurrent("/export/notation", "txt")} disabled={!composition || Boolean(busyAction)}>Notation</button>
              <button onClick={() => handleExportCurrent("/export/package", "zip")} disabled={!composition || Boolean(busyAction)}>ZIP Pack</button>
            </div>
            {renderedAudio && (
              <div className="audio-render">
                <span>{renderedAudio.filename}</span>
                <audio controls src={renderedAudio.url} />
              </div>
            )}
          </div>

          {commercialReview && (
            <div className="tool-card commercial-card">
              <div className="card-heading"><BadgeCheck size={16} /> Release Check</div>
              <ScoreBar label="Safety" value={commercialReview.score} />
              {[...commercialReview.warnings, ...commercialReview.notes].slice(0, 5).map((item, index) => (
                <p key={`${item}-${index}`}>{item}</p>
              ))}
            </div>
          )}

          {composition && (
            <div className="tool-card notes-card">
              <h2>Plugin Notes</h2>
              <div className="note-list">{composition.style_notes.map((item, index) => <span key={`${item}-${index}`}>{item}</span>)}</div>
              {composition.drum_pattern?.length > 0 && (
                <>
                  <h2>Drums</h2>
                  <div className="note-list">{composition.drum_pattern.map((item, index) => <span key={`${item}-${index}`}>{item}</span>)}</div>
                </>
              )}
              {composition.bassline?.length > 0 && (
                <>
                  <h2>Bass</h2>
                  <div className="note-list">{composition.bassline.map((item, index) => <span key={`${item}-${index}`}>{item}</span>)}</div>
                </>
              )}
              {composition.mix_notes?.length > 0 && (
                <>
                  <h2>Mix</h2>
                  <div className="note-list">{composition.mix_notes.map((item, index) => <span key={`${item}-${index}`}>{item}</span>)}</div>
                </>
              )}
              <h2>Originality</h2>
              <div className="note-list">{composition.originality_notes.map((item, index) => <span key={`${item}-${index}`}>{item}</span>)}</div>
              {composition.agent_trace?.length > 0 && (
                <>
                  <h2>Agent Trace</h2>
                  <div className="agent-trace">{composition.agent_trace.map((item, index) => <p key={`${item}-${index}`}>{item}</p>)}</div>
                </>
              )}
              <p className="disclaimer">{composition.disclaimer}</p>
            </div>
          )}
          </aside>
        </section>
      </main>
    )}

    {activeDialog && (
      <div className="studio-modal-backdrop" onClick={() => { setActiveDialog(""); setDialogInputText(""); setDialogTargetItem(null); }}>
        <section className="studio-modal" onClick={(event) => event.stopPropagation()}>
          <div className="modal-head">
            <h2>
              {activeDialog === "settings" && "Workspace Settings"}
              {activeDialog === "open" && "Open Saved Project"}
              {activeDialog === "export-old" && "Export Old Music"}
              {activeDialog === "create-workspace" && "Create Workspace"}
              {activeDialog === "create-project" && "Create Project"}
              {activeDialog === "rename-project" && "Rename Project"}
            </h2>
            <button className="icon-button" onClick={() => { setActiveDialog(""); setDialogInputText(""); setDialogTargetItem(null); }}>x</button>
          </div>

          {activeDialog === "settings" && (
            <div className="settings-grid">
              <label>Workspace Name
                <select value={selectedWorkspace?.workspace_id || ""} onChange={(event) => {
                  const workspace = workspaces.find((item) => item.workspace_id === event.target.value);
                  if (workspace) selectWorkspace(workspace);
                }}>
                  <option value="">Create a workspace</option>
                  {workspaces.map((workspace) => <option key={workspace.workspace_id} value={workspace.workspace_id}>{workspace.name}</option>)}
                </select>
              </label>
              <label>Project Title
                <select value={selectedProject?.project_id || ""} onChange={(event) => {
                  const project = projects.find((item) => item.project_id === event.target.value);
                  if (project) selectProject(project);
                }}>
                  <option value="">Create a project</option>
                  {projects.map((project) => <option key={project.project_id} value={project.project_id}>{project.title}</option>)}
                </select>
              </label>
              <label>Default Style
                <select value={input.style} onChange={(event) => handleStyleChange(event.target.value)}>
                  {STYLE_OPTIONS.map((option) => <option key={option}>{option}</option>)}
                </select>
              </label>
              <label>Default BPM
                <input type="number" min="45" max="220" value={input.tempo_bpm} onChange={(event) => setInput({ ...input, tempo_bpm: Number(event.target.value) })} />
              </label>
              <p className="modal-note">Create a workspace first, then a project. Compose and edit actions are enabled only after both exist.</p>
            </div>
          )}

          {activeDialog === "open" && (
            <div className="modal-list">
              {drafts.length === 0 ? (
                <p className="muted-copy">No saved projects yet.</p>
              ) : (
                drafts.map((draft) => (
                  <button key={draft.draft_id} onClick={() => { openDraft(draft.draft_id); setActiveDialog(""); }}>
                    <strong>{draft.title}</strong>
                    <span>{draft.style} / {draft.mood} / {formatTimestamp(draft.updated_at)}</span>
                  </button>
                ))
              )}
            </div>
          )}

          {activeDialog === "export-old" && (
            <div className="modal-list export-old-list">
              {drafts.length === 0 ? (
                <p className="muted-copy">No old saved music found.</p>
              ) : (
                drafts.map((draft) => (
                  <div className="old-export-row" key={draft.draft_id}>
                    <div>
                      <strong>{draft.title}</strong>
                      <span>{draft.style} / {draft.mood} / {formatTimestamp(draft.updated_at)}</span>
                    </div>
                    <button onClick={() => handleExportDraft(draft.draft_id, "/export/wav", `${draft.title}.wav`)} disabled={Boolean(busyAction)}>WAV</button>
                    <button onClick={() => handleExportDraft(draft.draft_id, "/export/mp3", `${draft.title}.mp3`)} disabled={Boolean(busyAction)}>MP3</button>
                    <button onClick={() => handleExportDraft(draft.draft_id, "/export/midi", `${draft.title}.mid`)} disabled={Boolean(busyAction)}>MIDI</button>
                  </div>
                ))
              )}
            </div>
          )}

          {activeDialog === "create-workspace" && (
            <form onSubmit={submitCreateWorkspace} className="modal-form">
              <div className="settings-grid">
                <label style={{ gridColumn: "span 2" }}>Workspace Name
                  <input
                    type="text"
                    autoFocus
                    required
                    placeholder="My Music Workspace"
                    value={dialogInputText}
                    onChange={(e) => setDialogInputText(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      background: "#101820",
                      border: "1px solid #303c47",
                      color: "#ffffff",
                      borderRadius: "6px",
                      marginTop: "6px"
                    }}
                  />
                </label>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", padding: "12px", borderTop: "1px solid #33404a", background: "#10161c" }}>
                <button type="button" className="action-btn text" onClick={() => { setActiveDialog(""); setDialogInputText(""); }} style={{ minHeight: "34px", padding: "0 12px", background: "transparent", border: "1px solid rgba(255,255,255,0.08)", color: "var(--soft)", borderRadius: "6px" }}>Cancel</button>
                <button type="submit" className="primary-action-btn" style={{ minHeight: "34px", padding: "0 12px", background: "linear-gradient(135deg, var(--teal), var(--teal-2))", border: "1px solid #82fff7", color: "#061214", borderRadius: "6px", fontWeight: "700" }}>Create</button>
              </div>
            </form>
          )}

          {activeDialog === "create-project" && (
            <form onSubmit={submitCreateProject} className="modal-form">
              <div className="settings-grid">
                <label style={{ gridColumn: "span 2" }}>Project Title
                  <input
                    type="text"
                    autoFocus
                    required
                    placeholder="New Song Project"
                    value={dialogInputText}
                    onChange={(e) => setDialogInputText(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      background: "#101820",
                      border: "1px solid #303c47",
                      color: "#ffffff",
                      borderRadius: "6px",
                      marginTop: "6px"
                    }}
                  />
                </label>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", padding: "12px", borderTop: "1px solid #33404a", background: "#10161c" }}>
                <button type="button" className="action-btn text" onClick={() => { setActiveDialog(""); setDialogInputText(""); }} style={{ minHeight: "34px", padding: "0 12px", background: "transparent", border: "1px solid rgba(255,255,255,0.08)", color: "var(--soft)", borderRadius: "6px" }}>Cancel</button>
                <button type="submit" className="primary-action-btn" style={{ minHeight: "34px", padding: "0 12px", background: "linear-gradient(135deg, var(--teal), var(--teal-2))", border: "1px solid #82fff7", color: "#061214", borderRadius: "6px", fontWeight: "700" }}>Create</button>
              </div>
            </form>
          )}

          {activeDialog === "rename-project" && (
            <form onSubmit={submitRenameProject} className="modal-form">
              <div className="settings-grid">
                <label style={{ gridColumn: "span 2" }}>New Project Title
                  <input
                    type="text"
                    autoFocus
                    required
                    value={dialogInputText}
                    onChange={(e) => setDialogInputText(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      background: "#101820",
                      border: "1px solid #303c47",
                      color: "#ffffff",
                      borderRadius: "6px",
                      marginTop: "6px"
                    }}
                  />
                </label>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", padding: "12px", borderTop: "1px solid #33404a", background: "#10161c" }}>
                <button type="button" className="action-btn text" onClick={() => { setActiveDialog(""); setDialogInputText(""); setDialogTargetItem(null); }} style={{ minHeight: "34px", padding: "0 12px", background: "transparent", border: "1px solid rgba(255,255,255,0.08)", color: "var(--soft)", borderRadius: "6px" }}>Cancel</button>
                <button type="submit" className="primary-action-btn" style={{ minHeight: "34px", padding: "0 12px", background: "linear-gradient(135deg, var(--teal), var(--teal-2))", border: "1px solid #82fff7", color: "#061214", borderRadius: "6px", fontWeight: "700" }}>Rename</button>
              </div>
            </form>
          )}
        </section>
      </div>
    )}
  </>
);
}

export default App;
