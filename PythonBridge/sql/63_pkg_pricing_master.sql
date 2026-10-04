USE [test];
GO
-- After 62. Web calculator snapshots; existing prices, Layout and Excel are unchanged.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF OBJECT_ID('dbo.PkgPricingMaster','U') IS NULL
BEGIN
 CREATE TABLE dbo.PkgPricingMaster(
  ID INT IDENTITY PRIMARY KEY,
  RequestItemID INT NOT NULL REFERENCES dbo.PackagingConfigurationRequestItem(ID),
  PackagingOrder VARCHAR(10) NOT NULL CHECK(PackagingOrder IN('Primary','Secondary')),
  PackagingTypeID INT NOT NULL REFERENCES dbo.PackagingType(ID),
  PackagingTypeName NVARCHAR(100) NOT NULL,
  AsOfDate DATE NOT NULL,
  FinalMOQ DECIMAL(18,0) NOT NULL CHECK(FinalMOQ>=0),
  UnitPrice DECIMAL(28,9) NOT NULL CHECK(UnitPrice>=0),
  CurrencyID INT NOT NULL REFERENCES dbo.Currency(ID),
  CurrencyCode NVARCHAR(20) NOT NULL,
  UnitUSDPrice DECIMAL(28,9) NULL CHECK(UnitUSDPrice>=0),
  Fingerprint CHAR(64) NOT NULL,
  InputJSON NVARCHAR(MAX) NOT NULL CHECK(ISJSON(InputJSON)=1),
  IsCurrent BIT NOT NULL DEFAULT(1),
  CreatedAt DATETIME2(7) NOT NULL DEFAULT(SYSUTCDATETIME()),
  CreatedBy INT NOT NULL REFERENCES dbo.Users(ID),
  RowVersion ROWVERSION NOT NULL
 );
 CREATE UNIQUE INDEX UX_PkgPricingMaster_Current ON dbo.PkgPricingMaster(RequestItemID,PackagingOrder) WHERE IsCurrent=1;
 CREATE INDEX IX_PkgPricingMaster_History ON dbo.PkgPricingMaster(RequestItemID,PackagingOrder,ID DESC);
END;
IF OBJECT_ID('dbo.PkgPricingComponent','U') IS NULL
BEGIN
 CREATE TABLE dbo.PkgPricingComponent(
  ID INT IDENTITY PRIMARY KEY,
  PricingMasterID INT NOT NULL REFERENCES dbo.PkgPricingMaster(ID),
  LineNumber INT NOT NULL,
  MaterialID INT NOT NULL REFERENCES dbo.PackagingMaterial(ID),
  PackagingPriceID INT NOT NULL REFERENCES dbo.PackagingPrice(ID),
  DimensionID INT NULL REFERENCES dbo.PackagingDimension(ID),
  QuantityPerProduct DECIMAL(18,6) NOT NULL CHECK(QuantityPerProduct>0),
  AreaPerMaterial DECIMAL(28,9) NULL CHECK(AreaPerMaterial>0),
  BaseUnitsPerPriceUnit DECIMAL(24,9) NOT NULL CHECK(BaseUnitsPerPriceUnit>0),
  PriceUnitsPerProduct DECIMAL(28,12) NOT NULL CHECK(PriceUnitsPerProduct>0),
  VendorMOQ DECIMAL(18,4) NOT NULL CHECK(VendorMOQ>=0),
  ProductMOQ DECIMAL(18,0) NOT NULL CHECK(ProductMOQ>=0),
  ProductUnitPrice DECIMAL(28,9) NOT NULL CHECK(ProductUnitPrice>=0),
  CurrencyID INT NOT NULL REFERENCES dbo.Currency(ID),
  ProductUnitUSDPrice DECIMAL(28,9) NULL CHECK(ProductUnitUSDPrice>=0),
  SnapshotJSON NVARCHAR(MAX) NOT NULL CHECK(ISJSON(SnapshotJSON)=1),
  CONSTRAINT UQ_PkgPricingComponent_Line UNIQUE(PricingMasterID,LineNumber)
 );
END;
COMMIT;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PkgPricing_ItemAuthorize
 @Username NVARCHAR(100),@ItemID INT,@Write BIT=0,@ExpectedRowVersion VARBINARY(8)=NULL
AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @Actor INT,@Admin BIT=0;
 EXEC dbo.usp_Packaging_Authorize @Username,'MasterRead',@Actor OUTPUT;
 IF NOT EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ItemID)
  THROW 51111,'Packaging request item was not found.',1;
 IF @Write=1
 BEGIN
  IF @@TRANCOUNT=0 THROW 51111,'Pricing saves require a document transaction.',1;
  EXEC dbo.usp_Packaging_Authorize @Username,'Maintain',@Actor OUTPUT;
  IF EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope='Admin') SET @Admin=1;
  IF NOT EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ItemID AND RowVersion=@ExpectedRowVersion)
   THROW 51108,'Request item changed. Refresh before saving pricing.',1;
  IF NOT EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ItemID AND Stage IN('Assigned','Working','Returned') AND (@Admin=1 OR PICUserID=@Actor))
   THROW 51102,'Only the assigned PIC or Admin can save pricing on an unlocked item.',1;
 END;
 SELECT ID,Stage,PICUserID,FirstPMType,SecondPMType,RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ItemID;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PkgPricing_Save
 @Username NVARCHAR(100),@ItemID INT,@ExpectedRowVersion VARBINARY(8),@Snapshot NVARCHAR(MAX)
AS
BEGIN
 SET NOCOUNT ON;
 -- Called by the API ONLY after server-side recalculation, in the response transaction.
 DECLARE @Actor INT,@Order VARCHAR(10)=JSON_VALUE(@Snapshot,'$.PackagingOrder'),
  @TypeID INT=TRY_CONVERT(INT,JSON_VALUE(@Snapshot,'$.PackagingTypeID')),
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
 IF NOT EXISTS(SELECT 1 FROM OPENJSON(@Snapshot,'$.components'))
  THROW 51111,'Select at least one component.',1;
 UPDATE dbo.PkgPricingMaster SET IsCurrent=0 WHERE RequestItemID=@ItemID AND PackagingOrder=@Order AND IsCurrent=1;
 INSERT dbo.PkgPricingMaster(RequestItemID,PackagingOrder,PackagingTypeID,PackagingTypeName,AsOfDate,FinalMOQ,UnitPrice,CurrencyID,CurrencyCode,UnitUSDPrice,Fingerprint,InputJSON,CreatedBy)
 SELECT @ItemID,@Order,@TypeID,@TypeName,AsOfDate,FinalMOQ,UnitPrice,CurrencyID,CurrencyCode,UnitUSDPrice,Fingerprint,InputJSON,@Actor
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
