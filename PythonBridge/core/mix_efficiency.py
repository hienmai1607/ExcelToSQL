"""Mix totals from frozen composition and visible child responses in the same request."""
import json
from decimal import Decimal, InvalidOperation, localcontext


def decoded(value, kind):
    try:
        value = json.loads(value, parse_float=Decimal) if isinstance(value, str) else value
        return value if isinstance(value, kind) else None
    except (ValueError, TypeError):
        return None


def number(raw, zero=False):
    try:
        value = Decimal(str(raw))
        return value if value.is_finite() and (value >= 0 if zero else value > 0) else None
    except (InvalidOperation, ValueError, TypeError):
        return None


def mix_totals(snapshot, children):
    """Never omit a missing constituent, borrow another request, or round each child."""
    structure, responses = decoded(snapshot, dict), decoded(children, list)
    empty = dict(weight=None, volume=None)
    items = structure.get("items") if structure else None
    if not isinstance(items, list) or not items:
        return empty
    densities = {}
    for child in responses or []:
        if not isinstance(child, dict):
            continue
        key = str(child.get("ProductID"))
        # Ambiguous responses must not silently pick a density.
        densities[key] = None if key in densities else number(child.get("NutDensity"))
    weight, volume, seen = Decimal(0), Decimal(0), set()
    complete = True
    with localcontext() as context:
        context.prec = 100
        for child in items:
            if not isinstance(child, dict):
                return empty
            key = str(child.get("ProductID"))
            quantity = number(child.get("UnitQuantity", child.get("MixUnitQuantity")))
            grams = number(child.get("WeightGrams"), zero=True)
            if key in ("None", "") or key in seen or quantity is None or grams is None:
                return empty
            seen.add(key)
            child_weight = quantity * grams
            weight += child_weight
            density = densities.get(key)
            if density is None:
                complete = False
            else:
                volume += child_weight / density
    return dict(weight=weight, volume=volume if complete else None)
