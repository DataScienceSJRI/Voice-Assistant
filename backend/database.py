import asyncio
import uuid as uuid_module
import logging
from datetime import datetime
from typing import Optional

import asyncpg

from config import DATABASE_URL

logger = logging.getLogger(__name__)

db_pool: Optional[asyncpg.Pool] = None


async def init_db():
    async with db_pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS test_sessions (
                id           TEXT PRIMARY KEY,
                user_id      UUID NOT NULL,
                tester_name  TEXT NOT NULL,
                prompt_used  TEXT,
                is_override  BOOLEAN DEFAULT TRUE,
                started_at   TIMESTAMPTZ DEFAULT NOW(),
                ended_at     TIMESTAMPTZ,
                outcome      TEXT CHECK (outcome IN ('worked', 'partial', 'failed')),
                notes        TEXT
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS transcript_entries (
                id          BIGSERIAL PRIMARY KEY,
                session_id  TEXT NOT NULL REFERENCES test_sessions(id) ON DELETE CASCADE,
                role        TEXT NOT NULL CHECK (role IN ('user', 'agent', 'system')),
                message     TEXT NOT NULL,
                timestamp   TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_sessions_user_id
            ON test_sessions(user_id)
        """)
        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_sessions_started_at
            ON test_sessions(started_at DESC)
        """)
        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_transcript_session_id
            ON transcript_entries(session_id)
        """)
    logger.info("Database schema ready")


async def cleanup_orphaned_sessions():
    """Background task: marks sessions with no ended_at older than 2 hours as ended."""
    while True:
        await asyncio.sleep(3600)  # run every hour
        try:
            async with db_pool.acquire() as conn:
                result = await conn.execute("""
                    UPDATE test_sessions
                    SET ended_at = NOW()
                    WHERE ended_at IS NULL
                      AND started_at < NOW() - INTERVAL '2 hours'
                """)
            logger.info("Orphan session cleanup: %s", result)
        except Exception as e:
            logger.error("Orphan session cleanup failed: %s", e)


def row_to_dict(row) -> dict:
    d = {}
    for k, v in dict(row).items():
        if isinstance(v, datetime):
            d[k] = v.isoformat()
        elif isinstance(v, uuid_module.UUID):
            d[k] = str(v)
        else:
            d[k] = v
    return d
