"""Local file lifecycle tests. All files live in temporary test directories."""
import asyncio
import hashlib
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
from fastapi import HTTPException
from starlette.requests import Request
from auth import AccessContext
import attachments_api as api

class Files(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix="bridge-attachments-")
  self.env=patch.dict(os.environ,{"ATTACHMENT_ROOT":self.temp.name})
  self.env.start()
  self.ctx=AccessContext(1,"Admin",frozenset({"Admin"}))
  self.rows={}
  self.mock=patch.object(api,"database",side_effect=self.database)
  self.mock.start()
 def tearDown(self):
  self.mock.stop();self.env.stop();self.temp.cleanup()
 def database(self,sql,params):
  if "Authorize" in sql:return []
  if "Save" in sql:
   _,item,id,name,key,mime,size,sha=params
   if id not in self.rows:
    self.rows[id]={"ID":id,"ItemID":item,"OriginalName":name,"StorageKey":key,"StorageProvider":"local","ContentType":mime,"SizeBytes":size,"SHA256":sha,"UploadedByName":"Admin"}
   return [self.rows[id]]
  return [r for id,r in self.rows.items() if r["ItemID"]==params[1] and (len(params)<3 or params[2]==id)]
 def upload(self,body=b"%PDF-1.7\nTest file",name="drawing.pdf",key=None,headers=None):
  async def receive():return {"type":"http.request","body":body,"more_body":False}
  request=Request({"type":"http","headers":headers or []},receive)
  return asyncio.run(api.upload(7,key or uuid4(),request,name,self.ctx))
 def test_upload_download_and_replay(self):
  key=uuid4()
  first=self.upload(key=key)
  second=self.upload(key=key)
  self.assertEqual(first,second)
  self.assertEqual(len(list(Path(self.temp.name).iterdir())),1)
  self.assertNotIn("StorageKey",first["attachment"])
  response=api.download(7,key,self.ctx)
  self.assertEqual(Path(response.path).read_bytes(),b"%PDF-1.7\nTest file")
  self.assertEqual(response.headers["x-content-type-options"],"nosniff")
  self.assertTrue(response.headers["content-disposition"].startswith("attachment;"))
  self.assertEqual(len(api.list_attachments(7,self.ctx)["rows"]),1)
 def test_invalid_content_and_filename(self):
  for name,body in [("../secret.pdf",b"%PDF-"),("run.exe",b"test"),("bad.pdf",b"not PDF"),("empty.txt",b"")]:
   with self.assertRaises(HTTPException):self.upload(body,name)
  self.assertEqual(list(Path(self.temp.name).iterdir()),[])
 def test_stream_size_limit_even_without_length_header(self):
  with patch.object(api,"MAX_BYTES",4):
   with self.assertRaises(HTTPException) as error:self.upload(b"12345","file.txt")
   self.assertEqual(error.exception.status_code,413)
  self.assertEqual(list(Path(self.temp.name).iterdir()),[])
 def test_permission_denied_before_file_write(self):
  with patch.object(api,"database",side_effect=HTTPException(403,"Denied")):
   with self.assertRaises(HTTPException):self.upload()
  self.assertEqual(list(Path(self.temp.name).iterdir()),[])
 def test_commit_failure_keeps_immutable_file_for_reconciliation(self):
  def failing(sql,params):
   if "Save" in sql:raise HTTPException(500,"Unknown commit result")
   return []
  with patch.object(api,"database",side_effect=failing):
   with self.assertRaises(HTTPException):self.upload()
  files=list(Path(self.temp.name).iterdir())
  self.assertEqual(len(files),1)
  self.assertFalse(files[0].name.endswith(".part"))
 def test_wrong_item_cannot_download_file(self):
  key=uuid4();self.upload(key=key)
  with self.assertRaises(HTTPException) as error:api.download(8,key,self.ctx)
  self.assertEqual(error.exception.status_code,404)

if __name__=="__main__":unittest.main()
