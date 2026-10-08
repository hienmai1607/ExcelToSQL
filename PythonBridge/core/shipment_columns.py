"""Flat layout/workbook columns backed by the parent's ShipmentCostInfo JSON."""
import json
from decimal import Decimal
SHIPMENT_GROUPS = [
 [
  "Shipment",
  {
   "Incoterm": "Incoterm",
   "PortOfEntryName": "Port of Entry",
   "ContainerSizeFT": "Container"
  }
 ],
 [
  "Logistics",
  {
   "FreightUSDPerContainer": "Freight ($/Container)",
   "DutyPct": "Duty %",
   "ImportClearanceUSDPerContainer": "Import clearance ($/cont)",
   "PortToWHUSDPerContainer": "Port - WH ($/cont)",
   "WHCostUSDPerPallet": "WH Cost ($/pallet)",
   "OverageShortageDamagePct": "Overage, Shortage & Damage %"
  }
 ],
 [
  "Co-Man",
  {
   "WHToCoManWHUSDPerPallet": "WH - Co-Man WH ($/pallet)",
   "CoManOverheadUSDPerPallet": "Co-Man Overhead ($/pallet)",
   "FreightToCustomerUSDPerPallet": "Freight to Customer ($/pallet)",
   "SpoilageAllowancePct": "Spoilage Allowance %",
   "PaymentTermPct": "Payment Term %",
   "CoManFeePct": "Co-Man fee %",
   "BrokerFeePct": "Broker Fee %"
  }
 ],
 [
  "Others",
  {
   "PackingUSDPerLb": "Packing cost ($/lbs)",
   "InitialDesignUSD": "Initial Design ($)",
   "OtherFixedCostsUSD": "Other fixed costs ($)",
   "FobbingUSDPerContainer": "Fobbing/container ($)",
   "InterestPct": "Interest %",
   "InterestMonths": "Interest months",
   "MarginPct": "Margin %"
  }
 ]
]
SHIPMENT_LABELS = {key: label for _, fields in SHIPMENT_GROUPS for key, label in fields.items()}
SHIPMENT_COLUMNS = set(SHIPMENT_LABELS)
def shipment_columns(row):
    raw = row.get("ShipmentCostInfo")
    info = json.loads(raw) if isinstance(raw, str) and raw else raw or {}
    values = {key: row.get(key) if key == "PortOfEntryName" else info.get(key) for key in SHIPMENT_COLUMNS}
    for title, fields in SHIPMENT_GROUPS[1:]:
        for key in fields:
            if key != "InterestMonths" and values[key] is not None:
                values[key] = format(Decimal(str(values[key])), ".2f")
    return values
