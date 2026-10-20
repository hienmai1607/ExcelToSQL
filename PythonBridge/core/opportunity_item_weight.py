"""Item-owned weight commands run inside the enclosing Opportunity save."""
def save_item_weight(cursor, model, result, username):
    from packaging_fields import consume
    provided = "NetWeightGrams" in model.model_fields_set
    refresh = bool(getattr(model, "RefreshProductWeight", False))
    if not provided and not refresh:
        return
    if provided and refresh:
        raise ValueError("Choose either a net weight or refresh from Product Master.")
    if provided and model.NetWeightGrams is None:
        raise ValueError("Enter a positive net weight in grams.")
    cursor.execute("EXEC dbo.usp_OpportunityItem_SetNetWeight ?,?,?,?,?",
                   username, result["NewID"], result["NewRowVersion"],
                   model.NetWeightGrams if provided else None, int(refresh))
    result["NewRowVersion"] = consume(cursor)[0][0]["RowVersion"]
