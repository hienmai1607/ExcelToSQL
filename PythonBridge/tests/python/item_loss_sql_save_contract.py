"""Rollback-only SQL save regression. Set LOSS_TEST_MIGRATE=0 to diagnose an unmigrated database."""
import sys,json,re,unittest,os
from pathlib import Path
from contextlib import contextmanager
from unittest.mock import patch
import pyodbc
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
from auth import AccessContext
import tcb_api,packaging_api
class ItemLossSQLSave(unittest.TestCase):
 def test_three_product_losses_and_layer_ratio_save(self):
  conn=pyodbc.connect("DRIVER={ODBC Driver 17 for SQL Server};SERVER=localhost;DATABASE=test;Trusted_Connection=yes;TrustServerCertificate=yes",autocommit=True)
  cur=conn.cursor()
  try:
   cur.execute("SET NOCOUNT ON;BEGIN TRANSACTION")
   if os.environ.get("LOSS_TEST_MIGRATE","1")=="1":
    for name in ["94_opportunity_owned_losses.sql","95_item_loss_formula.sql"]:
     for batch in re.split(r"^GO\s*$",(Path(__file__).resolve().parents[2]/"sql"/name).read_text(),flags=re.M|re.I):
      if batch.strip():
       cur.execute(batch)
       while cur.nextset():pass
   actor,username=cur.execute("SELECT TOP(1) u.ID,u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE u.IsActive=1 AND a.Scope='Admin' ORDER BY u.ID").fetchone()
   customer=cur.execute("SELECT TOP(1) ID FROM dbo.Customer WHERE Status='Active' ORDER BY ID").fetchval()
   product=cur.execute("INSERT dbo.Product(ProductCode,ProductName,WeightGrams,CustomerID,CreatedBy) VALUES('LS-'+LEFT(CONVERT(VARCHAR(36),NEWID()),16),'Loss regression',150,?,?);SELECT CONVERT(INT,SCOPE_IDENTITY())",customer,actor).fetchval()
   opp=cur.execute("INSERT dbo.Opportunity(OpportunityNumber,CustomerID,OpportunityDesc,BidOpen,BidClose,Stage,CreatedBy) VALUES('LS-'+LEFT(CONVERT(VARCHAR(36),NEWID()),16),?,'Loss regression','2026-10-01','2026-10-30','Draft',?);SELECT CONVERT(INT,SCOPE_IDENTITY())",customer,actor).fetchval()
   item=cur.execute("INSERT dbo.OpportunityItem(OpportunityID,ProductID,ItemDescription,AnnualUnit,Stage,CreatedBy) VALUES(?,?,'Loss regression',100,'Draft',?);SELECT CONVERT(INT,SCOPE_IDENTITY())",opp,product,actor).fetchval()
   steps=[]
   for i,ratio in enumerate(["3","2","1"]):
    master,version=cur.execute("INSERT dbo.LossProcessMaster(ProcessType,Sequence,LossPct,Status,CreatedBy) VALUES('LS-'+LEFT(CONVERT(VARCHAR(36),NEWID()),16),1,0,'Active',?);SELECT ID,CONVERT(VARCHAR(18),CONVERT(VARBINARY(8),RowVersion),1) FROM dbo.LossProcessMaster WHERE ID=CONVERT(INT,SCOPE_IDENTITY())",actor).fetchone()
    name=cur.execute("SELECT ProcessType FROM dbo.LossProcessMaster WHERE ID=?",master).fetchval()
    steps.append(dict(MasterID=master,MasterVersion=version,ProcessType="Processing",ProcessName=name,Sequence=i+1,LossPct=ratio))
   steps.append(dict(ProcessType="PrimaryPackaging",Sequence=1,LossPct="2"))
   @contextmanager
   def cursor():
    yield conn.cursor()
   with patch.object(packaging_api,"get_raw_cursor",cursor):
    ctx=AccessContext(actor,username,frozenset({"Admin"}))
    row=tcb_api.item_read(item,ctx)
    result=tcb_api.save_losses(tcb_api.LossSave(RowVersion=row["RowVersion"],Inputs={"LossProcesses":steps,"ProductLossFormula":"1-(1-L1)*(1-L2)*(1-L3)"}),item,ctx)
    self.assertEqual(result["saved"]["Inputs"]["LossProductPct"],"5.890600000")
    self.assertEqual(len(result["saved"]["Inputs"]["LossProcesses"]),4)
    value=cur.execute("SELECT TCBCostInfo FROM dbo.OpportunityItem WHERE ID=?",item).fetchval()
    self.assertEqual(json.loads(value)["Inputs"]["PrimaryLossPct"],"2.00")
  finally:
   cur.execute("IF @@TRANCOUNT>0 ROLLBACK")
   conn.close()
if __name__=="__main__":unittest.main()
