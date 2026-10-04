USE [test];
GO
-- After 64. Preserve prior snapshots, add quote context and reusable-reference lineage.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.PkgPricingMaster','OpportunityItemID') IS NULL
 ALTER TABLE dbo.PkgPricingMaster ADD OpportunityItemID INT NULL REFERENCES dbo.OpportunityItem(ID);
IF COL_LENGTH('dbo.PkgPricingMaster','OpportunityID') IS NULL
 ALTER TABLE dbo.PkgPricingMaster ADD OpportunityID INT NULL REFERENCES dbo.Opportunity(ID);
IF COL_LENGTH('dbo.PkgPricingMaster','ProductID') IS NULL
 ALTER TABLE dbo.PkgPricingMaster ADD ProductID INT NULL REFERENCES dbo.Product(ID);
IF COL_LENGTH('dbo.PkgPricingMaster','ProductGradeVersionID') IS NULL
 ALTER TABLE dbo.PkgPricingMaster ADD ProductGradeVersionID INT NULL REFERENCES dbo.ProductGradeVersion(ID);
IF COL_LENGTH('dbo.PkgPricingMaster','ProductMixVersionID') IS NULL
 ALTER TABLE dbo.PkgPricingMaster ADD ProductMixVersionID INT NULL REFERENCES dbo.ProductMixVersion(ID);
IF COL_LENGTH('dbo.PkgPricingMaster','ProductRowVersion') IS NULL
 ALTER TABLE dbo.PkgPricingMaster ADD ProductRowVersion VARBINARY(8) NULL;
IF COL_LENGTH('dbo.PkgPricingMaster','SourcePricingMasterID') IS NULL
 ALTER TABLE dbo.PkgPricingMaster ADD SourcePricingMasterID INT NULL REFERENCES dbo.PkgPricingMaster(ID);
IF COL_LENGTH('dbo.PkgPricingMaster','ContextSnapshotJSON') IS NULL
 ALTER TABLE dbo.PkgPricingMaster ADD ContextSnapshotJSON NVARCHAR(MAX) NULL CHECK(ContextSnapshotJSON IS NULL OR ISJSON(ContextSnapshotJSON)=1);
IF COL_LENGTH('dbo.PkgPricingMaster','SnapshotJSON') IS NULL
 ALTER TABLE dbo.PkgPricingMaster ADD SnapshotJSON NVARCHAR(MAX) NULL CHECK(SnapshotJSON IS NULL OR ISJSON(SnapshotJSON)=1);
COMMIT;
GO
-- Only known historical links are backfilled. Do not invent historical product versions.
UPDATE p SET OpportunityItemID=i.OpportunityItemID,OpportunityID=h.OpportunityID,ProductID=i.ProductID
FROM dbo.PkgPricingMaster p JOIN dbo.PackagingConfigurationRequestItem i ON i.ID=p.RequestItemID
JOIN dbo.PackagingConfigurationRequest h ON h.ID=i.RequestID
WHERE p.OpportunityItemID IS NULL;
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.PkgPricingMaster') AND name='IX_PkgPricingMaster_References')
 CREATE INDEX IX_PkgPricingMaster_References ON dbo.PkgPricingMaster(PackagingOrder,PackagingTypeID,CreatedAt DESC)
 INCLUDE(RequestItemID,ProductID,SourcePricingMasterID);
GO

CREATE OR ALTER PROCEDURE dbo.usp_PkgPricing_Save
 @Username NVARCHAR(100),@ItemID INT,@ExpectedRowVersion VARBINARY(8),@Snapshot NVARCHAR(MAX)
AS
BEGIN
 SET NOCOUNT ON;
 -- Called by the API ONLY after server-side recalculation, in the response transaction.
 DECLARE @Actor INT,@Order VARCHAR(10)=JSON_VALUE(@Snapshot,'$.PackagingOrder'),
  @TypeID INT=TRY_CONVERT(INT,JSON_VALUE(@Snapshot,'$.PackagingTypeID')),
  @OpportunityItem INT,@Opportunity INT,@Product INT,@ProductRV VARBINARY(8),@GradeVersion INT,@MixVersion INT,@Reference INT,
  @TypeName NVARCHAR(100)=JSON_VALUE(@Snapshot,'$.PackagingTypeName'),@ID INT;
 EXEC dbo.usp_PkgPricing_ItemAuthorize @Username,@ItemID,1,@ExpectedRowVersion;
 SELECT @Actor=ID FROM dbo.Users WHERE UserName=@Username AND IsActive=1;
 IF ISJSON(@Snapshot)<>1 OR @Order NOT IN('Primary','Secondary') OR @TypeID IS NULL
  THROW 51111,'Invalid pricing snapshot.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.PackagingType WHERE ID=@TypeID AND Status='Active' AND PackagingOrder=@Order AND PackagingType=@TypeName)
  THROW 51111,'Choose an active Packaging Type in the matching order.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ItemID AND
  CASE @Order WHEN 'Primary' THEN FirstPMType ELSE SecondPMType END=@TypeName)
  THROW 51111,'Calculator type must match the saved response type.',1;
 SELECT @OpportunityItem=i.OpportunityItemID,@Opportunity=h.OpportunityID,@Product=i.ProductID,@ProductRV=product.RowVersion
 FROM dbo.PackagingConfigurationRequestItem i JOIN dbo.PackagingConfigurationRequest h ON h.ID=i.RequestID
 JOIN dbo.Product product ON product.ID=i.ProductID WHERE i.ID=@ItemID;
 SET @GradeVersion=TRY_CONVERT(INT,JSON_VALUE(@Snapshot,'$.Context.ProductGradeVersion.ID'));
 SET @MixVersion=TRY_CONVERT(INT,JSON_VALUE(@Snapshot,'$.Context.ProductMixVersion.ID'));
 SET @Reference=TRY_CONVERT(INT,JSON_VALUE(@Snapshot,'$.InputJSON.ReferencePricingMasterID'));
 IF @Reference IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.PkgPricingMaster WHERE ID=@Reference AND PackagingOrder=@Order)
  THROW 51111,'Invalid pricing reference.',1;
 IF NOT EXISTS(SELECT 1 FROM OPENJSON(@Snapshot,'$.components'))
  THROW 51111,'Select at least one component.',1;
 UPDATE dbo.PkgPricingMaster SET IsCurrent=0 WHERE RequestItemID=@ItemID AND PackagingOrder=@Order AND IsCurrent=1;
 INSERT dbo.PkgPricingMaster(RequestItemID,PackagingOrder,PackagingTypeID,PackagingTypeName,AsOfDate,FinalMOQ,UnitPrice,CurrencyID,CurrencyCode,UnitUSDPrice,Fingerprint,InputJSON,CreatedBy,OpportunityItemID,OpportunityID,ProductID,ProductRowVersion,ProductGradeVersionID,ProductMixVersionID,SourcePricingMasterID,ContextSnapshotJSON,SnapshotJSON)
 SELECT @ItemID,@Order,@TypeID,@TypeName,AsOfDate,FinalMOQ,UnitPrice,CurrencyID,CurrencyCode,UnitUSDPrice,Fingerprint,InputJSON,@Actor,@OpportunityItem,@Opportunity,@Product,@ProductRV,@GradeVersion,@MixVersion,@Reference,JSON_QUERY(@Snapshot,'$.Context'),@Snapshot
 FROM OPENJSON(@Snapshot) WITH(AsOfDate DATE,FinalMOQ DECIMAL(18,0),UnitPrice DECIMAL(28,9),CurrencyID INT,CurrencyCode NVARCHAR(20),UnitUSDPrice DECIMAL(28,9),Fingerprint CHAR(64),InputJSON NVARCHAR(MAX) AS JSON);
 SET @ID=SCOPE_IDENTITY();
 INSERT dbo.PkgPricingComponent(PricingMasterID,LineNumber,MaterialID,PackagingPriceID,DimensionID,QuantityPerProduct,AreaPerMaterial,BaseUnitsPerPriceUnit,PriceUnitsPerProduct,VendorMOQ,ProductMOQ,ProductUnitPrice,CurrencyID,ProductUnitUSDPrice,SnapshotJSON)
 SELECT @ID,CONVERT(INT,j.[key])+1,c.MaterialID,c.PriceID,c.DimensionID,c.Quantity,c.Area,c.Factor,c.Consumption,c.VendorMOQ,c.ProductMOQ,c.ProductUnitPrice,c.CurrencyID,c.ProductUnitUSDPrice,j.value
 FROM OPENJSON(@Snapshot,'$.components') j CROSS APPLY OPENJSON(j.value) WITH(MaterialID INT,PriceID INT,DimensionID INT,Quantity DECIMAL(18,6),Area DECIMAL(28,9),Factor DECIMAL(24,9),Consumption DECIMAL(28,12),VendorMOQ DECIMAL(18,4),ProductMOQ DECIMAL(18,0),ProductUnitPrice DECIMAL(28,9),CurrencyID INT,ProductUnitUSDPrice DECIMAL(28,9)) c;
 -- Keep a lightweight reference in the request's normal change log.
 INSERT dbo.PackagingRequestChangeLog(EventID,RequestID,EntityLevel,ItemID,ItemLabel,Action,FieldName,OldValue,NewValue,ChangedBy,Source,IsResponse)
 SELECT NEWID(),RequestID,'Item',ID,ProductCode,'Update',@Order+'Pricing',NULL,
  CONCAT('Pricing #',@ID,': MOQ ',JSON_VALUE(@Snapshot,'$.FinalMOQ'),', unit price ',JSON_VALUE(@Snapshot,'$.UnitPrice'),' ',JSON_VALUE(@Snapshot,'$.CurrencyCode')),@Username,'User',1
 FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ItemID;
END;
GO

