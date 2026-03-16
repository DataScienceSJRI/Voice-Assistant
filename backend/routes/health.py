import logging

from fastapi import APIRouter, HTTPException, Depends

from auth import get_current_user
from config import SUPABASE_URL, SUPABASE_ANON_KEY
from database import db_pool

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/health")
async def health():
    try:
        async with db_pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
    except Exception as e:
        logger.error("Health check DB failure: %s", e)
        raise HTTPException(503, "Database unavailable")
    return {"status": "ok"}


@router.get("/api/config")
async def get_config():
    return {
        "supabase_url":      SUPABASE_URL,
        "supabase_anon_key": SUPABASE_ANON_KEY,
    }


@router.get("/api/me")
async def get_me(user=Depends(get_current_user)):
    return user
