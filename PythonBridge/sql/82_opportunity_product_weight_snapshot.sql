USE [test];
GO
-- After 81. Opportunity product weight is a read-only snapshot, not live master data.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.OpportunityItem','ProductNetWeightGrams') IS NULL
 ALTER TABLE dbo.OpportunityItem ADD ProductNetWeightGrams DECIMAL(10,2) NULL,
  ProductWeightSnapshotCapturedAt DATETIME2(7) NULL;
GO
-- Legacy items use their latest matching captured request weight when available;
-- otherwise capture today's Product Master weight once. Never rewrite requests.
UPDATE i SET ProductNetWeightGrams=COALESCE(r.WeightGrams,p.WeightGrams),
 ProductWeightSnapshotCapturedAt=COALESCE(r.SnapshotCapturedAt,SYSUTCDATETIME())
FROM dbo.OpportunityItem i JOIN dbo.Product p ON p.ID=i.ProductID
OUTER APPLY(SELECT TOP(1) ri.WeightGrams,ri.SnapshotCapturedAt
 FROM dbo.PackagingConfigurationRequestItem ri
 WHERE ri.OpportunityItemID=i.ID AND ri.ProductID=i.ProductID AND ri.WeightGrams IS NOT NULL
 ORDER BY ri.ID DESC) r
WHERE i.ProductWeightSnapshotCapturedAt IS NULL;
GO
CREATE OR ALTER TRIGGER dbo.tr_OpportunityItem_ProductWeightSnapshot
ON dbo.OpportunityItem AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 -- Only choosing another product recaptures weight. Unrelated edits preserve it.
 -- Nested mix child INSERTs must also capture; only our internal update skips the guard.
 IF TRIGGER_NESTLEVEL(OBJECT_ID('dbo.tr_OpportunityItem_ProductWeightSnapshot'))=1
 AND EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON d.ID=i.ID
  WHERE i.ProductID=d.ProductID AND EXISTS(
   SELECT i.ProductNetWeightGrams,i.ProductWeightSnapshotCapturedAt
   EXCEPT SELECT d.ProductNetWeightGrams,d.ProductWeightSnapshotCapturedAt))
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
-- Item description is retained for old clients/history, but no longer required.
-- Missing values default on create and preserve the previous label on same-product edits.
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_Opportunity_HeaderDetail_Batch_AuditImplementation'));
IF @D IS NULL THROW 52982,'Opportunity batch implementation is missing.',1;
IF CHARINDEX(N'COALESCE(NULLIF(r.ItemDescription',@D)=0 BEGIN
 DECLARE @Old NVARCHAR(MAX)=N'SELECT RowNum,Command,ID,OpportunityNumber,ProductID,ItemDescription,AnnualUnit,EstPctAwarded,ShelfPrice,''Draft'',RowVersionB64 FROM @ItemRows;';
 IF CHARINDEX(@Old,@D)=0 THROW 52982,'Unexpected Opportunity safe item mapping.',1;
 SET @D=REPLACE(@D,@Old,N'SELECT r.RowNum,r.Command,r.ID,r.OpportunityNumber,r.ProductID,
 COALESCE(NULLIF(r.ItemDescription,N''''),CASE WHEN oi.ProductID=r.ProductID THEN oi.ItemDescription END,p.ProductName),
 r.AnnualUnit,r.EstPctAwarded,r.ShelfPrice,''Draft'',r.RowVersionB64
 FROM @ItemRows r LEFT JOIN dbo.OpportunityItem oi ON oi.ID=r.ID
 LEFT JOIN dbo.Product p ON p.ID=r.ProductID;');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityProductLookup_Read'));
IF @D IS NULL THROW 52982,'Product lookup is missing.',1;
IF CHARINDEX(N'p.WeightGrams',@D)=0 BEGIN
 IF CHARINDEX(N'p.ProductName,p.ShelfLifeDays',@D)=0 THROW 52982,'Unexpected product lookup.',1;
 SET @D=REPLACE(@D,N'p.ProductName,p.ShelfLifeDays',N'p.ProductName,p.WeightGrams,p.ShelfLifeDays');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
-- Retained direct item reader also exposes the same snapshot.
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityItem_ReadByOpportunity'));
IF @D IS NULL THROW 52982,'Opportunity item reader is missing.',1;
IF CHARINDEX(N'ProductNetWeightGrams',@D)=0 BEGIN
 IF CHARINDEX(N'oi.ItemDescription, oi.AnnualUnit',@D)=0 THROW 52982,'Unexpected item reader.',1;
 SET @D=REPLACE(@D,N'oi.ItemDescription, oi.AnnualUnit',N'oi.ProductNetWeightGrams AS WeightGrams, oi.ItemDescription, oi.AnnualUnit');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE    PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
-- New Packaging Requests inherit the opportunity weight captured on product selection.
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingRequest_Create_AuditImplementation'));
IF @D IS NULL THROW 52982,'Packaging Request creation implementation is missing.',1;
IF CHARINDEX(N'i.ProductNetWeightGrams',@D)=0 BEGIN
 IF CHARINDEX(N'@ActorID,p.WeightGrams,p.Category',@D)=0 THROW 52982,'Unexpected Packaging Request weight mapping.',1;
 SET @D=REPLACE(@D,N'@ActorID,p.WeightGrams,p.Category',N'@ActorID,i.ProductNetWeightGrams,p.Category');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
COMMIT;
GO
