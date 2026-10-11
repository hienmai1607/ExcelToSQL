"""Apply migration 104 to the explicitly selected configured database."""
import argparse, re, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"core"))
from db import get_raw_cursor, DB_NAME
def apply():
 parser=argparse.ArgumentParser()
 parser.add_argument("--database",required=True)
 parser.add_argument("--apply",action="store_true")
 args=parser.parse_args()
 if args.database!=DB_NAME or not args.apply:raise SystemExit("Specify --apply and the exact configured --database.")
 with get_raw_cursor() as cur:
  try:
   cur.execute("BEGIN TRANSACTION")
   cur.execute("SELECT ID,UserName,IsActive,RowVersion FROM dbo.Users ORDER BY ID")
   users=list(cur.fetchall())
   cur.execute("SELECT AccessID,UserID,Scope,RowVersion FROM dbo.UserAccess ORDER BY AccessID")
   access=list(cur.fetchall())
   script=(ROOT/"sql"/"104_administrator_workspace.sql").read_text(encoding="utf-8")
   for batch in re.split(r"^GO\s*$",script,flags=re.MULTILINE|re.IGNORECASE):
    if batch.strip():
     cur.execute(batch)
     while cur.nextset():pass
   cur.execute("SELECT ID,UserName,IsActive,RowVersion FROM dbo.Users ORDER BY ID")
   if list(cur.fetchall())!=users:raise RuntimeError("Migration unexpectedly changed users.")
   cur.execute("SELECT AccessID,UserID,Scope,RowVersion FROM dbo.UserAccess ORDER BY AccessID")
   if list(cur.fetchall())!=access:raise RuntimeError("Migration unexpectedly changed existing access.")
   cur.execute("COMMIT TRANSACTION")
   print(f"Applied Administrator migration 104 to {DB_NAME}; existing {len(users)} users and {len(access)} access grants preserved.")
  except Exception:
   cur.execute("IF @@TRANCOUNT>0 ROLLBACK TRANSACTION");raise
if __name__=="__main__":apply()
