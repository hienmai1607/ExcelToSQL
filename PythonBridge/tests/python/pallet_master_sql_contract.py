"""Pallet Master integration contracts. All fixtures and migration reruns roll back."""
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
import pallet_api as api
import packaging_api as batches
import packaging_master_api as masters
import packaging_master_excel_api as excel
from auth import AccessContext
from master_models import MasterLayout, check_layout
from pallet_fields import PALLET_CAPACITY_LABELS


class PalletSQL(unittest.TestCase):
    def setUp(self):
        self.conn = pyodbc.connect("DRIVER={ODBC Driver 17 for SQL Server};SERVER=localhost;DATABASE=test;Trusted_Connection=yes;TrustServerCertificate=yes", autocommit=True)
        self.addCleanup(self.cleanup)
        self.cur = self.conn.cursor()
        self.cur.execute("SET NOCOUNT ON; SET QUOTED_IDENTIFIER ON; BEGIN TRANSACTION")
        for _ in range(2):
            for name in ("49_pallet_master.sql","78_pallet_container_capacities.sql","103_pallet_price.sql"):
                for sql in re.split(r"^GO\s*$", (ROOT / "sql" / name).read_text(), flags=re.M | re.I):
                    if sql.strip():
                        self.cur.execute(sql)
                        while self.cur.nextset():
                            pass
        actor, name = self.cur.execute("SELECT TOP(1) u.ID,u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE u.IsActive=1 AND a.Scope='Admin'").fetchone()
        self.ctx = AccessContext(actor, name, frozenset({"Admin"}))
        self.units = {}
        # These fixtures are never committed; real units/factors remain Admin-maintained.
        for code in ("M", "MM", "CM", "BOX"):
            self.cur.execute("IF NOT EXISTS(SELECT 1 FROM dbo.UoM WHERE UoMCode=?) INSERT dbo.UoM(UoMCode,CreatedBy) VALUES(?,?)", code, code, actor)
            self.cur.execute("UPDATE dbo.UoM SET Status='Active' WHERE UoMCode=?", code)
            self.units[code] = self.cur.execute("SELECT ID FROM dbo.UoM WHERE UoMCode=?", code).fetchval()
        # Detach reverse links only inside this rollback-only fixture transaction.
        if self.cur.execute("SELECT COL_LENGTH('dbo.UnitConversion','ReverseConversionID')").fetchval() is not None:
            self.cur.execute("""UPDATE dbo.UnitConversion SET ReverseConversionID=NULL WHERE ReverseConversionID IN
                (SELECT ID FROM dbo.UnitConversion WHERE FromUoMID IN(?,?) AND ToUoMID=?)""",
                self.units["M"], self.units["CM"], self.units["MM"])
        self.cur.execute("DELETE FROM dbo.UnitConversion WHERE FromUoMID IN(?,?) AND ToUoMID=?", self.units["M"], self.units["CM"], self.units["MM"])
        for code, factor in (("M", 1000), ("CM", 10)):
            self.cur.execute("INSERT dbo.UnitConversion(FromUoMID,ToUoMID,Factor,CreatedBy) VALUES(?,?,?,?)", self.units[code], self.units["MM"], factor, actor)
        @contextmanager
        def cursor():
            yield self.cur
        mock = patch.object(batches, "get_raw_cursor", cursor)
        mock.start()
        self.addCleanup(mock.stop)

    def cleanup(self):
        try:
            self.conn.cursor().execute("IF @@TRANCOUNT>0 ROLLBACK")
        finally:
            self.conn.close()

    def save(self, **values):
        data = dict(RowNum=1, Command="C", UnitOfMeasure="M", Width="1.1", Length="1.1")
        data.update(values)
        return api.pallet_save(api.PalletBatch(rows=[data]), self.ctx)["results"][0]

    def row(self, id, ctx=None):
        result = masters.read("pallets", 1, 500, "", None, None, None, None, None, "[]", ctx or self.ctx)
        return next(r for r in result["rows"] if r["ID"] == id)

    def role(self, scope):
        name = "pallet-" + uuid.uuid4().hex[:16]
        id = self.cur.execute("INSERT dbo.Users(UserName,IsActive) VALUES(?,1); SELECT CONVERT(INT,SCOPE_IDENTITY())", name).fetchval()
        self.cur.execute("INSERT dbo.UserAccess(UserID,Scope) VALUES(?,?)", id, scope)
        return AccessContext(id, name, frozenset({scope}))

    def test_price_roundtrip_preserves_omitted_and_clears_explicit_null(self):
        from db import bytes_to_b64
        result=self.save(PalletPriceUSDPerEA="12.50")
        self.assertEqual(result["Status"],"OK",result)
        id=result["NewID"]
        self.assertEqual(Decimal(self.row(id)["PalletPriceUSDPerEA"]),Decimal("12.50"))
        for supplied in ({},{"PalletPriceUSDPerEA":None}):
            version=self.cur.execute("SELECT RowVersion FROM dbo.Pallet WHERE ID=?",id).fetchval()
            result=self.save(Command="U",ID=id,RowVersion=bytes_to_b64(version),**supplied)
            self.assertEqual(result["Status"],"OK",result)
            value=self.row(id)["PalletPriceUSDPerEA"]
            self.assertEqual(value,None if supplied else "12.50")
    def test_meter_example_and_compact_size(self):
        result = self.save()
        self.assertEqual(result["Status"], "OK", result)
        row = self.row(result["NewID"])
        self.assertEqual(row["PalletSize"].upper(), "1.1X1.1M")
        self.assertEqual(Decimal(row["PalletAreaMM2"]), 1210000)
        self.assertEqual(row["ConversionStatus"], "Calculated")
        self.assertEqual(row["CreatedBy"], self.ctx.user_id)

    def test_mm_identity_cm_and_four_decimal_dimensions(self):
        for unit, width, length, expected in (("MM", "1234.5678", "1", "1234.5678"), ("CM", "110", "110", "1210000")):
            result = self.save(UnitOfMeasure=unit, Width=width, Length=length)
            self.assertEqual(result["Status"], "OK", result)
            self.assertEqual(Decimal(self.row(result["NewID"])["PalletAreaMM2"]), Decimal(expected))

    def test_missing_blocked_and_material_specific_conversion(self):
        self.assertIn("general conversion", self.save(UnitOfMeasure="BOX")["Message"])
        material = self.cur.execute("SELECT TOP(1) ID FROM dbo.PackagingMaterial").fetchval()
        self.cur.execute("INSERT dbo.UnitConversion(FromUoMID,ToUoMID,Factor,PackagingMaterialID,CreatedBy) VALUES(?,?,1000,?,?)", self.units["BOX"], self.units["MM"], material, self.ctx.user_id)
        self.assertEqual(self.save(UnitOfMeasure="BOX")["Status"], "ERROR")
        self.cur.execute("UPDATE dbo.UnitConversion SET Status='Block' WHERE FromUoMID=? AND ToUoMID=? AND PackagingMaterialID IS NULL", self.units["M"], self.units["MM"])
        self.assertEqual(self.save()["Status"], "ERROR")

    def test_live_factor_and_missing_conversion_on_read(self):
        id = self.save()["NewID"]
        self.cur.execute("UPDATE dbo.UnitConversion SET Factor=2000 WHERE FromUoMID=? AND ToUoMID=? AND PackagingMaterialID IS NULL", self.units["M"], self.units["MM"])
        self.assertEqual(Decimal(self.row(id)["PalletAreaMM2"]), 4840000)
        self.cur.execute("UPDATE dbo.UnitConversion SET Status='Block' WHERE FromUoMID=? AND ToUoMID=? AND PackagingMaterialID IS NULL", self.units["M"], self.units["MM"])
        self.assertIsNone(self.row(id)["PalletAreaMM2"])
        self.assertEqual(self.row(id)["ConversionStatus"], "Conversion required")
        self.cur.execute("UPDATE dbo.UnitConversion SET Status='Active',Factor=0.000000123 WHERE FromUoMID=? AND ToUoMID=? AND PackagingMaterialID IS NULL", self.units["M"], self.units["MM"])
        self.assertIsNone(self.row(id)["PalletAreaMM2"])
        self.assertEqual(self.row(id)["ConversionStatus"], "Conversion out of range")

    def test_validation_and_computed_inputs_rejected(self):
        for field, value in (("Width", "0"), ("Length", "-1"), ("Width", "1.12345"), ("Width", "100000000"), ("Length", "NaN"), ("PalletAreaMM2", 5), ("PalletSize", "fake")):
            with self.assertRaises((ValidationError, HTTPException), msg=field):
                self.save(**{field: value})
        for values in (dict(Command="U"), dict(ID=5), dict(Width=None), dict(UnitOfMeasure="")):
            with self.assertRaises((ValidationError, HTTPException)):
                self.save(**values)
        with self.assertRaises(ValidationError):
            api.PalletBatch(rows=[dict(RowNum=1, Command="C", Width=1, Length=1, UnitOfMeasure="MM")] * 2)

    def test_duplicate_stale_and_block(self):
        saved = self.save()
        self.assertEqual(self.save()["Status"], "ERROR")
        edit = dict(Command="U", ID=saved["NewID"], RowVersion=saved["NewRowVersion"])
        updated = self.save(**edit, Length="1.2")
        self.assertEqual(updated["Status"], "OK", updated)
        self.assertEqual(self.row(saved["NewID"])["PalletSize"].upper(), "1.1X1.2M")
        self.assertEqual(self.save(**edit, Length="1.3")["Status"], "ERROR")
        blocked = self.save(Command="D", ID=saved["NewID"], RowVersion=updated["NewRowVersion"])
        self.assertEqual(blocked["Status"], "OK", blocked)
        self.assertEqual(self.row(saved["NewID"])["Status"], "Block")

    def test_batch_partial_success_and_out_of_range(self):
        data = api.PalletBatch(rows=[dict(RowNum=1, Command="C", Width="1.1", Length="1.1", UnitOfMeasure="BOX"),
                                    dict(RowNum=2, Command="C", Width="1.1", Length="1.1", UnitOfMeasure="M")])
        self.assertEqual([r["Status"] for r in api.pallet_save(data, self.ctx)["results"]], ["ERROR", "OK"])
        self.cur.execute("UPDATE dbo.UnitConversion SET Factor=999999999999999 WHERE FromUoMID=? AND ToUoMID=?", self.units["M"], self.units["MM"])
        self.assertIn("out of range", self.save(Length="1.2")["Message"])

    def test_roles_and_live_sql_authorization(self):
        self.ctx = self.role("Packaging")
        saved = self.save()
        self.assertEqual(saved["Status"], "OK", saved)
        manager = self.role("PackagingManager")
        self.assertEqual(self.row(saved["NewID"], manager)["PalletSize"].upper(), "1.1X1.1M")
        with self.assertRaises(HTTPException) as error:
            api.pallet_save(api.PalletBatch(rows=[dict(RowNum=1, Command="D", ID=saved["NewID"], RowVersion=saved["NewRowVersion"])]), manager)
        self.assertEqual(error.exception.status_code, 403)
        self.cur.execute("DELETE dbo.UserAccess WHERE UserID=?", self.ctx.user_id)
        with self.assertRaises(HTTPException) as error:
            self.save(Length="1.2")
        self.assertEqual(error.exception.status_code, 403)

    def test_excel_update_computed_protection_and_numeric_export(self):
        saved = self.save()
        result = excel.save("pallets", excel.Batch(rows=[dict(row=3, command="U", id=saved["NewID"], version=saved["NewRowVersion"], changes={"Width": "1.2345"})]), self.ctx)["results"][0]
        self.assertEqual(result["Status"], "OK", result)
        row = self.row(saved["NewID"])
        self.assertEqual(Decimal(row["Width"]), Decimal("1.2345"))
        self.assertEqual(Decimal(row["Length"]), Decimal("1.1"))
        bad = excel.save("pallets", excel.Batch(rows=[dict(row=3, command="U", id=row["ID"], version=row["RowVersion"], changes={"PalletSize": "fake"})]), self.ctx)["results"][0]
        self.assertEqual(bad["Status"], "ERROR", bad)
        normalized = excel.normalize_row("pallets", row)
        self.assertEqual(json.loads(normalized["_Original"])["Width"], row["Width"])
        body = excel.View(layout=MasterLayout(columns=["PalletSize", "PalletAreaMM2"], filters=[]))
        data = dict(rows=[normalized], total=1)
        blob = excel.build("pallets", body, data, "http://localhost:8000")
        with zipfile.ZipFile(io.BytesIO(blob)) as book:
            xml = book.read("xl/worksheets/sheet1.xml").decode()
            self.assertIn("Pallet size [display]", xml)
            self.assertIn("Pallet area (mm²) [display]", xml)
        exported = masters.export("pallets", masters.Export(columns=["Width", "PalletAreaMM2"], rows=[["1.2345", "1357950"]]), self.ctx)
        with zipfile.ZipFile(io.BytesIO(exported.body)) as book:
            xml = book.read("xl/worksheets/sheet1.xml").decode()
            self.assertIn("<v>1.2345</v>", xml)
            self.assertIn("<v>1357950</v>", xml)
        self.assertEqual(check_layout("pallets", body.layout).columns[-3:], ["UnitOfMeasure", "Width", "Length"])


    def test_container_counts_create_update_preserve_clear_and_block(self):
        counts=dict(zip(PALLET_CAPACITY_LABELS,(10,20,22,8,20)))
        saved=self.save(**counts)
        self.assertEqual(saved["Status"],"OK",saved)
        row=self.row(saved["NewID"])
        for key,value in counts.items():
            self.assertEqual(row[key],value)
        edited=self.save(Command="U",ID=row["ID"],RowVersion=row["RowVersion"],Width="1.1234")
        self.assertEqual(edited["Status"],"OK",edited)
        row=self.row(row["ID"])
        for key,value in counts.items():
            self.assertEqual(row[key],value)  # Older clients do not erase new counts.
        stale=self.save(Command="U",ID=row["ID"],RowVersion=saved["NewRowVersion"],PalletsPer20DC=999)
        self.assertEqual(stale["Status"],"ERROR")
        edited=self.save(Command="U",ID=row["ID"],RowVersion=row["RowVersion"],Width="1.1234",PalletsPer20DC=0,PalletsPer40DC=None)
        self.assertEqual(edited["Status"],"OK",edited)
        row=self.row(row["ID"])
        self.assertEqual(row["PalletsPer20DC"],0)
        self.assertIsNone(row["PalletsPer40DC"])
        self.assertEqual(row["PalletsPer40HC"],22)
        blocked=api.pallet_save(api.PalletBatch(rows=[dict(RowNum=1,Command="D",ID=row["ID"],RowVersion=row["RowVersion"])]),self.ctx)["results"][0]
        self.assertEqual(blocked["Status"],"OK",blocked)
        self.assertEqual(self.row(row["ID"])["PalletsPer20DC"],0)

    def test_count_validation_in_api_sql_and_table(self):
        for key in PALLET_CAPACITY_LABELS:
            for value in (-1,"1.5",2147483648,True,"NaN"):
                with self.subTest(key=key,value=value),self.assertRaises(ValidationError):
                    self.save(**{key:value})
            for value in (-1,"1.5",2147483648,""):
                raw=dict(RowNum=1,Command="C",UnitOfMeasure="M",Width="1.2",Length="1.2",**{key:value})
                self.cur.execute("EXEC dbo.usp_Pallet_Batch ?,?",json.dumps([raw]),self.ctx.username)
                columns=[c[0] for c in self.cur.description]
                result=dict(zip(columns,self.cur.fetchone()))
                self.assertEqual(result["Status"],"ERROR",result)
                self.assertIn("whole numbers",result["Message"])
                while self.cur.nextset():
                    pass
        saved=self.save()
        self.assertEqual(saved["Status"],"OK",saved)
        row=self.row(saved["NewID"])
        for key in PALLET_CAPACITY_LABELS:
            self.assertIsNone(row[key])
        with self.assertRaises(pyodbc.Error):
            self.cur.execute("UPDATE dbo.Pallet SET PalletsPer20DC=-1 WHERE ID=?",row["ID"])

    def test_counts_are_editable_in_excel_and_export_as_numeric_cells(self):
        saved=self.save(PalletsPer20DC=10,PalletsPer40DC=20)
        changed=excel.save("pallets",excel.Batch(rows=[dict(row=3,command="U",id=saved["NewID"],version=saved["NewRowVersion"],
            changes={"PalletsPer40HC":"22","PalletsPer20RC":"0","PalletsPer40RHC":"18"})]),self.ctx)["results"][0]
        self.assertEqual(changed["Status"],"OK",changed)
        row=self.row(saved["NewID"])
        self.assertEqual([row[key] for key in PALLET_CAPACITY_LABELS],[10,20,22,0,18])
        body=excel.View(layout=MasterLayout(columns=list(PALLET_CAPACITY_LABELS),filters=[],sort=[dict(column="PalletsPer40HC",direction="desc")]))
        blob=excel.build("pallets",body,dict(rows=[excel.normalize_row("pallets",row)],total=1),"http://localhost:8000")
        with zipfile.ZipFile(io.BytesIO(blob)) as book:
            xml=book.read("xl/worksheets/sheet1.xml").decode()
            for label in PALLET_CAPACITY_LABELS.values():
                self.assertIn(label,xml)
                self.assertNotIn(label+" [display]",xml)
        exported=masters.export("pallets",masters.Export(columns=list(PALLET_CAPACITY_LABELS),
            rows=[[str(row[key]) for key in PALLET_CAPACITY_LABELS]]),self.ctx)
        with zipfile.ZipFile(io.BytesIO(exported.body)) as book:
            xml=book.read("xl/worksheets/sheet1.xml").decode()
            self.assertIn('<c r="A2" t="n"><v>10</v></c>',xml)
            self.assertIn('<c r="D2" t="n"><v>0</v></c>',xml)
        ordered=masters.read("pallets",1,500,"",None,None,None,None,None,
            '[{"column":"PalletsPer40HC","direction":"desc"}]',self.ctx)
        self.assertIn(row["ID"],[r["ID"] for r in ordered["rows"]])


if __name__ == "__main__":
    unittest.main()
