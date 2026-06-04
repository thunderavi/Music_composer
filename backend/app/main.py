import logging
import json
import shutil
import subprocess
import tempfile
from io import BytesIO
from functools import lru_cache
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware

from .config import Settings, get_settings
from .commercial import commercial_review
from .evaluation import evaluate_composition
from .music import (
    composition_to_midi_bytes,
    composition_to_musicxml_bytes,
    composition_to_notation_text,
    composition_to_soundfont_wav_bytes,
    composition_to_wav_bytes,
    composition_validation_report,
    optimize_generated_composition,
    validate_composition,
)
from .nim_client import NimClient, NimTimeoutError
from .schemas import (
    ComposeRequest,
    ComposeResponse,
    Composition,
    CommercialReview,
    DraftRecord,
    DraftSummary,
    EvaluationReport,
    ProviderInfo,
    RefineRequest,
    ValidationReport,
)
from .storage import DraftStore

logger = logging.getLogger("music-composer")
logging.basicConfig(level=logging.INFO)


@lru_cache
def get_store() -> DraftStore:
    return DraftStore(get_settings().app_database_path)


def get_nim_client(settings: Settings = Depends(get_settings)) -> NimClient:
    return NimClient(settings)


settings = get_settings()
app = FastAPI(title=settings.app_name, version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_credentials=settings.origins != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
api_router = APIRouter()


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@api_router.get("/provider", response_model=ProviderInfo)
def provider(settings: Settings = Depends(get_settings)) -> ProviderInfo:
    soundfont_ready = bool(settings.resolved_fluidsynth_path and settings.resolved_soundfont_path)
    return ProviderInfo(
        base_url=settings.normalized_nim_base_url,
        model=settings.nim_model,
        api_key_configured=bool(settings.nim_api_key),
        audio_engine="soundfont_fluidsynth" if soundfont_ready else "procedural",
    )


@api_router.post("/compose", response_model=ComposeResponse)
async def compose(
    request: ComposeRequest,
    nim_client: NimClient = Depends(get_nim_client),
    store: DraftStore = Depends(get_store),
) -> ComposeResponse:
    try:
        composition = optimize_generated_composition(await nim_client.compose(request))
    except NimTimeoutError as exc:
        raise HTTPException(status_code=504, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Composition generation failed")
        raise HTTPException(status_code=502, detail=f"NVIDIA NIM generation failed: {exc}") from exc

    warnings = validate_composition(composition)
    blocking = [warning for warning in warnings if warning.startswith("Invalid")]
    if blocking:
        raise HTTPException(status_code=422, detail={"message": "Generated composition failed validation.", "warnings": warnings})

    draft_id = store.create(composition)
    return ComposeResponse(draft_id=draft_id, composition=composition, warnings=warnings)


@api_router.post("/refine", response_model=ComposeResponse)
async def refine(
    request: RefineRequest,
    nim_client: NimClient = Depends(get_nim_client),
    store: DraftStore = Depends(get_store),
) -> ComposeResponse:
    try:
        composition = optimize_generated_composition(await nim_client.refine(request.target, request.composition, request.instructions))
    except NimTimeoutError as exc:
        raise HTTPException(status_code=504, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Composition refinement failed")
        raise HTTPException(status_code=502, detail=f"NVIDIA NIM refinement failed: {exc}") from exc

    warnings = validate_composition(composition)
    blocking = [warning for warning in warnings if warning.startswith("Invalid")]
    if blocking:
        raise HTTPException(status_code=422, detail={"message": "Refined composition failed validation.", "warnings": warnings})

    draft_id = store.create(composition)
    return ComposeResponse(draft_id=draft_id, composition=composition, warnings=warnings)


@api_router.post("/validate", response_model=ValidationReport)
def validate_draft(composition: Composition) -> ValidationReport:
    return ValidationReport(**composition_validation_report(composition))


@api_router.post("/evaluate", response_model=EvaluationReport)
def evaluate_draft(composition: Composition) -> EvaluationReport:
    return EvaluationReport(**evaluate_composition(composition))


@api_router.post("/commercial-review", response_model=CommercialReview)
def review_commercial_readiness(composition: Composition) -> CommercialReview:
    return CommercialReview(**commercial_review(composition))


@api_router.get("/drafts", response_model=list[DraftSummary])
def list_drafts(store: DraftStore = Depends(get_store)) -> list[DraftSummary]:
    return store.list()


@api_router.get("/drafts/{draft_id}", response_model=DraftRecord)
def get_draft(draft_id: str, store: DraftStore = Depends(get_store)) -> DraftRecord:
    record = store.get(draft_id)
    if not record:
        raise HTTPException(status_code=404, detail="Draft not found.")
    return record


@api_router.put("/drafts/{draft_id}", response_model=DraftRecord)
def update_draft(
    draft_id: str,
    composition: Composition,
    store: DraftStore = Depends(get_store),
) -> DraftRecord:
    warnings = validate_composition(composition)
    blocking = [warning for warning in warnings if warning.startswith("Invalid")]
    if blocking:
        raise HTTPException(status_code=422, detail={"message": "Draft failed validation.", "warnings": warnings})
    try:
        store.update(draft_id, composition)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Draft not found.") from exc
    record = store.get(draft_id)
    if not record:
        raise HTTPException(status_code=404, detail="Draft not found.")
    return record


@api_router.post("/export/midi")
def export_midi(composition: Composition) -> Response:
    warnings = validate_composition(composition)
    blocking = [warning for warning in warnings if warning.startswith("Invalid")]
    if blocking:
        raise HTTPException(status_code=422, detail={"message": "Cannot export invalid draft.", "warnings": warnings})
    midi_bytes = composition_to_midi_bytes(composition)
    safe_title = "".join(char for char in composition.title if char.isalnum() or char in (" ", "-", "_")).strip()
    filename = (safe_title or "composition").replace(" ", "_") + ".mid"
    return Response(
        content=midi_bytes,
        media_type="audio/midi",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@api_router.post("/export/wav")
def export_wav(composition: Composition, settings: Settings = Depends(get_settings)) -> Response:
    warnings = validate_composition(composition)
    blocking = [warning for warning in warnings if warning.startswith("Invalid")]
    if blocking:
        raise HTTPException(status_code=422, detail={"message": "Cannot export invalid draft.", "warnings": warnings})
    try:
        wav_bytes = composition_to_soundfont_wav_bytes(
            composition,
            fluidsynth_path=settings.resolved_fluidsynth_path,
            soundfont_path=settings.resolved_soundfont_path,
        )
    except Exception as exc:
        logger.warning("SoundFont render failed, using procedural fallback: %s", exc)
        wav_bytes = composition_to_wav_bytes(composition)
    safe_title = "".join(char for char in composition.title if char.isalnum() or char in (" ", "-", "_")).strip()
    filename = (safe_title or "composition").replace(" ", "_") + ".wav"
    return Response(
        content=wav_bytes,
        media_type="audio/wav",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@api_router.post("/export/mp3")
def export_mp3(composition: Composition, settings: Settings = Depends(get_settings)) -> Response:
    if not shutil.which("ffmpeg"):
        raise HTTPException(status_code=503, detail="MP3 export requires FFmpeg. Install FFmpeg or use WAV export.")
    warnings = validate_composition(composition)
    blocking = [warning for warning in warnings if warning.startswith("Invalid")]
    if blocking:
        raise HTTPException(status_code=422, detail={"message": "Cannot export invalid draft.", "warnings": warnings})
    try:
        wav_bytes = composition_to_soundfont_wav_bytes(
            composition,
            fluidsynth_path=settings.resolved_fluidsynth_path,
            soundfont_path=settings.resolved_soundfont_path,
        )
    except Exception:
        wav_bytes = composition_to_wav_bytes(composition)
    safe_title = "".join(char for char in composition.title if char.isalnum() or char in (" ", "-", "_")).strip()
    filename = (safe_title or "composition").replace(" ", "_") + ".mp3"
    with tempfile.TemporaryDirectory() as temp_dir:
        wav_path = Path(temp_dir) / "input.wav"
        mp3_path = Path(temp_dir) / "output.mp3"
        wav_path.write_bytes(wav_bytes)
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(wav_path), "-codec:a", "libmp3lame", "-qscale:a", "2", str(mp3_path)],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        mp3_bytes = mp3_path.read_bytes()
    return Response(
        content=mp3_bytes,
        media_type="audio/mpeg",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@api_router.post("/export/stems")
def export_stems(composition: Composition) -> Response:
    warnings = validate_composition(composition)
    blocking = [warning for warning in warnings if warning.startswith("Invalid")]
    if blocking:
        raise HTTPException(status_code=422, detail={"message": "Cannot export invalid draft.", "warnings": warnings})
    safe_title = "".join(char for char in composition.title if char.isalnum() or char in (" ", "-", "_")).strip()
    base_name = (safe_title or "composition").replace(" ", "_")
    package = BytesIO()
    with ZipFile(package, "w", ZIP_DEFLATED) as zip_file:
        for stem in ("rhythm", "harmony", "melody", "bass", "drums"):
            zip_file.writestr(f"{base_name}_{stem}.wav", composition_to_wav_bytes(composition, stem=stem))
        zip_file.writestr(f"{base_name}_stem_notes.json", json.dumps({
            "drum_pattern": composition.drum_pattern,
            "bassline": composition.bassline,
            "mix_notes": composition.mix_notes,
        }, indent=2))
    package.seek(0)
    return Response(
        content=package.read(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{base_name}_stems.zip"'},
    )


@api_router.post("/export/musicxml")
def export_musicxml(composition: Composition) -> Response:
    warnings = validate_composition(composition)
    blocking = [warning for warning in warnings if warning.startswith("Invalid")]
    if blocking:
        raise HTTPException(status_code=422, detail={"message": "Cannot export invalid draft.", "warnings": warnings})
    musicxml_bytes = composition_to_musicxml_bytes(composition)
    safe_title = "".join(char for char in composition.title if char.isalnum() or char in (" ", "-", "_")).strip()
    filename = (safe_title or "composition").replace(" ", "_") + ".musicxml"
    return Response(
        content=musicxml_bytes,
        media_type="application/vnd.recordare.musicxml+xml",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@api_router.post("/export/notation")
def export_notation(composition: Composition) -> Response:
    notation = composition_to_notation_text(composition)
    safe_title = "".join(char for char in composition.title if char.isalnum() or char in (" ", "-", "_")).strip()
    filename = (safe_title or "composition").replace(" ", "_") + "_notation.txt"
    return Response(
        content=notation,
        media_type="text/plain",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@api_router.post("/export/package")
def export_package(composition: Composition, settings: Settings = Depends(get_settings)) -> Response:
    warnings = validate_composition(composition)
    blocking = [warning for warning in warnings if warning.startswith("Invalid")]
    if blocking:
        raise HTTPException(status_code=422, detail={"message": "Cannot export invalid draft.", "warnings": warnings})

    safe_title = "".join(char for char in composition.title if char.isalnum() or char in (" ", "-", "_")).strip()
    base_name = (safe_title or "composition").replace(" ", "_")
    package = BytesIO()
    evaluation = evaluate_composition(composition)
    review = commercial_review(composition)
    license_notes = (
        f"{composition.disclaimer}\n\n"
        "Review generated chords, melody, lyrics, MIDI, WAV, stems, and MusicXML before commercial release.\n"
        "Do not claim the output is guaranteed unique. Keep human review in the workflow.\n"
    )
    with ZipFile(package, "w", ZIP_DEFLATED) as zip_file:
        zip_file.writestr(f"{base_name}.json", json.dumps(composition.model_dump(), indent=2))
        zip_file.writestr(f"{base_name}.mid", composition_to_midi_bytes(composition))
        try:
            zip_file.writestr(
                f"{base_name}.wav",
                composition_to_soundfont_wav_bytes(
                    composition,
                    fluidsynth_path=settings.resolved_fluidsynth_path,
                    soundfont_path=settings.resolved_soundfont_path,
                ),
            )
        except Exception as exc:
            logger.warning("SoundFont package render failed, using procedural fallback: %s", exc)
            zip_file.writestr(f"{base_name}.wav", composition_to_wav_bytes(composition))
        zip_file.writestr(f"{base_name}_rhythm_stem.wav", composition_to_wav_bytes(composition, stem="rhythm"))
        zip_file.writestr(f"{base_name}_harmony_stem.wav", composition_to_wav_bytes(composition, stem="harmony"))
        zip_file.writestr(f"{base_name}_melody_stem.wav", composition_to_wav_bytes(composition, stem="melody"))
        zip_file.writestr(f"{base_name}.musicxml", composition_to_musicxml_bytes(composition))
        zip_file.writestr(f"{base_name}_notation.txt", composition_to_notation_text(composition))
        zip_file.writestr(f"{base_name}_evaluation.json", json.dumps(evaluation, indent=2))
        zip_file.writestr(f"{base_name}_commercial_review.json", json.dumps(review, indent=2))
        zip_file.writestr("LICENSE_AND_REVIEW_NOTES.txt", license_notes)
    package.seek(0)
    return Response(
        content=package.read(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{base_name}_package.zip"'},
    )


app.include_router(api_router, prefix=settings.normalized_api_prefix)

if settings.normalized_api_prefix != "/api":
    app.include_router(api_router, prefix="/api")
