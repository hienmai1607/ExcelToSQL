"""Value captured pallet prices without reading or changing live pricing masters."""
import json
from decimal import Decimal, InvalidOperation


def pallet_usd(snapshot, owner):
    if isinstance(snapshot, str):
        try:
            snapshot = json.loads(snapshot)
        except (ValueError, TypeError):
            return None
    if not isinstance(snapshot, dict):
        return None
    def number(value):
        try:
            result = Decimal(str(value))
            return result if result.is_finite() and result >= 0 else None
        except (InvalidOperation, ValueError, TypeError):
            return None
    captured = number(snapshot.get("UnitUSDPrice"))
    if captured is not None:
        return captured
    price = number(snapshot.get("UnitPrice"))
    currency = snapshot.get("CurrencyCode")
    if price is None:
        return None
    if currency == "USD":
        return price
    key = "ExchangeRateVNDPerUSD" if currency == "VND" else "ExchangeRateCustomerCurrencyPerUSD" if currency and currency == owner.get("CustomerCurrencyCode") else None
    rate = number(owner.get(key)) if key else None
    return price / rate if rate and rate > 0 else None
