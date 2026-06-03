import logging
from functools import lru_cache

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware

from .config import Settings, get_settings
from .music import composition_to_midi_bytes, composition_to_notation_text, validate_composition
from .nim_client import NimClient
from .schemas import (
    ComposeRequest,
    ComposeResponse,
    Composition,
    DraftRecord,
    DraftSummary,
    ProviderInfo,
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
    return ProviderInfo(
        base_url=settings.normalized_nim_base_url,
        model=settings.nim_model,
        api_key_configured=bool(settings.nim_api_key),
    )


@api_router.post("/compose", response_model=ComposeResponse)
async def compose(
    request: ComposeRequest,
    nim_client: NimClient = Depends(get_nim_client),
    store: DraftStore = Depends(get_store),
) -> ComposeResponse:
    try:
        composition = await nim_client.compose(request)
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


app.include_router(api_router, prefix=settings.normalized_api_prefix)

if settings.normalized_api_prefix != "/api":
    app.include_router(api_router, prefix="/api")
