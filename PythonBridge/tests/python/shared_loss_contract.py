"""Shared Loss Master migration and API contracts. All SQL changes roll back."""
import json
import sys
import unittest
from pathlib import Path
from uuid import uuid4
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
from auth import AccessContext
from loss_process_api import LossMasterSave,save

class Models(unittest.TestCase):
 def test_shared_flag_reaches_master_save(self):
  ctx=AccessContext(1,"Admin",frozenset({"Admin"}))
  with patch("loss_process_api.require_page_edit"),patch("loss_process_api.execute",return_value=[[dict(ID=1)]]) as execute:
   save(LossMasterSave(ProcessType="Packing",Shared=True),ctx)
   self.assertIs(execute.call_args.args[1][-1],True)

class Migration(unittest.TestCase):
 def test_rerun_preserves_records_and_master_save_persists_shared(self):
  import pyodbc
  conn=pyodbc.connect("DRIVER={ODBC Driver 17 for SQL Server};SERVER=localhost;DATABASE=test;Trusted_Connection=yes;TrustServerCertificate=yes",autocommit=True)
  cur=conn.cursor()
  def consume():
   while cur.nextset():pass
  try:
   cur.execute("SET NOCOUNT ON; BEGIN TRANSACTION")
   snapshot="SELECT COUNT_BIG(*),CHECKSUM_AGG(BINARY_CHECKSUM(ID,RowVersion,ProcessType,Status)) FROM dbo.LossProcessMaster"
   before=tuple(cur.execute(snapshot).fetchone())
   original=cur.execute("SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.usp_LossProcessMaster_Save'))").fetchval()
   sql=(Path(__file__).resolve().parents[2]/"sql/139_shared_loss_types.sql").read_text(encoding="utf-8")
   cur.execute(sql);consume()
   definition=cur.execute("SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.usp_LossProcessMaster_Save'))").fetchval()
   cur.execute(sql);consume()
   self.assertEqual(definition,cur.execute("SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.usp_LossProcessMaster_Save'))").fetchval())
   self.assertEqual(before,tuple(cur.execute(snapshot).fetchone()))
   if "fn_WorkspaceAccess" in original:self.assertIn("fn_WorkspaceAccess",definition)
   actor=cur.execute("SELECT TOP 1 UserName FROM dbo.Users WHERE IsActive=1 AND dbo.fn_WorkspaceAccess(ID,'loss-processes',1)=1").fetchval()
   self.assertIsNotNone(actor)
   cur.execute("EXEC dbo.usp_LossProcessMaster_Save ?,NULL,NULL,?,1,0,'Active',1",actor,"Shared-"+uuid4().hex)
   row=cur.fetchone();consume()
   self.assertTrue(cur.execute("SELECT Shared FROM dbo.LossProcessMaster WHERE ID=?",row[0]).fetchval())
   cur.execute("EXEC dbo.usp_LossProcessMaster_Save ?,?,?,?,1,0,'Active',0",actor,row[0],row[1],"Shared-"+uuid4().hex);consume()
   self.assertFalse(cur.execute("SELECT Shared FROM dbo.LossProcessMaster WHERE ID=?",row[0]).fetchval())
   self.assertEqual(cur.execute("SELECT @@TRANCOUNT").fetchval(),1)
  finally:
   cur.close()
   conn.cursor().execute("IF @@TRANCOUNT>0 ROLLBACK TRANSACTION")
   conn.close()

if __name__=="__main__":unittest.main()
