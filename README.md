# ElevenLabs Agent Tester

Internal tool for testers to run voice conversations with an ElevenLabs conversational AI agent, rate outcomes, and review session history.

## Architecture

- **Backend**: FastAPI + asyncpg, JWT auth via Supabase
- **Frontend**: Single-page vanilla JS, served as static files by the same server
- **Auth**: Supabase email/password — each tester sees only their own sessions
- **Audio**: Browser → ElevenLabs directly via signed WebSocket URL

## Prerequisites

- Python 3.11+
- A [Supabase](https://supabase.com) project with email auth enabled
- An [ElevenLabs](https://elevenlabs.io) account with a ConvAI agent

## Local development

```bash
cp .env.example .env
# fill in .env values

bash start.sh
# open http://localhost:8000
```

Quick summary:
1. Clone to `/opt/elevenlabs-tester` on your Linux server
2. Create `.venv`, install deps, configure `.env`
3. Install `deploy/elevenlabs-tester.service` as a systemd unit
4. Configure nginx with `deploy/nginx.conf`
5. Issue SSL cert with certbot
6. Future updates: `bash deploy/deploy.sh`

## Environment variables

| Variable | Description |
|---|---|
| `ELEVENLABS_API_KEY` | ElevenLabs API key |
| `AGENT_ID` | ConvAI agent ID |
| `DATABASE_URL` | Supabase session-mode pooler URL |
| `SUPABASE_URL` | `https://[ref].supabase.co` |
| `SUPABASE_ANON_KEY` | Supabase anon/public key |
| `SUPABASE_JWT_SECRET` | Supabase JWT secret (Settings → API) |
| `ALLOWED_ORIGINS` | Comma-separated allowed CORS origins |

## API endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check (queries DB) |
| `GET` | `/api/config` | Public Supabase config for frontend |
| `GET` | `/api/agent` | ElevenLabs agent config proxy |
| `GET` | `/api/signed-url` | ElevenLabs signed WebSocket URL |
| `POST` | `/api/sessions` | Create a new test session |
| `GET` | `/api/sessions` | List current user's sessions |
| `GET` | `/api/sessions/{id}` | Get session + transcript |
| `POST` | `/api/sessions/{id}/transcript` | Append a transcript entry |
| `PUT` | `/api/sessions/{id}/end` | End session with outcome + notes |
| `POST` | `/api/sessions/{id}/abandon` | Mark session ended (beforeunload) |
