"""Orderless child components, root memberships and preserving migration contracts."""
import json
import re
import unittest
from decimal import Decimal
from pydantic import ValidationError
from fastapi import HTTPException
import packaging_type_master_contract as types
import pkg_pricing_contract as pricing
import packaging_type_api as type_api
import packaging_master_api as masters
import packaging_api as batches
import pkg_pricing_api as calculator
from pkg_pricing import Calculation
from packaging_orders import decode_orders
from db import bytes_to_b64


def apply_children(cur):
    for _ in range(2):
        for sql in re.split(r"^GO\s*$", (types.ROOT / "sql" / "68_packaging_child_components.sql").read_text(), flags=re.M | re.I):
            if sql.strip():
                cur.execute(sql)
                while cur.nextset():
                    pass


class ChildTypes(unittest.TestCase):
    cleanup = types.PackagingTypeMaster.cleanup
    read = types.PackagingTypeMaster.read
    role = types.PackagingTypeMaster.role

    def setUp(self):
        types.PackagingTypeMaster.setUp(self)
        apply_children(self.cur)

    def save(self, **values):
        row = dict(RowNum=1, Command="C", PackagingType=self.name, PriceBasis="Count")
        return type_api.packaging_type_save(type_api.PackagingTypeBatch(rows=[{**row, **values}]), self.ctx)["results"][0]

    def root(self, suffix="", orders=None):
        result = self.save(PackagingType=self.name + suffix, PackagingOrders=orders or ["Primary", "Secondary"])
        self.assertEqual(result["Status"], "OK", result)
        return result["NewID"]

    def edit_child(self, id, **values):
        row = self.cur.execute("SELECT PackagingType,RowVersion FROM dbo.PackagingType WHERE ID=?", id).fetchone()
        return self.save(Command="U", ID=id, PackagingType=row[0], RowVersion=bytes_to_b64(row[1]), **values)

    def test_child_creation_without_orders_null_or_empty_and_nested_child(self):
        parent = self.root()
        for index, orders in enumerate(({}, dict(PackagingOrders=[]), dict(PackagingOrders=None))):
            result = self.save(ParentTypeID=parent, PackagingType=self.name + str(index), **orders)
            self.assertEqual(result["Status"], "OK", result)
            child = result["NewID"]
            row = next(r for r in self.read()["rows"] if r["ID"] == child)
            self.assertEqual(row["PackagingOrders"], [])
            self.assertEqual(self.cur.execute("SELECT COUNT(*) FROM dbo.PackagingTypeOrder WHERE PackagingTypeID=?", child).fetchval(), 0)
            parent = child
        self.assertEqual(self.edit_child(parent, PriceBasis="Volume")["Status"], "OK")

    def test_root_still_requires_orders_and_child_to_root_requires_selection(self):
        for orders in ({}, dict(PackagingOrders=[]), dict(PackagingOrders=None)):
            with self.subTest(orders=orders), self.assertRaises(ValidationError):
                self.save(**orders)
        child = self.save(ParentTypeID=self.root(), PackagingType=self.name + "-child")["NewID"]
        with self.assertRaises(ValidationError):
            self.edit_child(child, ParentTypeID=None)
        changed = self.edit_child(child, ParentTypeID=None, PackagingOrders=["Tertiary"])
        self.assertEqual(changed["Status"], "OK", changed)
        self.assertEqual(next(r for r in self.read()["rows"] if r["ID"] == child)["PackagingOrders"], ["Tertiary"])

    def test_duplicate_component_names_are_scoped_to_parent_not_order(self):
        first, second = self.root("-one"), self.root("-two")
        for parent in (first, second):
            result = self.save(ParentTypeID=parent, PackagingType=self.name + "-lid")
            self.assertEqual(result["Status"], "OK", result)
        duplicate = self.save(ParentTypeID=first, PackagingType=self.name + "-lid")
        self.assertEqual(duplicate["Status"], "ERROR")
        self.assertIn("Parent Type", duplicate["Message"])
        # A root may use the same label as a component without taking the component's order.
        self.assertEqual(self.save(PackagingOrders=["Primary"], PackagingType=self.name + "-lid")["Status"], "OK")

    def test_legacy_child_memberships_are_hidden_and_ids_and_links_preserved(self):
        parent = self.root()
        child = self.cur.execute("INSERT dbo.PackagingType(PackagingOrder,PackagingType,PriceBasis,TareWeight,ParentTypeID,CreatedBy) VALUES('Secondary',?,'Count',0,?,?);SELECT CONVERT(INT,SCOPE_IDENTITY())",
                                 self.name + "-legacy", parent, self.ctx.user_id).fetchval()
        self.cur.execute("INSERT dbo.PackagingTypeOrder VALUES(?,'Secondary')", child)
        before = self.cur.execute("SELECT RowVersion,PackagingOrder,ParentTypeID FROM dbo.PackagingType WHERE ID=?", child).fetchone()
        apply_children(self.cur)
        after = self.cur.execute("SELECT RowVersion,PackagingOrder,ParentTypeID FROM dbo.PackagingType WHERE ID=?", child).fetchone()
        self.assertEqual(tuple(before), tuple(after))
        self.assertEqual(self.cur.execute("SELECT PackagingOrdersJSON FROM dbo.v_PackagingTypeWeb WHERE ID=?", child).fetchval(), "[]")
        result = self.edit_child(child, PackagingOrder="Primary", PackagingOrders=["Tertiary"], PriceBasis="Volume")
        self.assertEqual(result["Status"], "OK", result)
        self.assertEqual(self.cur.execute("SELECT PackagingOrder FROM dbo.PackagingType WHERE ID=?", child).fetchval(), "Secondary")
        self.assertEqual(self.cur.execute("SELECT PackagingOrder FROM dbo.PackagingTypeOrder WHERE PackagingTypeID=?", child).fetchval(), "Secondary")
        row = next(r for r in masters.lookups(ctx=self.ctx, entity="packaging-types")["packagingTypes"] if r["ID"] == child)
        self.assertEqual(row["PackagingOrders"], [])

    def test_child_validation_concurrency_cycles_and_permissions_unchanged(self):
        parent = self.root()
        result = self.save(ParentTypeID=parent, PackagingType=self.name + "-child")
        child = result["NewID"]
        self.assertEqual(self.edit_child(child, ParentTypeID=child)["Status"], "ERROR")
        self.assertEqual(self.save(ParentTypeID=2147483647, PackagingType=self.name + "-missing")["Status"], "ERROR")
        self.assertEqual(self.edit_child(child, PriceBasis="Volume")["Status"], "OK")
        stale = self.save(Command="U", ID=child, RowVersion=result["NewRowVersion"], ParentTypeID=parent, PackagingType=self.name + "-child")
        self.assertEqual(stale["Status"], "ERROR")
        manager = self.role("PackagingManager")
        with self.assertRaises(HTTPException):
            type_api.packaging_type_save(type_api.PackagingTypeBatch(rows=[dict(RowNum=1, Command="C",
                ParentTypeID=parent, PackagingType=self.name + "-other", PriceBasis="Count")]), manager)
        # Decoder never leaks a child's legacy Order, including old query projections.
        self.assertEqual(decode_orders([dict(ParentTypeID=parent, PackagingOrder="Primary")])[0]["PackagingOrders"], [])


class ChildPricing(unittest.TestCase):
    cleanup = pricing.PricingSQL.cleanup
    new_type = pricing.PricingSQL.new_type
    material = pricing.PricingSQL.material
    line = pricing.PricingSQL.line
    payload = pricing.PricingSQL.payload
    preview = pricing.PricingSQL.preview
    save = pricing.PricingSQL.save

    def setUp(self):
        pricing.PricingSQL.setUp(self)
        apply_children(self.cur)

    def test_same_children_available_for_all_root_orders_without_own_membership(self):
        self.cur.execute("INSERT dbo.PackagingTypeOrder VALUES(?,'Secondary'),(?,'Tertiary')", self.root, self.root)
        self.cur.execute("DELETE dbo.PackagingTypeOrder WHERE PackagingTypeID IN(?,?,?)", self.label_type, self.jar_type, self.film_type)
        for order in ("Primary", "Secondary", "Tertiary"):
            options = calculator.options(self.req, self.root, order, self.ctx)
            self.assertIn(self.label_price, [r["PriceID"] for r in options["materials"]])
            self.assertIn(self.film_price, [r["PriceID"] for r in options["materials"]])
            calculation = Calculation(PackagingOrder=order, LayerCount=3, PackagingTypeID=self.root,
                                      components=[self.line(self.label_price, "2")])
            result = self.preview(calculation)
            self.assertEqual(Decimal(result["UnitPrice"]), Decimal(20000))
            self.assertEqual(Decimal(result["FinalMOQ"]), Decimal(2500))

    def test_deep_component_and_legacy_mismatching_order_work_through_hierarchy(self):
        child = self.new_type("Nested", "Count", self.jar_type, order="Tertiary")
        _, price = self.material(child, "Deep", 5, 100)
        self.assertEqual(self.cur.execute("SELECT COUNT(*) FROM dbo.PackagingTypeOrder WHERE PackagingTypeID=?", child).fetchval(), 0)
        result = self.preview(self.payload(self.line(price, "2")))
        self.assertEqual(Decimal(result["UnitPrice"]), Decimal(10))
        self.assertEqual(Decimal(result["FinalMOQ"]), Decimal(50))
        self.assertEqual(self.save(self.payload(self.line(price, "2")), result)["results"][0]["Status"], "OK")

    def test_new_response_choices_are_roots_only_but_unchanged_legacy_child_is_preserved(self):
        choices = batches.execute("EXEC dbo.usp_PackagingResponseTypeLookup_Read ?;", [self.username])[0]
        ids = [r["ID"] for r in choices]
        self.assertIn(self.root, ids)
        self.assertNotIn(self.label_type, ids)
        name = self.cur.execute("SELECT PackagingType FROM dbo.PackagingType WHERE ID=?", self.label_type).fetchval()
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET FirstPMType=? WHERE ID=?", name, self.req)
        version = bytes_to_b64(self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?", self.req).fetchval())
        result = batches.response_save(batches.ResponseBatch(rows=[dict(RowNum=1, ID=self.req, RowVersion=version, FirstPMType=name, NutDensity="0.61")]), self.ctx)
        self.assertEqual(result["results"][0]["Status"], "OK", result)
        with self.assertRaises(HTTPException):
            calculator.options(self.req, self.label_type, "Primary", self.ctx)
        # Put the rejected response write last: its atomic document rollback ends the outer fixture.
        other = self.cur.execute("SELECT PackagingType FROM dbo.PackagingType WHERE ID=?", self.jar_type).fetchval()
        version = bytes_to_b64(self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?", self.req).fetchval())
        with self.assertRaises(HTTPException) as caught:
            batches.response_save(batches.ResponseBatch(rows=[dict(RowNum=1, ID=self.req, RowVersion=version, FirstPMType=other)]), self.ctx)
        self.assertEqual(caught.exception.status_code, 422)

    def test_migration_does_not_change_material_links_or_saved_pricing(self):
        payload = self.payload(self.line(self.label_price, "2"))
        self.assertEqual(self.save(payload, self.preview(payload))["results"][0]["Status"], "OK")
        before = self.cur.execute("SELECT ID,SnapshotJSON,InputJSON,Fingerprint FROM dbo.PkgPricingMaster WHERE RequestItemID=?", self.req).fetchone()
        apply_children(self.cur)
        after = self.cur.execute("SELECT ID,SnapshotJSON,InputJSON,Fingerprint FROM dbo.PkgPricingMaster WHERE RequestItemID=?", self.req).fetchone()
        self.assertEqual(tuple(before), tuple(after))
        self.assertEqual(self.cur.execute("SELECT PackagingTypeID FROM dbo.PackagingMaterial WHERE ID=?", self.label).fetchval(), self.label_type)


if __name__ == "__main__":
    unittest.main()
