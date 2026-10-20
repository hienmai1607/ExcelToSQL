"""Read and apply immutable load plans owned by a response item."""
import json
from fastapi import HTTPException

def read_plan(row):
    value=row.get("LoadPlanJSON")
    if isinstance(value,str):
        try:value=json.loads(value)
        except ValueError:return None
    return value if isinstance(value,dict) and isinstance(value.get("Result"),dict) and isinstance(value.get("Inputs"),dict) else None


# Inputs that determine physical loading, not notes or selected container/output totals.
DEPENDENCY_FIELDS=(
    'ConfigurationRequest','WeightGrams','ApplicableNetWeightGrams','ResponseLayerCount',
    'RequestedLayerCount','FirstPMType','SecondPMType','ThirdPMType','UnitsPerCarton',
    'UnitsPerTertiary','LengthMM','WidthMM','HeightMM','CartonsPerLayer',
    'ResponsePalletMaterialID','ResponsePalletSize','ResponsePalletStacking','ResponseMaxPalletHeightMM','PalletPricingID',
)


def lock_response_roots(cursor,identities):
    """Use parent-before-child locks, including sparse independent child saves."""
    cursor.execute("""SELECT DISTINCT COALESCE(root.ID,i.ID)
        FROM dbo.PackagingConfigurationRequestItem i JOIN dbo.OpportunityItem oi ON oi.ID=i.OpportunityItemID
        LEFT JOIN dbo.PackagingConfigurationRequestItem root
          ON root.RequestID=i.RequestID AND root.OpportunityItemID=oi.ParentItemID
        WHERE i.ID IN(SELECT value FROM OPENJSON(?)) ORDER BY 1""",json.dumps(sorted(identities)))
    for identity, in list(cursor.fetchall()):
        cursor.execute("SELECT ID FROM dbo.PackagingConfigurationRequestItem WITH(UPDLOCK,HOLDLOCK) WHERE ID=?",identity).fetchone()

def response_dependencies(cursor,identities):
    """Capture actual persisted inputs so sparse Excel and API writers behave alike."""
    if not identities:return {}
    fields=','.join('i.'+field for field in DEPENDENCY_FIELDS)
    cursor.execute(f"""SELECT i.ID,root.ID,{fields},
        (SELECT p.ID,p.PackagingOrder FROM dbo.PkgPricingMaster p
         WHERE p.RequestItemID=i.ID AND p.IsCurrent=1 ORDER BY p.PackagingOrder FOR JSON PATH)
        FROM dbo.PackagingConfigurationRequestItem i
        JOIN dbo.OpportunityItem oi ON oi.ID=i.OpportunityItemID
        LEFT JOIN dbo.PackagingConfigurationRequestItem root
          ON root.RequestID=i.RequestID AND root.OpportunityItemID=oi.ParentItemID
        WHERE i.ID IN(SELECT value FROM OPENJSON(?)) ORDER BY i.ID""",json.dumps(sorted(identities)))
    return {row[0]:(row[1],tuple(row[2:])) for row in cursor.fetchall()}

def invalidate_changed_plans(cursor,before,actor):
    """Clear current selections atomically; immutable historical plans are never deleted."""
    after=response_dependencies(cursor,before)
    affected=set()
    for identity,(parent,signature) in before.items():
        if after.get(identity)!=(parent,signature):
            affected.add(identity)
            if parent is not None:affected.add(parent)
    if not affected:return affected
    encoded=json.dumps(sorted(affected))
    cursor.execute("""SELECT i.ID,i.LoadPlanID FROM dbo.PackagingConfigurationRequestItem i WITH(UPDLOCK,HOLDLOCK)
        WHERE i.ID IN(SELECT value FROM OPENJSON(?))
        AND (i.LoadPlanID IS NOT NULL OR EXISTS(SELECT 1 FROM dbo.ResponseContainerLoadPlan m WHERE m.ItemID=i.ID))
        ORDER BY i.ID""",encoded)
    for identity,previous in list(cursor.fetchall()):
        cursor.execute("INSERT dbo.ResponseLoadPlanHistory(ItemID,PreviousPlanID,LoadPlanID,ChangedBy) VALUES(?,?,NULL,?)",identity,previous,actor)
        cursor.execute("DELETE FROM dbo.ResponseContainerLoadPlan WHERE ItemID=?",identity)
        cursor.execute("UPDATE dbo.PackagingConfigurationRequestItem SET LoadPlanID=NULL WHERE ID=?",identity)
    return affected

def apply_plan(cursor,row,actor):
    if "ContainerLoadPlanIDs" in row.model_fields_set:
        plans=row.ContainerLoadPlanIDs or {}
        for container,identity in plans.items():
            if not cursor.execute("SELECT ID FROM dbo.ContainerLoadPlan WHERE ID=? AND ContainerID=? AND ItemID=?",identity,container,row.ID).fetchone():
                raise HTTPException(422,"Choose saved container plans belonging to this response.")
        if cursor.execute("SELECT oi.ParentItemID FROM dbo.PackagingConfigurationRequestItem i JOIN dbo.OpportunityItem oi ON oi.ID=i.OpportunityItemID WHERE i.ID=?",row.ID).fetchval() is not None:
            raise HTTPException(422,"Container plans belong to the parent response.")
        cursor.execute("DELETE FROM dbo.ResponseContainerLoadPlan WHERE ItemID=?",row.ID)
        for container,identity in plans.items():
            cursor.execute("INSERT dbo.ResponseContainerLoadPlan(ItemID,ContainerID,PlanID,UpdatedBy) VALUES(?,?,?,?)",row.ID,container,identity,actor)
    if "LoadPlanID" not in row.model_fields_set:return
    if row.LoadPlanID is not None:
        cursor.execute("""SELECT p.Inputs,p.Result,i.ConfigurationRequest,oi.ParentItemID FROM dbo.ContainerLoadPlan p
            JOIN dbo.PackagingConfigurationRequestItem i ON i.ID=p.ItemID
            JOIN dbo.OpportunityItem oi ON oi.ID=i.OpportunityItemID WHERE p.ID=? AND p.ItemID=?""",row.LoadPlanID,row.ID)
        record=cursor.fetchone()
        if not record:raise HTTPException(422,"Choose a saved load plan for this response item.")
        if record[3] is not None:raise HTTPException(422,"Apply the load plan to the parent response.")
        # Loading mode is a feedback proposal per container, not a request-time lock.
        if json.loads(record[1])["cartons"]<=0:raise HTTPException(422,"A response load plan must fit at least one carton.")
        inputs=json.loads(record[0])
        result=json.loads(record[1])
        from decimal import Decimal
        from load_planning_api import response_dimensions
        actual=response_dimensions(cursor,row.ID)
        if actual is None or any(Decimal(str(actual[k]))!=Decimal(str(inputs['carton'][k])) for k in ('length','width','height')):
            raise HTTPException(422,'Final carton dimensions changed. Recalculate this container setup.')
        if result.get('PalletPricingID') is not None:
            current=cursor.execute('SELECT PalletPricingID FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',row.ID).fetchval()
            if current!=result['PalletPricingID']:raise HTTPException(422,'Pallet pricing changed. Save the response, then recalculate the load plan.')
        if inputs.get('weight_source')=='response':
            from decimal import Decimal
            from packaging_weight import response_weights
            gross=response_weights(cursor,row.ID)['CartonGrossWeightKG']
            if gross is None or Decimal(gross)!=Decimal(str(inputs['carton_kg'])):
                raise HTTPException(422,'Response gross weight changed. Save the response, then recalculate and apply the load plan.')
    cursor.execute("SELECT LoadPlanID FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",row.ID)
    previous=cursor.fetchone()[0]
    if row.LoadPlanID is not None:
        cursor.execute("""UPDATE m SET PlanID=p.ID,UpdatedBy=?,UpdatedAt=SYSUTCDATETIME()
            FROM dbo.ResponseContainerLoadPlan m JOIN dbo.ContainerLoadPlan p ON p.ItemID=m.ItemID AND p.ContainerID=m.ContainerID
            WHERE m.ItemID=? AND p.ID=?""",actor,row.ID,row.LoadPlanID)
        cursor.execute("""INSERT dbo.ResponseContainerLoadPlan(ItemID,ContainerID,PlanID,UpdatedBy)
            SELECT p.ItemID,p.ContainerID,p.ID,? FROM dbo.ContainerLoadPlan p WHERE p.ID=? AND p.ItemID=?
            AND NOT EXISTS(SELECT 1 FROM dbo.ResponseContainerLoadPlan m WHERE m.ItemID=p.ItemID AND m.ContainerID=p.ContainerID)""",actor,row.LoadPlanID,row.ID)
    if previous==row.LoadPlanID:return
    cursor.execute("INSERT dbo.ResponseLoadPlanHistory(ItemID,PreviousPlanID,LoadPlanID,ChangedBy) VALUES(?,?,?,?)",row.ID,previous,row.LoadPlanID,actor)
    cursor.execute("UPDATE dbo.PackagingConfigurationRequestItem SET LoadPlanID=? WHERE ID=?",row.LoadPlanID,row.ID)
    cursor.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",row.ID)
    return bytes(cursor.fetchone()[0])
