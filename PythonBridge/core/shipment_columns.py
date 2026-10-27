"""Flat layout/workbook columns backed by effective parent shared logistics and child-owned Others Info."""
import json
from decimal import Decimal
SHIPMENT_GROUPS = [
 [
  "Shipment",
  {
   "Incoterm": "Incoterm",
   "PortOfEntryName": "Port of Entry",
   "ContainerSizeFT": "Container",
   "FloorLoadUSDPerMT": "Floor load cost (USD/MT)"
  }
 ],
 [
  "Logistics",
  {
   "FobbingUSDPerContainer": "Fobbing (USD/cont)",
   "FreightUSDPerContainer": "Freight (USD/cont)",
   "DutyPct": "Duty %",
   "ImportClearanceUSDPerContainer": "Legacy import clearance (USD/cont)",
   "ImportClearanceCustomerPerContainer": "Import clearance (customer currency/cont)",
   "ImportClearanceCustomerPerPallet": "Legacy clearance (customer currency/pallet)",
   "PortToWHUSDPerContainer": "Port - WH (USD/cont)",
   "WHCostUSDPerPallet": "WH Cost (USD/pallet)",
   "PortToWHCustomerPerContainer": "Port - WH (customer currency/cont)",
   "WHCostCustomerPerPallet": "WH Cost (customer currency/pallet)",
   "OverageShortageDamagePct": "Overage, Shortage & Damage %"
  }
 ],
 [
  "Co-Man",
  {
   "WHToCoManWHUSDPerPallet": "WH - Co-Man WH (USD/pallet)",
   "CoManOverheadUSDPerPallet": "Co-Man Overhead (USD/pallet)",
   "FreightToCustomerUSDPerPallet": "Freight to Customer (USD/pallet)",
   "SpoilageAllowancePct": "Spoilage Allowance %",
   "PaymentTermPct": "Payment Term %",
   "CoManFeePct": "Co-Man fee %",
   "BrokerFeePct": "Broker Fee %"
  }
 ],
 [
  "Others",
  {
   "PackingUSDPerLb": "Packing cost (USD/lbs)",
   "InitialDesignUSD": "Initial Design (USD)",
   "InitialDesignCustomer": "Initial Design (customer currency)",
   "OtherFixedCostsUSD": "Other fixed costs (USD)",
   "InterestPct": "Interest %",
   "InterestMonths": "Legacy interest months",
   "InterestDays": "Interest days",
   "PaymentTermDays": "Payment term (days)",
   "MarginMode": "Margin basis",
   "MarginUSDPerLb": "Margin (USD/lbs)",
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
            if key not in ("InterestMonths","InterestDays","PaymentTermDays","MarginMode") and values[key] is not None:
                values[key] = format(Decimal(str(values[key])), ".2f")
    if values["InterestDays"] is None and values["InterestMonths"] is not None:
        values["InterestDays"] = int(values["InterestMonths"]) * 30
    values["MarginMode"] = values["MarginMode"] or ("USDPerLb" if values["MarginUSDPerLb"] is not None else "Percent")
    return values
