USE [test]
GO
-- Apply together with migration 23 and the matching API/webapp release.
-- Original TVPs stay unchanged; V2 types reserve the extended Excel contract.
-- Existing records stay NULL; no invented categories, rates or cost conversions.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
GO
IF OBJECT_ID(N'dbo.PackagingConfigurationRequestItem',N'U') IS NULL
 OR OBJECT_ID(N'dbo.OpportunityChangeLog',N'U') IS NULL
 THROW 52950,'Apply Packaging migrations 13-20 and Opportunity change log 21 first.',1;
GO
IF COL_LENGTH(N'dbo.Product',N'Category') IS NULL
 ALTER TABLE dbo.Product ADD Category NVARCHAR(100) NULL;
GO
IF COL_LENGTH(N'dbo.Product',N'Grade') IS NULL
 ALTER TABLE dbo.Product ADD Grade NVARCHAR(100) NULL;
GO
IF COL_LENGTH(N'dbo.Product',N'MixRatioPct') IS NULL
 ALTER TABLE dbo.Product ADD MixRatioPct DECIMAL(5,2) NULL;
GO
IF COL_LENGTH(N'dbo.Opportunity',N'CurrencyID') IS NULL
 ALTER TABLE dbo.Opportunity ADD CurrencyID INT NULL;
GO
IF COL_LENGTH(N'dbo.Opportunity',N'ExchangeRateToVND') IS NULL
 ALTER TABLE dbo.Opportunity ADD ExchangeRateToVND DECIMAL(19,6) NULL;
GO
IF COL_LENGTH(N'dbo.OpportunityItem',N'PalletSize') IS NULL
 ALTER TABLE dbo.OpportunityItem ADD PalletSize NVARCHAR(100) NULL;
GO
IF COL_LENGTH(N'dbo.OpportunityItem',N'PalletStacking') IS NULL
 ALTER TABLE dbo.OpportunityItem ADD PalletStacking NVARCHAR(100) NULL;
GO
IF COL_LENGTH(N'dbo.OpportunityItem',N'MaxPalletHeightM') IS NULL
 ALTER TABLE dbo.OpportunityItem ADD MaxPalletHeightM DECIMAL(9,3) NULL;
GO
IF COL_LENGTH(N'dbo.OpportunityItem',N'ContainerRequest') IS NULL
 ALTER TABLE dbo.OpportunityItem ADD ContainerRequest NVARCHAR(200) NULL;
GO
IF COL_LENGTH(N'dbo.OpportunityItem',N'ConfigurationRequest') IS NULL
 ALTER TABLE dbo.OpportunityItem ADD ConfigurationRequest NVARCHAR(500) NULL;
GO
IF COL_LENGTH(N'dbo.OpportunityItem',N'PackagingType') IS NULL
 ALTER TABLE dbo.OpportunityItem ADD PackagingType NVARCHAR(100) NULL;
GO
IF COL_LENGTH(N'dbo.OpportunityItem',N'RecyclableRequirement') IS NULL
 ALTER TABLE dbo.OpportunityItem ADD RecyclableRequirement NVARCHAR(200) NULL;
GO
IF COL_LENGTH(N'dbo.OpportunityItem',N'RecycledContent') IS NULL
 ALTER TABLE dbo.OpportunityItem ADD RecycledContent NVARCHAR(200) NULL;
GO
IF COL_LENGTH(N'dbo.OpportunityItem',N'Transparency') IS NULL
 ALTER TABLE dbo.OpportunityItem ADD Transparency NVARCHAR(100) NULL;
GO
IF COL_LENGTH(N'dbo.OpportunityItem',N'MetalizedAluminum') IS NULL
 ALTER TABLE dbo.OpportunityItem ADD MetalizedAluminum NVARCHAR(100) NULL;
GO
IF COL_LENGTH(N'dbo.OpportunityItem',N'BarrierRequirement') IS NULL
 ALTER TABLE dbo.OpportunityItem ADD BarrierRequirement NVARCHAR(500) NULL;
GO
IF COL_LENGTH(N'dbo.OpportunityItem',N'ShelfLifeDays') IS NULL
 ALTER TABLE dbo.OpportunityItem ADD ShelfLifeDays INT NULL;
GO
IF COL_LENGTH(N'dbo.OpportunityItem',N'SpecialComments') IS NULL
 ALTER TABLE dbo.OpportunityItem ADD SpecialComments NVARCHAR(1000) NULL;
GO
IF COL_LENGTH(N'dbo.PackagingConfigurationRequestItem',N'FirstPMType') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD FirstPMType NVARCHAR(100) NULL;
GO
IF COL_LENGTH(N'dbo.PackagingConfigurationRequestItem',N'SecondPMType') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD SecondPMType NVARCHAR(100) NULL;
GO
IF COL_LENGTH(N'dbo.PackagingConfigurationRequestItem',N'UnitsPerCarton') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD UnitsPerCarton INT NULL;
GO
IF COL_LENGTH(N'dbo.PackagingConfigurationRequestItem',N'PackagingDescription') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD PackagingDescription NVARCHAR(500) NULL;
GO
IF COL_LENGTH(N'dbo.PackagingConfigurationRequestItem',N'FirstPMMOQ') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD FirstPMMOQ DECIMAL(18,4) NULL;
GO
IF COL_LENGTH(N'dbo.PackagingConfigurationRequestItem',N'SecondPMMOQ') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD SecondPMMOQ DECIMAL(18,4) NULL;
GO
IF COL_LENGTH(N'dbo.PackagingConfigurationRequestItem',N'PalletType') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD PalletType NVARCHAR(100) NULL;
GO
IF COL_LENGTH(N'dbo.PackagingConfigurationRequestItem',N'CartonsPerLayer') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD CartonsPerLayer INT NULL;
GO
IF COL_LENGTH(N'dbo.PackagingConfigurationRequestItem',N'LayersPerPallet') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD LayersPerPallet INT NULL;
GO
IF COL_LENGTH(N'dbo.PackagingConfigurationRequestItem',N'PacksPerPallet') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD PacksPerPallet INT NULL;
GO
IF COL_LENGTH(N'dbo.PackagingConfigurationRequestItem',N'CartonsPerContainer') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD CartonsPerContainer INT NULL;
GO

IF OBJECT_ID(N'dbo.FK_Opportunity_Currency',N'F') IS NULL
 ALTER TABLE dbo.Opportunity WITH CHECK ADD CONSTRAINT FK_Opportunity_Currency
 FOREIGN KEY(CurrencyID) REFERENCES dbo.Currency(ID);
IF OBJECT_ID(N'dbo.CK_Opportunity_ExchangeRate',N'C') IS NULL
 ALTER TABLE dbo.Opportunity WITH CHECK ADD CONSTRAINT CK_Opportunity_ExchangeRate CHECK(
 (CurrencyID IS NULL AND ExchangeRateToVND IS NULL) OR
 (CurrencyID IS NOT NULL AND ExchangeRateToVND IS NOT NULL AND ExchangeRateToVND>0));
IF OBJECT_ID(N'dbo.CK_Product_MixRatioPct',N'C') IS NULL
 ALTER TABLE dbo.Product WITH CHECK ADD CONSTRAINT CK_Product_MixRatioPct
 CHECK(MixRatioPct IS NULL OR MixRatioPct BETWEEN 0 AND 100);
IF OBJECT_ID(N'dbo.CK_OpportunityItem_PackagingNumbers',N'C') IS NULL
 ALTER TABLE dbo.OpportunityItem WITH CHECK ADD CONSTRAINT CK_OpportunityItem_PackagingNumbers
 CHECK((MaxPalletHeightM IS NULL OR MaxPalletHeightM>0) AND (ShelfLifeDays IS NULL OR ShelfLifeDays>=0));
IF OBJECT_ID(N'dbo.CK_PCRI_ResponseNumbers',N'C') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem WITH CHECK ADD CONSTRAINT CK_PCRI_ResponseNumbers
 CHECK((UnitsPerCarton IS NULL OR UnitsPerCarton>0)
 AND (FirstPMMOQ IS NULL OR FirstPMMOQ>=0) AND (SecondPMMOQ IS NULL OR SecondPMMOQ>=0)
 AND (CartonsPerLayer IS NULL OR CartonsPerLayer>0) AND (LayersPerPallet IS NULL OR LayersPerPallet>0)
 AND (PacksPerPallet IS NULL OR PacksPerPallet>0) AND (CartonsPerContainer IS NULL OR CartonsPerContainer>0));
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.PackagingConfigurationRequestItem')
 AND name=N'IX_PCRI_SourceLatest')
 CREATE INDEX IX_PCRI_SourceLatest ON dbo.PackagingConfigurationRequestItem(OpportunityItemID,ID DESC)
 INCLUDE(IsOpen,Stage,RequestID);
GO
IF TYPE_ID(N'dbo.ProductBatchTypeV2') IS NULL
 EXEC(N'CREATE TYPE dbo.ProductBatchTypeV2 AS TABLE(
 RowNum INT NOT NULL PRIMARY KEY,Command CHAR(1) NOT NULL,ID INT NULL,
ProductCode VARCHAR(20) NULL,ProductName VARCHAR(200) NULL,WeightValue DECIMAL(10,4) NULL,
WeightUnit VARCHAR(2) NULL,Status VARCHAR(10) NULL,RowVersionB64 VARBINARY(8) NULL,
 Category NVARCHAR(100) NULL,
 Grade NVARCHAR(100) NULL,
 MixRatioPct DECIMAL(5,2) NULL
 )');
GO
IF TYPE_ID(N'dbo.OpportunityHeaderBatchTypeV2') IS NULL
 EXEC(N'CREATE TYPE dbo.OpportunityHeaderBatchTypeV2 AS TABLE(
 RowNum INT NOT NULL PRIMARY KEY,Command CHAR(1) NOT NULL,ID INT NULL,
OpportunityNumber VARCHAR(20) NULL,CustomerID INT NULL,OpportunityDesc VARCHAR(300) NULL,
BidOpen DATE NULL,BidClose DATE NULL,Stage VARCHAR(20) NULL,RowVersionB64 VARBINARY(8) NULL,
 CurrencyID INT NULL,
 ExchangeRateToVND DECIMAL(19,6) NULL
 )');
GO
IF TYPE_ID(N'dbo.OpportunityItemBatchTypeV2') IS NULL
 EXEC(N'CREATE TYPE dbo.OpportunityItemBatchTypeV2 AS TABLE(
 RowNum INT NOT NULL PRIMARY KEY,Command CHAR(1) NOT NULL,ID INT NULL,
OpportunityNumber VARCHAR(20) NOT NULL,ProductID INT NULL,ItemDescription VARCHAR(300) NULL,
AnnualUnit INT NULL,EstPctAwarded DECIMAL(5,2) NULL,ShelfPrice DECIMAL(10,2) NULL,
Stage VARCHAR(20) NULL,RowVersionB64 VARBINARY(8) NULL,
 PalletSize NVARCHAR(100) NULL,
 PalletStacking NVARCHAR(100) NULL,
 MaxPalletHeightM DECIMAL(9,3) NULL,
 ContainerRequest NVARCHAR(200) NULL,
 ConfigurationRequest NVARCHAR(500) NULL,
 PackagingType NVARCHAR(100) NULL,
 RecyclableRequirement NVARCHAR(200) NULL,
 RecycledContent NVARCHAR(200) NULL,
 Transparency NVARCHAR(100) NULL,
 MetalizedAluminum NVARCHAR(100) NULL,
 BarrierRequirement NVARCHAR(500) NULL,
 ShelfLifeDays INT NULL,
 SpecialComments NVARCHAR(1000) NULL
 )');
GO
IF TYPE_ID(N'dbo.PackagingResponseBatchTypeV2') IS NULL
 EXEC(N'CREATE TYPE dbo.PackagingResponseBatchTypeV2 AS TABLE(
 RowNum INT NOT NULL PRIMARY KEY,ID INT NOT NULL UNIQUE,
MaterialID INT NULL,HeightMM DECIMAL(12,2) NULL,WidthMM DECIMAL(12,2) NULL,LengthMM DECIMAL(12,2) NULL,
Cost DECIMAL(18,4) NULL,CurrencyID INT NULL,CostBasis NVARCHAR(40) NULL,
ResponseNotes NVARCHAR(1000) NULL,RowVersionB64 VARBINARY(8) NOT NULL,
 FirstPMType NVARCHAR(100) NULL,
 SecondPMType NVARCHAR(100) NULL,
 UnitsPerCarton INT NULL,
 PackagingDescription NVARCHAR(500) NULL,
 FirstPMMOQ DECIMAL(18,4) NULL,
 SecondPMMOQ DECIMAL(18,4) NULL,
 PalletType NVARCHAR(100) NULL,
 CartonsPerLayer INT NULL,
 LayersPerPallet INT NULL,
 PacksPerPallet INT NULL,
 CartonsPerContainer INT NULL
 )');
GO
-- Rate convention: 1 unit of header currency = ExchangeRateToVND VND.
CREATE OR ALTER TRIGGER dbo.tr_Opportunity_VNDRate
ON dbo.Opportunity AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM inserted i JOIN dbo.Currency c ON c.ID=i.CurrencyID
 WHERE c.CurrencyCode='VND' AND (i.ExchangeRateToVND IS NULL OR i.ExchangeRateToVND<>1))
 THROW 52951,'The exchange rate for VND must be 1.',1;
END;
GO
-- Database guard applies to old Excel/API paths as well as future V2 writes.
-- Workflow Stage and audit updates remain allowed; user-editable item data do not.
CREATE OR ALTER TRIGGER dbo.tr_OpportunityItem_ProcessingLock
ON dbo.OpportunityItem AFTER UPDATE,DELETE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(
  SELECT 1 FROM deleted d LEFT JOIN inserted i ON i.ID=d.ID
  WHERE EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem r WITH(UPDLOCK,HOLDLOCK)
   WHERE r.OpportunityItemID=d.ID AND r.IsOpen=1)
  AND (i.ID IS NULL OR EXISTS(
   SELECT i.OpportunityID,i.ProductID,CONVERT(VARBINARY(MAX),i.ItemDescription),i.AnnualUnit,i.EstPctAwarded,i.ShelfPrice,CONVERT(VARBINARY(MAX),i.PalletSize),CONVERT(VARBINARY(MAX),i.PalletStacking),i.MaxPalletHeightM,CONVERT(VARBINARY(MAX),i.ContainerRequest),CONVERT(VARBINARY(MAX),i.ConfigurationRequest),CONVERT(VARBINARY(MAX),i.PackagingType),CONVERT(VARBINARY(MAX),i.RecyclableRequirement),CONVERT(VARBINARY(MAX),i.RecycledContent),CONVERT(VARBINARY(MAX),i.Transparency),CONVERT(VARBINARY(MAX),i.MetalizedAluminum),CONVERT(VARBINARY(MAX),i.BarrierRequirement),i.ShelfLifeDays,CONVERT(VARBINARY(MAX),i.SpecialComments)
   EXCEPT
   SELECT d.OpportunityID,d.ProductID,CONVERT(VARBINARY(MAX),d.ItemDescription),d.AnnualUnit,d.EstPctAwarded,d.ShelfPrice,CONVERT(VARBINARY(MAX),d.PalletSize),CONVERT(VARBINARY(MAX),d.PalletStacking),d.MaxPalletHeightM,CONVERT(VARBINARY(MAX),d.ContainerRequest),CONVERT(VARBINARY(MAX),d.ConfigurationRequest),CONVERT(VARBINARY(MAX),d.PackagingType),CONVERT(VARBINARY(MAX),d.RecyclableRequirement),CONVERT(VARBINARY(MAX),d.RecycledContent),CONVERT(VARBINARY(MAX),d.Transparency),CONVERT(VARBINARY(MAX),d.MetalizedAluminum),CONVERT(VARBINARY(MAX),d.BarrierRequirement),d.ShelfLifeDays,CONVERT(VARBINARY(MAX),d.SpecialComments)
  )))
 THROW 52952,'Opportunity item is locked while a Packaging Request is processing.',1;
END;
GO
-- Resolve exactly one response without multiplying the Opportunity grid.
-- This view is an internal join source. Grant runtime EXECUTE on scoped readers,
-- not SELECT on this view or its underlying tables.
CREATE OR ALTER VIEW dbo.v_OpportunityItemPackaging
AS
 SELECT oi.ID AS OpportunityItemID,oi.OpportunityID,p.Category,p.Grade,p.MixRatioPct,
 oi.PalletSize,oi.PalletStacking,oi.MaxPalletHeightM,oi.ContainerRequest,oi.ConfigurationRequest,oi.PackagingType,oi.RecyclableRequirement,oi.RecycledContent,oi.Transparency,oi.MetalizedAluminum,oi.BarrierRequirement,oi.ShelfLifeDays,oi.SpecialComments,
 r.ID AS PackagingRequestItemID,r.RequestID AS PackagingRequestID,
 h.RequestNumber AS PackagingRequestNumber,r.Stage AS PackagingResponseStage,
 r.IsOpen AS PackagingIsOpen,r.FirstPMType,r.SecondPMType,r.UnitsPerCarton,r.PackagingDescription,r.FirstPMMOQ,r.SecondPMMOQ,r.PalletType,r.CartonsPerLayer,r.LayersPerPallet,r.PacksPerPallet,r.CartonsPerContainer,
 r.Cost AS PMCost,r.CurrencyID AS PMCostCurrencyID,r.CostBasis AS PMCostBasis
 FROM dbo.OpportunityItem oi
 JOIN dbo.Product p ON p.ID=oi.ProductID
 OUTER APPLY(SELECT TOP(1) ri.* FROM dbo.PackagingConfigurationRequestItem ri
 WHERE ri.OpportunityItemID=oi.ID AND ri.Stage<>'Canceled'
 ORDER BY ri.IsOpen DESC,ri.ID DESC) r
 LEFT JOIN dbo.PackagingConfigurationRequest h ON h.ID=r.RequestID;
GO
CREATE OR ALTER PROCEDURE dbo.usp_OpportunityItemPackaging_Read
 @Username NVARCHAR(100),@OpportunityID INT,@PageNumber INT=1,@PageSize INT=200
AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @Actor INT,@CanReadDraft BIT=0;
 SELECT @Actor=ID FROM dbo.Users WHERE UserName=@Username AND IsActive=1;
 IF @Actor IS NULL THROW 52953,'Username is incorrect.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope IN('Admin','Opportunity'))
 THROW 52954,'Opportunity access is required for this action.',1;
 IF EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope IN('Admin','Packaging','PackagingManager'))
 SET @CanReadDraft=1;
 IF @PageNumber<1 OR @PageSize NOT BETWEEN 1 AND 500
 THROW 52955,'Invalid page number or page size.',1;
 SELECT OpportunityItemID,OpportunityID,Category,Grade,MixRatioPct,
 PalletSize,PalletStacking,MaxPalletHeightM,ContainerRequest,ConfigurationRequest,PackagingType,RecyclableRequirement,RecycledContent,Transparency,MetalizedAluminum,BarrierRequirement,ShelfLifeDays,SpecialComments,
 PackagingRequestItemID,PackagingRequestID,PackagingRequestNumber,PackagingResponseStage,PackagingIsOpen,
 CASE WHEN @CanReadDraft=1 OR PackagingResponseStage='Approved' THEN FirstPMType END AS FirstPMType,
 CASE WHEN @CanReadDraft=1 OR PackagingResponseStage='Approved' THEN SecondPMType END AS SecondPMType,
 CASE WHEN @CanReadDraft=1 OR PackagingResponseStage='Approved' THEN UnitsPerCarton END AS UnitsPerCarton,
 CASE WHEN @CanReadDraft=1 OR PackagingResponseStage='Approved' THEN PackagingDescription END AS PackagingDescription,
 CASE WHEN @CanReadDraft=1 OR PackagingResponseStage='Approved' THEN FirstPMMOQ END AS FirstPMMOQ,
 CASE WHEN @CanReadDraft=1 OR PackagingResponseStage='Approved' THEN SecondPMMOQ END AS SecondPMMOQ,
 CASE WHEN @CanReadDraft=1 OR PackagingResponseStage='Approved' THEN PalletType END AS PalletType,
 CASE WHEN @CanReadDraft=1 OR PackagingResponseStage='Approved' THEN CartonsPerLayer END AS CartonsPerLayer,
 CASE WHEN @CanReadDraft=1 OR PackagingResponseStage='Approved' THEN LayersPerPallet END AS LayersPerPallet,
 CASE WHEN @CanReadDraft=1 OR PackagingResponseStage='Approved' THEN PacksPerPallet END AS PacksPerPallet,
 CASE WHEN @CanReadDraft=1 OR PackagingResponseStage='Approved' THEN CartonsPerContainer END AS CartonsPerContainer,
 CASE WHEN @CanReadDraft=1 OR PackagingResponseStage='Approved' THEN PMCost END AS PMCost,
 CASE WHEN @CanReadDraft=1 OR PackagingResponseStage='Approved' THEN PMCostCurrencyID END AS PMCostCurrencyID,
 CASE WHEN @CanReadDraft=1 OR PackagingResponseStage='Approved' THEN PMCostBasis END AS PMCostBasis
 FROM dbo.v_OpportunityItemPackaging WHERE OpportunityID=@OpportunityID
 ORDER BY OpportunityItemID OFFSET (CONVERT(BIGINT,@PageNumber)-1)*@PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;
 SELECT COUNT_BIG(*) AS Total FROM dbo.OpportunityItem WHERE OpportunityID=@OpportunityID;
END;
GO
CREATE OR ALTER TRIGGER dbo.tr_Opportunity_ChangeLog
ON dbo.Opportunity AFTER INSERT,UPDATE,DELETE AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @Event UNIQUEIDENTIFIER=COALESCE(TRY_CONVERT(UNIQUEIDENTIFIER,SESSION_CONTEXT(N'OpportunityChangeEvent')),NEWID());
 DECLARE @Actor NVARCHAR(128)=CONVERT(NVARCHAR(128),SESSION_CONTEXT(N'OpportunityChangeUser'));
 DECLARE @Source VARCHAR(20)=CONVERT(VARCHAR(20),SESSION_CONTEXT(N'OpportunityChangeSource'));
 -- Nested writes are automatic consequences of the initiating statement.
 SET @Source=CASE WHEN TRIGGER_NESTLEVEL()>1 THEN 'System'
                  WHEN @Source IN('User','System') THEN @Source ELSE 'Database' END;
 INSERT dbo.OpportunityChangeLog(EventID,OpportunityID,EntityLevel,ItemID,ItemLabel,Action,
 FieldName,OldValue,NewValue,ChangedBy,Source,Reason)
 SELECT @Event,COALESCE(i.ID,d.ID),'Header',
 NULL,NULL,
 CASE WHEN d.ID IS NULL THEN 'Create' WHEN i.ID IS NULL THEN 'Delete' ELSE 'Update' END,
 v.FieldName,v.OldValue,v.NewValue,COALESCE(@Actor,ORIGINAL_LOGIN()),@Source,
 CONVERT(NVARCHAR(500),SESSION_CONTEXT(N'OpportunityChangeReason'))
 FROM inserted i FULL JOIN deleted d ON i.ID=d.ID
 LEFT JOIN dbo.Customer oc ON oc.ID=d.CustomerID
 LEFT JOIN dbo.Customer nc ON nc.ID=i.CustomerID
 CROSS APPLY(VALUES
 ('OpportunityNumber',CONVERT(NVARCHAR(MAX),d.OpportunityNumber,126),CONVERT(NVARCHAR(MAX),i.OpportunityNumber,126)),
 ('CustomerID',CASE WHEN d.CustomerID IS NOT NULL THEN CONCAT(oc.CustomerName,N' (#',d.CustomerID,N')') END,CASE WHEN i.CustomerID IS NOT NULL THEN CONCAT(nc.CustomerName,N' (#',i.CustomerID,N')') END),
 ('OpportunityDesc',CONVERT(NVARCHAR(MAX),d.OpportunityDesc,126),CONVERT(NVARCHAR(MAX),i.OpportunityDesc,126)),
 ('BidOpen',CONVERT(NVARCHAR(MAX),d.BidOpen,126),CONVERT(NVARCHAR(MAX),i.BidOpen,126)),
 ('BidClose',CONVERT(NVARCHAR(MAX),d.BidClose,126),CONVERT(NVARCHAR(MAX),i.BidClose,126)),
 ('CurrencyID',CONVERT(NVARCHAR(MAX),d.CurrencyID,126),CONVERT(NVARCHAR(MAX),i.CurrencyID,126)),
 ('ExchangeRateToVND',CONVERT(NVARCHAR(MAX),d.ExchangeRateToVND,126),CONVERT(NVARCHAR(MAX),i.ExchangeRateToVND,126)),
 ('Stage',CONVERT(NVARCHAR(MAX),d.Stage,126),CONVERT(NVARCHAR(MAX),i.Stage,126))
 )v(FieldName,OldValue,NewValue)
 WHERE d.ID IS NULL OR i.ID IS NULL
 OR (v.OldValue IS NULL AND v.NewValue IS NOT NULL)
 OR (v.OldValue IS NOT NULL AND v.NewValue IS NULL)
 OR CONVERT(VARBINARY(MAX),v.OldValue)<>CONVERT(VARBINARY(MAX),v.NewValue);
END
GO
CREATE OR ALTER TRIGGER dbo.tr_OpportunityItem_ChangeLog
ON dbo.OpportunityItem AFTER INSERT,UPDATE,DELETE AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @Event UNIQUEIDENTIFIER=COALESCE(TRY_CONVERT(UNIQUEIDENTIFIER,SESSION_CONTEXT(N'OpportunityChangeEvent')),NEWID());
 DECLARE @Actor NVARCHAR(128)=CONVERT(NVARCHAR(128),SESSION_CONTEXT(N'OpportunityChangeUser'));
 DECLARE @Source VARCHAR(20)=CONVERT(VARCHAR(20),SESSION_CONTEXT(N'OpportunityChangeSource'));
 -- Nested writes are automatic consequences of the initiating statement.
 SET @Source=CASE WHEN TRIGGER_NESTLEVEL()>1 THEN 'System'
                  WHEN @Source IN('User','System') THEN @Source ELSE 'Database' END;
 INSERT dbo.OpportunityChangeLog(EventID,OpportunityID,EntityLevel,ItemID,ItemLabel,Action,
 FieldName,OldValue,NewValue,ChangedBy,Source,Reason)
 SELECT @Event,COALESCE(i.OpportunityID,d.OpportunityID),'Item',
 COALESCE(i.ID,d.ID),COALESCE(p.ProductCode,CONVERT(NVARCHAR(30),COALESCE(i.ProductID,d.ProductID))),
 CASE WHEN d.ID IS NULL THEN 'Create' WHEN i.ID IS NULL THEN 'Delete' ELSE 'Update' END,
 v.FieldName,v.OldValue,v.NewValue,COALESCE(@Actor,ORIGINAL_LOGIN()),@Source,
 CONVERT(NVARCHAR(500),SESSION_CONTEXT(N'OpportunityChangeReason'))
 FROM inserted i FULL JOIN deleted d ON i.ID=d.ID
 LEFT JOIN dbo.Product p ON p.ID=COALESCE(i.ProductID,d.ProductID)
 LEFT JOIN dbo.Product op ON op.ID=d.ProductID
 LEFT JOIN dbo.Product np ON np.ID=i.ProductID
 CROSS APPLY(VALUES
 ('OpportunityID',CONVERT(NVARCHAR(MAX),d.OpportunityID,126),CONVERT(NVARCHAR(MAX),i.OpportunityID,126)),
 ('ProductID',CASE WHEN d.ProductID IS NOT NULL THEN CONCAT(op.ProductCode,N' (#',d.ProductID,N')') END,CASE WHEN i.ProductID IS NOT NULL THEN CONCAT(np.ProductCode,N' (#',i.ProductID,N')') END),
 ('ItemDescription',CONVERT(NVARCHAR(MAX),d.ItemDescription,126),CONVERT(NVARCHAR(MAX),i.ItemDescription,126)),
 ('AnnualUnit',CONVERT(NVARCHAR(MAX),d.AnnualUnit,126),CONVERT(NVARCHAR(MAX),i.AnnualUnit,126)),
 ('EstPctAwarded',CONVERT(NVARCHAR(MAX),d.EstPctAwarded,126),CONVERT(NVARCHAR(MAX),i.EstPctAwarded,126)),
 ('ShelfPrice',CONVERT(NVARCHAR(MAX),d.ShelfPrice,126),CONVERT(NVARCHAR(MAX),i.ShelfPrice,126)),
 ('PalletSize',CONVERT(NVARCHAR(MAX),d.PalletSize,126),CONVERT(NVARCHAR(MAX),i.PalletSize,126)),
 ('PalletStacking',CONVERT(NVARCHAR(MAX),d.PalletStacking,126),CONVERT(NVARCHAR(MAX),i.PalletStacking,126)),
 ('MaxPalletHeightM',CONVERT(NVARCHAR(MAX),d.MaxPalletHeightM,126),CONVERT(NVARCHAR(MAX),i.MaxPalletHeightM,126)),
 ('ContainerRequest',CONVERT(NVARCHAR(MAX),d.ContainerRequest,126),CONVERT(NVARCHAR(MAX),i.ContainerRequest,126)),
 ('ConfigurationRequest',CONVERT(NVARCHAR(MAX),d.ConfigurationRequest,126),CONVERT(NVARCHAR(MAX),i.ConfigurationRequest,126)),
 ('PackagingType',CONVERT(NVARCHAR(MAX),d.PackagingType,126),CONVERT(NVARCHAR(MAX),i.PackagingType,126)),
 ('RecyclableRequirement',CONVERT(NVARCHAR(MAX),d.RecyclableRequirement,126),CONVERT(NVARCHAR(MAX),i.RecyclableRequirement,126)),
 ('RecycledContent',CONVERT(NVARCHAR(MAX),d.RecycledContent,126),CONVERT(NVARCHAR(MAX),i.RecycledContent,126)),
 ('Transparency',CONVERT(NVARCHAR(MAX),d.Transparency,126),CONVERT(NVARCHAR(MAX),i.Transparency,126)),
 ('MetalizedAluminum',CONVERT(NVARCHAR(MAX),d.MetalizedAluminum,126),CONVERT(NVARCHAR(MAX),i.MetalizedAluminum,126)),
 ('BarrierRequirement',CONVERT(NVARCHAR(MAX),d.BarrierRequirement,126),CONVERT(NVARCHAR(MAX),i.BarrierRequirement,126)),
 ('ShelfLifeDays',CONVERT(NVARCHAR(MAX),d.ShelfLifeDays,126),CONVERT(NVARCHAR(MAX),i.ShelfLifeDays,126)),
 ('SpecialComments',CONVERT(NVARCHAR(MAX),d.SpecialComments,126),CONVERT(NVARCHAR(MAX),i.SpecialComments,126)),
 ('Stage',CONVERT(NVARCHAR(MAX),d.Stage,126),CONVERT(NVARCHAR(MAX),i.Stage,126))
 )v(FieldName,OldValue,NewValue)
 WHERE d.ID IS NULL OR i.ID IS NULL
 OR (v.OldValue IS NULL AND v.NewValue IS NOT NULL)
 OR (v.OldValue IS NOT NULL AND v.NewValue IS NULL)
 OR CONVERT(VARBINARY(MAX),v.OldValue)<>CONVERT(VARBINARY(MAX),v.NewValue);
END
GO
COMMIT;
GO
