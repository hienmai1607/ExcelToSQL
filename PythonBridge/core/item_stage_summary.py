"""Read-only workflow evidence. Does not introduce or change stage transitions."""
import json

def document(value):
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(value or "{}")
        return parsed if isinstance(parsed, dict) else {}
    except (ValueError, TypeError):
        return {}

def stage_summary(row):
    review = product_review(row)
    saved = document(row.get("_TCBCostInfo"))
    inputs = document(saved.get("Inputs"))
    shipping = document(row.get("ShipmentCostInfo"))
    return json.dumps({
        **review,
        "PackagingStage": row.pop("_StagePackagingStage", None),
        "RequestNumber": row.pop("_StageRequestNumber", None),
        "PIC": row.pop("_StagePIC", None),
        "RequestedAt": str(row.pop("_StageRequestedAt", None) or ""),
        "SubmittedAt": str(row.pop("_StageSubmittedAt", None) or ""),
        "ReviewedAt": str(row.pop("_StageReviewedAt", None) or ""),
        "Reason": row.pop("_StageReason", None),
        "TCBSaved": bool(inputs),
        "TCBCalculated": saved.get("ProductUSDPerLb") is not None,
        "ShipmentSaved": bool(shipping),
        "LossSaved": inputs.get("ProductLossFormula") is not None or bool(inputs.get("LossProcesses")) or any(v is not None for k,v in inputs.items() if k.endswith("LossPct")),
        "PricesSaved": bool(inputs.get("Prices")),
        "GradesSaved": bool(document(row.get("ProductGradeSnapshot"))),
        "ShipmentInherited": bool(row.get("ParentItemID")),
    }, ensure_ascii=False)


def complete_stage_summaries(rows):
    """Use saved Analysis cells, including zero, rather than input badges as approval."""
    from tcb_analysis_columns import TCB_LABELS
    summaries = {r["ItemID"]: document(r.get("StageSummaryJSON")) for r in rows if r.get("ItemID") is not None}
    def entries(info):
        return all(info.get(key) for key in ("TCBSaved", "ShipmentSaved", "LossSaved", "GradesSaved", "PricesSaved"))
    def blocked(row):
        return summaries[row["ItemID"]].get("PackagingStage") in ("Returned", "Rejected", "Canceled") or row.get("ItemStage") == "Canceled"
    for row in rows:
        info = summaries.get(row.get("ItemID"))
        if info is None or row.get("IsMixParent"):
            continue
        info["AnalysisMissingFields"] = [label for key,label in TCB_LABELS.items() if row.get(key) in (None, "")]
        info["TCBReviewComplete"] = not info["AnalysisMissingFields"]
        info["TCBEntriesComplete"] = entries(info) or info["TCBReviewComplete"]
    for row in rows:
        info = summaries.get(row.get("ItemID"))
        if info is None or not row.get("IsMixParent"):
            continue
        children = [r for r in rows if r.get("ParentItemID") == row["ItemID"]]
        child_info = [summaries[c["ItemID"]] for c in children]
        info["PricesFromChildren"] = True
        info["PricesSaved"] = bool(children) and all(c.get("PricesSaved") for c in child_info)
        info["GradesSaved"] = bool(children) and all(c.get("GradesSaved") for c in child_info)
        info["AnalysisMissingFields"] = sorted({label for c in child_info for label in c.get("AnalysisMissingFields", [])})
        if not children:
            info["AnalysisMissingFields"] = ["Child product Analysis"]
        info["TCBBlockedByChildren"] = any(blocked(c) for c in children)
        info["TCBReviewComplete"] = bool(children) and all(c.get("TCBReviewComplete") for c in child_info) and not info["TCBBlockedByChildren"]
        info["TCBEntriesComplete"] = (entries(info) and all(c.get("TCBEntriesComplete") for c in child_info) or info["TCBReviewComplete"]) and not info["TCBBlockedByChildren"]
    for row in rows:
        if row.get("ItemID") in summaries:
            row["StageSummaryJSON"] = json.dumps(summaries[row["ItemID"]], ensure_ascii=False)
    return rows


def product_review(row):
    """Required saved Product Info and Packaging requirements, not optional inputs."""
    def present(key):
        return row.get(key) is not None and str(row[key]).strip() != ""
    product_missing = []
    if not present("ProductID") or not str(row["ProductID"]).isdigit() or int(row["ProductID"]) < 1:
        product_missing.append("Product")
    annual = str(row.get("AnnualUnit") if row.get("AnnualUnit") is not None else "").strip()
    from decimal import Decimal, InvalidOperation
    try:
        units = Decimal(annual)
        valid_units = units.is_finite() and units == units.to_integral_value() and 0 <= units <= 2147483647
    except InvalidOperation:
        valid_units = False
    if not valid_units:
        product_missing.append("Annual units")
    packaging_missing = []
    if not present("PrimaryTypeID") and not present("PackagingType"):
        packaging_missing.append("Primary Type")
    if not row.get("ParentItemID") and not present("PalletSize"):
        packaging_missing.append("Pallet size")
    return {"ProductInfoComplete":not product_missing,
            "PackagingRequirementsComplete":not packaging_missing,
            "ProductReviewComplete":not product_missing and not packaging_missing,
            "ProductReviewMissingFields":product_missing + packaging_missing}
