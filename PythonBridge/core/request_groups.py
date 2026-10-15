"""Atomic parent-family workflow actions; product identity never defines membership."""
from fastapi import HTTPException
from db import bytes_to_b64

def perform_group(item_id,payload,ctx,assignment=False):
    from packaging_api import get_raw_cursor,rv
    from packaging_fields import consume
    with get_raw_cursor() as cur:
        owns=cur.execute('SELECT @@TRANCOUNT').fetchval()==0
        cur.execute('SET QUOTED_IDENTIFIER ON; SET XACT_ABORT ON; '+('BEGIN TRANSACTION' if owns else 'SAVE TRANSACTION RequestFamily'))
        try:
            source=cur.execute('SELECT RequestID FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',item_id).fetchone()
            if not source:raise HTTPException(404,'Request item not found.')
            # Serialize short workflow writes per request, then lock the complete membership.
            cur.execute('SELECT ID FROM dbo.PackagingConfigurationRequest WITH(UPDLOCK,HOLDLOCK) WHERE ID=?',source[0]).fetchone()
            cur.execute("""SELECT i.ID,i.OpportunityItemID,oi.ParentItemID,i.RowVersion,i.Stage,i.PICUserID
                FROM dbo.PackagingConfigurationRequestItem i WITH(UPDLOCK,HOLDLOCK)
                JOIN dbo.OpportunityItem oi WITH(HOLDLOCK) ON oi.ID=i.OpportunityItemID
                WHERE i.RequestID=? ORDER BY i.ID""",source[0])
            rows=cur.fetchall()
            selected=next((r for r in rows if r[0]==item_id),None)
            if selected is None or bytes(selected[3])!=rv(payload.ExpectedRowVersion,True):
                raise HTTPException(409,'Request item changed. Refresh the whole group.')
            root=next((r for r in rows if r[1]==selected[2]),None) if selected[2] is not None else selected
            if root is None:raise HTTPException(422,'This legacy request is missing the parent response. The family cannot be processed as an independent child.')
            group=[r for r in rows if r[0]==root[0] or r[2]==root[1]]
            if root[2] is None:
                missing=cur.execute("""SELECT COUNT(*) FROM dbo.OpportunityItem oi WITH(HOLDLOCK)
                    WHERE oi.ParentItemID=? AND NOT EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem i
                     WHERE i.RequestID=? AND i.OpportunityItemID=oi.ID)""",root[1],source[0]).fetchval()
                if missing:raise HTTPException(422,'This request is missing a child response. The complete family is required.')
            expected=payload.ExpectedGroupVersions
            if expected is not None:
                if set(expected)!={r[0] for r in group} or any(rv(expected[r[0]],True)!=bytes(r[3]) for r in group):
                    raise HTTPException(409,'Group membership or a child response changed. Refresh the whole group.')
            if not ctx.is_admin and ctx.permissions is not None and ctx.permissions.get('requests')!='edit':
                raise HTTPException(403,'Packaging Request edit access is required.')
            allowed={'Working':{'Assigned','Returned'},'Pending Review':{'Assigned','Working','Returned'},'Approved':{'Pending Review'},'Returned':{'Pending Review'},'Canceled':{'Assigned','Working','Returned','Pending Review'}}
            for row in group:
                if assignment:
                    if row[4] not in {'Assigned','Working','Returned'}:raise HTTPException(409,'A family member is locked. No assignments were changed.')
                else:
                    target=payload.TargetStage
                    if target in ('Working','Pending Review') and not ctx.is_admin and row[5]!=ctx.user_id:
                        raise HTTPException(403,'Only the assigned PIC or Admin can submit the whole family.')
                    if target=='Approved' and not ctx.is_admin and row[5]==ctx.user_id:raise HTTPException(403,'The PIC cannot approve their own family.')
                    if row[4]!=target and row[4] not in allowed[target]:raise HTTPException(409,'A family member has an incompatible stage. Refresh the whole group.')
            if not assignment and payload.TargetStage in ('Pending Review','Approved'):
                import json
                incomplete=cur.execute("""SELECT TOP(1) ID FROM dbo.PackagingConfigurationRequestItem
                    WHERE ID IN(SELECT value FROM OPENJSON(?)) AND Stage<>? AND
                    (NULLIF(LTRIM(RTRIM(FirstPMType)),N'') IS NULL OR FirstPMMOQ IS NULL
                    OR (COALESCE(ResponseLayerCount,RequestedLayerCount)>=2 AND (NULLIF(LTRIM(RTRIM(SecondPMType)),N'') IS NULL OR UnitsPerCarton IS NULL OR SecondPMMOQ IS NULL))
                    OR (COALESCE(ResponseLayerCount,RequestedLayerCount)>=3 AND (NULLIF(LTRIM(RTRIM(ThirdPMType)),N'') IS NULL OR UnitsPerTertiary IS NULL OR ThirdPMMOQ IS NULL)))
                    ORDER BY ID""",json.dumps([r[0] for r in group]),payload.TargetStage).fetchone()
                if incomplete:raise HTTPException(422,'Complete packaging type, units and calculated MOQ for request item '+str(incomplete[0])+'. No family stages were changed.')
            results=[]
            for row in group:
                try:
                    if assignment:
                        cur.execute('EXEC dbo.usp_PackagingRequestItem_Assign ?,?,?,?',ctx.username,row[0],payload.PICUserID,bytes(row[3]))
                    elif row[4]==payload.TargetStage:
                        results.append(dict(ID=row[0],Stage=row[4],RowVersion=bytes_to_b64(row[3])))
                        continue
                    else:
                        cur.execute('EXEC dbo.usp_PackagingRequestItem_Transition ?,?,?,?,?',ctx.username,row[0],bytes(row[3]),payload.TargetStage,payload.Comment)
                    sets=consume(cur)
                    result=sets[0][0]
                    if isinstance(result.get('RowVersion'),bytes):result['RowVersion']=bytes_to_b64(result['RowVersion'])
                    results.append(result)
                except Exception as exc:
                    if isinstance(exc,HTTPException):raise
                    raise HTTPException(422,'Group action failed at request item '+str(row[0])+'. No group changes were saved. '+str(exc)) from exc
            if owns:cur.execute('COMMIT')
            return dict(result=next(r for r in results if r['ID']==root[0]),results=results,GroupItemIDs=[r[0] for r in group])
        except Exception:
            cur.execute('IF @@TRANCOUNT>0 '+('ROLLBACK' if owns else 'BEGIN IF XACT_STATE()=1 ROLLBACK TRANSACTION RequestFamily; ELSE ROLLBACK; END'))
            raise
