-- After 134. Explicit Opportunity-only net weight edits; no Product/PCR rewrites.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.usp_OpportunityItem_SetNetWeight
 @Username NVARCHAR(100),@ID INT,@ExpectedRowVersion VARBINARY(8),
 @NetWeightGrams DECIMAL(10,2)=NULL,@Refresh BIT=0
AS
BEGIN
 SET NOCOUNT ON;
 IF @@TRANCOUNT=0 THROW 52982,'Net weight must be saved with the Opportunity transaction.',1;
 DECLARE @Actor INT;
 SELECT @Actor=u.ID FROM dbo.Users u
 WHERE u.UserName=@Username AND u.IsActive=1
 AND EXISTS(SELECT 1 FROM dbo.UserAccess a WHERE a.UserID=u.ID AND a.Scope IN('Admin','Opportunity'));
 IF @Actor IS NULL THROW 52982,'Opportunity edit access is required.',1;
 DECLARE @Product INT,@Old DECIMAL(10,2),@Opportunity INT,@Label NVARCHAR(300);
 SELECT @Product=i.ProductID,@Old=i.ProductNetWeightGrams,@Opportunity=i.OpportunityID,@Label=i.ItemDescription
 FROM dbo.OpportunityItem i WITH(UPDLOCK,HOLDLOCK)
 JOIN dbo.Opportunity o WITH(HOLDLOCK) ON o.ID=i.OpportunityID
 WHERE i.ID=@ID AND i.RowVersion=@ExpectedRowVersion AND i.Stage='Draft' AND o.Stage='Draft'
 AND NOT EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem r WITH(HOLDLOCK)
   WHERE r.IsOpen=1 AND (r.OpportunityItemID=i.ID OR EXISTS(
    SELECT 1 FROM dbo.OpportunityItem child WHERE child.ParentItemID=i.ID AND child.ID=r.OpportunityItemID)));
 IF @Product IS NULL THROW 52982,'Net weight requires an unchanged Draft item with no open Packaging Request. Refresh the Opportunity.',1;
 IF @Refresh=1
 BEGIN
  IF @NetWeightGrams IS NOT NULL THROW 52982,'Choose either a net weight or refresh from Product Master.',1;
  SELECT @NetWeightGrams=WeightGrams FROM dbo.Product WITH(HOLDLOCK) WHERE ID=@Product AND Status='Active';
 END;
 IF @NetWeightGrams IS NULL OR @NetWeightGrams<=0
  THROW 52982,'Enter a positive net weight in grams (up to two decimals), or choose an active Product to refresh.',1;
 DECLARE @Previous SQL_VARIANT=SESSION_CONTEXT(N'OpportunityWeightRefreshID');
 BEGIN TRY
  EXEC sys.sp_set_session_context @key=N'OpportunityWeightRefreshID',@value=@ID;
  UPDATE dbo.OpportunityItem
   SET ProductNetWeightGrams=@NetWeightGrams,ProductWeightSnapshotCapturedAt=SYSUTCDATETIME(),
       UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()
   WHERE ID=@ID;
  EXEC sys.sp_set_session_context @key=N'OpportunityWeightRefreshID',@value=@Previous;
  IF @Old IS NULL OR @Old<>@NetWeightGrams
   INSERT dbo.OpportunityChangeLog(EventID,OpportunityID,EntityLevel,ItemID,ItemLabel,Action,FieldName,OldValue,NewValue,ChangedBy,Source,Reason)
   VALUES(COALESCE(TRY_CONVERT(UNIQUEIDENTIFIER,SESSION_CONTEXT(N'OpportunityChangeEvent')),NEWID()),
    @Opportunity,'Item',@ID,@Label,'Update','WeightGrams',CONVERT(NVARCHAR(MAX),@Old),CONVERT(NVARCHAR(MAX),@NetWeightGrams),
    @Username,'User',CASE WHEN @Refresh=1 THEN 'Captured current Product Master weight' ELSE 'Opportunity item net weight override' END);
 END TRY
 BEGIN CATCH
  EXEC sys.sp_set_session_context @key=N'OpportunityWeightRefreshID',@value=@Previous;
  THROW;
 END CATCH;
 SELECT RowVersion FROM dbo.OpportunityItem WHERE ID=@ID;
END;
GO
