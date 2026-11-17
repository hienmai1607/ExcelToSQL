"""Duty % tax-line breakdown: API model and SQL validator (migration 160). The SQL checks only read data."""
import json,sys,unittest
from decimal import Decimal as D
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'core'))
from pydantic import ValidationError
from shipment_fields import ShipmentCostInfo

LINES=[{'TaxType':'Import duty','Pct':'4'},{'TaxType':'GST','Pct':'10.5'}]

class Model(unittest.TestCase):
 def test_duty_is_the_sum_of_tax_lines(self):
  info=ShipmentCostInfo(DutyBreakdown=LINES)
  self.assertEqual(info.DutyPct,D('14.5'))
  self.assertEqual(ShipmentCostInfo(DutyBreakdown=LINES,DutyPct='14.50').DutyPct,D('14.5'))
 def test_mismatch_over_100_and_bad_lines_are_rejected(self):
  for value in ({'DutyBreakdown':LINES,'DutyPct':'4'},{'DutyBreakdown':[{'TaxType':'A','Pct':'60'},{'TaxType':'B','Pct':'41'}]},
                {'DutyBreakdown':[{'TaxType':' ','Pct':'1'}]},{'DutyBreakdown':[{'TaxType':'A','Pct':'1.00001'}]},
                {'DutyBreakdown':[]},{'DutyBreakdown':[{'TaxType':'A','Pct':'1','Extra':1}]}):
   with self.assertRaises(ValidationError,msg=value):ShipmentCostInfo(**value)
 def test_plain_duty_without_breakdown_still_works(self):
  self.assertEqual(ShipmentCostInfo(DutyPct='4').DutyPct,D(4))
 def test_four_decimal_duty_and_text_payment_term(self):
  info=ShipmentCostInfo(DutyBreakdown=[{'TaxType':'A','Pct':'1.2345'},{'TaxType':'B','Pct':'0.0001'}],PaymentTerm='30 days after B/L')
  self.assertEqual((info.DutyPct,info.PaymentTerm),(D('1.2346'),'30 days after B/L'))
  for value in ({'DutyPct':'1.23456'},{'PaymentTerm':'x'*201}):
   with self.assertRaises(ValidationError):ShipmentCostInfo(**value)

class SqlValidator(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  from db import get_raw_cursor
  cls.cursor=staticmethod(get_raw_cursor)
  with get_raw_cursor() as cur:
   if '-- Duty precision and payment term (161)' not in (cur.execute("SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityShipment_Validate'))").fetchval() or ''):
    raise unittest.SkipTest('Apply sql/160 and 161 to run the SQL checks.')
   row=cur.execute("""SELECT TOP(1) i.ID FROM dbo.OpportunityItem i WHERE i.ParentItemID IS NULL
     AND NOT EXISTS(SELECT 1 FROM dbo.OpportunityMixSnapshot m WHERE m.ParentItemID=i.ID) ORDER BY i.ID""").fetchone()
   if not row:raise unittest.SkipTest('No root Opportunity item available.')
   cls.item=row[0]
 def check(self,value):
  with self.cursor() as cur:cur.execute('EXEC dbo.usp_OpportunityShipment_Validate ?,?',self.item,json.dumps(value))
 def test_valid_breakdown_passes(self):
  self.check({'DutyPct':'14.50','DutyBreakdown':LINES})
  self.check({'DutyPct':'4'})
  self.check({'DutyPct':'1.2346','DutyBreakdown':[{'TaxType':'A','Pct':'1.2345'},{'TaxType':'B','Pct':'0.0001'}],'PaymentTerm':'30 days after B/L'})
 def test_invalid_breakdowns_are_rejected(self):
  cases={'match the sum':{'DutyPct':'4','DutyBreakdown':LINES},
   'exceed 100':{'DutyPct':'100','DutyBreakdown':[{'TaxType':'A','Pct':'60'},{'TaxType':'B','Pct':'41'}]},
   'Tax type':{'DutyPct':'1','DutyBreakdown':[{'TaxType':' ','Pct':'1'}]},
   'four decimals':{'DutyPct':'1.23456'},
   'Payment term':{'PaymentTerm':'x'*201},
   'two decimals':{'FreightUSDPerContainer':'1.234'},
   'JSON array':{'DutyPct':'1','DutyBreakdown':{'TaxType':'A','Pct':'1'}},
   '1 to 50':{'DutyBreakdown':[]},
   'Unknown or duplicate':{'DutyPct':'1','DutyBreakdown':[{'TaxType':'A','Pct':'1','Extra':'x'}]}}
  for message,value in cases.items():
   with self.subTest(message),self.assertRaisesRegex(Exception,message):self.check(value)

if __name__=='__main__':unittest.main()
