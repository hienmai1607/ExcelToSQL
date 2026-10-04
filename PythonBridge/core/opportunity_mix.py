"""Child edits share the document transaction; identity and units are SQL-owned."""
import json
from decimal import Decimal
from db import b64_to_bytes


def split_child_edits(cursor, models, username):
    from packaging_fields import additional, consume, PARENT_LOGISTICS_FIELDS
    normal, results = [], []
    if len({r.row_num for r in models}) != len(models):
        raise ValueError("Duplicate item row numbers.")
    ids = [r.id for r in models if r.id]
    if len(set(ids)) != len(ids):
        raise ValueError("Duplicate Opportunity item IDs.")
    for row in models:
        current = None
        if row.id:
            cursor.execute("""SELECT i.ParentItemID,i.ProductID,i.ItemDescription,i.AnnualUnit,
                i.RowVersion,o.OpportunityNumber FROM dbo.OpportunityItem i WITH(UPDLOCK,HOLDLOCK)
                JOIN dbo.Opportunity o ON o.ID=i.OpportunityID WHERE i.ID=?""", row.id)
            current = cursor.fetchone()
        if current is None or current.ParentItemID is None:
            if row.annual_unit is not None and (row.annual_unit != row.annual_unit.to_integral_value() or row.annual_unit > 2147483647):
                raise ValueError("Parent annual units must be a whole number from 0 to 2,147,483,647.")
            if row.command != "C" and (row.MixChildren or row.MixVersionID):
                cursor.execute("SELECT 1 FROM dbo.OpportunityMixSnapshot WHERE ParentItemID=?", row.id)
                if row.command != "U" or cursor.fetchval():
                    raise ValueError("Edit saved mix children by their item IDs and RowVersions.")
            normal.append(row)
            continue
        if row.command != "U" or row.MixChildren or row.MixVersionID:
            raise ValueError("Mix children can only update their Packaging requirements.")
        if current.OpportunityNumber != row.opportunity_number or bytes(current.RowVersion) != b64_to_bytes(row.row_version):
            raise ValueError("Mix child changed or belongs to another Opportunity. Refresh before saving.")
        for provided, stored in ((row.product_id, current.ProductID), (row.item_description, current.ItemDescription),
                                 (row.annual_unit, Decimal(current.AnnualUnit))):
            if provided is not None and provided != stored:
                raise ValueError("Mix child Product, description and Annual units are read-only.")
        if row.est_pct_awarded is not None or row.shelf_price is not None:
            raise ValueError("Estimated award and Shelf price belong to the parent mix.")
        if PARENT_LOGISTICS_FIELDS & row.model_fields_set:
            raise ValueError("Pallet and Container requirements belong to the parent item only.")
        extra=additional(row,"OpportunityItem")
        if extra.get("ProductGradeSnapshot") is not None:
            from opportunity_grade_snapshot import validate_snapshot
            validate_snapshot(cursor,extra["ProductGradeSnapshot"])
        cursor.execute("EXEC dbo.usp_OpportunityItem_Fields_Save ?,?,?,?,0",
                       username, row.id, current.RowVersion, json.dumps(extra))
        version = consume(cursor)[0][0]["RowVersion"]
        results.append(dict(RowNum=row.row_num, Status="OK", Message="Updated mix child",
                            NewID=row.id, NewRowVersion=version))
    return normal, results


def save_new_child_requirements(cursor, model, result, username):
    from packaging_fields import additional, consume, PARENT_LOGISTICS_FIELDS
    if model.MixVersionID is None and not model.MixChildren:
        return
    cursor.execute("SELECT MixVersionID FROM dbo.OpportunityMixSnapshot WHERE ParentItemID=?", result["NewID"])
    version = cursor.fetchval()
    if version is None or (model.MixVersionID is not None and version != model.MixVersionID):
        raise ValueError("The Active Product Mix changed. Reload product choices before saving.")
    if len({c.ProductID for c in model.MixChildren}) != len(model.MixChildren):
        raise ValueError("Duplicate mix children.")
    for child in model.MixChildren:
        if PARENT_LOGISTICS_FIELDS & child.model_fields_set:
            raise ValueError("Pallet and Container requirements belong to the parent item only.")
        cursor.execute("SELECT ID,RowVersion FROM dbo.OpportunityItem WHERE ParentItemID=? AND ProductID=?",
                       result["NewID"], child.ProductID)
        saved = cursor.fetchone()
        if saved is None:
            raise ValueError("Child Product does not belong to the saved Product Mix.")
        extra=additional(child,"OpportunityItem")
        if extra.get("ProductGradeSnapshot") is not None:
            from opportunity_grade_snapshot import validate_snapshot
            validate_snapshot(cursor,extra["ProductGradeSnapshot"])
        cursor.execute("EXEC dbo.usp_OpportunityItem_Fields_Save ?,?,?,?,0",
                       username, saved.ID, saved.RowVersion, json.dumps(extra))
        consume(cursor)
