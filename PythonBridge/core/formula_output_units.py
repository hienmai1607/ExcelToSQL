"""Shared formula-output units for parent and supplier conversions."""
from decimal import Decimal, DecimalException, ROUND_HALF_UP, localcontext

def output_unit_factor(definition, units, target_code, lookup):
    output_id=definition.get("ConversionOutputUoMID")
    if output_id is None:
        return Decimal(1),None  # Historical formulas retain their implicit output units.
    source=units.get(output_id)
    target=next((u for u in units.values() if u["UoMCode"].strip().casefold()==target_code.strip().casefold()),None)
    if not source or source.get("Status")!="Active" or not target or target.get("Status")!="Active":
        raise ValueError("Formula output and target units must be active.")
    same=source["ID"]==target["ID"]
    area_aliases={"m2","m\u00b2","m^2","sqm","sq m"}
    if source["UoMCode"].strip().casefold() in area_aliases and target["UoMCode"].strip().casefold() in area_aliases:same=True
    conversion=None if same else lookup(source["UoMCode"],target["UoMCode"])
    factor=Decimal(1) if same else Decimal(conversion["Factor"]) if conversion and conversion.get("Factor") is not None else None
    if factor is None or not factor.is_finite() or factor<=0:
        raise ValueError("Maintain an active unit conversion from "+source["UoMCode"]+" to "+target["UoMCode"]+".")
    return factor,dict(SourceUoM=source,TargetUoM=target,Conversion=conversion,Factor=factor)

def converted_output(value,factor):
    try:
        with localcontext() as context:
            context.prec=50
            result=(value*factor).quantize(Decimal("0.000000001"),rounding=ROUND_HALF_UP)
    except DecimalException as exc:
        raise ValueError("Converted formula output is out of range.") from exc
    if not result.is_finite() or result<=0 or result>=Decimal("1e19"):
        raise ValueError("Converted formula output must be positive and fit 19 whole digits and 9 decimals.")
    return result
