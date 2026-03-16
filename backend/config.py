import os
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

ELEVENLABS_API_KEY  = os.getenv("ELEVENLABS_API_KEY", "")
AGENT_ID            = os.getenv("AGENT_ID", "")
BASE_URL            = "https://api.elevenlabs.io"
DATABASE_URL        = os.getenv("DATABASE_URL", "")
SUPABASE_URL        = os.getenv("SUPABASE_URL", "")
SUPABASE_ANON_KEY   = os.getenv("SUPABASE_ANON_KEY", "")
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")
ALLOWED_ORIGINS     = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:8000").split(",")]
ADMIN_EMAILS        = {e.strip() for e in os.getenv("ADMIN_EMAILS", "").split(",") if e.strip()}
