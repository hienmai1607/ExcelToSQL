"""Definition, raw-unit calculation and rollback-only migration/API contracts."""
import sys
import re
import unittest
import uuid
from contextlib import contextmanager
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch
import pyodbc
from pydantic import ValidationError
from fastapi import HTTPException

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "core"))
from dimension_formula import area_formula, formula_variables
import packaging_dimension_api as api
import packaging_api as batches
from auth import AccessContext


class Formula(unittest.TestCase):
    def test_user_mm_formula_with_offset(self):
        self.assertEqual(area_formula("(D2*2+25)*D1/1000000", {"D1": Decimal(200), "D2": Decimal(100)}), Decimal(".045"))
        self.assertEqual(formula_variables("(D2*2+25)*D1/1000000"), frozenset({"D1", "D2"}))
        self.assertEqual(area_formula("D1*D2/3", {"D1": Decimal(".1"), "D2": Decimal(".2")}), Decimal(".006666667"))

    def test_arithmetic_and_safe_parser(self):
        self.assertEqual(area_formula("-(D1-D2)*D3", {"D1": Decimal(".1"), "D2": Decimal(".2"), "D3": Decimal(".3")}), Decimal(".03"))
        for expression in ("__import__('os')", "D1.__class__", "D1**2", "D1//D2", "D4*D2",
                           "D1*D2; DROP TABLE dbo.Users", "100", "1e9*D1", "(" * 20 + "D1" + "+D2)" * 20):
            with self.subTest(expression=expression), self.assertRaises(ValueError):
                formula_variables(expression)

    def test_test_value_errors_and_range(self):
        for expression, values in (("D1/D2", {"D1": Decimal(1), "D2": Decimal(0)}),
                                   ("D1-D1", {"D1": Decimal(1)}),
                                   ("D1*D2", {"D1": Decimal(1)}),
                                   ("D1*D2", {"D1": Decimal("1e20"), "D2": Decimal("1e20")}),
                                   ("D1*D2", {"D1": Decimal(".000001"), "D2": Decimal(".000001")})):
            with self.subTest(expression=expression), self.assertRaises(ValueError):
                area_formula(expression, values)


class DimensionSQL(unittest.TestCase):
    def setUp(self):
        self.conn = pyodbc.connect("DRIVER={ODBC Driver 17 for SQL Server};SERVER=localhost;DATABASE=test;Trusted_Connection=yes;TrustServerCertificate=yes", autocommit=True)
        self.addCleanup(self.cleanup)
        self.cur = self.conn.cursor()
        self.cur.execute("SET NOCOUNT ON; SET QUOTED_IDENTIFIER ON; BEGIN TRANSACTION")
        self.apply("59_packaging_dimension_master.sql")
        actor, name = self.cur.execute("SELECT TOP(1) u.ID,u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE u.IsActive=1 AND a.Scope='Admin'").fetchone()
        self.ctx = AccessContext(actor, name, frozenset({"Admin"}))
        self.units = {}
        for code in ("M", "MM", "CM"):
            self.cur.execute("IF NOT EXISTS(SELECT 1 FROM dbo.UoM WHERE UoMCode=?) INSERT dbo.UoM(UoMCode,CreatedBy) VALUES(?,?)", code, code, actor)
            self.cur.execute("UPDATE dbo.UoM SET Status='Active' WHERE UoMCode=?", code)
            self.units[code] = self.cur.execute("SELECT ID FROM dbo.UoM WHERE UoMCode=?", code).fetchval()
        token = uuid.uuid4().hex[:12]
        self.parent = self.cur.execute("INSERT dbo.PackagingType(PackagingOrder,PackagingType,PriceBasis,TareWeight,CreatedBy) VALUES('Primary',?,'Square meter',0,?); SELECT CONVERT(INT,SCOPE_IDENTITY())", "dimension-" + token, actor).fetchval()
        self.child = self.cur.execute("INSERT dbo.PackagingType(PackagingOrder,PackagingType,PriceBasis,TareWeight,ParentTypeID,CreatedBy) VALUES('Primary',?,'Square meter',0,?,?); SELECT CONVERT(INT,SCOPE_IDENTITY())", "dimension-child-" + token, self.parent, actor).fetchval()
        self.count_type = self.cur.execute("INSERT dbo.PackagingType(PackagingOrder,PackagingType,PriceBasis,TareWeight,CreatedBy) VALUES('Secondary',?,'Count',0,?); SELECT CONVERT(INT,SCOPE_IDENTITY())", "dimension-count-" + token, actor).fetchval()
        self.volume_type = self.cur.execute("INSERT dbo.PackagingType(PackagingOrder,PackagingType,PriceBasis,TareWeight,CreatedBy) VALUES('Secondary',?,'Volume',0,?); SELECT CONVERT(INT,SCOPE_IDENTITY())", "dimension-volume-" + token, actor).fetchval()
        # Emulate an old numeric row in a rollback-only schema, even on a migrated DB.
        if self.cur.execute("SELECT COL_LENGTH('dbo.PackagingDimension','D1Name')").fetchval() is not None:
            self.cur.execute("IF OBJECT_ID('dbo.CK_PackagingDimension_Names','C') IS NOT NULL ALTER TABLE dbo.PackagingDimension DROP CONSTRAINT CK_PackagingDimension_Names; ALTER TABLE dbo.PackagingDimension ALTER COLUMN D1Name NVARCHAR(100) NULL")
        self.legacy = self.cur.execute("""INSERT dbo.PackagingDimension(PackagingTypeID,D1,D2,D3,D1UoMID,D2UoMID,D3UoMID,SquareMeterFormula,CreatedBy)
         VALUES(?,10,20,30,?,?,?,'(D1+D2)*D3',?); SELECT CONVERT(INT,SCOPE_IDENTITY())""",
         self.parent, self.units["MM"], self.units["MM"], self.units["MM"], actor).fetchval()
        self.apply("60_packaging_dimension_definitions.sql")
        self.apply("60_packaging_dimension_definitions.sql")
        self.old_count = self.cur.execute("""INSERT dbo.PackagingDimension(PackagingTypeID,D1Name,D1UoMID,SquareMeterFormula,CreatedBy)
         VALUES(?,'Length',?,'D1*D1/1000000',?); SELECT CONVERT(INT,SCOPE_IDENTITY())""", self.count_type, self.units["MM"], actor).fetchval()
        self.apply("61_packaging_dimension_square_meter_types.sql")
        self.apply("61_packaging_dimension_square_meter_types.sql")
        self.apply("62_packaging_dimension_all_types.sql")
        self.apply("62_packaging_dimension_all_types.sql")
        self.apply("73_packaging_type_shipping.sql")
        self.apply("74_packaging_dimension_volume_formula.sql")
        self.apply("74_packaging_dimension_volume_formula.sql")
        self.apply("77_packaging_parent_dimensions.sql")
        self.apply("77_packaging_parent_dimensions.sql")
        self.apply("79_packaging_supplier_geometry.sql")
        self.apply("80_packaging_formula_roles.sql")
        self.apply("81_packaging_child_dimensions.sql")
        @contextmanager
        def cursor():
            yield self.cur
        mock = patch.object(batches, "get_raw_cursor", cursor)
        mock.start()
        self.addCleanup(mock.stop)

    def apply(self, name):
        for sql in re.split(r"^GO\s*$", (ROOT / "sql" / name).read_text(encoding="utf-8"), flags=re.M | re.I):
            if sql.strip():
                self.cur.execute(sql)
                while self.cur.nextset():
                    pass

    def cleanup(self):
        try:
            self.conn.cursor().execute("IF @@TRANCOUNT>0 ROLLBACK")
        finally:
            self.conn.close()

    def entry(self, **values):
        return {**dict(PackagingTypeID=self.parent, D1="Length", D2="Width", D3=None,
                    D1UoMID=self.units["MM"], D2UoMID=self.units["MM"], D3UoMID=None,
                    SquareMeterFormula="(D2*2+25)*D1/1000000"), **values}

    def create(self, ctx=None, **values):
        type_id=values.get('PackagingTypeID',self.parent)
        root=self.cur.execute('SELECT RootTypeID FROM dbo.v_PackagingTypeDimensionContext WHERE ID=?',type_id).fetchval()
        if root!=type_id and 'ParentDimensionID' not in values:
            parent=self.cur.execute('SELECT TOP(1) ID,RowVersion FROM dbo.PackagingDimension WHERE PackagingTypeID=? AND ParentDimensionID IS NULL ORDER BY ID DESC',root).fetchone()
            if parent is None:
                saved=self.create(ctx,PackagingTypeID=root)
                parent=(saved['ID'],__import__('base64').b64decode(saved['RowVersion']))
            values.update(ParentDimensionID=parent[0],ParentDimensionRowVersion=__import__('base64').b64encode(bytes(parent[1])).decode())
        body=self.entry(**values)
        legacy_formula=body.pop('SquareMeterFormula',None)
        if root!=type_id:
            body['ConvertFromParentFormula']=legacy_formula
            body['ConvertFromSupplierFormula']=legacy_formula
        return api.save(api.DimensionSave(**body), ctx or self.ctx)["row"]

    def rows(self, ctx=None):
        return api.read(page=1, page_size=100, search="dimension-", status=None, ctx=ctx or self.ctx)["rows"]

    def role(self, scope):
        name = "dimension-" + uuid.uuid4().hex[:12]
        id = self.cur.execute("INSERT dbo.Users(UserName,IsActive) VALUES(?,1); SELECT CONVERT(INT,SCOPE_IDENTITY())", name).fetchval()
        self.cur.execute("INSERT dbo.UserAccess(UserID,Scope) VALUES(?,?)", id, scope)
        return AccessContext(id, name, frozenset({scope}))

    def test_names_optional_d3_saved_without_test_measurements(self):
        saved = self.create()
        row = next(r for r in self.rows() if r["ID"] == saved["ID"])
        self.assertEqual((row["D1"], row["D2"], row["D3"]), ("Length", "Width", None))
        self.assertIsNone(row["D3Unit"])
        self.assertNotIn("SquareMeters", row)
        old_values = self.cur.execute("SELECT D1,D2,D3 FROM dbo.PackagingDimension WHERE ID=?", saved["ID"]).fetchone()
        self.assertEqual(tuple(old_values), (None, None, None))
        updated = self.create(ID=row["ID"], RowVersion=row["RowVersion"], D1="Overall length")
        self.assertNotEqual(updated["RowVersion"], row["RowVersion"])

    def test_test_calculation_is_raw_units_and_never_saved(self):
        before = self.cur.execute("SELECT COUNT(*) FROM dbo.PackagingDimension").fetchval()
        self.cur.execute("UPDATE dbo.UnitConversion SET Status='Block' WHERE FromUoMID=? AND ToUoMID=?", self.units["MM"], self.units["M"])
        self.create()  # A definition no longer depends on general conversions.
        payload = api.DimensionTest(**self.entry(TestD1="200", TestD2="100"))
        self.assertEqual(api.preview(payload, self.ctx)["SquareMeters"], "0.045000000")
        self.assertEqual(self.cur.execute("SELECT COUNT(*) FROM dbo.PackagingDimension").fetchval(), before + 1)
        with self.assertRaises(ValidationError):
            api.DimensionSave(**self.entry(TestD1="200"))

    def test_optional_unreferenced_dimensions_and_validation(self):
        self.create(D2=None, D2UoMID=None, SquareMeterFormula="D1*D1/1000000")
        for values in ({"D1": " "}, {"D2": "Width", "D2UoMID": None}, {"D3UoMID": self.units["MM"]},
                       {"SquareMeterFormula": "D1*D3"}, {"D1": "x" * 101}, {"SquareMeters": "123"}):
            with self.subTest(values=values), self.assertRaises(ValidationError):
                api.DimensionSave(**self.entry(**values))
        for values in ({"TestD1": "0", "TestD2": "100"}, {"TestD1": "1.1234567", "TestD2": "100"}, {"TestD1": "200"}):
            with self.subTest(values=values), self.assertRaises(ValidationError):
                api.DimensionTest(**self.entry(**values))

    def test_permissions_and_all_active_type_choices(self):
        pkg, manager, sales = self.role("Packaging"), self.role("PackagingManager"), self.role("Opportunity")
        saved = self.create(pkg)
        self.assertIn(saved["ID"], [r["ID"] for r in self.rows(manager)])
        choices = api.lookups(manager)["packagingTypes"]
        self.assertIn(self.parent, [r["ID"] for r in choices])
        self.assertIn(self.child, [r["ID"] for r in choices])
        self.assertIn(self.volume_type, [r["ID"] for r in choices])
        self.assertEqual(next(r for r in choices if r["ID"] == self.count_type)["PriceBasis"], "Count")
        self.assertEqual(api.preview(api.DimensionTest(**self.entry(TestD1="200", TestD2="100")), manager)["SquareMeters"], "0.045000000")
        with self.assertRaises(HTTPException) as denied:
            self.create(manager)
        self.assertEqual(denied.exception.status_code, 403)
        with self.assertRaises(HTTPException):
            self.rows(sales)

    def test_child_types_copy_geometry_and_linked_roots_require_remapping_before_reparenting(self):
        saved = self.create(PackagingTypeID=self.child)
        self.assertEqual(next(r for r in self.rows() if r["ID"] == saved["ID"])["PriceBasis"], "Square meter")
        with self.assertRaises(Exception):
            self.cur.execute("UPDATE dbo.PackagingType SET ParentTypeID=? WHERE ID=?", self.volume_type, self.parent)

    def test_count_basis_can_save_without_formula(self):
        saved = self.create(PackagingTypeID=self.count_type, SquareMeterFormula=None)
        row = next(r for r in self.rows() if r["ID"] == saved["ID"])
        self.assertEqual(row["PriceBasis"], "Count")
        self.assertIsNone(row["SquareMeterFormula"])
        self.apply("62_packaging_dimension_all_types.sql")
        self.assertIsNone(self.cur.execute("SELECT SquareMeterFormula FROM dbo.PackagingDimension WHERE ID=?", saved["ID"]).fetchval())

    def test_volume_basis_and_non_area_child_can_save_without_formula(self):
        self.cur.execute("UPDATE dbo.PackagingType SET ParentTypeID=? WHERE ID=?", self.count_type, self.volume_type)
        saved = self.create(PackagingTypeID=self.volume_type, SquareMeterFormula=None)
        row = next(r for r in self.rows() if r["ID"] == saved["ID"])
        self.assertEqual(row["PriceBasis"], "Volume")
        self.assertIsNone(row["SquareMeterFormula"])

    def test_square_meter_child_requires_consumption_formula_in_sql(self):
        with self.assertRaises(HTTPException) as denied:
            self.create(PackagingTypeID=self.child,SquareMeterFormula=None)
        self.assertEqual(denied.exception.status_code, 422)

    def test_existing_count_record_is_preserved_and_can_be_blocked(self):
        row = next(r for r in self.rows() if r["ID"] == self.old_count)
        self.assertEqual(row["PriceBasis"], "Count")
        self.create(ID=row["ID"], RowVersion=row["RowVersion"], PackagingTypeID=self.count_type, Status="Block")
        self.assertEqual(self.cur.execute("SELECT Status FROM dbo.PackagingDimension WHERE ID=?", self.old_count).fetchval(), "Block")

    def test_existing_count_record_can_review_and_maintain_its_formula(self):
        self.cur.execute("UPDATE dbo.PackagingDimension SET FormulaNeedsReview=1 WHERE ID=?", self.old_count)
        row = next(r for r in self.rows() if r["ID"] == self.old_count)
        self.create(ID=row["ID"], RowVersion=row["RowVersion"], PackagingTypeID=self.count_type, SquareMeterFormula="D1*D1/1000000", D1="Overall length", FormulaReviewed=True)
        stored = self.cur.execute("SELECT SquareMeterFormula,FormulaNeedsReview,D1Name FROM dbo.PackagingDimension WHERE ID=?", self.old_count).fetchone()
        self.assertEqual(tuple(stored), ("D1*D1/1000000", False, "Overall length"))

    def test_all_types_can_use_square_meter_test_calculation(self):
        for type_id in (self.count_type, self.volume_type):
            result = api.preview(api.DimensionTest(**self.entry(PackagingTypeID=type_id, TestD1="200", TestD2="100")), self.ctx)
            self.assertEqual(result["SquareMeters"], "0.045000000")
            self.assertEqual(result["CalculationStatus"], "Ready")

    def test_nonshipping_parents_have_no_role_formulas_and_can_switch_basis(self):
        saved = self.create()
        changed = self.create(ID=saved["ID"], RowVersion=saved["RowVersion"], PackagingTypeID=self.count_type, SquareMeterFormula=self.entry()["SquareMeterFormula"])
        self.assertEqual(tuple(self.cur.execute("SELECT OccupiedM2Formula,OccupiedM3Formula,ConvertFromParentFormula,ConvertFromSupplierFormula FROM dbo.PackagingDimension WHERE ID=?",saved["ID"]).fetchone()),(None,None,None,None))
        changed = self.create(ID=changed["ID"], RowVersion=changed["RowVersion"])
        self.assertEqual(self.cur.execute("SELECT PackagingTypeID FROM dbo.PackagingDimension WHERE ID=?", saved["ID"]).fetchval(), self.parent)

    def test_blocked_type_cannot_be_newly_selected(self):
        self.cur.execute("UPDATE dbo.PackagingType SET Status='Block' WHERE ID=?", self.volume_type)
        self.assertNotIn(self.volume_type, [r["ID"] for r in api.lookups(self.ctx)["packagingTypes"]])
        with self.assertRaises(HTTPException) as denied:
            self.create(PackagingTypeID=self.volume_type, SquareMeterFormula=None)
        self.assertEqual(denied.exception.status_code, 422)

    def test_stale_version(self):
        row = self.create()
        self.create(ID=row["ID"], RowVersion=row["RowVersion"], D1="Overall length")
        with self.assertRaises(HTTPException) as conflict:
            self.create(ID=row["ID"], RowVersion=row["RowVersion"], D1="New length")
        self.assertEqual(conflict.exception.status_code, 409)

    def test_blocked_unit_prevents_calculation(self):
        self.cur.execute("UPDATE dbo.UoM SET Status='Block' WHERE ID=?", self.units["MM"])
        self.assertIsNone(api.preview(api.DimensionTest(**self.entry(TestD1="200", TestD2="100")), self.ctx)["SquareMeters"])

    def test_migration_preserves_old_values_and_formula_on_edit(self):
        old = self.cur.execute("SELECT D1,D2,D3,LegacySquareMeterFormula,FormulaNeedsReview FROM dbo.PackagingDimension WHERE ID=?", self.legacy).fetchone()
        self.assertEqual(tuple(old), (Decimal(10), Decimal(20), Decimal(30), "(D1+D2)*D3", True))
        row = next(r for r in self.rows() if r["ID"] == self.legacy)
        self.create(ID=row["ID"], RowVersion=row["RowVersion"], FormulaReviewed=True)
        old = self.cur.execute("SELECT D1,D2,D3,LegacySquareMeterFormula,FormulaNeedsReview FROM dbo.PackagingDimension WHERE ID=?", self.legacy).fetchone()
        self.assertEqual(tuple(old), (Decimal(10), Decimal(20), Decimal(30), "(D1+D2)*D3", False))
        unit = self.cur.execute("SELECT UoMCode FROM dbo.UoM WHERE ID=?", self.units["MM"]).fetchval()
        archived = self.cur.execute("SELECT LegacyD1Unit,LegacyD2Unit,LegacyD3Unit FROM dbo.PackagingDimension WHERE ID=?", self.legacy).fetchone()
        self.assertEqual(tuple(archived), (unit, unit, unit))

    def test_legacy_formula_requires_explicit_review(self):
        row = next(r for r in self.rows() if r["ID"] == self.legacy)
        with self.assertRaises(HTTPException) as denied:
            self.create(ID=row["ID"], RowVersion=row["RowVersion"])
        self.assertEqual(denied.exception.status_code, 422)

    def test_database_scope_cannot_be_forged(self):
        manager = self.role("PackagingManager")
        forged = AccessContext(manager.user_id, manager.username, frozenset({"Admin"}))
        with self.assertRaises(HTTPException) as denied:
            self.create(forged)
        self.assertEqual(denied.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
