"""Item-owned weight commands run inside the enclosing Opportunity save."""
def save_item_weight(cursor, model, result, username):
    from packaging_fields import consume
    provided = "NetWeightGrams" in model.model_fields_set
    refresh = bool(getattr(model, "RefreshProductWeight", False))
    if not provided and not refresh:
        return
    if cursor.execute("""SELECT 1 FROM dbo.OpportunityItem i WITH(UPDLOCK,HOLDLOCK)
        JOIN dbo.Product p ON p.ID=i.ProductID WHERE i.ID=? AND i.ParentItemID IS NULL
        AND (p.IsMix=1 OR EXISTS(SELECT 1 FROM dbo.OpportunityMixSnapshot s WHERE s.ParentItemID=i.ID))""",result['NewID']).fetchone():
        raise ValueError("Mix parent net weight is calculated from its children and cannot be edited or refreshed from Product Master.")
    if provided and refresh:
        raise ValueError("Choose either a net weight or refresh from Product Master.")
    if provided and model.NetWeightGrams is None:
        raise ValueError("Enter a positive net weight in grams.")
    cursor.execute("EXEC dbo.usp_OpportunityItem_SetNetWeight ?,?,?,?,?",
                   username, result["NewID"], result["NewRowVersion"],
                   model.NetWeightGrams if provided else None, int(refresh))
    result["NewRowVersion"] = consume(cursor)[0][0]["RowVersion"]


def refresh_mix_parent_weights(cursor, item_ids, username):
    """Keep the item capture derived from its captured children in the same save."""
    import json
    from decimal import Decimal, ROUND_HALF_UP
    from packaging_fields import consume
    parents=cursor.execute("""SELECT DISTINCT p.ID FROM dbo.OpportunityItem i
        JOIN dbo.OpportunityItem p ON p.ID=COALESCE(i.ParentItemID,i.ID)
        WHERE i.ID IN(SELECT value FROM OPENJSON(?))
        AND EXISTS(SELECT 1 FROM dbo.OpportunityMixSnapshot s WHERE s.ParentItemID=p.ID)""",json.dumps(list(item_ids))).fetchall()
    for (identity,) in parents:
        current,version=cursor.execute('SELECT ProductNetWeightGrams,RowVersion FROM dbo.OpportunityItem WITH(UPDLOCK,HOLDLOCK) WHERE ID=?',identity).fetchone()
        children=cursor.execute('SELECT ProductNetWeightGrams,MixUnitQuantity FROM dbo.OpportunityItem WITH(HOLDLOCK) WHERE ParentItemID=?',identity).fetchall()
        if not children or any(weight is None or weight<=0 or quantity is None or quantity<=0 for weight,quantity in children):
            raise ValueError('Maintain every Mix child net weight and captured quantity before saving the parent.')
        total=sum((weight*quantity for weight,quantity in children),Decimal(0)).quantize(Decimal('.01'),rounding=ROUND_HALF_UP)
        if total==current:
            continue
        cursor.execute('EXEC dbo.usp_OpportunityItem_SetNetWeight ?,?,?,?,0',username,identity,version,total)
        consume(cursor)
        cursor.execute("""UPDATE dbo.OpportunityChangeLog SET Reason='Calculated from captured Mix child quantities and net weights'
            WHERE ID=(SELECT MAX(ID) FROM dbo.OpportunityChangeLog WHERE ItemID=? AND FieldName='WeightGrams')""",identity)
