import csv
import io
import uuid as uuid_module
from datetime import datetime

from fastapi.responses import StreamingResponse

from database import row_to_dict


def new_session_id() -> str:
    return f"TEST-{datetime.now().strftime('%Y%m%d')}-{uuid_module.uuid4().hex[:8].upper()}"


def _csv_response(rows: list, filename_prefix: str) -> StreamingResponse:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["session_id", "tester_name", "started_at", "ended_at",
                     "outcome", "notes", "prompt_used", "message_count"])
    for row in rows:
        d = row_to_dict(row)
        writer.writerow([
            d["id"], d["tester_name"],
            d.get("started_at", ""), d.get("ended_at", ""),
            d.get("outcome", ""), d.get("notes", ""),
            d.get("prompt_used", ""), d.get("message_count", 0),
        ])
    buf.seek(0)
    date_str = datetime.now().strftime("%Y%m%d")
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename_prefix}-{date_str}.csv"'},
    )
