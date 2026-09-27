"""Grade tree contract and SQL integration tests. SQL tests roll back all fixtures/schema."""
import json
import re
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from decimal import Decimal
from uuid import uuid4
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "core"))
from pydantic import ValidationError
from product_grades import GradeTree, GradeSave
from schemas import ProductBatchRequest
from auth import AccessContext
import product_grades_api as api

TREE = [
    dict(ParentID="0", ID=1, Grade="A", RatioPct="60"),
    dict(ParentID="0", ID=2, Grade="B", RatioPct="40"),
    dict(ParentID="0/1", ID=1, Grade="A1", RatioPct="33.33"),
    dict(ParentID="0/1", ID=2, Grade="A2", RatioPct="66.67"),
]


class Contracts(unittest.TestCase):
    def test_nested_percentages_and_ids(self):
        tree = GradeTree(items=TREE)
        self.assertEqual(tree.items[2].path, "0/1/1")
        self.assertEqual(tree.items[2].RatioPct, Decimal("33.33"))

    def test_invalid_trees(self):
        invalid = [
            [], TREE + [TREE[0]],
            [dict(ParentID="0/9", ID=1, Grade="Orphan", RatioPct=100)],
            [dict(ParentID="0", ID=1, Grade=" ", RatioPct=100)],
            [dict(ParentID="0", ID=1, Grade="A", RatioPct="99.99")],
            [dict(ParentID="0", ID=1, Grade="A", RatioPct="100.001")],
            [dict(ParentID="0", ID=1, Grade="A", RatioPct="NaN")],
            [*TREE[:2], dict(ParentID="0/1", ID=1, Grade="Child", RatioPct="50")],
        ]
        for items in invalid:
            with self.subTest(items=items), self.assertRaises(ValidationError):
                GradeTree(items=items)

    def test_initial_grade_without_manual_product_code(self):
        row = dict(RowNum=1, Command="C", ProductName="Test", Category="Nuts",
                   WeightValue=100, WeightUnit="g", GradeVersion=dict(items=TREE, Status="Active"))
        model = ProductBatchRequest(rows=[row]).rows[0]
        self.assertIsNone(model.product_code)
        self.assertEqual(len(model.GradeVersion.items), 4)
        with self.assertRaises(ValidationError):
            ProductBatchRequest(rows=[{**row, "Command": "U"}])
        with self.assertRaises(ValidationError):
            ProductBatchRequest(rows=[{**row, "Grade": "legacy"}])

    def test_authorization_and_tokens(self):
        from fastapi import HTTPException
        with patch.object(api, "execute") as sql:
            with self.assertRaises(HTTPException) as error:
                api.read(1, AccessContext(1, "Sales", frozenset({"Opportunity"})))
            self.assertEqual(error.exception.status_code, 403)
            sql.assert_not_called()
        with self.assertRaises(ValidationError):
            GradeSave(items=TREE, VersionID=1, ProductRowVersion="AAAAAAAAAAE=")
        with patch.object(api, "execute") as sql:
            with self.assertRaises(HTTPException):
                api.save(GradeSave(items=TREE, ProductRowVersion="invalid"), 1,
                         AccessContext(1, "Admin", frozenset({"Admin"})))
            sql.assert_not_called()


class SQLContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if "--sql" not in sys.argv:
            raise unittest.SkipTest("Pass --sql for local rollback integration tests.")

    def setUp(self):
        import pyodbc
        from packaging_fields import consume
        self.consume = consume
        self.conn = pyodbc.connect("DRIVER={ODBC Driver 17 for SQL Server};SERVER=localhost;DATABASE=test;Trusted_Connection=yes;TrustServerCertificate=yes", autocommit=True)
        self.addCleanup(self.cleanup)
        self.cur = self.conn.cursor()
        self.cur.execute("SET NOCOUNT ON; BEGIN TRANSACTION")
        for batch in re.split(r"^GO\s*$", (ROOT / "sql/29_product_mix.sql").read_text(encoding="utf-8"), flags=re.M | re.I):
            if batch.strip():
                self.cur.execute(batch)
                self.consume(self.cur)
        self.actor, self.user = self.cur.execute("SELECT TOP(1) u.ID,u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE u.IsActive=1 AND a.Scope='Admin' ORDER BY u.ID").fetchone()
        self.created = self.create_product()
        self.product = self.created["NewID"]

    def cleanup(self):
        try:
            self.conn.cursor().execute("IF @@TRANCOUNT>0 ROLLBACK")
        finally:
            self.conn.close()

    def create_product(self):
        self.cur.execute("""
            DECLARE @r dbo.ProductBatchType;
            INSERT @r(RowNum,Command,ProductName,WeightValue,WeightUnit) VALUES(1,'C',?,100,'g');
            DECLARE @Customer INT=(SELECT TOP(1) ID FROM dbo.Customer WHERE Status='Active' ORDER BY ID);
            EXEC dbo.usp_Product_Batch @r,?,0,@Customer;
        """, "Grade test " + uuid4().hex, self.user)
        result = self.consume(self.cur)[0][0]
        self.assertEqual(result["Status"], "OK", result)
        return result

    def token(self):
        return self.cur.execute("SELECT RowVersion FROM dbo.Product WHERE ID=?", self.product).fetchval()

    def save(self, items=None, status="Draft", version=None, token=None, user=None):
        self.cur.execute("EXEC dbo.usp_ProductGrade_Save ?,?,?,?,?,?,?",
                         self.product, user or self.user,
                         version["ID"] if version else None,
                         version["RowVersion"] if version else None,
                         token or self.token(), status, json.dumps(items if items is not None else TREE))
        return self.consume(self.cur)[0][0]

    def test_generated_codes_and_immutability(self):
        a = self.cur.execute("SELECT ProductCode FROM dbo.Product WHERE ID=?", self.product).fetchval()
        second = self.create_product()
        b = self.cur.execute("SELECT ProductCode FROM dbo.Product WHERE ID=?", second["NewID"]).fetchval()
        self.assertRegex(a, r"^PRD-\d{10}$")
        self.assertNotEqual(a, b)
        self.cur.execute("""DECLARE @r dbo.ProductBatchType;
            INSERT @r(RowNum,Command,ID,ProductCode,ProductName,WeightValue,WeightUnit,RowVersionB64)
            SELECT 1,'U',ID,'MANUAL',ProductName,100,'g',RowVersion FROM dbo.Product WHERE ID=?;
            EXEC dbo.usp_Product_Batch @r,?,0;""", self.product, self.user)
        self.assertEqual(self.consume(self.cur)[0][0]["Status"], "ERROR")

    def test_version_activation_retires_previous(self):
        one = self.save(status="Active")
        two = self.save()
        self.assertEqual((one["Version"], two["Version"]), (1, 2))
        self.save(status="Active", version=two)
        states = self.cur.execute("SELECT Version,Status FROM dbo.ProductGradeVersion WHERE ProductID=? ORDER BY Version", self.product).fetchall()
        self.assertEqual([tuple(r) for r in states], [(1, "Inactive"), (2, "Active")])
        self.assertEqual(self.cur.execute("SELECT COUNT(*) FROM dbo.ProductGradeItem WHERE VersionID=?", one["ID"]).fetchval(), 4)

    def test_old_product_token_cannot_overwrite_activation(self):
        import pyodbc
        old = self.token()
        self.save(status="Active")
        with self.assertRaisesRegex(pyodbc.Error, "52958"):
            self.save(token=old)

    def test_active_version_requires_copy(self):
        import pyodbc
        active = self.save(status="Active")
        with self.assertRaisesRegex(pyodbc.Error, "52961"):
            self.save(version=active)

    def test_sql_rejects_invalid_totals(self):
        import pyodbc
        with self.assertRaisesRegex(pyodbc.Error, "52960"):
            self.save(items=[dict(ParentID="0", ID=1, Grade="A", RatioPct=99)])

    def test_sql_rejects_orphan(self):
        import pyodbc
        with self.assertRaisesRegex(pyodbc.Error, "52960"):
            self.save(items=[dict(ParentID="0/9", ID=1, Grade="A", RatioPct=100)])

    def test_sql_rechecks_actor(self):
        import pyodbc
        with self.assertRaisesRegex(pyodbc.Error, "52953"):
            self.save(user="Missing-" + uuid4().hex)

    def test_api_product_and_initial_grade_share_transaction(self):
        from contextlib import contextmanager
        import packaging_fields
        from main import product_batch
        @contextmanager
        def cursor():
            yield self.cur
        name = "Atomic grade " + uuid4().hex
        payload = ProductBatchRequest(rows=[dict(RowNum=1, Command="C", ProductName=name, CustomerID=self.cur.execute("SELECT CustomerID FROM dbo.Product WHERE ID=?",self.product).fetchval(),
            Category="Test", WeightValue=100, WeightUnit="g", GradeVersion=dict(items=TREE, Status="Active"))])
        with patch.object(packaging_fields, "get_raw_cursor", cursor):
            result = product_batch(payload, self.user, True, frozenset({"Admin"}))["results"][0]
        self.assertEqual(result["Status"], "OK", result)
        version = self.cur.execute("SELECT ID FROM dbo.ProductGradeVersion WHERE ProductID=? AND Status='Active'", result["NewID"]).fetchval()
        self.assertIsNotNone(version)
        self.assertEqual(self.cur.execute("SELECT COUNT(*) FROM dbo.ProductGradeItem WHERE VersionID=?", version).fetchval(), 4)
        self.assertRegex(result["NewProductCode"], r"^PRD-\d{10}$")

    def test_initial_grade_failure_rolls_back_product(self):
        from contextlib import contextmanager
        import packaging_fields
        from main import product_batch
        @contextmanager
        def cursor():
            yield self.cur
        # Test-only rejection simulates a failure after the Product insert.
        self.cur.execute("CREATE OR ALTER TRIGGER dbo.tr_ProductGrade_TestReject ON dbo.ProductGradeItem AFTER INSERT AS BEGIN THROW 52960,'Test grade rejection.',1; END")
        name = "Rejected grade " + uuid4().hex
        payload = ProductBatchRequest(rows=[dict(RowNum=1, Command="C", ProductName=name, CustomerID=self.cur.execute("SELECT CustomerID FROM dbo.Product WHERE ID=?",self.product).fetchval(),
            Category="Test", WeightValue=100, WeightUnit="g", GradeVersion=dict(items=TREE))])
        with patch.object(packaging_fields, "get_raw_cursor", cursor):
            result = product_batch(payload, self.user, True, frozenset({"Admin"}))["results"][0]
        self.assertEqual(result["Status"], "ERROR", result)
        self.assertEqual(self.cur.execute("SELECT COUNT(*) FROM dbo.Product WHERE ProductName=?", name).fetchval(), 0)


if __name__ == "__main__":
    # Keep flag available to setUpClass, but remove it from unittest's CLI parser.
    unittest.main(argv=[a for a in sys.argv if a != "--sql"])
