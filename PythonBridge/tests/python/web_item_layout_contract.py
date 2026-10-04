"""Current web editor columns, guarded response reads and unchanged workbook catalogs."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
from fastapi import HTTPException
from preferences_api import Settings
from web_item_fields import WEB_ITEM_FIELDS,CALCULATED_FIELDS
import request_views
import opportunity_views

class WebItemLayout(unittest.TestCase):
    def test_version_five_accepts_the_full_editor_catalog(self):
        for domain in ("requests","opportunity"):
            settings=Settings.model_validate({domain:{"items":{"columns":sorted(WEB_ITEM_FIELDS),"field_version":5}}})
            self.assertEqual(set(getattr(settings,domain).items.columns),WEB_ITEM_FIELDS)
        self.assertNotIn("PrimaryPricePerUnit",request_views.ITEMS)
        self.assertNotIn("PrimaryPricePerUnit",opportunity_views.ITEM_COLUMNS)

    def test_request_notes_are_selected_at_header_level(self):
        with patch("packaging_api.execute",return_value=[[],[{"Total":0}]]) as sql:
            request_views.header_read("Admin",1,25,"",None,"[]")
            self.assertIn("h.RequestNotes",sql.call_args.args[0])

    def test_derived_fields_cannot_be_used_as_sql_sort_identifiers(self):
        for key in CALCULATED_FIELDS:
            with self.assertRaises(HTTPException):
                request_views.order('[{"column":"'+key+'"}]',request_views.VIEW_ITEMS-CALCULATED_FIELDS,"ItemID ASC")

    def test_new_response_values_and_weights_keep_the_permission_guard(self):
        row=dict(PackingWayVisible=0,PackingProductWeight=None,PackingRequestedLayers=3,PackingConfiguration="Both",WeightGrams=99,ResponseLayerCount=None,UnitsPerCarton=None)
        with patch.object(opportunity_views,"execute",return_value=[[row],[{"Total":1}]]) as sql:
            result=opportunity_views.sorted_grid("Sales",1,25,"[]")
            query=sql.call_args.args[0]
            for key in ("ThirdPMType","ThirdPMMOQ","NutDensity","LayersPerContainer"):
                self.assertIn("CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN response."+key,query)
            self.assertIn("THEN primary_pricing.UnitPrice END PrimaryPricePerUnit",query)
            for key in CALCULATED_FIELDS:self.assertIsNone(result["rows"][0][key])
            self.assertNotIn("PackingProductWeight",result["rows"][0])

    def test_response_weights_use_the_original_request_weight(self):
        row=dict(PackingWayVisible=1,PackingProductWeight="10",PackingRequestedLayers=3,PackingConfiguration="Both",WeightGrams=999,ResponseLayerCount=3,UnitsPerCarton=10,UnitsPerTertiary=5,CartonsPerLayer=10,LayersPerPallet=10,LayersPerContainer=10,PalletsPerContainer=20)
        with patch.object(opportunity_views,"execute",return_value=[[row],[{"Total":1}]]):
            actual=opportunity_views.sorted_grid("Admin",1,25,"[]")["rows"][0]
            self.assertEqual(actual["WeightGrams"],999)
            self.assertEqual(actual["TertiaryNetWeightGrams"],"500")
            self.assertEqual(actual["NetWeightPerPalletKG"],"50")
            self.assertEqual(actual["NetWeightPerContainerKG"],"1000")

if __name__=="__main__":unittest.main()
