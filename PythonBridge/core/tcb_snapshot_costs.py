"""Recalculate Processing with Loss from captured prices, never live masters.

Old stored JSON remains untouched. New snapshots already include the adjusted
processing charge, so the read adapter must not apply the loss a second time.
"""
from decimal import Decimal, localcontext
from fractions import Fraction as F


def recipe_rm_totals(value):
    """Expose recipe-weighted RM totals without altering captured unit prices."""
    if value.get("RMRecipeRatioApplied") or value.get("RMCostUSDPerLb") is None:
        return value
    recipes=value.get("MaterialCostSnapshots") or []
    prices=value.get("PriceSnapshots") or []
    if not recipes or not prices:return value
    before=F(0);after=F(0);covered=set()
    for row in recipes:
        path=row.get("Path");recipe=row.get("Inputs")
        if not path or not isinstance(recipe,dict):return value
        leaves=[p for p in prices if p.get("Path")==path or str(p.get("Path","")).startswith(path+"/")]
        if not leaves or any(not {"Path","USDPerLb","Proportion"}.issubset(p) or p["Path"] in covered for p in leaves):return value
        covered.update(p["Path"] for p in leaves)
        share=F(str(row["Proportion"])) if "Proportion" in row else sum((F(str(p["Proportion"])) for p in leaves),F(0))
        ratio=F(str(recipe.get("RMRatio",100)))/100
        before+=sum((F(str(p["USDPerLb"]))*F(str(p["Proportion"])) for p in leaves),F(0))*ratio
        if "RMUSDPerLb" in row:after+=F(str(row["RMUSDPerLb"]))*share*ratio
        elif "ProductUSDPerLb" in row:
            non_rm=(F(str(recipe.get("SeasoningUSDPerLb") or 0))*F(str(recipe.get("SeasoningRatio") or 0))
                    +F(str(recipe.get("OilUSDPerLb") or 0))*F(str(recipe.get("OilPct") or 0)))/100
            non_rm+=F(str(row.get("ProcessingWithLossUSDPerLb",recipe.get("ProcessingUSDPerLb")) or 0))
            after+=(F(str(row["ProductUSDPerLb"]))-non_rm)*share
        else:return value
    if covered!={p.get("Path") for p in prices}:return value
    with localcontext() as ctx:
        ctx.prec=60
        return {**value,"RMCostUSDPerLb":str(Decimal(after.numerator)/Decimal(after.denominator)),
                "RMWithoutLossUSDPerLb":str(Decimal(before.numerator)/Decimal(before.denominator)),"RMRecipeRatioApplied":True}


def processing_snapshot_costs(value):
    value=recipe_rm_totals(value)
    recipes = value.get("MaterialCostSnapshots")
    prices = value.get("PriceSnapshots")
    if not recipes or not isinstance(prices, list) or value.get("ProductUSDPerLb") is None:
        return value
    if all("ProcessingWithLossUSDPerLb" in row for row in recipes):
        return value
    # The oldest leaf-recipe snapshots have no RM/proportion capture. Their
    # legacy overall Product loss already adjusts Processing downstream.
    if any(not {"Path","RMUSDPerLb","Proportion","Inputs"}.issubset(row) for row in recipes):
        return value
    total = F(0)
    for row in recipes:
        recipe = row.get("Inputs", {})
        share = F(str(row["Proportion"]))
        rm = F(str(row["RMUSDPerLb"]))
        processing = F(str(recipe.get("ProcessingUSDPerLb") or 0))
        leaves = [p for p in prices if "/".join(p["Path"].split("/")[:2]) == row["Path"]]
        if not leaves or share <= 0:
            return {**value, "ProductUSDPerLb": None}
        raw = sum((F(str(p["USDPerLb"])) * F(str(p["Proportion"])) for p in leaves), F(0)) / share
        if processing and raw == 0:
            losses = value.get("ProcessLossSnapshots") or []
            factors = []
            for leaf in leaves:
                matching = [r for r in losses if r["Path"] == "0" or leaf["Path"] == r["Path"] or leaf["Path"].startswith(r["Path"] + "/")]
                if value.get("Inputs", {}).get("ProcessLossMode") == "GradePath":
                    matching = sorted(matching, key=lambda r: len(r["Path"]), reverse=True)[:1]
                factor = F(1)
                for loss in matching:
                    factor /= 1 - F(str(loss["LossPct"])) / 100
                factors.append(factor)
            if len(set(factors)) != 1:
                return {**value, "ProductUSDPerLb": None}
            adjusted = processing * factors[0]
        else:
            adjusted = processing * rm / raw if processing else F(0)
        line = (rm * F(str(recipe.get("RMRatio", 100)))
                + F(str(recipe.get("SeasoningUSDPerLb") or 0)) * F(str(recipe.get("SeasoningRatio") or 0))
                + F(str(recipe.get("OilUSDPerLb") or 0)) * F(str(recipe.get("OilPct") or 0))) / 100 + adjusted
        total += line * share
    with localcontext() as ctx:
        ctx.prec = 60
        return {**value, "ProductUSDPerLb": str(Decimal(total.numerator) / Decimal(total.denominator))}
