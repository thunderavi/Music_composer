import { useEffect, useMemo, useState } from "react";
import {
  Download,
  FileMusic,
  Loader2,
  Music,
  RefreshCw,
  Save,
  Sparkles,
  Wand2
} from "lucide-react";
import { composeSong, downloadExport, getProvider, saveDraft } from "./api.js";

const STYLE_OPTIONS = ["Lo-fi", "Pop", "Rock", "EDM", "Jazz", "R&B", "Folk", "Cinematic"];
const MOOD_OPTIONS = ["Relaxed", "Sad", "Hopeful", "Energetic", "Dreamy", "Dark", "Romantic"];

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

function splitLines(value) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseMelody(value) {
  return value
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const [pitch, duration = "1"] = token.split(":");
      return {
        pitch,
        duration_beats: Number(duration),
        lyric_syllable: null
      };
    });
}

function melodyToText(melody) {
  return melody.map((item) => `${item.pitch}:${item.duration_beats}`).join(" ");
}

function cloneComposition(composition) {
  return JSON.parse(JSON.stringify(composition));
}

function App() {
  const [input, setInput] = useState(defaultInput);
  const [provider, setProvider] = useState(null);
  const [draftId, setDraftId] = useState("");
  const [composition, setComposition] = useState(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    getProvider()
      .then(setProvider)
      .catch((err) => setError(err.message));
  }, []);

  const flattenedChords = useMemo(() => {
    if (!composition) return [];
    return composition.sections.flatMap((section) =>
      section.chords.map((chord, index) => ({ section: section.name, chord, index }))
    );
  }, [composition]);

  async function handleGenerate() {
    setIsGenerating(true);
    setError("");
    setStatus("");
    try {
      const response = await composeSong(input);
      setDraftId(response.draft_id);
      setComposition(response.composition);
      setStatus(response.warnings?.length ? response.warnings.join(" ") : "Draft generated.");
    } catch (err) {
      setError(err.message);
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleSave() {
    if (!draftId || !composition) return;
    setIsSaving(true);
    setError("");
    try {
      const response = await saveDraft(draftId, composition);
      setComposition(response.composition);
      setStatus("Draft saved.");
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  }

  function updateCompositionField(field, value) {
    setComposition((current) => ({ ...current, [field]: value }));
  }

  function updateSection(index, updater) {
    setComposition((current) => {
      const next = cloneComposition(current);
      next.sections[index] = updater(next.sections[index]);
      next.lyrics = next.sections.flatMap((section) => section.lyric_lines);
      return next;
    });
  }

  async function handleDownload(path, filename) {
    if (!composition) return;
    setError("");
    try {
      await downloadExport(path, composition, filename);
      setStatus("Export ready.");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="app-shell">
      <aside className="control-panel">
        <div className="brand-row">
          <div className="brand-mark">
            <Music size={24} />
          </div>
          <div>
            <h1>Music Composition Agent</h1>
            <p>NVIDIA NIM</p>
          </div>
        </div>

        <div className="provider-strip">
          <span>{provider?.model || "NIM model"}</span>
          <strong className={provider?.api_key_configured ? "ok" : "warn"}>
            {provider?.api_key_configured ? "key ready" : "key missing"}
          </strong>
        </div>

        <label>
          Style
          <select value={input.style} onChange={(event) => setInput({ ...input, style: event.target.value })}>
            {STYLE_OPTIONS.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>

        <label>
          Mood
          <select value={input.mood} onChange={(event) => setInput({ ...input, mood: event.target.value })}>
            {MOOD_OPTIONS.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>

        <label>
          Theme
          <textarea
            rows="3"
            value={input.theme}
            onChange={(event) => setInput({ ...input, theme: event.target.value })}
          />
        </label>

        <div className="split-fields">
          <label>
            Key
            <input value={input.key} onChange={(event) => setInput({ ...input, key: event.target.value })} />
          </label>
          <label>
            BPM
            <input
              type="number"
              min="45"
              max="220"
              value={input.tempo_bpm}
              onChange={(event) => setInput({ ...input, tempo_bpm: Number(event.target.value) })}
            />
          </label>
        </div>

        <div className="split-fields">
          <label>
            Bars
            <input
              type="number"
              min="4"
              max="32"
              value={input.bars}
              onChange={(event) => setInput({ ...input, bars: Number(event.target.value) })}
            />
          </label>
          <label>
            Time
            <input
              value={input.time_signature}
              onChange={(event) => setInput({ ...input, time_signature: event.target.value })}
            />
          </label>
        </div>

        <label>
          Creativity
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={input.creativity}
            onChange={(event) => setInput({ ...input, creativity: Number(event.target.value) })}
          />
        </label>

        <label>
          Instrumentation
          <input
            value={input.instrumentation}
            onChange={(event) => setInput({ ...input, instrumentation: event.target.value })}
          />
        </label>

        <button className="primary-button" onClick={handleGenerate} disabled={isGenerating}>
          {isGenerating ? <Loader2 className="spin" size={18} /> : <Wand2 size={18} />}
          Generate
        </button>

        <div className="action-grid">
          <button onClick={handleSave} disabled={!composition || !draftId || isSaving} title="Save draft">
            {isSaving ? <Loader2 className="spin" size={18} /> : <Save size={18} />}
            Save
          </button>
          <button
            onClick={() => handleDownload("/export/midi", "composition.mid")}
            disabled={!composition}
            title="Download MIDI"
          >
            <Download size={18} />
            MIDI
          </button>
          <button
            onClick={() => handleDownload("/export/notation", "notation.txt")}
            disabled={!composition}
            title="Download notation"
          >
            <FileMusic size={18} />
            Notation
          </button>
        </div>
      </aside>

      <section className="workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">Editable draft</p>
            <input
              className="title-input"
              value={composition?.title || "Untitled composition"}
              disabled={!composition}
              onChange={(event) => updateCompositionField("title", event.target.value)}
            />
          </div>
          <button className="ghost-button" onClick={handleGenerate} disabled={isGenerating}>
            <RefreshCw size={18} />
            Regenerate
          </button>
        </header>

        {error && <div className="message error">{error}</div>}
        {status && <div className="message status">{status}</div>}

        {!composition ? (
          <div className="empty-state">
            <Sparkles size={42} />
            <h2>Ready for a first draft</h2>
            <p>{input.style} / {input.mood} / {input.key}</p>
          </div>
        ) : (
          <div className="composition-grid">
            <section className="section-band">
              <div className="metadata-row">
                <label>
                  Style
                  <input value={composition.style} onChange={(event) => updateCompositionField("style", event.target.value)} />
                </label>
                <label>
                  Mood
                  <input value={composition.mood} onChange={(event) => updateCompositionField("mood", event.target.value)} />
                </label>
                <label>
                  Key
                  <input value={composition.key} onChange={(event) => updateCompositionField("key", event.target.value)} />
                </label>
                <label>
                  BPM
                  <input
                    type="number"
                    value={composition.tempo_bpm}
                    onChange={(event) => updateCompositionField("tempo_bpm", Number(event.target.value))}
                  />
                </label>
              </div>
            </section>

            <section className="section-band">
              <h2>Progression</h2>
              <div className="chord-strip">
                {flattenedChords.map((item, itemIndex) => (
                  <span key={`${item.section}-${item.index}-${itemIndex}`}>
                    <small>{item.section}</small>
                    {item.chord}
                  </span>
                ))}
              </div>
            </section>

            {composition.sections.map((section, index) => (
              <section className="editor-section" key={`${section.name}-${index}`}>
                <div className="section-heading">
                  <input
                    value={section.name}
                    onChange={(event) =>
                      updateSection(index, (current) => ({ ...current, name: event.target.value }))
                    }
                  />
                  <input
                    type="number"
                    min="1"
                    max="16"
                    value={section.bars}
                    onChange={(event) =>
                      updateSection(index, (current) => ({ ...current, bars: Number(event.target.value) }))
                    }
                  />
                </div>

                <label>
                  Chords
                  <input
                    value={section.chords.join(" - ")}
                    onChange={(event) =>
                      updateSection(index, (current) => ({
                        ...current,
                        chords: event.target.value.split(/[-,|]/).map((item) => item.trim()).filter(Boolean)
                      }))
                    }
                  />
                </label>

                <label>
                  Melody
                  <textarea
                    rows="3"
                    value={melodyToText(section.melody)}
                    onChange={(event) =>
                      updateSection(index, (current) => ({
                        ...current,
                        melody: parseMelody(event.target.value)
                      }))
                    }
                  />
                </label>

                <label>
                  Lyrics
                  <textarea
                    rows="5"
                    value={section.lyric_lines.join("\n")}
                    onChange={(event) =>
                      updateSection(index, (current) => ({
                        ...current,
                        lyric_lines: splitLines(event.target.value)
                      }))
                    }
                  />
                </label>
              </section>
            ))}

            <section className="section-band">
              <h2>Style Notes</h2>
              <div className="note-list">
                {composition.style_notes.map((item, index) => (
                  <span key={`${item}-${index}`}>{item}</span>
                ))}
              </div>
            </section>

            <section className="section-band disclaimer">
              {composition.disclaimer}
            </section>
          </div>
        )}
      </section>
    </main>
  );
}

export default App;
