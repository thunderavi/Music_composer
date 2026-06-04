import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BadgeCheck,
  Download,
  FileMusic,
  Gauge,
  History,
  Layers,
  Loader2,
  Music,
  Pause,
  Play,
  RefreshCw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Wand2,
  Waves
} from "lucide-react";
import {
  composeSong,
  downloadExport,
  evaluateComposition,
  exportCompositionBlob,
  getDraft,
  getProvider,
  listDrafts,
  refineSong,
  reviewCommercialReadiness,
  saveDraft,
  validateComposition
} from "./api.js";

const STYLE_OPTIONS = ["Lo-fi", "Pop", "Rock", "EDM", "Jazz", "R&B", "Folk", "Cinematic"];
const MOOD_OPTIONS = ["Relaxed", "Sad", "Hopeful", "Energetic", "Dreamy", "Dark", "Romantic"];
const KEY_OPTIONS = ["C major", "G major", "D major", "A minor", "E minor", "D minor", "F major", "Bb major"];
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
  instrumentation: "warm piano, soft bass, brushed drums"
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

function App() {
  const [input, setInput] = useState(defaultInput);
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

  useEffect(() => {
    getProvider().then(setProvider).catch((err) => setError(err.message));
    refreshDrafts();
  }, []);

  useEffect(() => {
    return () => {
      if (renderedAudio?.url) URL.revokeObjectURL(renderedAudio.url);
    };
  }, [renderedAudio]);

  const metrics = useMemo(() => localMetrics(composition), [composition]);
  const flattenedChords = useMemo(() => {
    if (!composition) return [];
    return composition.sections.flatMap((section) =>
      section.chords.map((chord, index) => ({ section: section.name, chord, index }))
    );
  }, [composition]);

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
    try {
      setDrafts(await listDrafts());
    } catch (err) {
      setError(err.message);
    }
  }

  async function openDraft(recordId) {
    await runWithStatus("open-draft", async () => {
      const record = await getDraft(recordId);
      setDraftId(record.draft_id);
      setComposition(record.composition);
      setRenderedAudio(null);
      setStatus("Draft opened.");
      await refreshQuality(record.composition);
    });
  }

  async function handleGenerate() {
    await runWithStatus("generate", async () => {
      const response = await composeSong(input);
      setDraftId(response.draft_id);
      setComposition(response.composition);
      setRenderedAudio(null);
      setStatus(response.warnings?.length ? response.warnings.join(" ") : "Draft generated.");
      await refreshQuality(response.composition);
      await refreshDrafts();
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
      const response = await refineSong(target, composition, `Optimize ${target} for ${composition.style} ${composition.mood}.`);
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
      const response = await saveDraft(draftId, composition);
      setComposition(response.composition);
      setStatus("Draft saved.");
      await refreshQuality(response.composition);
      await refreshDrafts();
    });
  }

  async function handleDownload(path, filename) {
    if (!composition) return;
    await runWithStatus(path, async () => {
      await downloadExport(path, composition, filename);
      setStatus("Export ready.");
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
    setComposition((current) => ({ ...current, [field]: value }));
  }

  function updateSection(index, updater) {
    setRenderedAudio(null);
    setComposition((current) => {
      const next = clone(current);
      next.sections[index] = updater(next.sections[index]);
      next.lyrics = next.sections.flatMap((section) => section.lyric_lines);
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

  return (
    <main className="studio-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><Music size={22} /></div>
          <div>
            <h1>Composer Workbench</h1>
            <p>NVIDIA NIM symbolic music agent</p>
          </div>
        </div>
        <div className="top-status">
          <span>{provider?.model || "Loading provider"}</span>
          {provider?.architecture && <span>{provider.architecture.replaceAll("_", " ")}</span>}
          {provider?.audio_engine && <span>{provider.audio_engine.replaceAll("_", " ")}</span>}
          <strong className={provider?.api_key_configured ? "ok" : "warn"}>
            {provider?.api_key_configured ? "NIM ready" : "key missing"}
          </strong>
        </div>
      </header>

      <section className="studio-layout">
        <aside className="left-rail">
          <div className="tool-card">
            <div className="card-heading"><SlidersHorizontal size={16} /> Generate</div>
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
            <button className="primary-button" onClick={handleGenerate} disabled={Boolean(busyAction)}>
              {busyAction === "generate" ? <Loader2 className="spin" size={18} /> : <Wand2 size={18} />}
              Generate
            </button>
          </div>

          <div className="tool-card draft-browser">
            <div className="card-heading">
              <span><History size={16} /> Drafts</span>
              <button className="icon-button" onClick={refreshDrafts} disabled={Boolean(busyAction)} title="Refresh drafts">
                <RefreshCw size={15} />
              </button>
            </div>
            <div className="draft-list">
              {drafts.length === 0 ? (
                <p>No drafts yet.</p>
              ) : (
                drafts.slice(0, 9).map((draft) => (
                  <button key={draft.draft_id} onClick={() => openDraft(draft.draft_id)} disabled={Boolean(busyAction)}>
                    <strong>{draft.title}</strong>
                    <span>{draft.style} / {draft.mood}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </aside>

        <section className="arrangement-pane">
          <div className="transport-bar">
            <div className="title-block">
              <p>Current draft</p>
              <input
                value={composition?.title || "Untitled composition"}
                disabled={!composition}
                onChange={(event) => updateCompositionField("title", event.target.value)}
              />
            </div>
            <div className="transport-actions">
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
            </div>
          </div>

          {error && <div className="message error">{error}</div>}
          {status && <div className="message status">{status}</div>}

          {!composition ? (
            <div className="empty-workspace">
              <Sparkles size={40} />
              <h2>Start a composition draft</h2>
              <p>{input.style} / {input.mood} / {input.key} / {input.tempo_bpm} BPM</p>
            </div>
          ) : (
            <div className="arrangement-stack">
              <div className="overview-strip">
                <div><Activity size={17} /><strong>{metrics.sections}</strong><span>sections</span></div>
                <div><Layers size={17} /><strong>{metrics.bars}</strong><span>bars</span></div>
                <div><Music size={17} /><strong>{metrics.chords}</strong><span>chords</span></div>
                <div><Waves size={17} /><strong>{metrics.notes}</strong><span>notes</span></div>
              </div>

              <section className="timeline-card">
                <div className="section-toolbar">
                  <h2>Chord Timeline</h2>
                  <button onClick={() => handleRefine("chords")} disabled={Boolean(busyAction)}>
                    {busyAction === "chords" ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
                    Chords
                  </button>
                </div>
                <div className="chord-strip">
                  {flattenedChords.map((item, itemIndex) => (
                    <span key={`${item.section}-${item.index}-${itemIndex}`}>
                      <small>{item.section}</small>
                      {item.chord}
                    </span>
                  ))}
                </div>
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
                              const next = { ...current, chords: [...current.chords] };
                              next.chords[chordIndex] = event.target.value;
                              return next;
                            })}
                          />
                        ))}
                      </div>
                      <input className="compact-input" value={section.chords.join(" - ")} onChange={(event) => updateSection(index, (current) => ({ ...current, chords: splitChords(event.target.value) }))} />
                    </label>
                    <div className="editor-grid">
                      <label>Melody
                        <textarea rows="4" value={melodyToText(section.melody)} onChange={(event) => updateSection(index, (current) => ({ ...current, melody: parseMelody(event.target.value) }))} />
                      </label>
                      <label>Lyrics
                        <textarea rows="4" value={section.lyric_lines.join("\n")} onChange={(event) => updateSection(index, (current) => ({ ...current, lyric_lines: splitLines(event.target.value) }))} />
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
            <div className="card-heading"><Gauge size={16} /> Inspector</div>
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
              <span><ShieldCheck size={16} /> Evaluation</span>
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
            <div className="card-heading"><Download size={16} /> Export</div>
            <div className="export-grid">
              <button onClick={handleRenderAudio} disabled={!composition || Boolean(busyAction)}>
                {busyAction === "render-audio" ? "Rendering" : "Render Player"}
              </button>
              <button onClick={() => handleDownload("/export/wav", "composition.wav")} disabled={!composition || Boolean(busyAction)}>WAV</button>
              <button onClick={() => handleDownload("/export/stems", "composition_stems.zip")} disabled={!composition || Boolean(busyAction)}>Stems</button>
              <button onClick={() => handleDownload("/export/mp3", "composition.mp3")} disabled={!composition || Boolean(busyAction)}>MP3</button>
              <button onClick={() => handleDownload("/export/midi", "composition.mid")} disabled={!composition || Boolean(busyAction)}>MIDI</button>
              <button onClick={() => handleDownload("/export/musicxml", "composition.musicxml")} disabled={!composition || Boolean(busyAction)}>MusicXML</button>
              <button onClick={() => handleDownload("/export/notation", "notation.txt")} disabled={!composition || Boolean(busyAction)}>Notation</button>
              <button onClick={() => handleDownload("/export/package", "composition_package.zip")} disabled={!composition || Boolean(busyAction)}>ZIP Pack</button>
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
              <div className="card-heading"><BadgeCheck size={16} /> Commercial Review</div>
              <ScoreBar label="Safety" value={commercialReview.score} />
              {[...commercialReview.warnings, ...commercialReview.notes].slice(0, 5).map((item, index) => (
                <p key={`${item}-${index}`}>{item}</p>
              ))}
            </div>
          )}

          {composition && (
            <div className="tool-card notes-card">
              <h2>Style Notes</h2>
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
  );
}

export default App;
