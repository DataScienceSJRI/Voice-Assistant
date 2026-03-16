import asyncio
import logging
import os
from contextlib import asynccontextmanager

import asyncpg
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler

from config import (
    ALLOWED_ORIGINS,
    DATABASE_URL,
    ELEVENLABS_API_KEY,
    AGENT_ID,
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    SUPABASE_JWT_SECRET,
)
import database
from limiter import limiter
from routes import health, elevenlabs, sessions, admin

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


# ── Lifespan ───────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    missing = [k for k, v in {
        "ELEVENLABS_API_KEY":  ELEVENLABS_API_KEY,
        "AGENT_ID":            AGENT_ID,
        "DATABASE_URL":        DATABASE_URL,
        "SUPABASE_JWT_SECRET": SUPABASE_JWT_SECRET,
        "SUPABASE_URL":        SUPABASE_URL,
        "SUPABASE_ANON_KEY":   SUPABASE_ANON_KEY,
    }.items() if not v]
    if missing:
        raise RuntimeError(f"Missing required environment variables: {', '.join(missing)}")

    database.db_pool = await asyncpg.create_pool(
        DATABASE_URL, min_size=2, max_size=10, statement_cache_size=0
    )
    logger.info("Database pool created")
    await database.init_db()

    cleanup_task = asyncio.create_task(database.cleanup_orphaned_sessions())
    logger.info("Orphan cleanup task started")

    yield

    cleanup_task.cancel()
    try:
        await cleanup_task
    except asyncio.CancelledError:
        pass
    await database.db_pool.close()
    logger.info("Database pool closed")


# ── App ────────────────────────────────────────────────────────────────────

app = FastAPI(lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(health.router)
app.include_router(elevenlabs.router)
app.include_router(sessions.router)
app.include_router(admin.router)

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="static")
