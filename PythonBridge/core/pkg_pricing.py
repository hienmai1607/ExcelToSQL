"""Exact, bounded packaging-unit pricing; no browser-supplied totals or formulas."""
from decimal import Decimal, ROUND_CEILING, ROUND_HALF_UP, localcontext
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class PricingInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Component(PricingInput):
    PriceID: int = Field(ge=1, le=2147483647)
    PriceRowVersion: str = Field(min_length=12, max_length=12)
    Quantity: Decimal = Field(gt=0, max_digits=18, decimal_places=6, allow_inf_nan=False)
    DimensionID: int | None = Field(None, ge=1, le=2147483647)
    DimensionRowVersion: str | None = Field(None, min_length=12, max_length=12)
    D1: Decimal | None = Field(None, gt=0, max_digits=18, decimal_places=6, allow_inf_nan=False)
    D2: Decimal | None = Field(None, gt=0, max_digits=18, decimal_places=6, allow_inf_nan=False)
    D3: Decimal | None = Field(None, gt=0, max_digits=18, decimal_places=6, allow_inf_nan=False)


class Calculation(PricingInput):
    PackagingOrder: Literal["Primary", "Secondary", "Tertiary", "Quaternary"]
    LayerCount: int | None = Field(None,ge=1,le=4)
    PackagingTypeID: int = Field(ge=1, le=2147483647)
    SquareMeterUoMID: int | None = Field(None, ge=1, le=2147483647)
    DimensionID: int | None = Field(None, ge=1, le=2147483647)
    DimensionRowVersion: str | None = Field(None, min_length=12, max_length=12)
    D1: Decimal | None = Field(None, gt=0, max_digits=18, decimal_places=6, allow_inf_nan=False)
    D2: Decimal | None = Field(None, gt=0, max_digits=18, decimal_places=6, allow_inf_nan=False)
    D3: Decimal | None = Field(None, gt=0, max_digits=18, decimal_places=6, allow_inf_nan=False)
    ReferencePricingMasterID: int | None = Field(None, ge=1, le=2147483647)
    components: list[Component] = Field(min_length=1, max_length=100)
    Fingerprint: str | None = Field(None, pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def unique(self):
        if len({c.PriceID for c in self.components}) != len(self.components):
            raise ValueError("Select each price only once; increase its quantity instead.")
        return self


def rounded(value, scale=9, limit=Decimal("1e19")):
    if not value.is_finite() or value < 0 or value >= limit:
        raise ValueError("Calculation is outside the supported range.")
    result = value.quantize(Decimal(1).scaleb(-scale), rounding=ROUND_HALF_UP)
    if result >= limit:
        raise ValueError("Rounded calculation is outside the supported range.")
    return result


def component_cost(unit_price, vendor_moq, quantity, factor, area=None):
    """factor = base units (pieces or m²) in ONE vendor price unit."""
    with localcontext() as context:
        context.prec = 50
        if factor <= 0 or quantity <= 0:
            raise ValueError("Quantity and conversion factor must be positive.")
        consumption = quantity * (area if area is not None else Decimal(1)) / factor
        consumption = rounded(consumption, 12, Decimal("1e16"))
        if consumption == 0:
            raise ValueError("Consumption is too small to store safely.")
        price = rounded(unit_price * consumption)
        moq = (vendor_moq / consumption).to_integral_value(rounding=ROUND_CEILING)
        if moq >= Decimal("1e14"):
            raise ValueError("Product MOQ is outside the response field range.")
        return consumption, price, moq


def aggregate(rows, usd_currency):
    """Use the vendor currency when uniform; mixed currencies are summed in USD."""
    with localcontext() as context:
        context.prec = 50
        moq = max(r["ProductMOQ"] for r in rows)
        for r in rows:
            units = moq * r["Consumption"]
            if units < r["VendorMOQ"] or (r["QuantityTo"] is not None and units >= r["QuantityTo"]):
                raise ValueError(r["MaterialName"] + ": combined MOQ falls outside the selected price tier. Choose another effective tier.")
        currencies = {r["CurrencyID"] for r in rows}
        usd_prices = [r["ProductUnitUSDPrice"] for r in rows]
        usd_total = rounded(sum(usd_prices, Decimal(0))) if all(v is not None for v in usd_prices) else None
        if len(currencies) == 1:
            currency_id, currency = rows[0]["CurrencyID"], rows[0]["CurrencyCode"]
            total = rounded(sum((r["ProductUnitPrice"] for r in rows), Decimal(0)))
        else:
            if usd_total is None or usd_currency is None:
                raise ValueError("Mixed currencies require a positive Exchange Rate to USD for every price and a USD currency.")
            currency_id, currency, total = usd_currency, "USD", usd_total
        return dict(FinalMOQ=moq, UnitPrice=total, CurrencyID=currency_id, CurrencyCode=currency, UnitUSDPrice=usd_total)
