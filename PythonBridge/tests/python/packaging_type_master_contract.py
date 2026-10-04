"""Packaging Type Master SQL/API/Excel contracts. All fixtures roll back."""
import io
import json
import re
import sys
import unittest
import uuid
import zipfile
from contextlib import contextmanager
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch
import pyodbc
from fastapi import HTTPException
from pydantic import ValidationError

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "core"))
import packaging_api as db_api
import packaging_type_api as api
import packaging_master_api as masters
import packaging_master_excel_api as excel
from auth import AccessContext
from master_models import MasterLayout, check_layout


class PackagingTypeMaster(unittest.TestCase):
    def setUp(self):
        self.conn = pyodbc.connect("DRIVER={ODBC Driver 17 for SQL Server};SERVER=localhost;DATABASE=test;Trusted_Connection=yes;TrustServerCertificate=yes", autocommit=True)
        self.addCleanup(self.cleanup)
        self.cur = self.conn.cursor()
        self.cur.execute("SET NOCOUNT ON; SET QUOTED_IDENTIFIER ON; BEGIN TRANSACTION")
        for _ in range(2):
            for migration in ("51_packaging_type_master.sql", "54_packaging_type_parent.sql", "55_packaging_type_retire_tare_weight.sql", "66_packaging_type_orders.sql"):
                for sql in re.split(r"^GO\s*$", (ROOT / "sql" / migration).read_text(), flags=re.M | re.I):
                    if sql.strip():
                        self.cur.execute(sql)
                        while self.cur.nextset():
                            pass
        actor, name = self.cur.execute("SELECT TOP(1) u.ID,u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE u.IsActive=1 AND a.Scope='Admin'").fetchone()
        self.ctx = AccessContext(actor, name, frozenset({"Admin"}))
        self.name = "Type-" + uuid.uuid4().hex[:12]
        @contextmanager
        def cursor():
            yield self.cur
        mock = patch.object(db_api, "get_raw_cursor", cursor)
        mock.start()
        self.addCleanup(mock.stop)

    def cleanup(self):
        try:
            self.conn.cursor().execute("IF @@TRANCOUNT>0 ROLLBACK")
        finally:
            self.conn.close()

    def row_data(self, **values):
        return {**dict(RowNum=1, Command="C", PackagingOrder="Primary", PackagingType=self.name, PriceBasis="Count"), **values}

    def save(self, **values):
        return api.packaging_type_save(api.PackagingTypeBatch(rows=[self.row_data(**values)]), self.ctx)["results"][0]

    def read(self, ctx=None, **values):
        return masters.read("packaging-types", 1, 500, values.get("search", self.name), values.get("status"), None, None, None, None, values.get("sort", "[]"), ctx or self.ctx)

    def role(self, scope):
        name = "type-" + uuid.uuid4().hex[:16]
        id = self.cur.execute("INSERT dbo.Users(UserName,IsActive) VALUES(?,1);SELECT CONVERT(INT,SCOPE_IDENTITY())", name).fetchval()
        self.cur.execute("INSERT dbo.UserAccess(UserID,Scope) VALUES(?,?)", id, scope)
        return AccessContext(id, name, frozenset({scope}))

    def hierarchy(self):
        root = self.save(PackagingType=self.name + "-root", PackagingOrder="Secondary")
        child = self.save(PackagingType=self.name + "-child", ParentTypeID=root["NewID"])
        leaf = self.save(PackagingType=self.name + "-leaf", ParentTypeID=child["NewID"])
        for saved in (root, child, leaf):
            self.assertEqual(saved["Status"], "OK", saved)
        return root, child, leaf

    def edit(self, saved, **values):
        row = next(r for r in self.read()["rows"] if r["ID"] == saved["NewID"])
        return self.save(Command="U", ID=row["ID"], RowVersion=row["RowVersion"],
                         PackagingType=row["PackagingType"], PackagingOrder=row["PackagingOrder"], **values)

    def test_parent_read_lookup_and_sort(self):
        root, child, leaf = self.hierarchy()
        rows = {r["ID"]: r for r in self.read(sort='[{"column":"ParentType","direction":"asc"}]')["rows"]}
        self.assertIsNone(rows[root["NewID"]]["ParentTypeID"])
        self.assertEqual(rows[child["NewID"]]["ParentTypeID"], root["NewID"])
        self.assertEqual(rows[child["NewID"]]["ParentType"], "Secondary / " + self.name + "-root")
        choices = masters.lookups(ctx=self.ctx, entity="packaging-types")["packagingTypes"]
        self.assertEqual(next(r for r in choices if r["ID"] == leaf["NewID"])["ParentTypeID"], child["NewID"])
        normalized = excel.normalize_row("packaging-types", rows[child["NewID"]])
        self.assertEqual(json.loads(normalized["_Original"])["ParentType"], rows[child["NewID"]]["ParentType"])
        body = excel.View(layout=MasterLayout(columns=["ParentType"], filters=[]))
        blob = excel.build("packaging-types", body, dict(rows=[normalized], total=1), "http://localhost:8000")
        with zipfile.ZipFile(io.BytesIO(blob)) as book:
            xml = book.read("xl/worksheets/sheet1.xml").decode()
            self.assertIn(">Parent Type<", xml)
            self.assertIn(rows[child["NewID"]]["ParentType"], xml)
            self.assertIn("ParentType", book.read("xl/worksheets/sheet3.xml").decode())

    def test_omitted_parent_is_preserved_and_null_clears(self):
        root, child, _ = self.hierarchy()
        updated = self.edit(child, PriceBasis="Volume")
        self.assertEqual(updated["Status"], "OK", updated)
        self.assertEqual(self.cur.execute("SELECT ParentTypeID FROM dbo.PackagingType WHERE ID=?", child["NewID"]).fetchval(), root["NewID"])
        cleared = self.edit(updated, ParentTypeID=None)
        self.assertEqual(cleared["Status"], "OK", cleared)
        self.assertIsNone(self.cur.execute("SELECT ParentTypeID FROM dbo.PackagingType WHERE ID=?", child["NewID"]).fetchval())

    def test_self_parent_and_descendant_cycles_rejected(self):
        root, child, leaf = self.hierarchy()
        for saved, parent in ((root, root), (root, child), (root, leaf), (child, leaf)):
            failed = self.edit(saved, ParentTypeID=parent["NewID"])
            self.assertEqual(failed["Status"], "ERROR", failed)
            self.assertIn("descendants", failed["Message"])
        self.assertIsNone(self.cur.execute("SELECT ParentTypeID FROM dbo.PackagingType WHERE ID=?", root["NewID"]).fetchval())

    def test_blocked_parent_preserved_but_new_assignment_rejected(self):
        root, child, _ = self.hierarchy()
        blocked = api.packaging_type_save(api.PackagingTypeBatch(rows=[dict(RowNum=1, Command="D", ID=root["NewID"], RowVersion=root["NewRowVersion"])]), self.ctx)["results"][0]
        self.assertEqual(blocked["Status"], "OK", blocked)
        self.assertEqual(self.edit(child, ParentTypeID=root["NewID"], PriceBasis="Volume")["Status"], "OK")
        invalid = self.save(PackagingType=self.name + "-other", ParentTypeID=root["NewID"])
        self.assertEqual(invalid["Status"], "ERROR", invalid)
        self.assertEqual(self.save(PackagingType=self.name + "-missing", ParentTypeID=2147483647)["Status"], "ERROR")
        for value in (0, -1, 2147483648):
            with self.assertRaises(ValidationError):
                self.save(ParentTypeID=value)

    def test_excel_parent_assignment_ambiguity_preserve_and_clear(self):
        root, child, _ = self.hierarchy()
        def update(changes):
            row = next(r for r in self.read()["rows"] if r["ID"] == child["NewID"])
            return excel.save("packaging-types", excel.Batch(rows=[dict(row=3, command="U", id=row["ID"], version=row["RowVersion"], changes=changes)]), self.ctx)["results"][0]
        self.assertEqual(update({"PriceBasis": "Volume"})["Status"], "OK")
        self.assertEqual(self.cur.execute("SELECT ParentTypeID FROM dbo.PackagingType WHERE ID=?", child["NewID"]).fetchval(), root["NewID"])
        self.assertEqual(update({"ParentType": ""})["Status"], "OK")
        self.assertIsNone(self.cur.execute("SELECT ParentTypeID FROM dbo.PackagingType WHERE ID=?", child["NewID"]).fetchval())
        self.assertEqual(self.save(PackagingType=self.name + "-root")["Status"], "OK")
        ambiguous = update({"ParentType": self.name + "-root"})
        self.assertEqual(ambiguous["Status"], "ERROR", ambiguous)
        self.assertIn("ambiguous", ambiguous["Message"])
        self.assertEqual(update({"ParentType": "Secondary / " + self.name + "-root"})["Status"], "OK")
        self.assertEqual(update({"ParentType": "Primary / " + self.name + "-leaf"})["Status"], "ERROR")

    def test_cycle_error_does_not_prevent_other_batch_rows(self):
        root, _, leaf = self.hierarchy()
        rows = [self.row_data(Command="U", ID=root["NewID"], RowVersion=root["NewRowVersion"], ParentTypeID=leaf["NewID"]),
                self.row_data(RowNum=2, PackagingType=self.name + "-valid", ParentTypeID=root["NewID"])]
        results = api.packaging_type_save(api.PackagingTypeBatch(rows=rows), self.ctx)["results"]
        self.assertEqual([r["Status"] for r in results], ["ERROR", "OK"])

    def test_create_all_choices_without_tare_weight(self):
        for order in ("Primary", "Secondary"):
            for basis in ("Count", "Square meter", "Volume"):
                saved = self.save(PackagingOrder=order, PriceBasis=basis, PackagingType=self.name + basis)
                self.assertEqual(saved["Status"], "OK", saved)
        rows = self.read(sort=json.dumps([dict(column="PackagingOrder", direction="asc"), dict(column="PriceBasis", direction="desc")]))["rows"]
        self.assertEqual(len(rows), 6)
        self.assertEqual(rows[0]["PackagingOrder"], "Primary")
        self.assertNotIn("TareWeight", rows[0])
        self.assertEqual(self.cur.execute("SELECT TareWeight FROM dbo.PackagingType WHERE ID=?", rows[0]["ID"]).fetchval(), 0)
        self.assertEqual(rows[0]["CreatedBy"], self.ctx.user_id)

    def test_duplicate_within_order(self):
        self.assertEqual(self.save()["Status"], "OK")
        duplicate = self.save()
        self.assertEqual(duplicate["Status"], "ERROR", duplicate)
        self.assertIn("already exists", duplicate["Message"])
        self.assertEqual(self.save(PackagingOrder="Secondary")["Status"], "OK")
        self.assertEqual(self.read()["total"], 2)

    def test_api_validation(self):
        for field, value in (("PackagingOrder", "Quaternary"), ("PriceBasis", "KG"), ("TareWeight", 0), ("PackagingType", " "), ("PackagingType", "A"*101), ("CreatedBy", 99)):
            with self.assertRaises((ValidationError, HTTPException), msg=field):
                self.save(**{field: value})
        for field in ("PackagingOrder", "PackagingType", "PriceBasis"):
            with self.assertRaises(ValidationError):
                self.save(**{field: None})
        with self.assertRaises(ValidationError):
            api.PackagingTypeBatch(rows=[self.row_data(), self.row_data()])

    def test_sql_rejects_invalid_enums_and_empty_name(self):
        for changes in (dict(PackagingOrder="primary"), dict(PriceBasis="KG"), dict(PackagingType=" ")):
            results = db_api.execute("EXEC dbo.usp_PackagingType_Batch ?,?;", [json.dumps([self.row_data(**changes)]), self.ctx.username])[0]
            self.assertEqual(results[0]["Status"], "ERROR", results)
        self.assertEqual(self.read()["total"], 0)

    def test_edit_stale_block_and_reactivate(self):
        saved = self.save()
        edit = dict(Command="U", ID=saved["NewID"], RowVersion=saved["NewRowVersion"])
        updated = self.save(**edit, PriceBasis="Volume")
        self.assertEqual(updated["Status"], "OK", updated)
        self.assertEqual(self.save(**edit)["Status"], "ERROR")
        payload = api.PackagingTypeBatch(rows=[dict(RowNum=1, Command="D", ID=saved["NewID"], RowVersion=updated["NewRowVersion"])])
        blocked = api.packaging_type_save(payload, self.ctx)["results"][0]
        self.assertEqual(blocked["Status"], "OK", blocked)
        self.assertEqual(self.read(status="Block")["total"], 1)
        kept = self.save(Command="U", ID=saved["NewID"], RowVersion=blocked["NewRowVersion"], Status=None)
        self.assertEqual(kept["Status"], "OK", kept)
        self.assertEqual(self.read(status="Block")["total"], 1)
        active = self.save(Command="U", ID=saved["NewID"], RowVersion=kept["NewRowVersion"], Status="Active")
        self.assertEqual(active["Status"], "OK", active)

    def test_partial_batch_preserves_successful_rows(self):
        self.save()
        rows = [self.row_data(), self.row_data(RowNum=2, PackagingType=self.name+"-new")]
        results = api.packaging_type_save(api.PackagingTypeBatch(rows=rows), self.ctx)["results"]
        self.assertEqual([r["Status"] for r in results], ["ERROR", "OK"])
        self.assertEqual(self.read()["total"], 2)

    def test_roles_and_live_sql_permissions(self):
        self.ctx = self.role("Packaging")
        saved = self.save()
        self.assertEqual(saved["Status"], "OK", saved)
        manager = self.role("PackagingManager")
        self.assertEqual(self.read(manager)["total"], 1)
        with self.assertRaises(HTTPException) as error:
            api.packaging_type_save(api.PackagingTypeBatch(rows=[self.row_data(PackagingType=self.name+"-2")]), manager)
        self.assertEqual(error.exception.status_code, 403)
        self.cur.execute("DELETE dbo.UserAccess WHERE UserID=?", self.ctx.user_id)
        with self.assertRaises(HTTPException) as error:
            self.save(PackagingType=self.name+"-2")
        self.assertEqual(error.exception.status_code, 403)
        with self.assertRaises(HTTPException):
            self.read(self.role("Product"))

    def test_excel_partial_update_and_retired_column_layout(self):
        saved = self.save()
        result = excel.save("packaging-types", excel.Batch(rows=[dict(row=3, command="U", id=saved["NewID"], version=saved["NewRowVersion"], changes={"PriceBasis": "Volume"})]), self.ctx)["results"][0]
        self.assertEqual(result["Status"], "OK", result)
        row = self.read()["rows"][0]
        self.assertEqual(row["PackagingOrder"], "Primary")
        self.assertEqual(row["PriceBasis"], "Volume")
        for changes in ({"CreatedByName": "Fake"}, {"TareWeight": "12.345"}):
            bad = excel.save("packaging-types", excel.Batch(rows=[dict(row=3, command="U", id=row["ID"], version=row["RowVersion"], changes=changes)]), self.ctx)["results"][0]
            self.assertEqual(bad["Status"], "ERROR", bad)
        normalized = excel.normalize_row("packaging-types", row)
        self.assertNotIn("TareWeight", json.loads(normalized["_Original"]))
        body = excel.View(layout=MasterLayout(columns=["TareWeight"], filters=[], sort=[dict(column="TareWeight", direction="asc")], column_widths={"TareWeight": 160}))
        blob = excel.build("packaging-types", body, dict(rows=[normalized], total=1), "http://localhost:8000")
        with zipfile.ZipFile(io.BytesIO(blob)) as book:
            self.assertNotIn("TareWeight", book.read("xl/worksheets/sheet1.xml").decode())
            self.assertNotIn("Tare weight", book.read("xl/worksheets/sheet1.xml").decode())
            self.assertNotIn("TareWeight", book.read("xl/worksheets/sheet3.xml").decode())
        upgraded = check_layout("packaging-types", body.layout)
        self.assertNotIn("TareWeight", upgraded.columns)
        self.assertEqual(upgraded.sort, [])
        self.assertEqual(upgraded.column_widths, {})
        exported = masters.export("packaging-types", masters.Export(columns=["PriceBasis"], rows=[["Volume"]]), self.ctx)
        with zipfile.ZipFile(io.BytesIO(exported.body)) as book:
            self.assertIn("Volume", book.read("xl/worksheets/sheet1.xml").decode())
        with self.assertRaises(HTTPException):
            masters.export("packaging-types", masters.Export(columns=["TareWeight"], rows=[["12.345"]]), self.ctx)

    def test_historical_tare_is_preserved_by_new_and_legacy_sql_updates(self):
        saved = self.save()
        self.cur.execute("UPDATE dbo.PackagingType SET TareWeight=25.123 WHERE ID=?", saved["NewID"])
        updated = self.edit(saved, PriceBasis="Volume")
        self.assertEqual(updated["Status"], "OK", updated)
        self.assertEqual(self.cur.execute("SELECT TareWeight FROM dbo.PackagingType WHERE ID=?", saved["NewID"]).fetchval(), Decimal("25.123"))
        legacy = self.row_data(Command="U", ID=saved["NewID"], RowVersionHex="0x" + db_api.rv(updated["NewRowVersion"], True).hex(), TareWeight="99")
        result = db_api.execute("EXEC dbo.usp_PackagingType_Batch ?,?;", [json.dumps([legacy]), self.ctx.username])[0][0]
        self.assertEqual(result["Status"], "OK", result)
        self.assertEqual(self.cur.execute("SELECT TareWeight FROM dbo.PackagingType WHERE ID=?", saved["NewID"]).fetchval(), Decimal("25.123"))


if __name__ == "__main__":
    unittest.main()
