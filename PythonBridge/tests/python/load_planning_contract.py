import random
import unittest
from decimal import Decimal
from pydantic import ValidationError
from load_planning import footprint, PlanInput, plan
from load_planning_api import Specification
from workspace_access import route_pages, merge_permissions
from packaging_type_api import PackagingTypeRow

class LoadingTests(unittest.TestCase):
    def inputs(self,**changes):
        data=dict(carton=dict(length=400,width=300,height=200),carton_kg=10,
            pallet=dict(length=1200,width=800,height=140),pallet_kg=20,
            max_pallet_height=1140,pallet_payload_kg=1000,
            container=dict(length=5900,width=2350,height=2390),payload_kg=28000)
        return PlanInput.model_validate({**data,**changes})

    def test_mixed_orientation_eleven_euro_pallets(self):
        places=footprint(5900,2350,1200,800)
        self.assertEqual(len(places),11)
        self.assertEqual(len(footprint(5900,2350,1200,800,False)),8)

    def test_positions_fit_without_overlap(self):
        rng=random.Random(25)
        for _ in range(150):
            L,W=rng.randint(100,6000),rng.randint(100,2500)
            l,w=rng.randint(100,1600),rng.randint(100,1200)
            positions=footprint(L,W,l,w)
            for i,a in enumerate(positions):
                self.assertGreaterEqual(a["x"],0);self.assertGreaterEqual(a["y"],0)
                self.assertLessEqual(a["x"]+a["length"],L)
                self.assertLessEqual(a["y"]+a["width"],W)
                self.assertIn((a["length"],a["width"]),[(l,w),(w,l)])
                for b in positions[i+1:]:
                    self.assertTrue(a["x"]+a["length"]<=b["x"] or b["x"]+b["length"]<=a["x"] or a["y"]+a["width"]<=b["y"] or b["y"]+b["width"]<=a["y"])

    def test_actual_pallet_height_and_double_stack(self):
        p=plan(self.inputs(double_stack=True,stackable=True))
        self.assertEqual(p["pallet_layers"],5)
        self.assertEqual(p["loaded_unit_height"],1140)
        self.assertEqual(p["loaded_units"],22)
        self.assertEqual(p["cartons"],880)
        self.assertEqual(p["gross_kg"],9240)

    def test_stack_requires_height_and_confirmation(self):
        p=plan(self.inputs(double_stack=True))
        self.assertEqual(p["container_tiers"],1)
        p=plan(self.inputs(double_stack=True,stackable=True,clearance_height=200))
        self.assertEqual(p["container_tiers"],1)

    def test_payload_and_partial_top_layer(self):
        p=plan(self.inputs(pallet_payload_kg=115,payload_kg=300))
        self.assertEqual(p["cartons_per_pallet"],11)
        self.assertEqual(p["pallet_layers"],2)
        self.assertEqual(p["loaded_units"],2)
        self.assertEqual(p["cartons"],22)
        self.assertEqual(p["gross_kg"],260)

    def test_response_cartons_per_layer_limits_layout_and_gross(self):
        p=plan(self.inputs(carton=dict(length=200,width=100,height=150),carton_kg=Decimal("5.78885"),
            pallet=dict(length=1100,width=1100,height=155),pallet_kg=17,max_pallet_height=1900,
            pallet_payload_kg=None,cartons_per_layer=5))
        self.assertEqual(len(p["pallet_layer"]),5)
        self.assertEqual(p["cartons_per_layer"],5)
        self.assertEqual(p["pallet_layers"],11)
        self.assertEqual(p["cartons_per_pallet"],55)
        self.assertAlmostEqual(p["gross_kg"]/p["loaded_units"],335.38675)
        self.assertEqual(p["cartons"],p["loaded_units"]*55)

    def test_response_carton_count_cannot_exceed_geometry(self):
        with self.assertRaises(ValueError):
            plan(self.inputs(cartons_per_layer=100))
        for invalid in (0,-1,1.5):
            with self.assertRaises(ValidationError):self.inputs(cartons_per_layer=invalid)

    def test_response_carton_count_keeps_pallet_weight_checks(self):
        p=plan(self.inputs(cartons_per_layer=5,pallet_payload_kg=115))
        self.assertEqual(p["cartons_per_pallet"],11)
        self.assertEqual(p["pallet_layers"],3)
        self.assertTrue(any("goods weight" in w for w in p["warnings"]))

    def test_missing_weights_not_zero(self):
        p=plan(self.inputs(carton_kg=None))
        self.assertIsNone(p["gross_kg"])
        self.assertTrue(any("not verified" in w for w in p["warnings"]))

    def test_door_and_clearance(self):
        self.assertEqual(plan(self.inputs(door_height=1000))["loaded_units"],0)
        self.assertEqual(plan(self.inputs(door_width=700))["loaded_units"],0)
        with self.assertRaises(ValidationError):self.inputs(clearance_width=2350)
        with self.assertRaises(ValidationError):Specification(length=100,width=100,height=100,door_width=101)

    def test_floor_and_zero_fit(self):
        p=plan(self.inputs(mode="floor"))
        self.assertEqual(p["cartons"],len(p["container_layer"])*p["container_tiers"])
        self.assertEqual(plan(self.inputs(carton=dict(length=2000,width=2000,height=200)))["loaded_units"],0)

    def test_fractional_boundary_and_limits(self):
        self.assertEqual(len(footprint(Decimal("1199.999"),800,1200,800)),0)
        with self.assertRaises(ValueError):footprint(20000,20000,.001,.001)

    def test_container_permissions_and_pallet_type(self):
        self.assertEqual(merge_permissions(["Packaging"],[])["containers"],"none")
        self.assertEqual(merge_permissions(["Packaging"],[{"containers":"edit"}])["containers"],"none")
        self.assertEqual(merge_permissions(["Admin"],[])["containers"],"edit")
        self.assertEqual(route_pages("/api/load-planning/items/1/preview"),("requests","opportunities"))
        row=PackagingTypeRow(RowNum=1,Command="C",PackagingType="Pallet",PackagingOrders=["Pallet"],FinalComponent=True,CopyDim=True)
        self.assertEqual(row.PackagingOrders,["Pallet"])
        with self.assertRaises(ValidationError):PackagingTypeRow(RowNum=1,Command="C",PackagingType="Bad pallet",PackagingOrders=["Pallet","Primary"],FinalComponent=True,CopyDim=True)

if __name__=="__main__":unittest.main()


class ContainerLookupAccess(unittest.TestCase):
    def test_request_users_can_read_containers_without_master_access(self):
        from auth import AccessContext
        from workspace_access import enforce_route
        from unittest.mock import patch
        from load_planning_api import containers
        ctx=AccessContext(2,"packaging.member",frozenset({"Packaging"}),permissions={"requests":"edit","containers":"none"})
        enforce_route(ctx,"/api/load-planning/containers","GET")
        with patch("load_planning_api.execute",return_value=([{"ID":1,"Specifications":'{"length":5900,"width":2350,"height":2390}'}],None)):
            self.assertEqual(containers(ctx)["rows"][0]["ID"],1)
