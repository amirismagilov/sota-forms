from __future__ import annotations

from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.responses import Response

from ..db import get_db
from ..models import StoredFile

router = APIRouter(prefix="/api/public/files", tags=["files"])

MAX_BYTES = 25 * 1024 * 1024  # 25 MB hard cap


@router.post("")
async def upload_file(file: UploadFile):
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "file too large")
    async for db in get_db():
        rec = StoredFile(
            filename=file.filename or "upload",
            content_type=file.content_type or "application/octet-stream",
            size=len(data),
            data=data,
        )
        db.add(rec)
        await db.commit()
        await db.refresh(rec)
        return {
            "id": rec.id,
            "filename": rec.filename,
            "size": rec.size,
            "content_type": rec.content_type,
            "url": f"/api/public/files/{rec.id}",
        }


# Only these types are safe to render inline; everything else is forced to
# download so an uploaded HTML/SVG can't execute in our origin (stored XSS).
_INLINE_SAFE = {"image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"}


@router.get("/{file_id}")
async def get_file(file_id: str):
    async for db in get_db():
        rec = await db.get(StoredFile, file_id)
        if not rec:
            raise HTTPException(404, "file not found")
        disposition = "inline" if rec.content_type in _INLINE_SAFE else "attachment"
        safe_name = rec.filename.replace('"', "")
        return Response(
            content=rec.data,
            media_type=rec.content_type if rec.content_type in _INLINE_SAFE else "application/octet-stream",
            headers={
                "Content-Disposition": f'{disposition}; filename="{safe_name}"',
                "X-Content-Type-Options": "nosniff",
            },
        )
