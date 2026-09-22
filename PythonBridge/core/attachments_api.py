"""Private local attachment storage; all downloads are authenticated."""
import hashlib
import logging
import os
import tempfile
from pathlib import Path
from uuid import UUID, uuid4
from zipfile import ZipFile, BadZipFile

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool
from auth import AccessContext, get_access_context
from db import get_raw_cursor

router = APIRouter(prefix="/api/packaging/items", tags=["Packaging attachments"])
log = logging.getLogger(__name__)
MAX_BYTES = 10 * 1024 * 1024
TYPES = {".pdf":"application/pdf", ".png":"image/png", ".jpg":"image/jpeg",
 ".jpeg":"image/jpeg", ".txt":"text/plain", ".csv":"text/csv", ".eml":"message/rfc822",
 ".msg":"application/vnd.ms-outlook",
 ".docx":"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
 ".xlsx":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
 ".pptx":"application/vnd.openxmlformats-officedocument.presentationml.presentation"}

def storage_root():
    default = Path(os.environ.get("LOCALAPPDATA", tempfile.gettempdir())) / "PythonBridge" / "attachments"
    root = Path(os.environ.get("ATTACHMENT_ROOT", str(default))).resolve()
    repo = Path(__file__).resolve().parents[1]
    if root == repo or repo in root.parents:
        raise HTTPException(500, "Attachment storage must be outside the project directory.")
    root.mkdir(parents=True, exist_ok=True)
    return root

def stored_path(key):
    # Never interpret a client filename or SQL string as a relative path.
    return storage_root() / str(UUID(str(key)))

def database(sql, params):
    try:
        with get_raw_cursor() as cur:
            cur.execute(sql, *params)
            while not cur.description:
                if not cur.nextset():
                    return []
            names = [x[0] for x in cur.description]
            return [dict(zip(names, row)) for row in cur.fetchall()]
    except HTTPException:
        raise
    except Exception as exc:
        message = str(exc)
        for code, status, detail in [
          ("51101",401,"Username is incorrect."),("51102",403,"Packaging read access is required."),
          ("51201",404,"Packaging item not found."),("51202",403,"You cannot upload to this item."),
          ("51203",409,"Attachments are locked for this item stage."),
          ("51204",409,"Upload key belongs to a different file."),
          ("51205",422,"Maximum 20 attachments per item.")]:
            if code in message:
                raise HTTPException(status, detail) from exc
        log.exception("Attachment database operation failed")
        raise HTTPException(500,"Attachment database operation failed. Retry with the same upload key.") from exc

def public(row):
    return {k:v for k,v in row.items() if k not in ("StorageKey","StorageProvider","SHA256")}

def filename_info(name):
    if not name or len(name)>255 or any(ord(c)<32 for c in name) or any(c in name for c in '/\\:'):
        raise HTTPException(422,"Use a plain filename without path separators.")
    suffix = Path(name).suffix.lower()
    if suffix not in TYPES:
        raise HTTPException(422,"Allowed: PDF, PNG, JPG, DOCX, XLSX, PPTX, TXT, CSV, EML and MSG.")
    return suffix, TYPES[suffix]

def validate_content(path, suffix):
    with path.open("rb") as f:
        head=f.read(4096)
    valid=True
    if suffix==".pdf": valid=head.startswith(b"%PDF-")
    elif suffix==".png": valid=head.startswith(b"\x89PNG\r\n\x1a\n")
    elif suffix in (".jpg",".jpeg"): valid=head.startswith(b"\xff\xd8\xff")
    elif suffix==".msg": valid=head.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1")
    elif suffix in (".docx",".xlsx",".pptx"):
        try:
            with ZipFile(path) as archive:
                names=set(archive.namelist())
                required={".docx":"word/document.xml",".xlsx":"xl/workbook.xml",".pptx":"ppt/presentation.xml"}[suffix]
                valid="[Content_Types].xml" in names and required in names
        except BadZipFile:
            valid=False
    else: valid=b"\x00" not in head
    if not valid:
        raise HTTPException(422,"File content does not match its extension.")

@router.get("/{item_id}/attachments")
def list_attachments(item_id:int, ctx:AccessContext=Depends(get_access_context)):
    rows=database("EXEC dbo.usp_PackagingAttachment_Read ?,?",[ctx.username,item_id])
    return {"rows":[public(r) for r in rows]}

@router.put("/{item_id}/attachments/{upload_id}")
async def upload(item_id:int, upload_id:UUID, request:Request,
                 filename:str=Query(...,min_length=1,max_length=255),
                 ctx:AccessContext=Depends(get_access_context)):
    suffix,mime=filename_info(filename)
    await run_in_threadpool(database,"EXEC dbo.usp_PackagingAttachment_Authorize ?,?,1",[ctx.username,item_id])
    length=request.headers.get("content-length")
    if length:
        try: too_large=int(length)>MAX_BYTES
        except ValueError: raise HTTPException(422,"Invalid Content-Length.")
        if too_large: raise HTTPException(413,"Maximum file size is 10 MB.")
    root=storage_root()
    key=str(uuid4())  # separate immutable object per attempt
    temporary=root/(key+".part")
    final=stored_path(key)
    count=0
    digest=hashlib.sha256()
    try:
        with temporary.open("xb") as output:
            async for chunk in request.stream():
                count+=len(chunk)
                if count>MAX_BYTES: raise HTTPException(413,"Maximum file size is 10 MB.")
                digest.update(chunk)
                await run_in_threadpool(output.write,chunk)
            await run_in_threadpool(output.flush)
            await run_in_threadpool(os.fsync,output.fileno())
        if count==0: raise HTTPException(422,"Empty files cannot be attached.")
        await run_in_threadpool(validate_content,temporary,suffix)
        temporary.rename(final)
        # Stage/ownership rechecked under SQL lock after upload completes.
        rows=await run_in_threadpool(database,"EXEC dbo.usp_PackagingAttachment_Save ?,?,?,?,?,?,?,?",
            [ctx.username,item_id,str(upload_id),filename,key,mime,count,digest.hexdigest()])
        row=rows[0]
        if str(row["StorageKey"])!=key:
            final.unlink()  # confirmed idempotent replay; retain original object
        return {"attachment":public(row)}
    finally:
        temporary.unlink(missing_ok=True)
        # A lost SQL reply may mean COMMIT succeeded. Never delete the final
        # object on an ambiguous error; reconciliation can remove orphans later.

@router.get("/{item_id}/attachments/{attachment_id}/download")
def download(item_id:int, attachment_id:UUID, ctx:AccessContext=Depends(get_access_context)):
    rows=database("EXEC dbo.usp_PackagingAttachment_Read ?,?,?",[ctx.username,item_id,str(attachment_id)])
    if not rows: raise HTTPException(404,"Attachment not found.")
    row=rows[0]
    path=stored_path(row["StorageKey"])
    if not path.is_file(): raise HTTPException(404,"Attachment file is unavailable.")
    return FileResponse(path,filename=row["OriginalName"],media_type="application/octet-stream",
        headers={"X-Content-Type-Options":"nosniff","Cache-Control":"private, no-store"})
