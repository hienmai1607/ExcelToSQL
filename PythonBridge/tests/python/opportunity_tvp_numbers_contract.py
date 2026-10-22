"""Real-ODBC regression for multi-item numeric TVP binding; fixtures roll back."""
import unittest
from contextlib import contextmanager
from unittest.mock import patch
from decimal import Decimal
from uuid import uuid4
from editable_opportunity_weight_contract import EditableWeight
from schemas import OpportunityBatchRequest
from main import opportunity_batch

class MultiItemNumbers(unittest.TestCase):
 setUp=EditableWeight.setUp
 cleanup=EditableWeight.cleanup

 def save_pair(self,annual=230000,award=100,price=None,reverse=False):
  customer=self.cur.execute('SELECT CustomerID FROM dbo.Opportunity WHERE ID=?',self.opp).fetchval()
  second=self.cur.execute("INSERT dbo.Product(ProductCode,ProductName,WeightGrams,CustomerID,CreatedBy) VALUES(?,'TVP numeric regression',450,?,?);SELECT CONVERT(INT,SCOPE_IDENTITY())",'TVP-'+uuid4().hex[:12],customer,self.actor).fetchval()
  key='TVP-'+uuid4().hex[:12]
  items=[dict(RowNum=2,Command='C',OpportunityNumber=key,ProductID=self.product,AnnualUnit=230000,EstPctAwarded=100,ShelfPrice=53.39,ContainerRequest='20RC'),
         dict(RowNum=3,Command='C',OpportunityNumber=key,ProductID=second,AnnualUnit=annual,EstPctAwarded=award,ShelfPrice=price,ContainerRequest='20RC')]
  if reverse:items.reverse()
  body=OpportunityBatchRequest(header_rows=[dict(RowNum=1,Command='C',OpportunityNumber=key,CustomerID=customer,OpportunityDesc='TVP numeric regression',BidOpen='2025-07-01',BidClose='2025-08-01',ExchangeRateVNDPerUSD=25000,ExchangeRateCustomerCurrencyPerUSD=1)],item_rows=items)
  @contextmanager
  def cursor():yield self.cur
  with patch('packaging_fields.get_raw_cursor',cursor):
   result=opportunity_batch(body,username=self.user,is_admin=True,scopes=frozenset({'Admin'}))
  self.assertEqual([r['Status'] for r in result['item_results']],['OK','OK'],result)
  stored=self.cur.execute('SELECT AnnualUnit,EstPctAwarded,ShelfPrice FROM dbo.OpportunityItem WHERE ID=?',result['item_results'][1]['NewID']).fetchone()
  self.assertEqual(stored[0],Decimal(annual))
  self.assertEqual(stored[1],None if award is None else Decimal(str(award)))
  self.assertEqual(stored[2],None if price is None else Decimal(str(price)))
  first=self.cur.execute('SELECT ShelfPrice FROM dbo.OpportunityItem WHERE ID=?',result['item_results'][0]['NewID']).fetchval()
  self.assertEqual(first,Decimal('53.39'))

 def test_later_blank_shelf_price_is_saved_as_null(self):self.save_pair()
 def test_later_blank_award_is_saved_as_null(self):self.save_pair(award=None,price=53.39)
 def test_later_larger_annual_units_do_not_overflow(self):self.save_pair(annual=1000000,price=53.39)
 def test_later_larger_price_does_not_overflow(self):self.save_pair(price=1000)
 def test_numeric_boundaries_remain_exact(self):self.save_pair(annual=2147483647,price=99999999.99)
 def test_zero_is_not_treated_as_blank(self):self.save_pair(annual=0,award=0,price=0)
 def test_reversed_input_has_identical_saved_values(self):self.save_pair(reverse=True)
 def test_whole_sql_decimal_quantity_does_not_send_fractional_text_to_int_tvp(self):self.save_pair(annual=Decimal('50000.0000'))
