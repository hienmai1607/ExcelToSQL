USE [test]
GO
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
GO
IF OBJECT_ID('dbo.usp_PackagingRequest_Create_AuditImplementation','P') IS NULL
 THROW 52980,'Apply Packaging migration 24 before migration 25.',1;
GO
IF COL_LENGTH('dbo.PackagingConfigurationRequest','SourceCurrencyID') IS NULL ALTER TABLE dbo.PackagingConfigurationRequest ADD SourceCurrencyID INT NULL;
IF COL_LENGTH('dbo.PackagingConfigurationRequest','SourceCurrencyCode') IS NULL ALTER TABLE dbo.PackagingConfigurationRequest ADD SourceCurrencyCode VARCHAR(20) NULL;
IF COL_LENGTH('dbo.PackagingConfigurationRequest','SourceExchangeRateToVND') IS NULL ALTER TABLE dbo.PackagingConfigurationRequest ADD SourceExchangeRateToVND DECIMAL(19,6) NULL;
IF COL_LENGTH('dbo.PackagingConfigurationRequest','SnapshotCapturedAt') IS NULL ALTER TABLE dbo.PackagingConfigurationRequest ADD SnapshotCapturedAt DATETIME2(7) NULL;
IF COL_LENGTH('dbo.PackagingConfigurationRequest','SnapshotOrigin') IS NULL ALTER TABLE dbo.PackagingConfigurationRequest ADD SnapshotOrigin VARCHAR(20) NULL;
GO
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','WeightGrams') IS NULL ALTER TABLE dbo.PackagingConfigurationRequestItem ADD WeightGrams DECIMAL(10,2) NULL;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','Category') IS NULL ALTER TABLE dbo.PackagingConfigurationRequestItem ADD Category NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','Grade') IS NULL ALTER TABLE dbo.PackagingConfigurationRequestItem ADD Grade NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','MixRatioPct') IS NULL ALTER TABLE dbo.PackagingConfigurationRequestItem ADD MixRatioPct DECIMAL(5,2) NULL;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','PalletSize') IS NULL ALTER TABLE dbo.PackagingConfigurationRequestItem ADD PalletSize NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','PalletStacking') IS NULL ALTER TABLE dbo.PackagingConfigurationRequestItem ADD PalletStacking NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','MaxPalletHeightM') IS NULL ALTER TABLE dbo.PackagingConfigurationRequestItem ADD MaxPalletHeightM DECIMAL(9,3) NULL;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','ContainerRequest') IS NULL ALTER TABLE dbo.PackagingConfigurationRequestItem ADD ContainerRequest NVARCHAR(200) NULL;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','ConfigurationRequest') IS NULL ALTER TABLE dbo.PackagingConfigurationRequestItem ADD ConfigurationRequest NVARCHAR(500) NULL;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','PackagingType') IS NULL ALTER TABLE dbo.PackagingConfigurationRequestItem ADD PackagingType NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','RecyclableRequirement') IS NULL ALTER TABLE dbo.PackagingConfigurationRequestItem ADD RecyclableRequirement NVARCHAR(200) NULL;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','RecycledContent') IS NULL ALTER TABLE dbo.PackagingConfigurationRequestItem ADD RecycledContent NVARCHAR(200) NULL;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','Transparency') IS NULL ALTER TABLE dbo.PackagingConfigurationRequestItem ADD Transparency NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','MetalizedAluminum') IS NULL ALTER TABLE dbo.PackagingConfigurationRequestItem ADD MetalizedAluminum NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','BarrierRequirement') IS NULL ALTER TABLE dbo.PackagingConfigurationRequestItem ADD BarrierRequirement NVARCHAR(500) NULL;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','ShelfLifeDays') IS NULL ALTER TABLE dbo.PackagingConfigurationRequestItem ADD ShelfLifeDays INT NULL;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','SpecialComments') IS NULL ALTER TABLE dbo.PackagingConfigurationRequestItem ADD SpecialComments NVARCHAR(1000) NULL;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','EstPctAwarded') IS NULL ALTER TABLE dbo.PackagingConfigurationRequestItem ADD EstPctAwarded DECIMAL(5,2) NULL;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','ShelfPrice') IS NULL ALTER TABLE dbo.PackagingConfigurationRequestItem ADD ShelfPrice DECIMAL(10,2) NULL;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','SourceProductRowVersion') IS NULL ALTER TABLE dbo.PackagingConfigurationRequestItem ADD SourceProductRowVersion BINARY(8) NULL;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','SnapshotCapturedAt') IS NULL ALTER TABLE dbo.PackagingConfigurationRequestItem ADD SnapshotCapturedAt DATETIME2(7) NULL;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','SnapshotOrigin') IS NULL ALTER TABLE dbo.PackagingConfigurationRequestItem ADD SnapshotOrigin VARCHAR(20) NULL;
GO
CREATE OR ALTER TRIGGER dbo.tr_PackagingConfigurationRequest_ChangeLog
ON dbo.PackagingConfigurationRequest AFTER INSERT,UPDATE,DELETE AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @Event UNIQUEIDENTIFIER=COALESCE(TRY_CONVERT(UNIQUEIDENTIFIER,SESSION_CONTEXT(N'PackagingChangeEvent')),NEWID()),
 @Actor NVARCHAR(128)=CONVERT(NVARCHAR(128),SESSION_CONTEXT(N'PackagingChangeUser')),
 @Source VARCHAR(20)=CONVERT(VARCHAR(20),SESSION_CONTEXT(N'PackagingChangeSource'));
 SET @Source=CASE WHEN TRIGGER_NESTLEVEL()>1 THEN 'System' WHEN @Source IN('User','System') THEN @Source ELSE 'Database' END;
 INSERT dbo.PackagingRequestChangeLog(EventID,RequestID,EntityLevel,ItemID,ItemLabel,Action,FieldName,OldValue,NewValue,ChangedBy,Source,Reason,IsResponse)
 SELECT @Event,COALESCE(i.ID,d.ID),'Header',
 NULL,NULL,
 CASE WHEN d.ID IS NULL THEN 'Create' WHEN i.ID IS NULL THEN 'Delete' ELSE 'Update' END,
 v.FieldName,v.OldValue,v.NewValue,COALESCE(@Actor,ORIGINAL_LOGIN()),
 CASE WHEN v.FieldName='IsOpen' AND @Source<>'Database' THEN 'System' ELSE @Source END,
 CONVERT(NVARCHAR(1000),SESSION_CONTEXT(N'PackagingChangeReason')),v.IsResponse
 FROM inserted i FULL JOIN deleted d ON i.ID=d.ID
 CROSS APPLY(VALUES
 ('SourceCurrencyID',CONVERT(NVARCHAR(MAX),d.[SourceCurrencyID],126),CONVERT(NVARCHAR(MAX),i.[SourceCurrencyID],126),0),
 ('SourceCurrencyCode',CONVERT(NVARCHAR(MAX),d.[SourceCurrencyCode],126),CONVERT(NVARCHAR(MAX),i.[SourceCurrencyCode],126),0),
 ('SourceExchangeRateToVND',CONVERT(NVARCHAR(MAX),d.[SourceExchangeRateToVND],126),CONVERT(NVARCHAR(MAX),i.[SourceExchangeRateToVND],126),0),
 ('SnapshotCapturedAt',CONVERT(NVARCHAR(MAX),d.[SnapshotCapturedAt],126),CONVERT(NVARCHAR(MAX),i.[SnapshotCapturedAt],126),0),
 ('SnapshotOrigin',CONVERT(NVARCHAR(MAX),d.[SnapshotOrigin],126),CONVERT(NVARCHAR(MAX),i.[SnapshotOrigin],126),0),
 ('OpportunityID',CONVERT(NVARCHAR(MAX),d.[OpportunityID],126),CONVERT(NVARCHAR(MAX),i.[OpportunityID],126),0),
 ('OpportunityNumber',CONVERT(NVARCHAR(MAX),d.[OpportunityNumber],126),CONVERT(NVARCHAR(MAX),i.[OpportunityNumber],126),0),
 ('CustomerID',CASE WHEN d.CustomerID IS NOT NULL THEN CONCAT((SELECT x.CustomerName FROM dbo.Customer x WHERE x.ID=d.CustomerID),N' (#',d.CustomerID,N')') END,CASE WHEN i.CustomerID IS NOT NULL THEN CONCAT((SELECT x.CustomerName FROM dbo.Customer x WHERE x.ID=i.CustomerID),N' (#',i.CustomerID,N')') END,0),
 ('CustomerName',CONVERT(NVARCHAR(MAX),d.[CustomerName],126),CONVERT(NVARCHAR(MAX),i.[CustomerName],126),0),
 ('OpportunityDescription',CONVERT(NVARCHAR(MAX),d.[OpportunityDescription],126),CONVERT(NVARCHAR(MAX),i.[OpportunityDescription],126),0),
 ('BidOpen',CONVERT(NVARCHAR(MAX),d.[BidOpen],126),CONVERT(NVARCHAR(MAX),i.[BidOpen],126),0),
 ('BidClose',CONVERT(NVARCHAR(MAX),d.[BidClose],126),CONVERT(NVARCHAR(MAX),i.[BidClose],126),0),
 ('RequestedBy',(SELECT CONVERT(NVARCHAR(MAX),CONCAT(u.UserName,N' (#',u.ID,N')')) FROM dbo.Users u WHERE u.ID=d.RequestedBy),(SELECT CONVERT(NVARCHAR(MAX),CONCAT(u.UserName,N' (#',u.ID,N')')) FROM dbo.Users u WHERE u.ID=i.RequestedBy),0),
 ('RequestedAt',CONVERT(NVARCHAR(MAX),d.[RequestedAt],126),CONVERT(NVARCHAR(MAX),i.[RequestedAt],126),0),
 ('ResponseDue',CONVERT(NVARCHAR(MAX),d.[ResponseDue],126),CONVERT(NVARCHAR(MAX),i.[ResponseDue],126),0),
 ('RequestNotes',CONVERT(NVARCHAR(MAX),d.[RequestNotes],126),CONVERT(NVARCHAR(MAX),i.[RequestNotes],126),0)
 )v(FieldName,OldValue,NewValue,IsResponse)
 WHERE d.ID IS NULL OR i.ID IS NULL OR (v.OldValue IS NULL AND v.NewValue IS NOT NULL)
 OR (v.OldValue IS NOT NULL AND v.NewValue IS NULL)
 OR CONVERT(VARBINARY(MAX),v.OldValue)<>CONVERT(VARBINARY(MAX),v.NewValue);
END
GO
CREATE OR ALTER TRIGGER dbo.tr_PackagingConfigurationRequestItem_ChangeLog
ON dbo.PackagingConfigurationRequestItem AFTER INSERT,UPDATE,DELETE AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @Event UNIQUEIDENTIFIER=COALESCE(TRY_CONVERT(UNIQUEIDENTIFIER,SESSION_CONTEXT(N'PackagingChangeEvent')),NEWID()),
 @Actor NVARCHAR(128)=CONVERT(NVARCHAR(128),SESSION_CONTEXT(N'PackagingChangeUser')),
 @Source VARCHAR(20)=CONVERT(VARCHAR(20),SESSION_CONTEXT(N'PackagingChangeSource'));
 SET @Source=CASE WHEN TRIGGER_NESTLEVEL()>1 THEN 'System' WHEN @Source IN('User','System') THEN @Source ELSE 'Database' END;
 INSERT dbo.PackagingRequestChangeLog(EventID,RequestID,EntityLevel,ItemID,ItemLabel,Action,FieldName,OldValue,NewValue,ChangedBy,Source,Reason,IsResponse)
 SELECT @Event,COALESCE(i.RequestID,d.RequestID),'Item',
 COALESCE(i.ID,d.ID),COALESCE(i.ProductCode,d.ProductCode),
 CASE WHEN d.ID IS NULL THEN 'Create' WHEN i.ID IS NULL THEN 'Delete' ELSE 'Update' END,
 v.FieldName,v.OldValue,v.NewValue,COALESCE(@Actor,ORIGINAL_LOGIN()),
 CASE WHEN v.FieldName='IsOpen' AND @Source<>'Database' THEN 'System' ELSE @Source END,
 CONVERT(NVARCHAR(1000),SESSION_CONTEXT(N'PackagingChangeReason')),v.IsResponse
 FROM inserted i FULL JOIN deleted d ON i.ID=d.ID
 CROSS APPLY(VALUES
 ('WeightGrams',CONVERT(NVARCHAR(MAX),d.[WeightGrams],126),CONVERT(NVARCHAR(MAX),i.[WeightGrams],126),0),
 ('Category',CONVERT(NVARCHAR(MAX),d.[Category],126),CONVERT(NVARCHAR(MAX),i.[Category],126),0),
 ('Grade',CONVERT(NVARCHAR(MAX),d.[Grade],126),CONVERT(NVARCHAR(MAX),i.[Grade],126),0),
 ('MixRatioPct',CONVERT(NVARCHAR(MAX),d.[MixRatioPct],126),CONVERT(NVARCHAR(MAX),i.[MixRatioPct],126),0),
 ('PalletSize',CONVERT(NVARCHAR(MAX),d.[PalletSize],126),CONVERT(NVARCHAR(MAX),i.[PalletSize],126),0),
 ('PalletStacking',CONVERT(NVARCHAR(MAX),d.[PalletStacking],126),CONVERT(NVARCHAR(MAX),i.[PalletStacking],126),0),
 ('MaxPalletHeightM',CONVERT(NVARCHAR(MAX),d.[MaxPalletHeightM],126),CONVERT(NVARCHAR(MAX),i.[MaxPalletHeightM],126),0),
 ('ContainerRequest',CONVERT(NVARCHAR(MAX),d.[ContainerRequest],126),CONVERT(NVARCHAR(MAX),i.[ContainerRequest],126),0),
 ('ConfigurationRequest',CONVERT(NVARCHAR(MAX),d.[ConfigurationRequest],126),CONVERT(NVARCHAR(MAX),i.[ConfigurationRequest],126),0),
 ('PackagingType',CONVERT(NVARCHAR(MAX),d.[PackagingType],126),CONVERT(NVARCHAR(MAX),i.[PackagingType],126),0),
 ('RecyclableRequirement',CONVERT(NVARCHAR(MAX),d.[RecyclableRequirement],126),CONVERT(NVARCHAR(MAX),i.[RecyclableRequirement],126),0),
 ('RecycledContent',CONVERT(NVARCHAR(MAX),d.[RecycledContent],126),CONVERT(NVARCHAR(MAX),i.[RecycledContent],126),0),
 ('Transparency',CONVERT(NVARCHAR(MAX),d.[Transparency],126),CONVERT(NVARCHAR(MAX),i.[Transparency],126),0),
 ('MetalizedAluminum',CONVERT(NVARCHAR(MAX),d.[MetalizedAluminum],126),CONVERT(NVARCHAR(MAX),i.[MetalizedAluminum],126),0),
 ('BarrierRequirement',CONVERT(NVARCHAR(MAX),d.[BarrierRequirement],126),CONVERT(NVARCHAR(MAX),i.[BarrierRequirement],126),0),
 ('ShelfLifeDays',CONVERT(NVARCHAR(MAX),d.[ShelfLifeDays],126),CONVERT(NVARCHAR(MAX),i.[ShelfLifeDays],126),0),
 ('SpecialComments',CONVERT(NVARCHAR(MAX),d.[SpecialComments],126),CONVERT(NVARCHAR(MAX),i.[SpecialComments],126),0),
 ('EstPctAwarded',CONVERT(NVARCHAR(MAX),d.[EstPctAwarded],126),CONVERT(NVARCHAR(MAX),i.[EstPctAwarded],126),0),
 ('ShelfPrice',CONVERT(NVARCHAR(MAX),d.[ShelfPrice],126),CONVERT(NVARCHAR(MAX),i.[ShelfPrice],126),0),
 ('SnapshotCapturedAt',CONVERT(NVARCHAR(MAX),d.[SnapshotCapturedAt],126),CONVERT(NVARCHAR(MAX),i.[SnapshotCapturedAt],126),0),
 ('SnapshotOrigin',CONVERT(NVARCHAR(MAX),d.[SnapshotOrigin],126),CONVERT(NVARCHAR(MAX),i.[SnapshotOrigin],126),0),
 ('OpportunityItemID',CONVERT(NVARCHAR(MAX),d.[OpportunityItemID],126),CONVERT(NVARCHAR(MAX),i.[OpportunityItemID],126),0),
 ('ProductID',CASE WHEN d.ProductID IS NOT NULL THEN CONCAT((SELECT x.ProductCode FROM dbo.Product x WHERE x.ID=d.ProductID),N' (#',d.ProductID,N')') END,CASE WHEN i.ProductID IS NOT NULL THEN CONCAT((SELECT x.ProductCode FROM dbo.Product x WHERE x.ID=i.ProductID),N' (#',i.ProductID,N')') END,0),
 ('ProductCode',CONVERT(NVARCHAR(MAX),d.[ProductCode],126),CONVERT(NVARCHAR(MAX),i.[ProductCode],126),0),
 ('ProductName',CONVERT(NVARCHAR(MAX),d.[ProductName],126),CONVERT(NVARCHAR(MAX),i.[ProductName],126),0),
 ('ItemDescription',CONVERT(NVARCHAR(MAX),d.[ItemDescription],126),CONVERT(NVARCHAR(MAX),i.[ItemDescription],126),0),
 ('AnnualUnit',CONVERT(NVARCHAR(MAX),d.[AnnualUnit],126),CONVERT(NVARCHAR(MAX),i.[AnnualUnit],126),0),
 ('PackagingRequirement',CONVERT(NVARCHAR(MAX),d.[PackagingRequirement],126),CONVERT(NVARCHAR(MAX),i.[PackagingRequirement],126),0),
 ('PICUserID',(SELECT CONVERT(NVARCHAR(MAX),CONCAT(u.UserName,N' (#',u.ID,N')')) FROM dbo.Users u WHERE u.ID=d.PICUserID),(SELECT CONVERT(NVARCHAR(MAX),CONCAT(u.UserName,N' (#',u.ID,N')')) FROM dbo.Users u WHERE u.ID=i.PICUserID),0),
 ('Stage',CONVERT(NVARCHAR(MAX),d.[Stage],126),CONVERT(NVARCHAR(MAX),i.[Stage],126),0),
 ('IsOpen',CONVERT(NVARCHAR(MAX),d.[IsOpen],126),CONVERT(NVARCHAR(MAX),i.[IsOpen],126),0),
 ('MaterialID',CASE WHEN d.MaterialID IS NOT NULL THEN CONCAT((SELECT x.MaterialCode FROM dbo.PackagingMaterial x WHERE x.ID=d.MaterialID),N' (#',d.MaterialID,N')') END,CASE WHEN i.MaterialID IS NOT NULL THEN CONCAT((SELECT x.MaterialCode FROM dbo.PackagingMaterial x WHERE x.ID=i.MaterialID),N' (#',i.MaterialID,N')') END,1),
 ('HeightMM',CONVERT(NVARCHAR(MAX),d.[HeightMM],126),CONVERT(NVARCHAR(MAX),i.[HeightMM],126),1),
 ('WidthMM',CONVERT(NVARCHAR(MAX),d.[WidthMM],126),CONVERT(NVARCHAR(MAX),i.[WidthMM],126),1),
 ('LengthMM',CONVERT(NVARCHAR(MAX),d.[LengthMM],126),CONVERT(NVARCHAR(MAX),i.[LengthMM],126),1),
 ('Cost',CONVERT(NVARCHAR(MAX),d.[Cost],126),CONVERT(NVARCHAR(MAX),i.[Cost],126),1),
 ('CurrencyID',CASE WHEN d.CurrencyID IS NOT NULL THEN CONCAT((SELECT x.CurrencyCode FROM dbo.Currency x WHERE x.ID=d.CurrencyID),N' (#',d.CurrencyID,N')') END,CASE WHEN i.CurrencyID IS NOT NULL THEN CONCAT((SELECT x.CurrencyCode FROM dbo.Currency x WHERE x.ID=i.CurrencyID),N' (#',i.CurrencyID,N')') END,1),
 ('CostBasis',CONVERT(NVARCHAR(MAX),d.[CostBasis],126),CONVERT(NVARCHAR(MAX),i.[CostBasis],126),1),
 ('ResponseNotes',CONVERT(NVARCHAR(MAX),d.[ResponseNotes],126),CONVERT(NVARCHAR(MAX),i.[ResponseNotes],126),1),
 ('SubmittedAt',CONVERT(NVARCHAR(MAX),d.[SubmittedAt],126),CONVERT(NVARCHAR(MAX),i.[SubmittedAt],126),1),
 ('SubmittedBy',(SELECT CONVERT(NVARCHAR(MAX),CONCAT(u.UserName,N' (#',u.ID,N')')) FROM dbo.Users u WHERE u.ID=d.SubmittedBy),(SELECT CONVERT(NVARCHAR(MAX),CONCAT(u.UserName,N' (#',u.ID,N')')) FROM dbo.Users u WHERE u.ID=i.SubmittedBy),1),
 ('ReviewedAt',CONVERT(NVARCHAR(MAX),d.[ReviewedAt],126),CONVERT(NVARCHAR(MAX),i.[ReviewedAt],126),1),
 ('ReviewedBy',(SELECT CONVERT(NVARCHAR(MAX),CONCAT(u.UserName,N' (#',u.ID,N')')) FROM dbo.Users u WHERE u.ID=d.ReviewedBy),(SELECT CONVERT(NVARCHAR(MAX),CONCAT(u.UserName,N' (#',u.ID,N')')) FROM dbo.Users u WHERE u.ID=i.ReviewedBy),1),
 ('ManagerComment',CONVERT(NVARCHAR(MAX),d.[ManagerComment],126),CONVERT(NVARCHAR(MAX),i.[ManagerComment],126),1),
 ('FirstPMType',CONVERT(NVARCHAR(MAX),d.[FirstPMType],126),CONVERT(NVARCHAR(MAX),i.[FirstPMType],126),1),
 ('SecondPMType',CONVERT(NVARCHAR(MAX),d.[SecondPMType],126),CONVERT(NVARCHAR(MAX),i.[SecondPMType],126),1),
 ('UnitsPerCarton',CONVERT(NVARCHAR(MAX),d.[UnitsPerCarton],126),CONVERT(NVARCHAR(MAX),i.[UnitsPerCarton],126),1),
 ('PackagingDescription',CONVERT(NVARCHAR(MAX),d.[PackagingDescription],126),CONVERT(NVARCHAR(MAX),i.[PackagingDescription],126),1),
 ('FirstPMMOQ',CONVERT(NVARCHAR(MAX),d.[FirstPMMOQ],126),CONVERT(NVARCHAR(MAX),i.[FirstPMMOQ],126),1),
 ('SecondPMMOQ',CONVERT(NVARCHAR(MAX),d.[SecondPMMOQ],126),CONVERT(NVARCHAR(MAX),i.[SecondPMMOQ],126),1),
 ('PalletType',CONVERT(NVARCHAR(MAX),d.[PalletType],126),CONVERT(NVARCHAR(MAX),i.[PalletType],126),1),
 ('CartonsPerLayer',CONVERT(NVARCHAR(MAX),d.[CartonsPerLayer],126),CONVERT(NVARCHAR(MAX),i.[CartonsPerLayer],126),1),
 ('LayersPerPallet',CONVERT(NVARCHAR(MAX),d.[LayersPerPallet],126),CONVERT(NVARCHAR(MAX),i.[LayersPerPallet],126),1),
 ('PacksPerPallet',CONVERT(NVARCHAR(MAX),d.[PacksPerPallet],126),CONVERT(NVARCHAR(MAX),i.[PacksPerPallet],126),1),
 ('CartonsPerContainer',CONVERT(NVARCHAR(MAX),d.[CartonsPerContainer],126),CONVERT(NVARCHAR(MAX),i.[CartonsPerContainer],126),1)
 )v(FieldName,OldValue,NewValue,IsResponse)
 WHERE d.ID IS NULL OR i.ID IS NULL OR (v.OldValue IS NULL AND v.NewValue IS NOT NULL)
 OR (v.OldValue IS NOT NULL AND v.NewValue IS NULL)
 OR CONVERT(VARBINARY(MAX),v.OldValue)<>CONVERT(VARBINARY(MAX),v.NewValue);

 -- Header status is derived, not stored. Reconstruct the before-state from the statement delta.
 ;WITH Affected AS(SELECT RequestID FROM inserted UNION SELECT RequestID FROM deleted),
 Counts AS(
 SELECT h.ID,
 (SELECT COUNT(*) FROM dbo.PackagingConfigurationRequestItem x WHERE x.RequestID=h.ID AND x.IsOpen=1) OpenNow,
 (SELECT COUNT(*) FROM dbo.PackagingConfigurationRequestItem x WHERE x.RequestID=h.ID AND x.Stage='Approved') ApprovedNow,
 (SELECT COUNT(*) FROM dbo.PackagingConfigurationRequestItem x WHERE x.RequestID=h.ID) TotalNow,
 (SELECT COUNT(*) FROM inserted x WHERE x.RequestID=h.ID AND x.IsOpen=1) OpenAdded,
 (SELECT COUNT(*) FROM deleted x WHERE x.RequestID=h.ID AND x.IsOpen=1) OpenRemoved,
 (SELECT COUNT(*) FROM inserted x WHERE x.RequestID=h.ID AND x.Stage='Approved') ApprovedAdded,
 (SELECT COUNT(*) FROM deleted x WHERE x.RequestID=h.ID AND x.Stage='Approved') ApprovedRemoved,
 (SELECT COUNT(*) FROM inserted x WHERE x.RequestID=h.ID) Added,
 (SELECT COUNT(*) FROM deleted x WHERE x.RequestID=h.ID) Removed
 FROM dbo.PackagingConfigurationRequest h WITH(UPDLOCK,HOLDLOCK) JOIN Affected a ON a.RequestID=h.ID),
 Statuses AS(SELECT ID,
 CASE WHEN TotalNow-Added+Removed=0 THEN NULL WHEN OpenNow-OpenAdded+OpenRemoved>0 THEN 'Open'
 WHEN ApprovedNow-ApprovedAdded+ApprovedRemoved>0 THEN 'Completed' ELSE 'Canceled' END OldStatus,
 CASE WHEN OpenNow>0 THEN 'Open' WHEN ApprovedNow>0 THEN 'Completed' ELSE 'Canceled' END NewStatus FROM Counts)
 INSERT dbo.PackagingRequestChangeLog(EventID,RequestID,EntityLevel,Action,FieldName,OldValue,NewValue,ChangedBy,Source,Reason)
 SELECT @Event,ID,'Header',CASE WHEN OldStatus IS NULL THEN 'Create' ELSE 'Update' END,'RequestStatus',OldStatus,NewStatus,
 COALESCE(@Actor,ORIGINAL_LOGIN()),'System',CONVERT(NVARCHAR(1000),SESSION_CONTEXT(N'PackagingChangeReason'))
 FROM Statuses WHERE OldStatus IS NULL OR OldStatus<>NewStatus;
END
GO
-- Backfill only uncaptured extension fields. Existing original basics stay untouched.
DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT(N'PackagingChangeUser'),
 @OldSource SQL_VARIANT=SESSION_CONTEXT(N'PackagingChangeSource'),
 @OldReason SQL_VARIANT=SESSION_CONTEXT(N'PackagingChangeReason'),
 @Actor NVARCHAR(128)=ORIGINAL_LOGIN();
BEGIN TRY
 EXEC sys.sp_set_session_context N'PackagingChangeUser',@Actor;
 EXEC sys.sp_set_session_context N'PackagingChangeSource',N'System';
 EXEC sys.sp_set_session_context N'PackagingChangeReason',N'Migration-time snapshot of current source values; not original submission values.';
 UPDATE h SET SourceCurrencyID=o.CurrencyID,SourceCurrencyCode=c.CurrencyCode,
 SourceExchangeRateToVND=o.ExchangeRateToVND,SnapshotCapturedAt=SYSUTCDATETIME(),SnapshotOrigin='Migration'
 FROM dbo.PackagingConfigurationRequest h
 JOIN dbo.Opportunity o ON o.ID=h.OpportunityID LEFT JOIN dbo.Currency c ON c.ID=o.CurrencyID
 WHERE h.SnapshotCapturedAt IS NULL;
 UPDATE i SET WeightGrams=p.WeightGrams,Category=p.Category,Grade=p.Grade,MixRatioPct=p.MixRatioPct,PalletSize=oi.PalletSize,PalletStacking=oi.PalletStacking,MaxPalletHeightM=oi.MaxPalletHeightM,ContainerRequest=oi.ContainerRequest,ConfigurationRequest=oi.ConfigurationRequest,PackagingType=oi.PackagingType,RecyclableRequirement=oi.RecyclableRequirement,RecycledContent=oi.RecycledContent,Transparency=oi.Transparency,MetalizedAluminum=oi.MetalizedAluminum,BarrierRequirement=oi.BarrierRequirement,ShelfLifeDays=oi.ShelfLifeDays,SpecialComments=oi.SpecialComments,EstPctAwarded=oi.EstPctAwarded,ShelfPrice=oi.ShelfPrice,SourceProductRowVersion=p.RowVersion,SnapshotCapturedAt=SYSUTCDATETIME(),SnapshotOrigin='Migration'
 FROM dbo.PackagingConfigurationRequestItem i
 JOIN dbo.OpportunityItem oi ON oi.ID=i.OpportunityItemID
 JOIN dbo.Product p ON p.ID=i.ProductID WHERE i.SnapshotCapturedAt IS NULL;
 EXEC sys.sp_set_session_context N'PackagingChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'PackagingChangeSource',@OldSource;
 EXEC sys.sp_set_session_context N'PackagingChangeReason',@OldReason;
END TRY
BEGIN CATCH
 EXEC sys.sp_set_session_context N'PackagingChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'PackagingChangeSource',@OldSource;
 EXEC sys.sp_set_session_context N'PackagingChangeReason',@OldReason;
 THROW;
END CATCH
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingRequest_Create_AuditImplementation
    @Username NVARCHAR(100), @OpportunityID INT, @ExpectedRowVersion VARBINARY(8),
    @CreationKey UNIQUEIDENTIFIER, @ResponseDue DATE,
    @Items dbo.PackagingRequestSelectionType READONLY, @RequestNotes NVARCHAR(1000)=NULL
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    DECLARE @ActorID INT,@ID INT,@SnapshotAt DATETIME2(7)=SYSUTCDATETIME();
    EXEC dbo.usp_Packaging_Authorize @Username,'Request',@ActorID OUTPUT;
    IF @CreationKey IS NULL OR @ResponseDue IS NULL OR @ResponseDue<CONVERT(DATE,SYSUTCDATETIME())
        THROW 51120,'CreationKey and a response due date of today or later are required.',1;
    IF NOT EXISTS(SELECT 1 FROM @Items) OR (SELECT COUNT(*) FROM @Items)>10000
        THROW 51121,'Select between 1 and 10000 Opportunity items.',1;
    BEGIN TRY
        BEGIN TRANSACTION;
        IF EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequest WITH(UPDLOCK,HOLDLOCK) WHERE CreationKey=@CreationKey)
            THROW 51122,'CreationKey already exists. Retrieve the existing request; do not create another.',1;
        IF NOT EXISTS(SELECT 1 FROM dbo.Opportunity WITH(UPDLOCK,HOLDLOCK)
                      WHERE ID=@OpportunityID AND Stage='Draft' AND RowVersion=@ExpectedRowVersion)
            THROW 51123,'Opportunity must be Draft with the expected RowVersion.',1;
        IF EXISTS(SELECT 1 FROM @Items s LEFT JOIN dbo.OpportunityItem i WITH(UPDLOCK,HOLDLOCK)
            ON i.ID=s.OpportunityItemID AND i.OpportunityID=@OpportunityID
            AND i.Stage='Draft' AND i.RowVersion=s.ExpectedRowVersion WHERE i.ID IS NULL)
            THROW 51124,'Selected items must belong to the Draft Opportunity and have current RowVersions.',1;
        IF EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem p WITH(UPDLOCK,HOLDLOCK)
                  JOIN @Items s ON s.OpportunityItemID=p.OpportunityItemID WHERE p.IsOpen=1)
            THROW 51125,'A selected Opportunity item already has an open Packaging request.',1;
        IF NOT EXISTS(SELECT 1 FROM dbo.Opportunity o JOIN dbo.Customer c WITH(HOLDLOCK)
                      ON c.ID=o.CustomerID AND c.Status='Active' WHERE o.ID=@OpportunityID)
            THROW 51136,'Active Customer is required.',1;
        IF EXISTS(SELECT 1 FROM @Items s JOIN dbo.OpportunityItem i ON i.ID=s.OpportunityItemID
                  JOIN dbo.Product p WITH(HOLDLOCK) ON p.ID=i.ProductID WHERE p.Status<>'Active')
            THROW 51137,'Active Products are required.',1;
        IF EXISTS(SELECT 1 FROM @Items s JOIN dbo.OpportunityItem i ON i.ID=s.OpportunityItemID
         WHERE NULLIF(LTRIM(RTRIM(i.PackagingType)),N'') IS NULL)
         THROW 52962,'Packaging type is required for every selected item before creating a request.',1;
        INSERT dbo.PackagingConfigurationRequest(CreationKey,OpportunityID,OpportunityNumber,CustomerID,
            CustomerName,OpportunityDescription,BidOpen,BidClose,SourceRowVersion,RequestedBy,ResponseDue,RequestNotes,SourceCurrencyID,SourceCurrencyCode,SourceExchangeRateToVND,SnapshotCapturedAt,SnapshotOrigin)
        SELECT @CreationKey,o.ID,o.OpportunityNumber,o.CustomerID,c.CustomerName,o.OpportunityDesc,
            o.BidOpen,o.BidClose,o.RowVersion,@ActorID,@ResponseDue,@RequestNotes,o.CurrencyID,currency.CurrencyCode,o.ExchangeRateToVND,@SnapshotAt,'Request'
        FROM dbo.Opportunity o JOIN dbo.Customer c ON c.ID=o.CustomerID LEFT JOIN dbo.Currency currency WITH(HOLDLOCK) ON currency.ID=o.CurrencyID WHERE o.ID=@OpportunityID;
        SET @ID=SCOPE_IDENTITY();
        INSERT dbo.PackagingConfigurationRequestItem(RequestID,OpportunityItemID,ProductID,ProductCode,
            ProductName,ItemDescription,AnnualUnit,SourceRowVersion,PackagingRequirement,CreatedBy,WeightGrams,Category,Grade,MixRatioPct,PalletSize,PalletStacking,MaxPalletHeightM,ContainerRequest,ConfigurationRequest,PackagingType,RecyclableRequirement,RecycledContent,Transparency,MetalizedAluminum,BarrierRequirement,ShelfLifeDays,SpecialComments,EstPctAwarded,ShelfPrice,SourceProductRowVersion,SnapshotCapturedAt,SnapshotOrigin)
        SELECT @ID,i.ID,i.ProductID,p.ProductCode,p.ProductName,i.ItemDescription,i.AnnualUnit,
            i.RowVersion,s.PackagingRequirement,@ActorID,p.WeightGrams,p.Category,p.Grade,p.MixRatioPct,i.PalletSize,i.PalletStacking,i.MaxPalletHeightM,i.ContainerRequest,i.ConfigurationRequest,i.PackagingType,i.RecyclableRequirement,i.RecycledContent,i.Transparency,i.MetalizedAluminum,i.BarrierRequirement,i.ShelfLifeDays,i.SpecialComments,i.EstPctAwarded,i.ShelfPrice,p.RowVersion,@SnapshotAt,'Request'
        FROM @Items s JOIN dbo.OpportunityItem i ON i.ID=s.OpportunityItemID JOIN dbo.Product p ON p.ID=i.ProductID;
        COMMIT;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK;
        THROW;
    END CATCH;
    SELECT ID,RequestNumber,CreationKey,RowVersion FROM dbo.PackagingConfigurationRequest WHERE ID=@ID;
    SELECT ID,OpportunityItemID,Stage,RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE RequestID=@ID ORDER BY ID;
END;
GO
CREATE OR ALTER TRIGGER dbo.tr_PackagingConfigurationRequest_SnapshotImmutable
 ON dbo.PackagingConfigurationRequest AFTER UPDATE AS
 BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON d.ID=i.ID
 WHERE d.SnapshotCapturedAt IS NOT NULL AND EXISTS(
 SELECT CONVERT(VARBINARY(MAX),i.[OpportunityID]),CONVERT(VARBINARY(MAX),i.[OpportunityNumber]),CONVERT(VARBINARY(MAX),i.[CustomerID]),CONVERT(VARBINARY(MAX),i.[CustomerName]),CONVERT(VARBINARY(MAX),i.[OpportunityDescription]),CONVERT(VARBINARY(MAX),i.[BidOpen]),CONVERT(VARBINARY(MAX),i.[BidClose]),CONVERT(VARBINARY(MAX),i.[RequestedBy]),CONVERT(VARBINARY(MAX),i.[RequestedAt]),CONVERT(VARBINARY(MAX),i.[ResponseDue]),CONVERT(VARBINARY(MAX),i.[RequestNotes]),CONVERT(VARBINARY(MAX),i.[CreationKey]),CONVERT(VARBINARY(MAX),i.[SourceRowVersion]),CONVERT(VARBINARY(MAX),i.[SourceCurrencyID]),CONVERT(VARBINARY(MAX),i.[SourceCurrencyCode]),CONVERT(VARBINARY(MAX),i.[SourceExchangeRateToVND]),CONVERT(VARBINARY(MAX),i.[SnapshotCapturedAt]),CONVERT(VARBINARY(MAX),i.[SnapshotOrigin])
 EXCEPT SELECT CONVERT(VARBINARY(MAX),d.[OpportunityID]),CONVERT(VARBINARY(MAX),d.[OpportunityNumber]),CONVERT(VARBINARY(MAX),d.[CustomerID]),CONVERT(VARBINARY(MAX),d.[CustomerName]),CONVERT(VARBINARY(MAX),d.[OpportunityDescription]),CONVERT(VARBINARY(MAX),d.[BidOpen]),CONVERT(VARBINARY(MAX),d.[BidClose]),CONVERT(VARBINARY(MAX),d.[RequestedBy]),CONVERT(VARBINARY(MAX),d.[RequestedAt]),CONVERT(VARBINARY(MAX),d.[ResponseDue]),CONVERT(VARBINARY(MAX),d.[RequestNotes]),CONVERT(VARBINARY(MAX),d.[CreationKey]),CONVERT(VARBINARY(MAX),d.[SourceRowVersion]),CONVERT(VARBINARY(MAX),d.[SourceCurrencyID]),CONVERT(VARBINARY(MAX),d.[SourceCurrencyCode]),CONVERT(VARBINARY(MAX),d.[SourceExchangeRateToVND]),CONVERT(VARBINARY(MAX),d.[SnapshotCapturedAt]),CONVERT(VARBINARY(MAX),d.[SnapshotOrigin])))
 THROW 52981,'Request specifications are immutable. Cancel the item and create a new request for revised requirements.',1;
 END
GO
CREATE OR ALTER TRIGGER dbo.tr_PackagingConfigurationRequestItem_SnapshotImmutable
 ON dbo.PackagingConfigurationRequestItem AFTER UPDATE AS
 BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON d.ID=i.ID
 WHERE d.SnapshotCapturedAt IS NOT NULL AND EXISTS(
 SELECT CONVERT(VARBINARY(MAX),i.[RequestID]),CONVERT(VARBINARY(MAX),i.[OpportunityItemID]),CONVERT(VARBINARY(MAX),i.[ProductID]),CONVERT(VARBINARY(MAX),i.[ProductCode]),CONVERT(VARBINARY(MAX),i.[ProductName]),CONVERT(VARBINARY(MAX),i.[ItemDescription]),CONVERT(VARBINARY(MAX),i.[AnnualUnit]),CONVERT(VARBINARY(MAX),i.[PackagingRequirement]),CONVERT(VARBINARY(MAX),i.[SourceRowVersion]),CONVERT(VARBINARY(MAX),i.[WeightGrams]),CONVERT(VARBINARY(MAX),i.[Category]),CONVERT(VARBINARY(MAX),i.[Grade]),CONVERT(VARBINARY(MAX),i.[MixRatioPct]),CONVERT(VARBINARY(MAX),i.[PalletSize]),CONVERT(VARBINARY(MAX),i.[PalletStacking]),CONVERT(VARBINARY(MAX),i.[MaxPalletHeightM]),CONVERT(VARBINARY(MAX),i.[ContainerRequest]),CONVERT(VARBINARY(MAX),i.[ConfigurationRequest]),CONVERT(VARBINARY(MAX),i.[PackagingType]),CONVERT(VARBINARY(MAX),i.[RecyclableRequirement]),CONVERT(VARBINARY(MAX),i.[RecycledContent]),CONVERT(VARBINARY(MAX),i.[Transparency]),CONVERT(VARBINARY(MAX),i.[MetalizedAluminum]),CONVERT(VARBINARY(MAX),i.[BarrierRequirement]),CONVERT(VARBINARY(MAX),i.[ShelfLifeDays]),CONVERT(VARBINARY(MAX),i.[SpecialComments]),CONVERT(VARBINARY(MAX),i.[EstPctAwarded]),CONVERT(VARBINARY(MAX),i.[ShelfPrice]),CONVERT(VARBINARY(MAX),i.[SourceProductRowVersion]),CONVERT(VARBINARY(MAX),i.[SnapshotCapturedAt]),CONVERT(VARBINARY(MAX),i.[SnapshotOrigin])
 EXCEPT SELECT CONVERT(VARBINARY(MAX),d.[RequestID]),CONVERT(VARBINARY(MAX),d.[OpportunityItemID]),CONVERT(VARBINARY(MAX),d.[ProductID]),CONVERT(VARBINARY(MAX),d.[ProductCode]),CONVERT(VARBINARY(MAX),d.[ProductName]),CONVERT(VARBINARY(MAX),d.[ItemDescription]),CONVERT(VARBINARY(MAX),d.[AnnualUnit]),CONVERT(VARBINARY(MAX),d.[PackagingRequirement]),CONVERT(VARBINARY(MAX),d.[SourceRowVersion]),CONVERT(VARBINARY(MAX),d.[WeightGrams]),CONVERT(VARBINARY(MAX),d.[Category]),CONVERT(VARBINARY(MAX),d.[Grade]),CONVERT(VARBINARY(MAX),d.[MixRatioPct]),CONVERT(VARBINARY(MAX),d.[PalletSize]),CONVERT(VARBINARY(MAX),d.[PalletStacking]),CONVERT(VARBINARY(MAX),d.[MaxPalletHeightM]),CONVERT(VARBINARY(MAX),d.[ContainerRequest]),CONVERT(VARBINARY(MAX),d.[ConfigurationRequest]),CONVERT(VARBINARY(MAX),d.[PackagingType]),CONVERT(VARBINARY(MAX),d.[RecyclableRequirement]),CONVERT(VARBINARY(MAX),d.[RecycledContent]),CONVERT(VARBINARY(MAX),d.[Transparency]),CONVERT(VARBINARY(MAX),d.[MetalizedAluminum]),CONVERT(VARBINARY(MAX),d.[BarrierRequirement]),CONVERT(VARBINARY(MAX),d.[ShelfLifeDays]),CONVERT(VARBINARY(MAX),d.[SpecialComments]),CONVERT(VARBINARY(MAX),d.[EstPctAwarded]),CONVERT(VARBINARY(MAX),d.[ShelfPrice]),CONVERT(VARBINARY(MAX),d.[SourceProductRowVersion]),CONVERT(VARBINARY(MAX),d.[SnapshotCapturedAt]),CONVERT(VARBINARY(MAX),d.[SnapshotOrigin])))
 THROW 52981,'Request specifications are immutable. Cancel the item and create a new request for revised requirements.',1;
 END
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingRequest_Grid_Read
    @Username NVARCHAR(100), @RequestID INT=NULL, @OpportunityID INT=NULL,
    @ProductCode VARCHAR(20)=NULL, @CustomerName VARCHAR(200)=NULL,
    @Stage VARCHAR(20)=NULL, @PICUserID INT=NULL, @DueFrom DATE=NULL, @DueTo DATE=NULL,
    @AfterID INT=0, @PageSize INT=500, @CreationKey UNIQUEIDENTIFIER=NULL,
    @PageNumber INT=NULL, @OpportunityNumber VARCHAR(20)=NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ActorID INT;
    EXEC dbo.usp_Packaging_Authorize @Username,'Read',@ActorID OUTPUT;
    DECLARE @CanReadDraft BIT=0;
    IF EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@ActorID
              AND Scope IN(N'Packaging',N'PackagingManager',N'Admin')) SET @CanReadDraft=1;
    IF @PageSize IS NULL OR @PageSize NOT BETWEEN 1 AND 500 OR @AfterID IS NULL OR @AfterID<0
        THROW 51135,'Page size must be 1-500 and AfterID must be nonnegative.',1;
    IF @PageNumber IS NOT NULL AND (@PageNumber<1 OR @AfterID<>0)
        THROW 51135,'Use page numbers or AfterID, not both.',1;
    ;WITH Matched AS (
        SELECT i.ID AS ItemID,h.ID AS RequestID,h.RequestNumber,h.CreationKey,
            h.RequestedBy,requester.UserName AS RequestedByName,h.RequestedAt,h.ResponseDue,h.RequestNotes,
            h.OpportunityID,h.OpportunityNumber,h.CustomerName,h.OpportunityDescription,h.BidOpen,h.BidClose,
            h.RowVersion AS HeaderRowVersion,i.OpportunityItemID,i.ProductID,i.ProductCode,i.ProductName,
            i.ItemDescription,i.AnnualUnit,i.PackagingRequirement,i.PICUserID,u.UserName AS PIC,
            i.Stage AS ItemStage,i.WeightGrams,i.Category,i.Grade,i.MixRatioPct,i.PalletSize,i.PalletStacking,i.MaxPalletHeightM,i.ContainerRequest,i.ConfigurationRequest,i.PackagingType,i.RecyclableRequirement,i.RecycledContent,i.Transparency,i.MetalizedAluminum,i.BarrierRequirement,i.ShelfLifeDays,i.SpecialComments,i.EstPctAwarded,i.ShelfPrice,i.SnapshotCapturedAt,i.SnapshotOrigin,
 h.SourceCurrencyID,h.SourceCurrencyCode,h.SourceExchangeRateToVND,
            CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.MaterialID END AS MaterialID,
            CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN m.MaterialCode END AS MaterialCode,
            CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.HeightMM END AS HeightMM,
            CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.WidthMM END AS WidthMM,
            CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.LengthMM END AS LengthMM,
            CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.Cost END AS Cost,
            CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.CurrencyID END AS CurrencyID,
            CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN c.CurrencyCode END AS CurrencyCode,
            CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.CostBasis END AS CostBasis,
            CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.ResponseNotes END AS ResponseNotes,
            i.SubmittedAt,i.SubmittedBy,i.ReviewedAt,i.ReviewedBy,
            CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.ManagerComment END AS ManagerComment,
            i.RowVersion AS ItemRowVersion,
            CASE WHEN totals.OpenCount>0 THEN 'Open'
                 WHEN totals.ApprovedCount>0 THEN 'Completed' ELSE 'Canceled' END AS RequestStatus,
            CONVERT(BIT,CASE WHEN o.RowVersion<>h.SourceRowVersion OR oi.RowVersion<>i.SourceRowVersion THEN 1 ELSE 0 END) AS SourceChanged,
            COUNT_BIG(*) OVER() AS TotalMatchingRows
        FROM dbo.PackagingConfigurationRequest h
        JOIN dbo.Users requester ON requester.ID=h.RequestedBy
        JOIN dbo.PackagingConfigurationRequestItem i ON i.RequestID=h.ID
        JOIN dbo.Opportunity o ON o.ID=h.OpportunityID
        JOIN dbo.OpportunityItem oi ON oi.ID=i.OpportunityItemID
        LEFT JOIN dbo.Users u ON u.ID=i.PICUserID
        LEFT JOIN dbo.PackagingMaterial m ON m.ID=i.MaterialID
        LEFT JOIN dbo.Currency c ON c.ID=i.CurrencyID
        CROSS APPLY (SELECT SUM(CONVERT(INT,t.IsOpen)) OpenCount,
            SUM(CASE WHEN t.Stage='Approved' THEN 1 ELSE 0 END) ApprovedCount
            FROM dbo.PackagingConfigurationRequestItem t WHERE t.RequestID=h.ID) totals
        WHERE (@RequestID IS NULL OR h.ID=@RequestID)
          AND (@CreationKey IS NULL OR h.CreationKey=@CreationKey)
          AND (@OpportunityID IS NULL OR h.OpportunityID=@OpportunityID)
          AND (@OpportunityNumber IS NULL OR h.OpportunityNumber LIKE @OpportunityNumber+'%')
          AND (@ProductCode IS NULL OR i.ProductCode LIKE @ProductCode+'%')
          AND (@CustomerName IS NULL OR h.CustomerName LIKE @CustomerName+'%')
          AND (@Stage IS NULL OR i.Stage=@Stage)
          AND (@PICUserID IS NULL OR i.PICUserID=@PICUserID)
          AND (@DueFrom IS NULL OR h.ResponseDue>=@DueFrom)
          AND (@DueTo IS NULL OR h.ResponseDue<=@DueTo)
    )
    SELECT * FROM Matched WHERE ItemID>@AfterID ORDER BY ItemID
    OFFSET (CONVERT(BIGINT,COALESCE(@PageNumber,1))-1)*@PageSize ROWS
    FETCH NEXT @PageSize ROWS ONLY;
END;
GO
COMMIT TRANSACTION;
GO
