import sys, unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "core"))
from fastapi import HTTPException
from pydantic import ValidationError
import opportunity_views as views
from preferences_api import Settings

class ViewContracts(unittest.TestCase):
    def test_item_prefix_columns(self):
        settings=Settings(opportunity={"items":{"columns":["ProductCode"],"prefix_columns":["ProductCode"]}})
        self.assertEqual(settings.opportunity.items.prefix_columns, ["ProductCode"])
        for kind, prefixes in (("header", ["ProductCode"]), ("items", ["Password"]), ("items", ["ProductCode", "ProductCode"])):
            with self.assertRaises(ValidationError):
                Settings(opportunity={kind:{"columns":["OpportunityNumber"] if kind=="header" else ["ProductCode"],"prefix_columns":prefixes}})

    def test_allowlisted_sort(self):
        for value in ('null', '{}', '[{"column":"AnnualUnit"}]', '[{"column":"BidOpen","direction":"DROP"}]', '[{"column":"BidOpen"},{"column":"BidOpen"}]'):
            with self.assertRaises(HTTPException):
                views.parse_header_sort(value)

    def test_sorted_headers_before_expansion_and_parameterized_filters(self):
        with patch.object(views, "execute", return_value=[[{"OpportunityID":1}],[{"Total":10}]]) as sql:
            result = views.sorted_grid("Sales",2,3,'[{"column":"ItemCount","direction":"desc"},{"column":"CustomerName","direction":"asc"}]',customer_name="x';DROP TABLE x;--")
            query, params = sql.call_args.args
            self.assertIn("[ItemCount] DESC, [CustomerName] ASC, OpportunityID DESC",query)
            self.assertLess(query.index("OFFSET ? ROWS"), query.index("LEFT JOIN dbo.OpportunityItem"))
            self.assertIn("u.IsActive=1",query)
            self.assertIn("active_request.IsOpen=1",query)
            self.assertIn("HasOpenPackagingRequest",query)
            self.assertIn("N'Admin',N'Opportunity'",query)
            self.assertNotIn("DROP TABLE",query)
            self.assertIn("x';DROP TABLE x;--%",params)
            self.assertEqual(result["total"],10)
            self.assertEqual(result["page"],2)

    def test_empty_page_retains_total(self):
        with patch.object(views,"execute",return_value=[[],[{"Total":9}]]):
            self.assertEqual(views.sorted_grid("Sales",100,25,"[]")["total"],9)

    def test_profile_views_are_independent_and_validated(self):
        filtered=Settings(opportunity={"header":{"columns":["CustomerName"],"filters":["bid_open_from"],"values":{"bid_open_from":"2026-09-01"}}})
        self.assertEqual(filtered.opportunity.header.filters,["bid_open_from"])
        for data in ({"filters":["password"]},{"filters":["stage","stage"]},{"values":{"unexpected":"x"}}):
            with self.assertRaises(ValidationError):
                Settings(opportunity={"header":{"columns":["CustomerName"],**data}})
        settings=Settings(opportunity={"header":{"columns":["CustomerName","OpportunityNumber"],"sort":[{"column":"BidClose","direction":"asc"}]},"items":{"columns":["ShelfPrice","ProductCode"],"sort":[{"column":"ShelfPrice","direction":"desc"}]}})
        self.assertEqual(settings.opportunity.items.columns[0],"ShelfPrice")
        self.assertEqual(settings.columns[0],"CustomerName")
        for data in ({"header":{"columns":["ProductCode"]}},{"items":{"columns":["ShelfPrice","ShelfPrice"]}},{"items":{"columns":["ProductCode"],"sort":[{"column":"BidOpen"}]}}):
            with self.assertRaises(ValidationError):Settings(opportunity=data)

if __name__=="__main__":unittest.main()
