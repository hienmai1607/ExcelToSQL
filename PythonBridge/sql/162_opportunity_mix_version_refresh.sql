-- Requires 161. Explicit "Update to current mix version" for a saved Opportunity Mix item.
-- Kept children (same Product) keep their own data; removed children are deleted; new ones are added.
-- Runs only inside the Opportunity save transaction. Existing data is not changed by this migration.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 IF CHARINDEX(N'-- Duty precision and payment term (161)',COALESCE(OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityShipment_Validate')),N''))=0
  THROW 52996,'Apply migration 161 first.',1;
 DECLARE @D NVARCHAR(MAX),@Old NVARCHAR(400),@New NVARCHAR(600);
 -- 1. Delete trigger: allow removing children individually only for the item being refreshed.
 SET @D=OBJECT_DEFINITION(OBJECT_ID('dbo.tr_OpportunityItem_MixDelete'));
 IF @D IS NULL THROW 52996,'Mix delete trigger is missing; migration 162 was not applied.',1;
 IF CHARINDEX(N'OpportunityMixRefreshID',@D)=0
 BEGIN
  SET @Old=N'  AND NOT EXISTS(SELECT 1 FROM deleted p WHERE p.ID=c.ParentItemID))';
  IF (LEN(@D)-LEN(REPLACE(@D,@Old,N'')))/LEN(@Old)<>1
   THROW 52996,'Unexpected Mix delete trigger definition; migration 162 was not applied.',1;
  SET @D=REPLACE(@D,@Old,N'  AND NOT EXISTS(SELECT 1 FROM deleted p WHERE p.ID=c.ParentItemID)
  -- Mix version refresh (162): only the refreshed parent''s children, only inside its procedure.
  AND c.ParentItemID<>ISNULL(TRY_CONVERT(INT,SESSION_CONTEXT(N''OpportunityMixRefreshID'')),0))');
  SET @D=STUFF(@D,1,CHARINDEX(N'TRIGGER',UPPER(@D))+LEN(N'TRIGGER')-1,N'ALTER TRIGGER');
  EXEC sys.sp_executesql @D;
 END;
 -- 2. Child rules: quantity and numbering may change only for the refreshed parent's children.
 --    Membership/quantity must still match the (new) snapshot through the trigger's later check.
 SET @D=OBJECT_DEFINITION(OBJECT_ID('dbo.tr_OpportunityItem_MixChildren'));
 IF @D IS NULL THROW 52996,'Mix children trigger is missing; migration 162 was not applied.',1;
 IF CHARINDEX(N'OpportunityMixRefreshID',@D)=0
 BEGIN
  DECLARE @Bypass NVARCHAR(200)=N' AND ISNULL(d.ParentItemID,0)<>ISNULL(TRY_CONVERT(INT,SESSION_CONTEXT(N''OpportunityMixRefreshID'')),0)';
  SET @Old=N'   OR ISNULL(i.MixUnitQuantity,0)<>ISNULL(d.MixUnitQuantity,0)';
  IF (LEN(@D)-LEN(REPLACE(@D,@Old,N'')))/LEN(@Old)<>1 THROW 52996,'Unexpected Mix children trigger (quantity); migration 162 was not applied.',1;
  SET @D=REPLACE(@D,@Old,@Old+@Bypass);
  SET @Old=N'   OR ISNULL(i.MixChildNumber,0)<>ISNULL(d.MixChildNumber,0)';
  IF (LEN(@D)-LEN(REPLACE(@D,@Old,N'')))/LEN(@Old)<>1 THROW 52996,'Unexpected Mix children trigger (number); migration 162 was not applied.',1;
  SET @D=REPLACE(@D,@Old,@Old+@Bypass);
  SET @D=STUFF(@D,1,CHARINDEX(N'TRIGGER',UPPER(@D))+LEN(N'TRIGGER')-1,N'ALTER TRIGGER');
  EXEC sys.sp_executesql @D;
 END;
 COMMIT;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
END CATCH;
GO
CREATE OR ALTER PROCEDURE dbo.usp_OpportunityItem_MixRefresh
 @Username NVARCHAR(100),@ID INT,@ExpectedRowVersion VARBINARY(8)
AS
BEGIN
 SET NOCOUNT ON;
 IF @@TRANCOUNT=0 THROW 52983,'A Mix version update must be saved with the Opportunity transaction.',1;
 DECLARE @Actor INT;
 SELECT @Actor=u.ID FROM dbo.Users u
 WHERE u.UserName=@Username AND u.IsActive=1
 AND EXISTS(SELECT 1 FROM dbo.UserAccess a WHERE a.UserID=u.ID AND a.Scope IN('Admin','Opportunity'));
 IF @Actor IS NULL THROW 52983,'Opportunity edit access is required.',1;
 DECLARE @Product INT,@Opportunity INT,@Label NVARCHAR(300),@Units DECIMAL(18,4),@OldVersion INT,@NewVersion INT;
 SELECT @Product=i.ProductID,@Opportunity=i.OpportunityID,@Label=i.ItemDescription,@Units=i.AnnualUnit,@OldVersion=s.MixVersionID
 FROM dbo.OpportunityItem i WITH(UPDLOCK,HOLDLOCK)
 JOIN dbo.Opportunity o WITH(HOLDLOCK) ON o.ID=i.OpportunityID
 JOIN dbo.OpportunityMixSnapshot s WITH(UPDLOCK,HOLDLOCK) ON s.ParentItemID=i.ID
 WHERE i.ID=@ID AND i.ParentItemID IS NULL AND i.RowVersion=@ExpectedRowVersion AND i.Stage='Draft' AND o.Stage='Draft';
 IF @Product IS NULL THROW 52983,'Mix version update requires an unchanged saved Draft Mix item. Refresh the Opportunity.',1;
 IF EXISTS(SELECT 1 FROM dbo.OpportunityItem c WITH(UPDLOCK,HOLDLOCK) WHERE c.ParentItemID=@ID AND c.Stage<>'Draft')
  OR EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem r WITH(HOLDLOCK)
   WHERE r.IsOpen=1 AND (r.OpportunityItemID=@ID OR r.OpportunityItemID IN(SELECT ID FROM dbo.OpportunityItem WHERE ParentItemID=@ID)))
  OR EXISTS(SELECT 1 FROM dbo.NPDRecipeRequestItem r WITH(HOLDLOCK)
   WHERE r.IsOpen=1 AND (r.OpportunityItemID=@ID OR r.OpportunityItemID IN(SELECT ID FROM dbo.OpportunityItem WHERE ParentItemID=@ID)))
  THROW 52983,'This Mix or one of its children is processing or has an open Packaging/Recipe Request. Its mix version cannot change.',1;
 SELECT @NewVersion=v.ID FROM dbo.ProductMixVersion v WITH(UPDLOCK,HOLDLOCK)
 JOIN dbo.Product p WITH(HOLDLOCK) ON p.ID=v.ProductID AND p.IsMix=1 AND p.Status='Active'
 WHERE v.ProductID=@Product AND v.Status='Active';
 IF @NewVersion IS NULL THROW 52983,'The Mix Product has no Active mix version. Activate a version first.',1;
 IF @NewVersion=@OldVersion THROW 52983,'This Mix item already uses the current Active mix version.',1;
 IF EXISTS(SELECT 1 FROM dbo.ProductMixItem m JOIN dbo.Product c ON c.ID=m.ProductID WHERE m.VersionID=@NewVersion AND c.Status<>'Active')
  THROW 52983,'The Active mix version contains a blocked child Product.',1;
 -- Children leaving the mix must have no business history; referenced records are never deleted.
 DECLARE @Removed TABLE(ID INT PRIMARY KEY);
 INSERT @Removed SELECT c.ID FROM dbo.OpportunityItem c WHERE c.ParentItemID=@ID
  AND NOT EXISTS(SELECT 1 FROM dbo.ProductMixItem m WHERE m.VersionID=@NewVersion AND m.ProductID=c.ProductID);
 IF EXISTS(SELECT 1 FROM @Removed r WHERE EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem x WHERE x.OpportunityItemID=r.ID)
   OR EXISTS(SELECT 1 FROM dbo.NPDRecipeRequestItem x WHERE x.OpportunityItemID=r.ID)
   -- The automatic initial TCB version is not history (same rule as business deletion).
   OR EXISTS(SELECT 1 FROM dbo.OpportunityTCBVersion x WHERE x.ItemID=r.ID AND (x.Version<>1 OR x.SavedJSON<>N'{}' OR x.ContextJSON IS NOT NULL))
   OR EXISTS(SELECT 1 FROM dbo.OpportunityItemStageHistory x WHERE x.OpportunityItemID=r.ID)
   OR EXISTS(SELECT 1 FROM dbo.PkgPricingMaster x WHERE x.OpportunityItemID=r.ID))
  THROW 52983,'A child Product that leaves the mix has Packaging, Recipe, TCB or stage history. Add a new Opportunity item with the Mix instead.',1;
 IF (SELECT COUNT(*) FROM dbo.ProductMixItem WHERE VersionID=@NewVersion)>10000
  THROW 52983,'A mix may generate at most 10000 child items.',1;
 DECLARE @Previous SQL_VARIANT=SESSION_CONTEXT(N'OpportunityMixRefreshID');
 BEGIN TRY
  EXEC sys.sp_set_session_context @key=N'OpportunityMixRefreshID',@value=@ID;
  DELETE x FROM dbo.OpportunityTCBVersion x JOIN @Removed r ON r.ID=x.ItemID WHERE x.Version=1 AND x.SavedJSON=N'{}' AND x.ContextJSON IS NULL;
  DELETE c FROM dbo.OpportunityItem c JOIN @Removed r ON r.ID=c.ID;
  -- Snapshots are immutable: replace the row.
  DELETE dbo.OpportunityMixSnapshot WHERE ParentItemID=@ID;
  INSERT dbo.OpportunityMixSnapshot(ParentItemID,MixVersionID,Origin) VALUES(@ID,@NewVersion,'Save');
  UPDATE c SET MixUnitQuantity=m.UnitQuantity,AnnualUnit=CONVERT(DECIMAL(18,4),@Units*m.UnitQuantity),
   UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()
  FROM dbo.OpportunityItem c JOIN dbo.ProductMixItem m ON m.VersionID=@NewVersion AND m.ProductID=c.ProductID
  WHERE c.ParentItemID=@ID AND (c.MixUnitQuantity<>m.UnitQuantity OR c.AnnualUnit<>CONVERT(DECIMAL(18,4),@Units*m.UnitQuantity));
  INSERT dbo.OpportunityItem(OpportunityID,ProductID,ItemDescription,AnnualUnit,Stage,CreatedBy,ParentItemID,MixUnitQuantity,MixChildNumber)
  SELECT @Opportunity,m.ProductID,p.ProductName,CONVERT(DECIMAL(18,4),@Units*m.UnitQuantity),'Draft',@Actor,@ID,m.UnitQuantity,
   10000+ROW_NUMBER() OVER(ORDER BY p.ProductCode,p.ID)
  FROM dbo.ProductMixItem m JOIN dbo.Product p ON p.ID=m.ProductID
  WHERE m.VersionID=@NewVersion AND NOT EXISTS(SELECT 1 FROM dbo.OpportunityItem c WHERE c.ParentItemID=@ID AND c.ProductID=m.ProductID);
  -- Child numbers follow Product code order, as on first save.
  WITH Ordered AS(SELECT c.MixChildNumber,ROW_NUMBER() OVER(ORDER BY p.ProductCode,p.ID) N
   FROM dbo.OpportunityItem c JOIN dbo.Product p ON p.ID=c.ProductID WHERE c.ParentItemID=@ID)
  UPDATE Ordered SET MixChildNumber=N WHERE MixChildNumber<>N;
  UPDATE dbo.OpportunityItem SET UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME() WHERE ID=@ID;
  EXEC sys.sp_set_session_context @key=N'OpportunityMixRefreshID',@value=@Previous;
  INSERT dbo.OpportunityChangeLog(EventID,OpportunityID,EntityLevel,ItemID,ItemLabel,Action,FieldName,OldValue,NewValue,ChangedBy,Source,Reason)
  SELECT COALESCE(TRY_CONVERT(UNIQUEIDENTIFIER,SESSION_CONTEXT(N'OpportunityChangeEvent')),NEWID()),
   @Opportunity,'Item',@ID,@Label,'Update','MixVersion',
   CONVERT(NVARCHAR(MAX),(SELECT Version FROM dbo.ProductMixVersion WHERE ID=@OldVersion)),
   CONVERT(NVARCHAR(MAX),(SELECT Version FROM dbo.ProductMixVersion WHERE ID=@NewVersion)),
   @Username,'User','Updated to the current Active Product Mix version';
 END TRY
 BEGIN CATCH
  EXEC sys.sp_set_session_context @key=N'OpportunityMixRefreshID',@value=@Previous;
  THROW;
 END CATCH;
 SELECT RowVersion FROM dbo.OpportunityItem WHERE ID=@ID;
END;
GO
