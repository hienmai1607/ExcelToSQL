"""Admin UoM metadata and authoritative product mass conversion."""
from decimal import Decimal,ROUND_HALF_UP
from fastapi import HTTPException
from db import get_raw_cursor
CATEGORIES=("Weight/Mass","Length/Distance","Area","Volume","Unit/Count","Other")

def product_weight(value,code):
    if value is None:return value,code
    code=(code or "g").strip()
    with get_raw_cursor() as cur:
        row=cur.execute("SELECT Category,BaseFactor FROM dbo.UoM WHERE UoMCode=? AND Status='Active'",code).fetchone()
    if not row or row[0]!="Weight/Mass":
        raise ValueError("Choose an active Weight/Mass UoM.")
    grams=Decimal(str(value))*row[1]
    if not grams.is_finite() or grams<=0:raise ValueError("Weight must be positive.")
    # Keep the established SQL/TVP gram/ounce contract; never trust a browser factor.
    unit="g" if grams<=Decimal("999999.9999") else "oz"
    weight=grams if unit=="g" else grams/Decimal("28.3495231")
    weight=weight.quantize(Decimal(".0001"),rounding=ROUND_HALF_UP)
    if weight>Decimal("999999.9999") or grams<Decimal(".005"):
        raise ValueError("Weight exceeds the supported Product range or rounds below 0.01 g.")
    return weight,unit

def save_uoms(payload,ctx,fields):
    from packaging_api import tvp_sql,rv
    from packaging_fields import consume
    import json
    documents=[]
    if len({r.RowNum for r in payload.rows})!=len(payload.rows) or len({r.ID for r in payload.rows if r.ID})!=sum(r.ID is not None for r in payload.rows):
        raise HTTPException(422,"Duplicate row or UoM ID.")
    for row in payload.rows:
        data=row.model_dump(mode="json")
        version=rv(data.pop("RowVersion"),row.Command!="C")
        data["RowVersionB64"]="0x"+version.hex() if version else None
        if row.Command!="C" and row.ID is None:raise HTTPException(422,"Update/block requires a UoM ID.")
        documents.append(data)
    with get_raw_cursor() as cur:
        own=cur.execute("SELECT @@TRANCOUNT").fetchval()==0
        cur.execute("SET QUOTED_IDENTIFIER ON;SET XACT_ABORT ON;"+("BEGIN TRANSACTION" if own else "SAVE TRANSACTION UomMetadata"))
        try:
            cur.execute(tvp_sql("UoMBatchType",fields)+"EXEC dbo.usp_UoM_Batch @Rows,?;",json.dumps(documents),ctx.username)
            results=consume(cur)[0]
            by_num={r.RowNum:r for r in payload.rows}
            for saved in results:
                row=by_num[saved["RowNum"]]
                if saved["Status"]!="OK" or row.Command=="D":continue
                cur.execute("UPDATE dbo.UoM SET Category=COALESCE(?,Category),BaseFactor=COALESCE(?,BaseFactor) WHERE ID=?",row.Category,row.BaseFactor,saved["NewID"])
                saved["NewRowVersion"]=cur.execute("SELECT RowVersion FROM dbo.UoM WHERE ID=?",saved["NewID"]).fetchval()
            if own:cur.execute("COMMIT TRANSACTION")
            import base64
            for saved in results:
                if isinstance(saved.get("NewRowVersion"),(bytes,bytearray)):saved["NewRowVersion"]=base64.b64encode(saved["NewRowVersion"]).decode("ascii")
            return {"results":results}
        except Exception:
            if own:cur.execute("IF @@TRANCOUNT>0 ROLLBACK TRANSACTION")
            elif cur.execute("SELECT XACT_STATE()").fetchval()==1:cur.execute("ROLLBACK TRANSACTION UomMetadata")
            raise
