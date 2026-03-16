import logging

from fastapi import APIRouter, Depends, Request

from auth import require_admin
from database import db_pool, row_to_dict
from limiter import limiter
from utils import _csv_response

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/api/admin/sessions")
@limiter.limit("30/minute")
async def admin_list_sessions(request: Request, user=Depends(require_admin)):
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT s.*, COUNT(t.id) AS message_count
            FROM test_sessions s
            LEFT JOIN transcript_entries t ON t.session_id = s.id
            GROUP BY s.id
            ORDER BY s.started_at DESC
        """)
    return [row_to_dict(r) for r in rows]


@router.get("/api/admin/sessions/export")
@limiter.limit("10/minute")
async def admin_export_sessions(request: Request, user=Depends(require_admin)):
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT s.*, COUNT(t.id) AS message_count
            FROM test_sessions s
            LEFT JOIN transcript_entries t ON t.session_id = s.id
            GROUP BY s.id
            ORDER BY s.started_at DESC
        """)
    return _csv_response(rows, "all-sessions")
