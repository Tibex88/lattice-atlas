import json
import sqlite3
from pathlib import Path

from dashboard.config import SQLITE_DB
from dashboard.datasets import decode_entry, utc_now
from dashboard.errors import LOGGER, NotFoundError, RequestError


class SQLiteStore:
    _instance = None

    @classmethod
    def get(cls):
        if cls._instance is None:
            cls._instance = cls(SQLITE_DB, LOGGER)
        return cls._instance

    def __init__(self, path, logger):
        self.path = Path(path)
        self.logger = logger
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self):
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def _initialize(self):
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS saved_blueprints (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    dataset TEXT NOT NULL,
                    n INTEGER NOT NULL,
                    entry_index INTEGER NOT NULL,
                    encoding TEXT NOT NULL,
                    width INTEGER NOT NULL,
                    height INTEGER NOT NULL,
                    structure_count INTEGER,
                    title TEXT NOT NULL DEFAULT '',
                    notes TEXT NOT NULL DEFAULT '',
                    tags_json TEXT NOT NULL DEFAULT '[]',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(dataset, n, entry_index)
                );

                CREATE TABLE IF NOT EXISTS saved_sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    notes TEXT NOT NULL DEFAULT '',
                    state_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                """
            )
        self.logger.info("storage.ready", path=str(self.path))

    def status(self):
        with self._connect() as conn:
            blueprint_count = conn.execute("SELECT COUNT(*) FROM saved_blueprints").fetchone()[0]
            session_count = conn.execute("SELECT COUNT(*) FROM saved_sessions").fetchone()[0]
        return {"path": str(self.path), "blueprints": blueprint_count, "sessions": session_count}

    def _serialize_blueprint_row(self, row):
        return {
            "id": row["id"],
            "dataset": row["dataset"],
            "n": row["n"],
            "index": row["entry_index"],
            "encoding": row["encoding"],
            "width": row["width"],
            "height": row["height"],
            "count": row["structure_count"],
            "title": row["title"],
            "notes": row["notes"],
            "tags": json.loads(row["tags_json"]),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def list_blueprints(self):
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT *
                FROM saved_blueprints
                ORDER BY updated_at DESC, id DESC
                """
            ).fetchall()
        return [self._serialize_blueprint_row(row) for row in rows]

    def save_blueprint(self, dataset, n, index, title="", notes="", tags=None):
        entry = decode_entry(dataset, n, index)
        timestamp = utc_now()
        tags = tags or []
        if not isinstance(tags, list) or any(not isinstance(tag, str) for tag in tags):
            raise RequestError("tags must be a list of strings")
        payload = {
            "dataset": dataset,
            "n": n,
            "entry_index": index,
            "encoding": entry["encoding"],
            "width": entry["width"],
            "height": entry["height"],
            "structure_count": entry["count"],
            "title": title.strip(),
            "notes": notes.strip(),
            "tags_json": json.dumps(tags),
            "created_at": timestamp,
            "updated_at": timestamp,
        }
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO saved_blueprints (
                    dataset, n, entry_index, encoding, width, height, structure_count,
                    title, notes, tags_json, created_at, updated_at
                ) VALUES (
                    :dataset, :n, :entry_index, :encoding, :width, :height, :structure_count,
                    :title, :notes, :tags_json, :created_at, :updated_at
                )
                ON CONFLICT(dataset, n, entry_index) DO UPDATE SET
                    encoding=excluded.encoding,
                    width=excluded.width,
                    height=excluded.height,
                    structure_count=excluded.structure_count,
                    title=excluded.title,
                    notes=excluded.notes,
                    tags_json=excluded.tags_json,
                    updated_at=excluded.updated_at
                """,
                payload,
            )
            row = conn.execute(
                """
                SELECT *
                FROM saved_blueprints
                WHERE dataset = ? AND n = ? AND entry_index = ?
                """,
                (dataset, n, index),
            ).fetchone()
        self.logger.info("storage.blueprint_saved", dataset=dataset, n=n, index=index)
        return self._serialize_blueprint_row(row)

    def delete_blueprint(self, blueprint_id):
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM saved_blueprints WHERE id = ?", (blueprint_id,)).fetchone()
            if row is None:
                raise NotFoundError(f"saved blueprint {blueprint_id} not found")
            conn.execute("DELETE FROM saved_blueprints WHERE id = ?", (blueprint_id,))
        self.logger.info("storage.blueprint_deleted", id=blueprint_id)
        return {"id": blueprint_id}

    def _serialize_session_row(self, row):
        return {
            "id": row["id"],
            "name": row["name"],
            "notes": row["notes"],
            "state": json.loads(row["state_json"]),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def list_sessions(self):
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT *
                FROM saved_sessions
                ORDER BY updated_at DESC, id DESC
                """
            ).fetchall()
        return [self._serialize_session_row(row) for row in rows]

    def save_session(self, name, state, notes="", session_id=None):
        if not isinstance(state, dict):
            raise RequestError("state must be an object")
        timestamp = utc_now()
        clean_name = name.strip()
        clean_notes = notes.strip()
        encoded_state = json.dumps(state)
        if session_id is None:
            with self._connect() as conn:
                cursor = conn.execute(
                    """
                    INSERT INTO saved_sessions (name, notes, state_json, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (clean_name, clean_notes, encoded_state, timestamp, timestamp),
                )
                row = conn.execute("SELECT * FROM saved_sessions WHERE id = ?", (cursor.lastrowid,)).fetchone()
        else:
            with self._connect() as conn:
                existing = conn.execute("SELECT id FROM saved_sessions WHERE id = ?", (session_id,)).fetchone()
                if existing is None:
                    raise NotFoundError(f"saved session {session_id} not found")
                conn.execute(
                    """
                    UPDATE saved_sessions
                    SET name = ?, notes = ?, state_json = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (clean_name, clean_notes, encoded_state, timestamp, session_id),
                )
                row = conn.execute("SELECT * FROM saved_sessions WHERE id = ?", (session_id,)).fetchone()
        self.logger.info("storage.session_saved", id=row["id"], name=row["name"])
        return self._serialize_session_row(row)

    def delete_session(self, session_id):
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM saved_sessions WHERE id = ?", (session_id,)).fetchone()
            if row is None:
                raise NotFoundError(f"saved session {session_id} not found")
            conn.execute("DELETE FROM saved_sessions WHERE id = ?", (session_id,))
        self.logger.info("storage.session_deleted", id=session_id)
        return {"id": session_id}


STORE = SQLiteStore.get()
