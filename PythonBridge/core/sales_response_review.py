"""Sales requester acceptance publishes manager-approved packaging and recipe responses."""
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from auth import AccessContext, get_access_context
from db import get_raw_cursor
from npd_api import query, one, transaction, audit, sheet_row, publish
from npd_recipes import obj
from packaging_api import rv

router = APIRouter(prefix='/api/opportunity/response-reviews', tags=['Sales response review'])
Kind = Literal['packaging', 'recipe']


def access(ctx, edit=False):
    if not ctx.is_admin and ('Opportunity' not in ctx.scopes or ctx.permissions is not None and ctx.permissions.get('opportunities') not in (('edit',) if edit else ('edit', 'display'))):
        raise HTTPException(403, 'Opportunity '+('edit' if edit else 'display')+' access is required.')


def ready(cur):
    if cur.execute("SELECT COL_LENGTH('dbo.NPDRecipeSheet','SalesReviewStatus')").fetchval() is None:
        raise HTTPException(503, 'Install SQL migration 159 before reviewing Sales responses.')


def packaging_family(cur, item_id, lock=False):
    hint=' WITH(UPDLOCK,HOLDLOCK)' if lock else ''
    selected=one(cur, 'SELECT i.RequestID,o.ParentItemID,i.OpportunityItemID FROM dbo.PackagingConfigurationRequestItem i JOIN dbo.OpportunityItem o ON o.ID=i.OpportunityItemID WHERE i.ID=?', item_id)
    one(cur, 'SELECT ID FROM dbo.PackagingConfigurationRequest'+hint+' WHERE ID=?', selected['RequestID'])
    root=selected['ParentItemID'] or selected['OpportunityItemID']
    if lock and cur.execute('''SELECT COUNT(*) FROM dbo.OpportunityItem child WITH(HOLDLOCK) WHERE child.ParentItemID=? AND NOT EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem member WHERE member.RequestID=? AND member.OpportunityItemID=child.ID)''',root,selected['RequestID']).fetchval():
        raise HTTPException(409,'The packaging request is missing a child response. Review the complete family.')
    rows=query(cur, '''SELECT i.*,o.ParentItemID,h.RequestedBy,h.OpportunityID,h.RequestNumber,
        reviewer.UserName ApprovedByName,pic.UserName PIC
        FROM dbo.PackagingConfigurationRequestItem i'''+hint+''' JOIN dbo.OpportunityItem o ON o.ID=i.OpportunityItemID
        JOIN dbo.PackagingConfigurationRequest h ON h.ID=i.RequestID
        LEFT JOIN dbo.Users reviewer ON reviewer.ID=i.ReviewedBy
        LEFT JOIN dbo.Users pic ON pic.ID=i.PICUserID
        WHERE i.RequestID=? AND (o.ID=? OR o.ParentItemID=?) ORDER BY o.ParentItemID,i.ID''', selected['RequestID'], root, root)
    if lock and not any(r['OpportunityItemID']==root for r in rows):
        raise HTTPException(409,'The packaging request is missing its parent response.')
    return rows


@router.get('')
def review_list(opportunity_id:int=Query(...,ge=1),ctx:AccessContext=Depends(get_access_context)):
    access(ctx)
    with get_raw_cursor() as cur:
        ready(cur)
        packaging=query(cur, '''SELECT i.ID,i.OpportunityItemID,o.ParentItemID,i.RequestID,h.RequestNumber,
            i.RowVersion,i.Stage,h.RequestedBy,pic.UserName PIC,reviewer.UserName ApprovedByName,
            i.SalesReviewedAt,i.SalesReviewComment,
            CASE WHEN i.Stage='Awaiting Sales' THEN 'Pending' WHEN i.Stage='Approved' THEN 'Accepted'
                 WHEN i.Stage='Returned' AND i.SalesReviewedAt IS NOT NULL THEN 'Returned' ELSE 'Not submitted' END SalesReviewStatus
            FROM dbo.PackagingConfigurationRequestItem i JOIN dbo.OpportunityItem o ON o.ID=i.OpportunityItemID
            JOIN dbo.PackagingConfigurationRequest h ON h.ID=i.RequestID
            LEFT JOIN dbo.Users pic ON pic.ID=i.PICUserID LEFT JOIN dbo.Users reviewer ON reviewer.ID=i.ReviewedBy
            WHERE h.OpportunityID=? AND NOT EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem newer
             WHERE newer.OpportunityItemID=i.OpportunityItemID AND newer.ID>i.ID)''',opportunity_id)
        recipe=query(cur, '''SELECT s.ID,s.SheetNumber,s.RowVersion,s.ApprovalStatus,s.SalesReviewStatus,
            s.SalesReviewedAt,s.SalesReviewComment,i.OpportunityItemID,i.RequestID,h.RequestNumber,h.RequestedBy,
            pic.UserName PIC,reviewer.UserName ApprovedByName
            FROM dbo.NPDRecipeRequestItem i JOIN dbo.NPDRecipeRequest h ON h.ID=i.RequestID
            JOIN dbo.NPDRecipeSheet s ON s.RequestItemID=i.ID
            LEFT JOIN dbo.Users pic ON pic.ID=i.PICUserID LEFT JOIN dbo.Users reviewer ON reviewer.ID=s.ApprovedBy
            WHERE h.OpportunityID=? AND i.IsLinked=1 AND NOT EXISTS(SELECT 1 FROM dbo.NPDRecipeSheet newer WHERE newer.RequestItemID=i.ID AND newer.Revision>s.Revision)''',opportunity_id)
        for kind, rows in [('packaging',packaging),('recipe',recipe)]:
            for row in rows:
                row['Kind']=kind
                row['CanReview']=bool(row['SalesReviewStatus']=='Pending' and (ctx.is_admin or row['RequestedBy']==ctx.user_id and (ctx.permissions is None or ctx.permissions.get('opportunities')=='edit')))
                if kind=='packaging':
                    row['GroupVersions']={r['ID']:r['RowVersion'] for r in packaging_family(cur,row['ID'])}
        return {'packaging':packaging,'recipe':recipe}


@router.get('/{kind}/{identity}')
def review_detail(kind:Kind,identity:int,ctx:AccessContext=Depends(get_access_context)):
    access(ctx)
    with get_raw_cursor() as cur:
        ready(cur)
        if kind=='recipe':
            row=sheet_row(cur,identity)
            if row['ApprovalStatus']!='Approved':raise HTTPException(409,'This recipe is awaiting team or manager review.')
            return {'rows':[row],'calculation':obj(row['CalculationJSON'])}
        rows=packaging_family(cur,identity)
        if any(r['Stage'] not in ('Approved','Awaiting Sales') for r in rows):raise HTTPException(409,'This packaging family is awaiting team or manager review.')
        # Captured pricing is the reviewed result; do not recalculate live master prices here.
        for row in rows:
            row['LayerPrices']=query(cur, 'SELECT PackagingOrder,PackagingTypeName,FinalMOQ,UnitPrice,CurrencyCode,UnitUSDPrice FROM dbo.PkgPricingMaster WHERE RequestItemID=? AND IsCurrent=1 ORDER BY ID',row['ID'])
            pallet=query(cur,'SELECT SnapshotJSON FROM dbo.PalletPricingSnapshot WHERE ID=? AND ItemID=?',row['PalletPricingID'],row['ID']) if row.get('PalletPricingID') else []
            row['PalletPricing']=obj(pallet[0]['SnapshotJSON']) if pallet else None
        return {'rows':rows}


class Decision(BaseModel):
    model_config=ConfigDict(extra='forbid',str_strip_whitespace=True)
    Action:Literal['Accept','Return']
    RowVersion:str
    GroupVersions:dict[int,str]|None=None
    Comment:str|None=Field(None,max_length=2000)


@router.post('/{kind}/{identity}')
def decide(kind:Kind,identity:int,body:Decision,ctx:AccessContext=Depends(get_access_context)):
    access(ctx,True)
    if body.Action=='Return' and not body.Comment:raise HTTPException(422,'Enter a reason for returning the response.')
    with transaction(ctx) as cur:
        ready(cur)
        if kind=='packaging':
            rows=packaging_family(cur,identity,True)
            selected=next(r for r in rows if r['ID']==identity)
            if not ctx.is_admin and selected['RequestedBy']!=ctx.user_id:raise HTTPException(403,'Only the original request creator or Admin can review this response.')
            if selected['RowVersion']!=body.RowVersion or body.GroupVersions is None or {str(r['ID']):r['RowVersion'] for r in rows}!={str(k):v for k,v in body.GroupVersions.items()}:
                raise HTTPException(409,'The packaging family changed. Refresh before reviewing.')
            if any(r['Stage']!='Awaiting Sales' for r in rows):raise HTTPException(409,'Only a complete manager-approved family can be reviewed by Sales.')
            header=one(cur,'SELECT Stage FROM dbo.Opportunity WITH(UPDLOCK,HOLDLOCK) WHERE ID=?',selected['OpportunityID'])
            if header['Stage']!='Draft':raise HTTPException(409,'Only a Draft Opportunity can receive a response.')
            # The whole family becomes visible to approved-only Opportunity readers atomically.
            cur.execute('EXEC sys.sp_set_session_context N\'PackagingChangeUser\',?; EXEC sys.sp_set_session_context N\'PackagingChangeSource\',N\'User\'; EXEC sys.sp_set_session_context N\'PackagingChangeReason\',?;',ctx.username,body.Comment or 'Sales accepted response.')
            while cur.nextset():pass
            try:
                for row in rows:
                    cur.execute('''UPDATE dbo.PackagingConfigurationRequestItem SET Stage=?,IsOpen=?,
                        SalesReviewedBy=?,SalesReviewedAt=SYSUTCDATETIME(),SalesReviewComment=?,UpdatedBy=?,UpdatedAt=SYSUTCDATETIME()
                        WHERE ID=? AND RowVersion=?''','Approved' if body.Action=='Accept' else 'Returned',0 if body.Action=='Accept' else 1,ctx.user_id,body.Comment,ctx.user_id,row['ID'],rv(row['RowVersion'],True))
                    while cur.nextset():pass
                audit(cur,'Packaging Sales',identity,body.Action,{'Items':[r['ID'] for r in rows],'Comment':body.Comment},ctx)
            finally:
                cur.execute("EXEC sys.sp_set_session_context N'PackagingChangeUser',NULL; EXEC sys.sp_set_session_context N'PackagingChangeSource',NULL; EXEC sys.sp_set_session_context N'PackagingChangeReason',NULL;")
                while cur.nextset():pass
        else:
            row=sheet_row(cur,identity)
            request=one(cur,'''SELECT h.RequestedBy,i.IsLinked FROM dbo.NPDRecipeRequestItem i WITH(UPDLOCK,HOLDLOCK)
                JOIN dbo.NPDRecipeRequest h ON h.ID=i.RequestID WHERE i.ID=?''',row['RequestItemID'])
            row=sheet_row(cur,identity)
            if not ctx.is_admin and request['RequestedBy']!=ctx.user_id:raise HTTPException(403,'Only the original request creator or Admin can review this response.')
            if row['RowVersion']!=body.RowVersion:raise HTTPException(409,'Recipe changed. Refresh before reviewing.')
            if row['ApprovalStatus']!='Approved' or row['SalesReviewStatus']!='Pending' or not request['IsLinked']:raise HTTPException(409,'Only a linked manager-approved recipe can be reviewed by Sales.')
            if body.Action=='Accept':
                publish(cur,row,obj(row['CalculationJSON']),ctx)
                cur.execute('UPDATE dbo.NPDRecipeRequestItem SET ActiveSheetID=?,IsOpen=0 WHERE ID=?',identity,row['RequestItemID'])
            else:
                cur.execute("UPDATE dbo.NPDRecipeSheet SET ApprovalStatus='Returned' WHERE ID=?",identity)
                cur.execute('UPDATE dbo.NPDRecipeRequestItem SET IsOpen=1 WHERE ID=?',row['RequestItemID'])
            cur.execute('''UPDATE dbo.NPDRecipeSheet SET SalesReviewStatus=?,SalesReviewedBy=?,SalesReviewedAt=SYSUTCDATETIME(),
                SalesReviewComment=?,UpdatedBy=?,UpdatedAt=SYSUTCDATETIME() WHERE ID=?''','Accepted' if body.Action=='Accept' else 'Returned',ctx.user_id,body.Comment,ctx.user_id,identity)
            audit(cur,'Sheet',identity,'Sales '+body.Action,{'Comment':body.Comment},ctx)
        return {'status':'Accepted' if body.Action=='Accept' else 'Returned'}
