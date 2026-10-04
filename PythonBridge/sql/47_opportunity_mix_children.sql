USE [test];
GO
-- After 46. Real child Opportunity items, with immutable mix membership.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
IF COL_LENGTH('dbo.OpportunityItem','ParentItemID') IS NULL
BEGIN
 ALTER TABLE dbo.OpportunityItem ADD ParentItemID INT NULL,
  MixUnitQuantity DECIMAL(12,4) NULL, MixChildNumber INT NULL;
END;
GO
IF OBJECT_ID('dbo.FK_OpportunityItem_MixParent','F') IS NULL
 ALTER TABLE dbo.OpportunityItem ADD CONSTRAINT FK_OpportunityItem_MixParent
  FOREIGN KEY(ParentItemID) REFERENCES dbo.OpportunityItem(ID);
IF OBJECT_ID('dbo.CK_OpportunityItem_MixChild','C') IS NULL
 ALTER TABLE dbo.OpportunityItem ADD CONSTRAINT CK_OpportunityItem_MixChild
  CHECK((ParentItemID IS NULL AND MixUnitQuantity IS NULL AND MixChildNumber IS NULL)
   OR (ParentItemID IS NOT NULL AND ParentItemID<>ID AND MixUnitQuantity IS NOT NULL
    AND MixChildNumber IS NOT NULL AND MixUnitQuantity>0 AND MixChildNumber>0));
IF EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.OpportunityItem') AND name='UX_OpportunityItem_MixChild' AND has_filter=1)
 DROP INDEX UX_OpportunityItem_MixChild ON dbo.OpportunityItem;
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.OpportunityItem') AND name='UX_OpportunityItem_MixChild')
 CREATE UNIQUE INDEX UX_OpportunityItem_MixChild
  ON dbo.OpportunityItem(ParentItemID,ProductID,OpportunityID);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.OpportunityItem') AND name='IX_OpportunityItem_MixTree')
 CREATE INDEX IX_OpportunityItem_MixTree ON dbo.OpportunityItem(OpportunityID,ParentItemID,ID);
GO
CREATE OR ALTER PROCEDURE dbo.usp_OpportunityMixLookup_Read @Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
  WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope IN('Admin','Opportunity'))
  THROW 51042,'Opportunity access is required for this action.',1;
 SELECT v.ProductID AS ParentProductID,v.ID AS MixVersionID,m.ProductID,
  m.UnitQuantity,p.ProductCode,p.ProductName,p.WeightGrams,p.Category
 FROM dbo.ProductMixVersion v JOIN dbo.ProductMixItem m ON m.VersionID=v.ID
 JOIN dbo.Product parent ON parent.ID=v.ProductID AND parent.Status='Active'
 JOIN dbo.Customer customer ON customer.ID=parent.CustomerID AND customer.Status='Active'
 JOIN dbo.Product p ON p.ID=m.ProductID
 WHERE v.Status='Active' ORDER BY v.ProductID,p.ProductCode,p.ID;
END;
GO
ALTER TABLE dbo.OpportunityItem ALTER COLUMN AnnualUnit DECIMAL(18,4) NOT NULL;
ALTER TABLE dbo.PackagingConfigurationRequestItem ALTER COLUMN AnnualUnit DECIMAL(18,4) NOT NULL;
GO
IF OBJECT_ID('dbo.UQ_OpportunityItem_OppProduct','UQ') IS NOT NULL
 ALTER TABLE dbo.OpportunityItem DROP CONSTRAINT UQ_OpportunityItem_OppProduct;
-- A normal unique index treats NULL as the root discriminator and remains
-- compatible with legacy stored procedures compiled with QUOTED_IDENTIFIER OFF.
IF EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.OpportunityItem') AND name='UX_OpportunityItem_RootProduct' AND has_filter=1)
 DROP INDEX UX_OpportunityItem_RootProduct ON dbo.OpportunityItem;
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.OpportunityItem') AND name='UX_OpportunityItem_RootProduct')
 CREATE UNIQUE INDEX UX_OpportunityItem_RootProduct ON dbo.OpportunityItem(OpportunityID,ProductID,ParentItemID);
GO
IF OBJECT_ID('dbo.OpportunityMixSnapshot','U') IS NULL
 CREATE TABLE dbo.OpportunityMixSnapshot(
  ParentItemID INT NOT NULL PRIMARY KEY REFERENCES dbo.OpportunityItem(ID),
  MixVersionID INT NOT NULL REFERENCES dbo.ProductMixVersion(ID),
  CapturedAt DATETIME2(7) NOT NULL DEFAULT SYSUTCDATETIME(),
  Origin VARCHAR(10) NOT NULL DEFAULT 'Save' CHECK(Origin IN('Save','Migration')));
GO
CREATE OR ALTER TRIGGER dbo.tr_OpportunityMixSnapshot_Immutable
ON dbo.OpportunityMixSnapshot AFTER UPDATE AS
BEGIN
 THROW 52960,'Saved Opportunity mix snapshots are immutable.',1;
END;
GO
CREATE OR ALTER TRIGGER dbo.tr_OpportunityItem_MixChildren
ON dbo.OpportunityItem AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 -- Membership and the multiplier are snapshots, not editable item fields.
 IF EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON d.ID=i.ID
  WHERE ISNULL(i.ParentItemID,0)<>ISNULL(d.ParentItemID,0)
   OR ISNULL(i.MixUnitQuantity,0)<>ISNULL(d.MixUnitQuantity,0)
   OR ISNULL(i.MixChildNumber,0)<>ISNULL(d.MixChildNumber,0)
   OR (d.ParentItemID IS NOT NULL AND
    (i.ProductID<>d.ProductID OR i.OpportunityID<>d.OpportunityID OR i.ItemDescription<>d.ItemDescription)))
  THROW 52960,'Mix child Product, description, parent and quantity multiplier are read-only.',1;
 IF EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON d.ID=i.ID
  JOIN dbo.OpportunityMixSnapshot s ON s.ParentItemID=i.ID
  WHERE i.ProductID<>d.ProductID OR i.OpportunityID<>d.OpportunityID)
  THROW 52960,'A saved mix composition cannot change Product. Create a new Opportunity item.',1;
 IF EXISTS(SELECT 1 FROM inserted i JOIN dbo.OpportunityItem p ON p.ID=i.ParentItemID
  LEFT JOIN dbo.OpportunityMixSnapshot s ON s.ParentItemID=p.ID
  LEFT JOIN dbo.ProductMixItem m ON m.VersionID=s.MixVersionID AND m.ProductID=i.ProductID
  WHERE p.ParentItemID IS NOT NULL OR p.OpportunityID<>i.OpportunityID OR m.ProductID IS NULL
   OR m.UnitQuantity<>i.MixUnitQuantity OR i.AnnualUnit<>p.AnnualUnit*i.MixUnitQuantity
   OR i.EstPctAwarded IS NOT NULL OR i.ShelfPrice IS NOT NULL)
  THROW 52960,'Mix child units are calculated from the parent; award and shelf price belong to the parent.',1;
 IF EXISTS(SELECT 1 FROM inserted i WHERE i.ParentItemID IS NULL
  AND (i.AnnualUnit<0 OR i.AnnualUnit<>FLOOR(i.AnnualUnit) OR i.AnnualUnit>2147483647))
  THROW 52960,'Parent annual units must be a whole number from 0 to 2,147,483,647.',1;
 IF EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON d.ID=i.ID
  JOIN dbo.OpportunityItem c WITH(UPDLOCK,HOLDLOCK) ON c.ParentItemID=i.ID
  WHERE i.AnnualUnit<>d.AnnualUnit AND (c.Stage<>'Draft' OR EXISTS(
   SELECT 1 FROM dbo.PackagingConfigurationRequestItem r WITH(UPDLOCK,HOLDLOCK)
   WHERE r.OpportunityItemID=c.ID AND r.IsOpen=1)))
  THROW 52960,'A mix child is processing. Its parent annual units cannot change.',1;
 -- Only a saved Active version is copied. Subsequent master activation has no effect.
 INSERT dbo.OpportunityMixSnapshot(ParentItemID,MixVersionID,Origin)
 SELECT i.ID,v.ID,CASE WHEN SESSION_CONTEXT(N'OpportunityMixMigration')=1 THEN 'Migration' ELSE 'Save' END
 FROM inserted i JOIN dbo.Product p WITH(UPDLOCK,HOLDLOCK) ON p.ID=i.ProductID AND p.IsMix=1
 JOIN dbo.ProductMixVersion v WITH(UPDLOCK,HOLDLOCK) ON v.ProductID=p.ID AND v.Status='Active'
 WHERE i.ParentItemID IS NULL AND i.Stage='Draft'
 AND NOT EXISTS(SELECT 1 FROM dbo.OpportunityMixSnapshot s WHERE s.ParentItemID=i.ID)
 AND NOT EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem r WHERE r.OpportunityItemID=i.ID);
 IF (SELECT COUNT(*) FROM dbo.OpportunityMixSnapshot s JOIN inserted i ON i.ID=s.ParentItemID
  JOIN dbo.ProductMixItem m ON m.VersionID=s.MixVersionID
  WHERE NOT EXISTS(SELECT 1 FROM dbo.OpportunityItem c WHERE c.ParentItemID=i.ID))>10000
  THROW 52960,'A save may generate at most 10000 mix child items.',1;
 IF EXISTS(SELECT 1 FROM inserted i JOIN dbo.OpportunityMixSnapshot s ON s.ParentItemID=i.ID
  JOIN dbo.ProductMixItem m ON m.VersionID=s.MixVersionID
  WHERE TRY_CONVERT(DECIMAL(18,4),i.AnnualUnit*m.UnitQuantity) IS NULL)
  THROW 52960,'Calculated mix child Annual units exceed the supported range.',1;
 INSERT dbo.OpportunityItem(OpportunityID,ProductID,ItemDescription,AnnualUnit,Stage,CreatedBy,
  ParentItemID,MixUnitQuantity,MixChildNumber)
 SELECT i.OpportunityID,m.ProductID,p.ProductName,CONVERT(DECIMAL(18,4),i.AnnualUnit*m.UnitQuantity),
  'Draft',i.CreatedBy,i.ID,m.UnitQuantity,
  ROW_NUMBER() OVER(PARTITION BY i.ID ORDER BY p.ProductCode,p.ID)
 FROM inserted i JOIN dbo.OpportunityMixSnapshot s ON s.ParentItemID=i.ID
 JOIN dbo.ProductMixItem m ON m.VersionID=s.MixVersionID JOIN dbo.Product p ON p.ID=m.ProductID
 WHERE NOT EXISTS(SELECT 1 FROM dbo.OpportunityItem c WHERE c.ParentItemID=i.ID);
 UPDATE c SET AnnualUnit=CONVERT(DECIMAL(18,4),i.AnnualUnit*c.MixUnitQuantity),
  UpdatedAt=SYSUTCDATETIME(),UpdatedBy=i.UpdatedBy
 FROM dbo.OpportunityItem c JOIN inserted i ON i.ID=c.ParentItemID JOIN deleted d ON d.ID=i.ID
 WHERE i.AnnualUnit<>d.AnnualUnit;
END;
GO
-- SQL Server cannot cascade a self-referencing FK. Delete the tree atomically.
CREATE OR ALTER TRIGGER dbo.tr_OpportunityItem_MixDelete
ON dbo.OpportunityItem INSTEAD OF DELETE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM deleted c WHERE c.ParentItemID IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM deleted p WHERE p.ID=c.ParentItemID))
  THROW 52960,'Mix children cannot be removed individually. Remove their parent item.',1;
 DELETE c FROM dbo.OpportunityItem c JOIN deleted p ON c.ParentItemID=p.ID;
 DELETE s FROM dbo.OpportunityMixSnapshot s JOIN deleted p ON p.ID=s.ParentItemID;
 DELETE i FROM dbo.OpportunityItem i JOIN deleted d ON i.ID=d.ID;
END;
GO
-- Backfill only editable mixes which have never had a Packaging Request.
-- This is explicitly today's composition, not an invented historical snapshot.
EXEC sys.sp_set_session_context N'OpportunityMixMigration',1;
BEGIN TRY
 UPDATE i SET ProductID=i.ProductID FROM dbo.OpportunityItem i
 JOIN dbo.Opportunity o ON o.ID=i.OpportunityID AND o.Stage='Draft'
 JOIN dbo.Product p ON p.ID=i.ProductID AND p.IsMix=1
 WHERE i.ParentItemID IS NULL AND i.Stage='Draft'
 AND NOT EXISTS(SELECT 1 FROM dbo.OpportunityMixSnapshot s WHERE s.ParentItemID=i.ID)
 AND NOT EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem r WHERE r.OpportunityItemID=i.ID);
 EXEC sys.sp_set_session_context N'OpportunityMixMigration',NULL;
END TRY
BEGIN CATCH
 EXEC sys.sp_set_session_context N'OpportunityMixMigration',NULL;
 THROW;
END CATCH;
GO
-- Typed scalar adapter avoids ODBC metadata discovery on a DECLARE-TVP batch.
-- The established Create procedure still owns authorization, locks and snapshots.
CREATE OR ALTER PROCEDURE dbo.usp_PackagingRequest_CreateJson
 @ItemsJson NVARCHAR(MAX),@Username NVARCHAR(100),@OpportunityID INT,
 @ExpectedRowVersion VARBINARY(8),@CreationKey UNIQUEIDENTIFIER,
 @ResponseDue DATE,@RequestNotes NVARCHAR(1000)=NULL
AS
BEGIN
 SET NOCOUNT ON;
 IF ISJSON(@ItemsJson)<>1 THROW 51121,'Invalid Packaging item selection.',1;
 DECLARE @Items dbo.PackagingRequestSelectionType;
 INSERT @Items(OpportunityItemID,ExpectedRowVersion,PackagingRequirement)
 SELECT OpportunityItemID,CONVERT(VARBINARY(8),ExpectedRowVersion,1),PackagingRequirement
 FROM OPENJSON(@ItemsJson) WITH(OpportunityItemID INT,ExpectedRowVersion VARCHAR(18),
  PackagingRequirement NVARCHAR(1000));
 EXEC dbo.usp_PackagingRequest_Create @Username,@OpportunityID,@ExpectedRowVersion,
  @CreationKey,@ResponseDue,@Items,@RequestNotes;
END;
GO
