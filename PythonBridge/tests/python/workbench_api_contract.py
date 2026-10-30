"""Read-model contracts; no database writes."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
from fastapi import HTTPException
from auth import AccessContext
import workbench_api as api
import packaging_api

class Contract(unittest.TestCase):
    def test_pic_authorization(self):
        with patch.object(api,"execute",return_value=[[{"ID":2,"UserName":"PIC"}]]) as sql:
            with self.assertRaises(HTTPException) as error:
                api.pics(AccessContext(1,"Sales",frozenset({"Opportunity"})))
            self.assertEqual(error.exception.status_code,403)
            sql.assert_not_called()
            self.assertEqual(api.pics(AccessContext(1,"Manager",frozenset({"PackagingManager"})))["rows"][0]["ID"],2)
            self.assertIn("fn_PackagingPICMember(u.ID)=1",sql.call_args.args[0])
    def test_summary_parameterized_paging(self):
        with patch.object(packaging_api,"execute",return_value=[[],[{"Total":17}]]) as sql:
            result=api.requests(3,10,"Acme","Open",AccessContext(1,"Admin",frozenset({"Admin"})))
            self.assertEqual(result["total"],17)
            self.assertEqual(sql.call_args.args[1],["Admin",*(["Acme%"]*3+[None,None,None,None,"Open","Open"]),20,10,*(["Acme%"]*3+[None,None,None,None,"Open","Open"])])
    def test_summary_denies_unrelated_scope(self):
        with patch.object(api,"execute") as sql:
            with self.assertRaises(HTTPException):
                api.requests(1,25,"",None,AccessContext(1,"Customer",frozenset({"Customer"})))
            sql.assert_not_called()
    def test_request_id_forwarded(self):
        with patch.object(packaging_api,"execute",return_value=[[{"ItemID":7,"TotalMatchingRows":1}]]) as sql:
            result=packaging_api.request_read(page=2,page_size=10,stage=None,opportunity_number=None,request_id=5,ctx=AccessContext(1,"Admin",frozenset({"Admin"})))
            self.assertEqual(result["rows"][0]["ItemID"],7)
            self.assertEqual(sql.call_args.args[1],["Admin",None,10,2,None,5])
    def test_verified_session(self):
        self.assertEqual(api.session(AccessContext(1,"Manager",frozenset({"PackagingManager"}))),{"user_id":1,"username":"Manager","scopes":["PackagingManager"],"is_admin":False,"can_assign_packaging":True})
if __name__=="__main__":
    unittest.main()
