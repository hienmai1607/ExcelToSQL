"""Separate each Mix child's own commercial costs from inherited shared logistics."""
import json

CHILD_OTHER_KEYS = frozenset((
    "PackingUSDPerLb", "InitialDesignUSD", "InitialDesignCustomer", "OtherFixedCostsUSD",
    "InterestPct", "InterestDays", "InterestMonths", "MarginPct", "MarginMode", "MarginUSDPerLb",
))


def shipment_object(raw):
    if isinstance(raw, str):
        raw = json.loads(raw) if raw else {}
    return dict(raw) if isinstance(raw, dict) else {}


def own_others(row):
    """OwnShipmentCostInfo distinguishes unmaintained children from inherited data."""
    raw = row.get("OwnShipmentCostInfo", row.get("ShipmentCostInfo"))
    return {k: v for k, v in shipment_object(raw).items() if k in CHILD_OTHER_KEYS}


def effective_shipment(row):
    values = shipment_object(row.get("ShipmentCostInfo"))
    if row.get("ParentItemID"):
        values = {k: v for k, v in values.items() if k not in CHILD_OTHER_KEYS}
        values.update(own_others(row))
    elif row.get("IsMixParent"):
        values = {k: v for k, v in values.items() if k not in CHILD_OTHER_KEYS}
    return values


def validate_child_others(value):
    if value and any(v is not None and k not in CHILD_OTHER_KEYS for k, v in value.items()):
        raise ValueError("Mix children maintain only Others Info; shipment and shared logistics belong to the parent.")
