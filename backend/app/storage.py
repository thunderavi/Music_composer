import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from .schemas import Composition, DraftRecord, DraftSummary


class DraftStore:
    def __init__(self, database_path: str) -> None:
        self.database_path = Path(database_path)
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self._init()

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.database_path)

    def _init(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS drafts (
                    draft_id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    style TEXT NOT NULL,
                    mood TEXT NOT NULL,
                    composition_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            connection.commit()

    def create(self, composition: Composition) -> str:
        draft_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        payload = composition.model_dump_json()
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO drafts (draft_id, title, style, mood, composition_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (draft_id, composition.title, composition.style, composition.mood, payload, now, now),
            )
            connection.commit()
        return draft_id

    def update(self, draft_id: str, composition: Composition) -> None:
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as connection:
            cursor = connection.execute(
                """
                UPDATE drafts
                SET title = ?, style = ?, mood = ?, composition_json = ?, updated_at = ?
                WHERE draft_id = ?
                """,
                (
                    composition.title,
                    composition.style,
                    composition.mood,
                    composition.model_dump_json(),
                    now,
                    draft_id,
                ),
            )
            if cursor.rowcount == 0:
                raise KeyError(draft_id)
            connection.commit()

    def get(self, draft_id: str) -> Optional[DraftRecord]:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT draft_id, composition_json, created_at, updated_at
                FROM drafts
                WHERE draft_id = ?
                """,
                (draft_id,),
            ).fetchone()
        if not row:
            return None
        return DraftRecord(
            draft_id=row[0],
            composition=Composition.model_validate(json.loads(row[1])),
            created_at=row[2],
            updated_at=row[3],
        )

    def list(self) -> List[DraftSummary]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT draft_id, title, style, mood, updated_at
                FROM drafts
                ORDER BY updated_at DESC
                LIMIT 50
                """
            ).fetchall()
        return [
            DraftSummary(
                draft_id=row[0],
                title=row[1],
                style=row[2],
                mood=row[3],
                updated_at=row[4],
            )
            for row in rows
        ]
