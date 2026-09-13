"""Persistent conversation storage keyed by browser device ID (SQLite).

Chat HTTP no longer uses this module — agent-runtime owns
``runtime/conversations/agent.db``. Kept so a stale Python process cannot
silently invent a second writer. Do not import from new code.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.config import settings

_BACKEND_ROOT = Path(__file__).resolve().parent.parent


def _conversations_dir() -> Path:
    p = Path(settings.conversations_data_dir)
    if not p.is_absolute():
        p = _BACKEND_ROOT / p
    return p.resolve()


DB_PATH = _conversations_dir() / "agent.db"


def _utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _connect() as conn:
        # Bootstrap without assuming column names — older DBs used client_ip.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                device_id TEXT NOT NULL DEFAULT '',
                title TEXT NOT NULL DEFAULT 'New conversation',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                meta TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_msg_conv
                ON messages(conversation_id, id ASC);
        """)

        cols = {row[1] for row in conn.execute("PRAGMA table_info(conversations)").fetchall()}
        if "client_ip" in cols and "device_id" not in cols:
            conn.execute("ALTER TABLE conversations RENAME COLUMN client_ip TO device_id")
            conn.execute("DROP INDEX IF EXISTS idx_conv_ip_updated")
            cols = {row[1] for row in conn.execute("PRAGMA table_info(conversations)").fetchall()}
        if "device_id" not in cols:
            conn.execute(
                "ALTER TABLE conversations ADD COLUMN device_id TEXT NOT NULL DEFAULT ''"
            )

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_conv_device_updated "
            "ON conversations(device_id, updated_at DESC)"
        )

        msg_cols = {row[1] for row in conn.execute("PRAGMA table_info(messages)").fetchall()}
        if "meta" not in msg_cols:
            conn.execute("ALTER TABLE messages ADD COLUMN meta TEXT")


def create_conversation(device_id: str, title: str = "New conversation") -> dict[str, Any]:
    conv_id = str(uuid.uuid4())
    now = _utcnow()
    title = (title or "New conversation").strip()[:80] or "New conversation"
    with _connect() as conn:
        conn.execute(
            "INSERT INTO conversations (id, device_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (conv_id, device_id, title, now, now),
        )
    return {"id": conv_id, "title": title, "created_at": now, "updated_at": now}


def list_conversations(device_id: str, limit: int = 50) -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            """SELECT id, title, created_at, updated_at
               FROM conversations WHERE device_id = ?
               ORDER BY updated_at DESC LIMIT ?""",
            (device_id, limit),
        ).fetchall()
    return [dict(r) for r in rows]


def _parse_message_row(row: sqlite3.Row) -> dict[str, Any]:
    msg = dict(row)
    raw_meta = msg.pop("meta", None)
    if raw_meta:
        try:
            msg["meta"] = json.loads(raw_meta)
        except (TypeError, json.JSONDecodeError):
            msg["meta"] = None
    else:
        msg["meta"] = None
    return msg


def get_conversation(conversation_id: str, device_id: str) -> dict[str, Any] | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT id, title, created_at, updated_at FROM conversations WHERE id = ? AND device_id = ?",
            (conversation_id, device_id),
        ).fetchone()
        if not row:
            return None
        messages = conn.execute(
            "SELECT role, content, meta, created_at FROM messages WHERE conversation_id = ? ORDER BY id ASC",
            (conversation_id,),
        ).fetchall()
    return {
        **dict(row),
        "messages": [_parse_message_row(m) for m in messages],
    }


def belongs_to_device(conversation_id: str, device_id: str) -> bool:
    with _connect() as conn:
        row = conn.execute(
            "SELECT 1 FROM conversations WHERE id = ? AND device_id = ?",
            (conversation_id, device_id),
        ).fetchone()
    return row is not None


def add_message(
    conversation_id: str,
    role: str,
    content: str,
    meta: dict[str, Any] | None = None,
) -> None:
    now = _utcnow()
    meta_json = json.dumps(meta, ensure_ascii=False) if meta else None
    with _connect() as conn:
        conn.execute(
            "INSERT INTO messages (conversation_id, role, content, meta, created_at) VALUES (?, ?, ?, ?, ?)",
            (conversation_id, role, content, meta_json, now),
        )
        conn.execute(
            "UPDATE conversations SET updated_at = ? WHERE id = ?",
            (now, conversation_id),
        )


def update_title(conversation_id: str, title: str) -> None:
    title = title.strip()[:80] or "New conversation"
    with _connect() as conn:
        conn.execute(
            "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?",
            (title, _utcnow(), conversation_id),
        )


def delete_conversation(conversation_id: str, device_id: str) -> bool:
    with _connect() as conn:
        cur = conn.execute(
            "DELETE FROM conversations WHERE id = ? AND device_id = ?",
            (conversation_id, device_id),
        )
        conn.execute("DELETE FROM messages WHERE conversation_id = ?", (conversation_id,))
    return cur.rowcount > 0
