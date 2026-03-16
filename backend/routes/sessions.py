import uuid as uuid_module
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel, field_validator

from auth import get_current_user
import database
from database import row_to_dict
from limiter import limiter
from utils import new_session_id, _csv_response

logger = logging.getLogger(__name__)
router = APIRouter()


class CreateSession(BaseModel):
    prompt_used: str = ""
    is_override: bool = True

    @field_validator("prompt_used")
    @classmethod
    def cap_prompt(cls, v: str) -> str:
        return v[:10_000]


@router.post("/api/sessions")
@limiter.limit("20/minute")
async def create_session(request: Request, body: CreateSession, user=Depends(get_current_user)):
    sid = new_session_id()
    async with database.db_pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO test_sessions (id, user_id, tester_name, prompt_used, is_override)
            VALUES ($1, $2, $3, $4, $5)
            """,
            sid,
            uuid_module.UUID(user["id"]),
            user["name"],
            body.prompt_used,
            body.is_override,
        )
    return {"session_id": sid}


class TranscriptEntry(BaseModel):
    role: str
    message: str

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        if v not in ("user", "agent", "system"):
            raise ValueError("role must be user, agent, or system")
        return v

    @field_validator("message")
    @classmethod
    def cap_message(cls, v: str) -> str:
        return v[:5_000]


@router.post("/api/sessions/{session_id}/transcript")
@limiter.limit("120/minute")
async def add_transcript(request: Request, session_id: str, entry: TranscriptEntry, user=Depends(get_current_user)):
    async with database.db_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT user_id FROM test_sessions WHERE id=$1", session_id
        )
        if not row:
            raise HTTPException(404, "Session not found")
        if str(row["user_id"]) != user["id"]:
            raise HTTPException(403, "Not your session")
        await conn.execute(
            "INSERT INTO transcript_entries (session_id, role, message) VALUES ($1, $2, $3)",
            session_id, entry.role, entry.message,
        )
    return {"ok": True}


VALID_OUTCOMES = {"worked", "partial", "failed"}


class EndSession(BaseModel):
    outcome: str
    notes: str = ""

    @field_validator("outcome")
    @classmethod
    def validate_outcome(cls, v: str) -> str:
        if v not in VALID_OUTCOMES:
            raise ValueError(f"outcome must be one of: {', '.join(sorted(VALID_OUTCOMES))}")
        return v

    @field_validator("notes")
    @classmethod
    def cap_notes(cls, v: str) -> str:
        return v[:2_000]


@router.put("/api/sessions/{session_id}/end")
@limiter.limit("30/minute")
async def end_session(request: Request, session_id: str, body: EndSession, user=Depends(get_current_user)):
    async with database.db_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT user_id FROM test_sessions WHERE id=$1", session_id
        )
        if not row:
            raise HTTPException(404, "Session not found")
        if str(row["user_id"]) != user["id"]:
            raise HTTPException(403, "Not your session")
        await conn.execute(
            "UPDATE test_sessions SET ended_at=$1, outcome=$2, notes=$3 WHERE id=$4",
            datetime.now(timezone.utc), body.outcome, body.notes, session_id,
        )
    return {"ok": True}


@router.post("/api/sessions/{session_id}/abandon")
@limiter.limit("30/minute")
async def abandon_session(request: Request, session_id: str, user=Depends(get_current_user)):
    """Called via keepalive fetch when the browser tab is closed mid-session."""
    async with database.db_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT user_id, ended_at FROM test_sessions WHERE id=$1", session_id
        )
        if not row:
            return {"ok": True}  # already gone, no error
        if str(row["user_id"]) != user["id"]:
            raise HTTPException(403, "Not your session")
        if row["ended_at"] is None:
            await conn.execute(
                "UPDATE test_sessions SET ended_at=$1 WHERE id=$2",
                datetime.now(timezone.utc), session_id,
            )
    return {"ok": True}


@router.get("/api/sessions")
@limiter.limit("30/minute")
async def list_sessions(request: Request, user=Depends(get_current_user)):
    async with database.db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT
                s.*,
                COUNT(t.id) AS message_count
            FROM test_sessions s
            LEFT JOIN transcript_entries t ON t.session_id = s.id
            WHERE s.user_id = $1
            GROUP BY s.id
            ORDER BY s.started_at DESC
        """, uuid_module.UUID(user["id"]))
    return [row_to_dict(r) for r in rows]


@router.get("/api/sessions/export")
@limiter.limit("10/minute")
async def export_my_sessions(request: Request, user=Depends(get_current_user)):
    async with database.db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT s.*, COUNT(t.id) AS message_count
            FROM test_sessions s
            LEFT JOIN transcript_entries t ON t.session_id = s.id
            WHERE s.user_id = $1
            GROUP BY s.id
            ORDER BY s.started_at DESC
        """, uuid_module.UUID(user["id"]))
    return _csv_response(rows, "my-sessions")


@router.get("/api/sessions/{session_id}")
async def get_session(session_id: str, user=Depends(get_current_user)):
    async with database.db_pool.acquire() as conn:
        session = await conn.fetchrow(
            "SELECT * FROM test_sessions WHERE id=$1 AND user_id=$2",
            session_id, uuid_module.UUID(user["id"]),
        )
        if not session:
            raise HTTPException(404, "Session not found")
        entries = await conn.fetch(
            "SELECT role, message, timestamp FROM transcript_entries WHERE session_id=$1 ORDER BY id",
            session_id,
        )
    return {**row_to_dict(session), "transcript": [row_to_dict(e) for e in entries]}
