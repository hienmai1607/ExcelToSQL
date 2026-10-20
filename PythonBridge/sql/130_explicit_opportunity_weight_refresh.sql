-- Explicit same-Product reselection refreshes only an unlocked standalone Draft.
-- Existing Opportunity and PCR weights remain frozen unless this command is saved.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER TRIGGER dbo.tr_OpportunityItem_ProductWeightSnapshot
ON dbo.OpportunityItem AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF TRIGGER_NESTLEVEL(OBJECT_ID('dbo.tr_OpportunityItem_ProductWeightSnapshot'))=1
 AND EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON d.ID=i.ID
  WHERE i.ProductID=d.ProductID AND EXISTS(
   SELECT i.ProductNetWeightGrams,i.ProductWeightSnapshotCapturedAt
   EXCEPT SELECT d.ProductNetWeightGrams,d.ProductWeightSnapshotCapturedAt)
  AND (TRY_CONVERT(INT,SESSION_CONTEXT(N'OpportunityWeightRefreshID')) IS NULL
       OR TRY_CONVERT(INT,SESSION_CONTEXT(N'OpportunityWeightRefreshID'))<>i.ID))
  THROW 52982,'Product net weight is a read-only snapshot from Product Master.',1;
 IF NOT EXISTS(SELECT 1 FROM inserted i LEFT JOIN deleted d ON d.ID=i.ID
  WHERE d.ID IS NULL OR d.ProductID<>i.ProductID) RETURN;
 UPDATE item SET ProductNetWeightGrams=p.WeightGrams,
  ProductWeightSnapshotCapturedAt=SYSUTCDATETIME()
 FROM dbo.OpportunityItem item JOIN inserted i ON i.ID=item.ID
 LEFT JOIN deleted d ON d.ID=i.ID JOIN dbo.Product p WITH(HOLDLOCK) ON p.ID=i.ProductID
 WHERE d.ID IS NULL OR d.ProductID<>i.ProductID;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_OpportunityItem_RefreshProductWeight
 @Username NVARCHAR(100),@ID INT,@ExpectedRowVersion VARBINARY(8),@ProductID INT
AS
BEGIN
 SET NOCOUNT ON;
 IF @@TRANCOUNT=0 THROW 52982,'Weight refresh must be part of the Opportunity save transaction.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
  WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope IN('Admin','Opportunity'))
  THROW 52982,'Opportunity edit access is required.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.OpportunityItem i WITH(UPDLOCK,HOLDLOCK)
  JOIN dbo.Opportunity o WITH(HOLDLOCK) ON o.ID=i.OpportunityID
  JOIN dbo.Product p WITH(HOLDLOCK) ON p.ID=i.ProductID
  WHERE i.ID=@ID AND i.RowVersion=@ExpectedRowVersion AND i.ProductID=@ProductID
  AND i.Stage='Draft' AND o.Stage='Draft' AND i.ParentItemID IS NULL
  AND p.Status='Active'
  AND NOT EXISTS(SELECT 1 FROM dbo.OpportunityMixSnapshot ms WHERE ms.ParentItemID=i.ID)
  AND NOT EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem r WITH(HOLDLOCK)
   WHERE r.OpportunityItemID=i.ID AND r.IsOpen=1))
  THROW 52982,'Refresh requires an unchanged standalone Draft item with no open Packaging Request. Refresh the Opportunity.',1;
 DECLARE @Previous SQL_VARIANT=SESSION_CONTEXT(N'OpportunityWeightRefreshID');
 BEGIN TRY
  EXEC sys.sp_set_session_context @key=N'OpportunityWeightRefreshID',@value=@ID;
  UPDATE i SET ProductNetWeightGrams=p.WeightGrams,ProductWeightSnapshotCapturedAt=SYSUTCDATETIME()
  FROM dbo.OpportunityItem i JOIN dbo.Product p WITH(HOLDLOCK) ON p.ID=i.ProductID WHERE i.ID=@ID;
  EXEC sys.sp_set_session_context @key=N'OpportunityWeightRefreshID',@value=@Previous;
 END TRY
 BEGIN CATCH
  EXEC sys.sp_set_session_context @key=N'OpportunityWeightRefreshID',@value=@Previous;
  THROW;
 END CATCH;
 SELECT RowVersion FROM dbo.OpportunityItem WHERE ID=@ID;
END;
GO
