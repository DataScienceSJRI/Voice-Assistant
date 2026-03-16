import logging

import httpx
from fastapi import APIRouter, HTTPException, Depends, Request

from auth import get_current_user
from config import BASE_URL, ELEVENLABS_API_KEY, AGENT_ID
from limiter import limiter

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/api/signed-url")
@limiter.limit("10/minute")
async def get_signed_url(request: Request, user=Depends(get_current_user)):
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            f"{BASE_URL}/v1/convai/conversation/get_signed_url",
            params={"agent_id": AGENT_ID},
            headers={"xi-api-key": ELEVENLABS_API_KEY},
        )
    if resp.status_code != 200:
        logger.error("ElevenLabs signed-url error %s: %s", resp.status_code, resp.text[:200])
        raise HTTPException(502, "Failed to get signed URL from ElevenLabs")
    return resp.json()


@router.get("/api/agent")
@limiter.limit("20/minute")
async def get_agent(request: Request, user=Depends(get_current_user)):
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(
            f"{BASE_URL}/v1/convai/agents/{AGENT_ID}",
            headers={"xi-api-key": ELEVENLABS_API_KEY},
        )
    if resp.status_code != 200:
        logger.error("ElevenLabs get-agent error %s: %s", resp.status_code, resp.text[:200])
        raise HTTPException(502, "Failed to get agent config from ElevenLabs")
    return resp.json()
