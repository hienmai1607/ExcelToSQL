:on error exit
/*
PythonBridge VM upgrade: migrations 89-96, generated 2026-10-08.
Existing application database only; apply migrations through 88 first.
Back up the database and stop the API before executing.
SSMS: select your application database and enable Query > SQLCMD Mode.
sqlcmd -S YOUR_SERVER -d YOUR_DATABASE -E -b -i upgrade_089_to_096_vm.sql
No external includes, credentials, local USE directives or sample records.
Source transaction boundaries are preserved. This upgrade is NOT atomic;
earlier committed changes remain if a later batch fails. Stop and investigate.
Historical columns/JSON remain. Migration 94 removes obsolete Product Loss
snapshot/write objects, not historical records.
Deploy matching core/, webapp/dist/ and templates/Opportunity_Local_Update.xlsm.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
GO
IF DB_NAME() IN (N'master',N'model',N'msdb',N'tempdb')
 THROW 52995,'Select the existing PythonBridge application database, not a system database.',1;
IF @@TRANCOUNT<>0
 THROW 52995,'Run this upgrade on a new connection without an existing transaction.',1;
IF (SELECT compatibility_level FROM sys.databases WHERE database_id=DB_ID())<130
 THROW 52995,'PythonBridge requires database compatibility level 130 or higher.',1;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','SameConfig') IS NULL
 OR CHARINDEX(N'-- Mix Same config.',COALESCE(OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation')),N''))=0
 THROW 52995,'Apply migrations through 88 before this upgrade; it is not a fresh-install script.',1;
PRINT N'Applying PythonBridge migrations 89-96 to '+QUOTENAME(DB_NAME());
GO
-- BEGIN MIGRATION 89_opportunity_shipment_costs.sql
PRINT N'Applying 89_opportunity_shipment_costs.sql';
GO
-- After 88. Select the intended application database before running.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','SameConfig') IS NULL
 THROW 52996,'Apply migrations through 88 before Shipment information.',1;
IF OBJECT_ID('dbo.PortOfEntry','U') IS NULL
 CREATE TABLE dbo.PortOfEntry(
  ID INT IDENTITY PRIMARY KEY,CustomerID INT NOT NULL REFERENCES dbo.Customer(ID),
  MarketID INT NOT NULL REFERENCES dbo.Market(ID),PortCode NVARCHAR(30) NOT NULL,
  PortName NVARCHAR(200) NOT NULL,Status VARCHAR(10) NOT NULL DEFAULT('Active'),
  CreatedBy INT NOT NULL REFERENCES dbo.Users(ID),CreatedAt DATETIME2 NOT NULL DEFAULT(SYSUTCDATETIME()),
  UpdatedBy INT NULL REFERENCES dbo.Users(ID),UpdatedAt DATETIME2 NULL,RowVersion ROWVERSION,
  CONSTRAINT UQ_PortOfEntry_CustomerMarketCode UNIQUE(CustomerID,MarketID,PortCode),
  CONSTRAINT CK_PortOfEntry_Status CHECK(Status IN('Active','Block')));
IF COL_LENGTH('dbo.OpportunityItem','ShipmentCostInfo') IS NULL
 ALTER TABLE dbo.OpportunityItem ADD ShipmentCostInfo NVARCHAR(MAX) NULL
 CONSTRAINT CK_OpportunityItem_ShipmentCostInfo CHECK(ShipmentCostInfo IS NULL OR ISJSON(ShipmentCostInfo)=1);
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','ShipmentContainerSizeFT') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD ShipmentContainerSizeFT VARCHAR(4) NULL
 CONSTRAINT CK_PCRItem_ShipmentContainerSizeFT CHECK(ShipmentContainerSizeFT IN('20FT','40FT'));
GO
CREATE OR ALTER PROCEDURE dbo.usp_OpportunityShipment_Validate @ID INT,@Value NVARCHAR(MAX)
AS
BEGIN
 SET NOCOUNT ON;

 IF @Value IS NULL RETURN;
 IF ISJSON(@Value)<>1 OR LEFT(LTRIM(@Value),1)<>'{' THROW 52996,'Shipment information must be a JSON object.',1;
 IF EXISTS(SELECT 1 FROM dbo.OpportunityItem WHERE ID=@ID AND ParentItemID IS NOT NULL)
  THROW 52996,'Shipment, Logistics, Co-Man and Others belong to the Mix parent.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Value) WHERE [key] NOT IN('Incoterm','PortOfEntryID','ContainerSizeFT','FreightUSDPerContainer','DutyPct','ImportClearanceUSDPerContainer','PortToWHUSDPerContainer','WHCostUSDPerPallet','OverageShortageDamagePct','WHToCoManWHUSDPerPallet','CoManOverheadUSDPerPallet','FreightToCustomerUSDPerPallet','SpoilageAllowancePct','PaymentTermPct','CoManFeePct','BrokerFeePct','PackingUSDPerLb','InitialDesignUSD','OtherFixedCostsUSD','FobbingUSDPerContainer','InterestPct','InterestMonths','MarginPct'))
  OR EXISTS(SELECT [key] FROM OPENJSON(@Value) GROUP BY [key] HAVING COUNT(*)>1)
  THROW 52996,'Unknown or duplicate shipment information field.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Value) WHERE [type]<>0 AND
  (([key]='Incoterm' AND ([type]<>1 OR [value] NOT IN('CFA','DDP','EXW','FOB')))
  OR ([key]='ContainerSizeFT' AND ([type]<>1 OR [value] NOT IN('20FT','40FT')))
  OR ([key]='PortOfEntryID' AND ([type] NOT IN(1,2) OR TRY_CONVERT(INT,[value]) IS NULL OR TRY_CONVERT(INT,[value])<1))))
  THROW 52996,'Check Incoterm, Port of Entry and Container size.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Value) WHERE [key] IN('FreightUSDPerContainer','DutyPct','ImportClearanceUSDPerContainer','PortToWHUSDPerContainer','WHCostUSDPerPallet','OverageShortageDamagePct','WHToCoManWHUSDPerPallet','CoManOverheadUSDPerPallet','FreightToCustomerUSDPerPallet','SpoilageAllowancePct','PaymentTermPct','CoManFeePct','BrokerFeePct','PackingUSDPerLb','InitialDesignUSD','OtherFixedCostsUSD','FobbingUSDPerContainer','InterestPct','InterestMonths','MarginPct') AND [type]<>0 AND
  ([type] NOT IN(1,2) OR TRY_CONVERT(DECIMAL(19,2),NULLIF([value],'')) IS NULL
   OR TRY_CONVERT(DECIMAL(19,2),[value])<0 OR [value] LIKE '%[eE]%'
   OR (CHARINDEX('.', [value])>0 AND LEN(SUBSTRING([value],CHARINDEX('.', [value])+1,100))>2)
   OR ([key] IN('DutyPct','OverageShortageDamagePct','SpoilageAllowancePct','PaymentTermPct','CoManFeePct','BrokerFeePct','InterestPct','MarginPct') AND TRY_CONVERT(DECIMAL(19,2),[value])>100)
   OR ([key]='InterestMonths' AND (TRY_CONVERT(INT,[value]) IS NULL
    OR TRY_CONVERT(DECIMAL(19,2),[value])<>TRY_CONVERT(INT,[value])))))
  THROW 52996,'Use nonnegative USD amounts with up to two decimals, percentages 0-100, and whole Interest months.',1;
 DECLARE @Port INT=TRY_CONVERT(INT,JSON_VALUE(@Value,'$.PortOfEntryID'));
 IF @Port IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.OpportunityItem WHERE ID=@ID
   AND TRY_CONVERT(INT,JSON_VALUE(ShipmentCostInfo,'$.PortOfEntryID'))=@Port)
  AND NOT EXISTS(SELECT 1 FROM dbo.PortOfEntry p JOIN dbo.OpportunityItem i ON i.ID=@ID
   JOIN dbo.Opportunity o ON o.ID=i.OpportunityID JOIN dbo.Customer c ON c.ID=o.CustomerID
   WHERE p.ID=@Port AND p.CustomerID=c.ID AND p.MarketID=c.MarketID AND p.Status='Active')
  THROW 52996,'Choose an active Port of Entry for this Customer and Market.',1;

END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PortOfEntry_Save
 @Username NVARCHAR(100),@ID INT,@ExpectedRowVersion VARBINARY(8),
 @CustomerID INT,@MarketID INT,@PortCode NVARCHAR(30),@PortName NVARCHAR(200),@Status VARCHAR(10)
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 DECLARE @Actor INT;
 SELECT @Actor=u.ID FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
 WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope='Admin';
 IF @Actor IS NULL THROW 52998,'Admin access is required to maintain Ports of Entry.',1;
 IF NULLIF(LTRIM(RTRIM(@PortCode)),N'') IS NULL OR NULLIF(LTRIM(RTRIM(@PortName)),N'') IS NULL
  OR @Status NOT IN('Active','Block') THROW 52996,'Enter a Port code, name and valid status.',1;
 BEGIN TRANSACTION;
 IF NOT EXISTS(SELECT 1 FROM dbo.Customer WITH(HOLDLOCK) WHERE ID=@CustomerID AND Status='Active')
  OR NOT EXISTS(SELECT 1 FROM dbo.Market WITH(HOLDLOCK) WHERE ID=@MarketID)
  THROW 52996,'Choose an active Customer and a valid Market.',1;
 IF @ID IS NULL BEGIN
  INSERT dbo.PortOfEntry(CustomerID,MarketID,PortCode,PortName,Status,CreatedBy)
  VALUES(@CustomerID,@MarketID,LTRIM(RTRIM(@PortCode)),LTRIM(RTRIM(@PortName)),@Status,@Actor);
  SET @ID=CONVERT(INT,SCOPE_IDENTITY());
 END ELSE BEGIN
  IF NOT EXISTS(SELECT 1 FROM dbo.PortOfEntry WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@ExpectedRowVersion)
   THROW 52997,'Port of Entry changed. Refresh and retry.',1;
  UPDATE dbo.PortOfEntry SET CustomerID=@CustomerID,MarketID=@MarketID,PortCode=LTRIM(RTRIM(@PortCode)),
   PortName=LTRIM(RTRIM(@PortName)),Status=@Status,UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME() WHERE ID=@ID;
 END;
 COMMIT;
 SELECT ID,RowVersion FROM dbo.PortOfEntry WHERE ID=@ID;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_OpportunityShipmentLookup_Read @Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
  WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope IN('Admin','Opportunity'))
  THROW 52998,'Opportunity access is required.',1;
 SELECT c.ID,c.MarketID,m.MarketCode,m.MarketName FROM dbo.Customer c JOIN dbo.Market m ON m.ID=c.MarketID WHERE c.Status='Active';
 SELECT p.ID,p.CustomerID,p.MarketID,p.PortCode,p.PortName FROM dbo.PortOfEntry p
 JOIN dbo.Customer c ON c.ID=p.CustomerID AND c.MarketID=p.MarketID
 WHERE p.Status='Active' AND c.Status='Active' ORDER BY p.PortName,p.ID;
END;
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityItem_Fields_Save'));
IF @D IS NULL OR CHARINDEX(N'-- Mix parent packaging orders.',@D)=0
 THROW 52996,'Opportunity field validation is missing.',1;
IF CHARINDEX(N'-- Shipment cost information.',@D)=0 BEGIN
 IF CHARINDEX(N'WHERE [key] NOT IN(',@D)=0 OR CHARINDEX(N'UPDATE t SET',@D)=0
  OR CHARINDEX(N'DECLARE @OldUser SQL_VARIANT',@D)=0 THROW 52996,'Unexpected Opportunity fields signature.',1;
 SET @D=REPLACE(@D,N'WHERE [key] NOT IN(',N'WHERE [key] NOT IN(''ShipmentCostInfo'',');
 SET @D=REPLACE(@D,N'DECLARE @OldUser SQL_VARIANT',N'-- Shipment cost information.
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''ShipmentCostInfo'')
 BEGIN
  IF EXISTS(SELECT 1 FROM dbo.OpportunityItem WHERE ID=@ID AND ParentItemID IS NOT NULL)
   THROW 52996,''Shipment, Logistics, Co-Man and Others belong to the Mix parent.'',1;
  IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''ShipmentCostInfo'' AND [type] NOT IN(0,5))
   THROW 52996,''Shipment information must be an object.'',1;
  DECLARE @Shipment NVARCHAR(MAX)=JSON_QUERY(@Fields,''$.ShipmentCostInfo'');
  EXEC dbo.usp_OpportunityShipment_Validate @ID,@Shipment;
 END;
 DECLARE @OldUser SQL_VARIANT');
 SET @D=REPLACE(@D,N'UPDATE t SET',N'UPDATE t SET
 ShipmentCostInfo=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''ShipmentCostInfo'') THEN JSON_QUERY(@Fields,''$.ShipmentCostInfo'') ELSE t.ShipmentCostInfo END,');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.tr_OpportunityItem_ChangeLog'));
IF @D IS NULL THROW 52996,'Opportunity item audit trigger is missing.',1;
IF CHARINDEX(N'''ShipmentCostInfo''',@D)=0 BEGIN
 IF CHARINDEX(N'(''ShelfPrice'',',@D)=0 THROW 52996,'Unexpected Opportunity audit signature.',1;
 SET @D=REPLACE(@D,N'(''ShelfPrice'',',N'(''ShipmentCostInfo'',d.ShipmentCostInfo,i.ShipmentCostInfo),
 (''ShelfPrice'',');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER TRIGGER',N'ALTER TRIGGER'),N'CREATE   TRIGGER',N'ALTER TRIGGER'),N'CREATE TRIGGER',N'ALTER TRIGGER');
 EXEC sys.sp_executesql @D;
END;
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingRequest_Create_AuditImplementation'));
IF @D IS NULL OR CHARINDEX(N'ProductMixSnapshot',@D)=0 THROW 52996,'Mix snapshot creation is missing.',1;
IF CHARINDEX(N'ShipmentContainerSizeFT',@D)=0 BEGIN
 IF CHARINDEX(N'NumberOfSecondary,ProductMixSnapshot,',@D)=0 OR CHARINDEX(N'i.NumberOfSecondary,(SELECT StructureJSON',@D)=0
  THROW 52996,'Unexpected request snapshot signature.',1;
 SET @D=REPLACE(@D,N'NumberOfSecondary,ProductMixSnapshot,',N'NumberOfSecondary,ShipmentContainerSizeFT,ProductMixSnapshot,');
 SET @D=REPLACE(@D,N'i.NumberOfSecondary,(SELECT StructureJSON',N'i.NumberOfSecondary,
  (SELECT JSON_VALUE(ShipmentCostInfo,''$.ContainerSizeFT'') FROM dbo.OpportunityItem WHERE ID=COALESCE(i.ParentItemID,i.ID)),(SELECT StructureJSON');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
CREATE OR ALTER TRIGGER dbo.tr_PCRItem_ShipmentSizeImmutable
ON dbo.PackagingConfigurationRequestItem AFTER UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON d.ID=i.ID
  WHERE EXISTS(SELECT i.ShipmentContainerSizeFT EXCEPT SELECT d.ShipmentContainerSizeFT))
  THROW 52996,'The requested Shipment container size is immutable.',1;
END;
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation'));
IF @D IS NULL OR CHARINDEX(N'-- Mix Same config.',@D)=0 THROW 52996,'Apply migration 88 first.',1;
IF CHARINDEX(N'-- Shipment size response filter.',@D)=0 BEGIN
 IF CHARINDEX(N'-- Container type profiles:',@D)=0 THROW 52996,'Container response validation is missing.',1;
 SET @D=REPLACE(@D,N'-- Container type profiles:',N'-- Shipment size response filter.
 DECLARE @ShipmentSize VARCHAR(4)=(SELECT ShipmentContainerSizeFT FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ID);
 DECLARE @ShipmentType VARCHAR(10)=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''SelectedContainerType'')
  THEN JSON_VALUE(@Fields,''$.SelectedContainerType'') ELSE (SELECT SelectedContainerType FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ID) END;
 IF @ShipmentType IS NOT NULL AND ((@ShipmentSize=''20FT'' AND @ShipmentType NOT IN(''20DC'',''20RC''))
  OR (@ShipmentSize=''40FT'' AND @ShipmentType NOT IN(''40DC'',''40HC'',''40RHC'')))
  THROW 52996,''Choose a Container type matching the requested Shipment size.'',1;
 -- Container type profiles:');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
COMMIT;
GO
-- END MIGRATION 89_opportunity_shipment_costs.sql
GO
-- BEGIN MIGRATION 90_port_name_only.sql
PRINT N'Applying 90_port_name_only.sql';
GO
-- Apply after 89 in the intended application database.
-- Remove Port code from maintenance without deleting historical codes, IDs or links.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
IF OBJECT_ID('dbo.PortOfEntry','U') IS NULL
 THROW 52996,'Apply 89 before the Port name-only migration.',1;
BEGIN TRANSACTION;
IF EXISTS(SELECT 1 FROM sys.key_constraints WHERE parent_object_id=OBJECT_ID('dbo.PortOfEntry')
 AND name='UQ_PortOfEntry_CustomerMarketCode')
 ALTER TABLE dbo.PortOfEntry DROP CONSTRAINT UQ_PortOfEntry_CustomerMarketCode;
IF EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.PortOfEntry') AND name='UX_PortOfEntry_LegacyCode')
 DROP INDEX UX_PortOfEntry_LegacyCode ON dbo.PortOfEntry;
IF EXISTS(SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.PortOfEntry') AND name='PortCode' AND is_nullable=0)
 ALTER TABLE dbo.PortOfEntry ALTER COLUMN PortCode NVARCHAR(30) NULL;
COMMIT;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PortOfEntry_Save
 @Username NVARCHAR(100),@ID INT,@ExpectedRowVersion VARBINARY(8),
 @CustomerID INT,@MarketID INT,@PortName NVARCHAR(200),@Status VARCHAR(10)
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 DECLARE @Actor INT;
 SELECT @Actor=u.ID FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
 WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope='Admin';
 IF @Actor IS NULL THROW 52998,'Admin access is required to maintain Ports of Entry.',1;
 IF NULLIF(LTRIM(RTRIM(@PortName)),N'') IS NULL
  OR @Status NOT IN('Active','Block') THROW 52996,'Enter a Port name and valid status.',1;
 BEGIN TRANSACTION;
 IF NOT EXISTS(SELECT 1 FROM dbo.Customer WITH(HOLDLOCK) WHERE ID=@CustomerID AND Status='Active')
  OR NOT EXISTS(SELECT 1 FROM dbo.Market WITH(HOLDLOCK) WHERE ID=@MarketID)
  THROW 52996,'Choose an active Customer and a valid Market.',1;
 IF EXISTS(SELECT 1 FROM dbo.PortOfEntry WITH(UPDLOCK,HOLDLOCK)
  WHERE CustomerID=@CustomerID AND MarketID=@MarketID AND PortName=LTRIM(RTRIM(@PortName))
   AND (@ID IS NULL OR ID<>@ID))
  THROW 52996,'That Port name already exists for this Customer and Market.',1;
 IF @ID IS NULL BEGIN
  INSERT dbo.PortOfEntry(CustomerID,MarketID,PortName,Status,CreatedBy)
  VALUES(@CustomerID,@MarketID,LTRIM(RTRIM(@PortName)),@Status,@Actor);
  SET @ID=CONVERT(INT,SCOPE_IDENTITY());
 END ELSE BEGIN
  IF NOT EXISTS(SELECT 1 FROM dbo.PortOfEntry WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@ExpectedRowVersion)
   THROW 52997,'Port of Entry changed. Refresh and retry.',1;
  UPDATE dbo.PortOfEntry SET CustomerID=@CustomerID,MarketID=@MarketID,
   PortName=LTRIM(RTRIM(@PortName)),Status=@Status,UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME() WHERE ID=@ID;
 END;
 COMMIT;
 SELECT ID,RowVersion FROM dbo.PortOfEntry WHERE ID=@ID;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_OpportunityShipmentLookup_Read @Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
  WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope IN('Admin','Opportunity'))
  THROW 52998,'Opportunity access is required.',1;
 SELECT c.ID,c.MarketID,m.MarketCode,m.MarketName FROM dbo.Customer c JOIN dbo.Market m ON m.ID=c.MarketID WHERE c.Status='Active';
 SELECT p.ID,p.CustomerID,p.MarketID,p.PortName FROM dbo.PortOfEntry p
 JOIN dbo.Customer c ON c.ID=p.CustomerID AND c.MarketID=p.MarketID
 WHERE p.Status='Active' AND c.Status='Active' ORDER BY p.PortName,p.ID;
END;
GO
-- END MIGRATION 90_port_name_only.sql
GO
-- BEGIN MIGRATION 91_opportunity_tcb.sql
PRINT N'Applying 91_opportunity_tcb.sql';
GO
-- After 90. Run in the intended application database. No history is removed.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
IF COL_LENGTH('dbo.OpportunityItem','TCBCostInfo') IS NULL
 ALTER TABLE dbo.OpportunityItem ADD TCBCostInfo NVARCHAR(MAX) NULL
 CONSTRAINT CK_OpportunityItem_TCBCostInfo CHECK(TCBCostInfo IS NULL OR ISJSON(TCBCostInfo)=1);
GO
CREATE OR ALTER PROCEDURE dbo.usp_OpportunityTCB_Save
 @Username NVARCHAR(100),@ID INT,@ExpectedRowVersion VARBINARY(8),@Value NVARCHAR(MAX)
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 DECLARE @Actor INT,@OpportunityID INT,@Old NVARCHAR(MAX);
 SELECT @Actor=u.ID FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
 WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope IN('Admin','Opportunity');
 IF @Actor IS NULL THROW 52998,'Opportunity access is required.',1;
 IF @Value IS NULL OR ISJSON(@Value)<>1 OR LEFT(LTRIM(@Value),1)<>'{' THROW 52996,'TCB information must be JSON.',1;
 BEGIN TRY
 BEGIN TRANSACTION;
 SELECT @OpportunityID=i.OpportunityID,@Old=i.TCBCostInfo
 FROM dbo.OpportunityItem i WITH(UPDLOCK,HOLDLOCK)
 JOIN dbo.Opportunity o WITH(UPDLOCK,HOLDLOCK) ON o.ID=i.OpportunityID
 WHERE i.ID=@ID AND i.RowVersion=@ExpectedRowVersion AND i.Stage='Draft' AND o.Stage='Draft';
 IF @OpportunityID IS NULL THROW 52997,'Item changed or is no longer Draft. Refresh before saving TCB.',1;
 -- A price cannot change between API calculation and this write.
 IF EXISTS(SELECT 1 FROM OPENJSON(@Value,'$.PriceSnapshots') WITH
  (PriceID INT,PriceVersion VARCHAR(18)) selected
  LEFT JOIN dbo.RawMaterialPrice p WITH(UPDLOCK,HOLDLOCK) ON p.ID=selected.PriceID
  WHERE p.ID IS NULL OR TRY_CONVERT(VARBINARY(8),selected.PriceVersion,1) IS NULL
   OR TRY_CONVERT(VARBINARY(8),selected.PriceVersion,1)<>p.RowVersion)
  THROW 52997,'Selected raw-material price changed. Refresh before saving TCB.',1;
 UPDATE dbo.OpportunityItem SET TCBCostInfo=@Value WHERE ID=@ID;
 INSERT dbo.OpportunityChangeLog(EventID,OpportunityID,EntityLevel,ItemID,ItemLabel,Action,
  FieldName,OldValue,NewValue,ChangedBy,Source,Reason)
 SELECT NEWID(),@OpportunityID,'Item',@ID,p.ProductCode,'Update','TCBCostInfo',@Old,@Value,@Username,'User','TCB Calculator'
 FROM dbo.OpportunityItem i JOIN dbo.Product p ON p.ID=i.ProductID WHERE i.ID=@ID;
 SELECT ID,RowVersion FROM dbo.OpportunityItem WHERE ID=@ID;
 COMMIT;
 END TRY
 BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
 END CATCH
END;
GO
-- END MIGRATION 91_opportunity_tcb.sql
GO
-- BEGIN MIGRATION 92_loss_process_master.sql
PRINT N'Applying 92_loss_process_master.sql';
GO
-- After 91. Select the intended application database. No history is removed.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
IF COL_LENGTH('dbo.OpportunityItem','TCBCostInfo') IS NULL
 THROW 52996,'Apply migration 91 before Loss Process Master.',1;
IF OBJECT_ID('dbo.LossProcessMaster','U') IS NULL
BEGIN
 CREATE TABLE dbo.LossProcessMaster(
  ID INT IDENTITY PRIMARY KEY,ProcessType VARCHAR(32) NOT NULL,Sequence INT NOT NULL,
  LossPct DECIMAL(5,2) NOT NULL,Status VARCHAR(10) NOT NULL DEFAULT('Active'),
  CreatedBy INT NOT NULL REFERENCES dbo.Users(ID),CreatedAt DATETIME2 NOT NULL DEFAULT(SYSUTCDATETIME()),
  UpdatedBy INT NULL REFERENCES dbo.Users(ID),UpdatedAt DATETIME2 NULL,RowVersion ROWVERSION,
  CONSTRAINT CK_LossProcessMaster_Type CHECK(ProcessType IN('Sorting','Processing','PrimaryPackaging',
   'SecondaryPackaging','TertiaryPackaging','MixPrimaryPackaging','MixSecondaryPackaging','MixTertiaryPackaging')),
  CONSTRAINT CK_LossProcessMaster_Values CHECK(Sequence BETWEEN 1 AND 1000 AND LossPct BETWEEN 0 AND 100),
  CONSTRAINT CK_LossProcessMaster_Status CHECK(Status IN('Active','Block')));
 CREATE UNIQUE INDEX UX_LossProcessMaster_ActiveValues ON dbo.LossProcessMaster(ProcessType,Sequence,LossPct)
  WHERE Status='Active';
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_LossProcessMaster_Save
 @Username NVARCHAR(100),@ID INT=NULL,@ExpectedRowVersion VARBINARY(8)=NULL,
 @ProcessType VARCHAR(32)=NULL,@Sequence INT=NULL,@LossPct DECIMAL(5,2)=NULL,@Status VARCHAR(10)='Active'
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 DECLARE @Actor INT;
 SELECT @Actor=u.ID FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
 WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope='Admin';
 IF @Actor IS NULL THROW 52998,'Admin access is required to maintain Loss Process Master.',1;
 IF @ProcessType IS NULL OR @ProcessType NOT IN('Sorting','Processing','PrimaryPackaging','SecondaryPackaging',
   'TertiaryPackaging','MixPrimaryPackaging','MixSecondaryPackaging','MixTertiaryPackaging')
  OR @Sequence IS NULL OR @Sequence NOT BETWEEN 1 AND 1000 OR @LossPct IS NULL OR @LossPct NOT BETWEEN 0 AND 100
  OR @Status IS NULL OR @Status NOT IN('Active','Block') THROW 52996,'Check process type, sequence, loss and status.',1;
 BEGIN TRY
 BEGIN TRANSACTION;
 IF @Status='Active' AND EXISTS(SELECT 1 FROM dbo.LossProcessMaster WITH(UPDLOCK,HOLDLOCK)
  WHERE ProcessType=@ProcessType AND Sequence=@Sequence AND LossPct=@LossPct AND Status='Active'
   AND (@ID IS NULL OR ID<>@ID))
  THROW 52996,'An active Loss Process with these values already exists.',1;
 IF @ID IS NULL
 BEGIN
  INSERT dbo.LossProcessMaster(ProcessType,Sequence,LossPct,Status,CreatedBy)
  VALUES(@ProcessType,@Sequence,@LossPct,@Status,@Actor);
  SET @ID=CONVERT(INT,SCOPE_IDENTITY());
 END ELSE BEGIN
  IF NOT EXISTS(SELECT 1 FROM dbo.LossProcessMaster WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@ExpectedRowVersion)
   THROW 52997,'Loss Process changed. Refresh before saving.',1;
  UPDATE dbo.LossProcessMaster SET ProcessType=@ProcessType,Sequence=@Sequence,LossPct=@LossPct,Status=@Status,
   UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME() WHERE ID=@ID;
 END;
 SELECT ID,RowVersion FROM dbo.LossProcessMaster WHERE ID=@ID;
 COMMIT;
 END TRY
 BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
 END CATCH
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_OpportunityTCB_Save
 @Username NVARCHAR(100),@ID INT,@ExpectedRowVersion VARBINARY(8),@Value NVARCHAR(MAX)
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 DECLARE @Actor INT,@OpportunityID INT,@Old NVARCHAR(MAX);
 SELECT @Actor=u.ID FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
 WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope IN('Admin','Opportunity');
 IF @Actor IS NULL THROW 52998,'Opportunity access is required.',1;
 IF @Value IS NULL OR ISJSON(@Value)<>1 OR LEFT(LTRIM(@Value),1)<>'{' THROW 52996,'TCB information must be JSON.',1;
 BEGIN TRY
 BEGIN TRANSACTION;
 SELECT @OpportunityID=i.OpportunityID,@Old=i.TCBCostInfo
 FROM dbo.OpportunityItem i WITH(UPDLOCK,HOLDLOCK)
 JOIN dbo.Opportunity o WITH(UPDLOCK,HOLDLOCK) ON o.ID=i.OpportunityID
 WHERE i.ID=@ID AND i.RowVersion=@ExpectedRowVersion AND i.Stage='Draft' AND o.Stage='Draft';
 IF @OpportunityID IS NULL THROW 52997,'Item changed or is no longer Draft. Refresh before saving TCB.',1;
 -- A price cannot change between API calculation and this write.
 IF EXISTS(SELECT 1 FROM OPENJSON(@Value,'$.PriceSnapshots') WITH
  (PriceID INT,PriceVersion VARCHAR(18)) selected
  LEFT JOIN dbo.RawMaterialPrice p WITH(UPDLOCK,HOLDLOCK) ON p.ID=selected.PriceID
  WHERE p.ID IS NULL OR TRY_CONVERT(VARBINARY(8),selected.PriceVersion,1) IS NULL
   OR TRY_CONVERT(VARBINARY(8),selected.PriceVersion,1)<>p.RowVersion)
  THROW 52997,'Selected raw-material price changed. Refresh before saving TCB.',1;
 -- New assignments must still match Master at the instant of saving. Existing
 -- exact snapshots remain valid after Master edits or blocking.
 IF EXISTS(
  SELECT 1 FROM OPENJSON(@Value,'$.Inputs.LossProcesses') WITH
   (MasterID INT,MasterVersion VARCHAR(18),ProcessType VARCHAR(32),Sequence INT,LossPct DECIMAL(38,12)) assigned
  LEFT JOIN dbo.LossProcessMaster master WITH(UPDLOCK,HOLDLOCK) ON master.ID=assigned.MasterID
  WHERE NOT EXISTS(SELECT 1 FROM OPENJSON(@Old,'$.Inputs.LossProcesses') WITH
   (MasterID INT,MasterVersion VARCHAR(18),ProcessType VARCHAR(32),Sequence INT,LossPct DECIMAL(38,12)) previous
   WHERE ISNULL(previous.MasterID,-1)=ISNULL(assigned.MasterID,-1)
    AND ISNULL(previous.MasterVersion,'')=ISNULL(assigned.MasterVersion,'')
    AND previous.ProcessType=assigned.ProcessType AND previous.Sequence=assigned.Sequence
    AND previous.LossPct=assigned.LossPct)
  AND NOT (assigned.MasterID IS NULL AND JSON_QUERY(@Old,'$.Inputs.LossProcesses') IS NULL
   AND assigned.LossPct=ISNULL(TRY_CONVERT(DECIMAL(38,12),JSON_VALUE(@Old,
     CASE assigned.ProcessType WHEN 'Processing' THEN '$.Inputs.LossProductPct'
      WHEN 'PrimaryPackaging' THEN '$.Inputs.PrimaryLossPct' WHEN 'SecondaryPackaging' THEN '$.Inputs.SecondaryLossPct'
      WHEN 'TertiaryPackaging' THEN '$.Inputs.TertiaryLossPct' WHEN 'MixPrimaryPackaging' THEN '$.Inputs.MixPrimaryLossPct'
      WHEN 'MixSecondaryPackaging' THEN '$.Inputs.MixSecondaryLossPct' WHEN 'MixTertiaryPackaging' THEN '$.Inputs.MixTertiaryLossPct'
      ELSE '$.Inputs.Unknown' END)),-1))
  AND (master.ID IS NULL OR master.Status<>'Active'
    OR TRY_CONVERT(VARBINARY(8),assigned.MasterVersion,1) IS NULL
    OR TRY_CONVERT(VARBINARY(8),assigned.MasterVersion,1)<>master.RowVersion
    OR master.ProcessType<>assigned.ProcessType OR master.Sequence<>assigned.Sequence OR master.LossPct<>assigned.LossPct))
  THROW 52997,'Loss Process Master changed or assignment is invalid. Refresh and select again.',1;
 UPDATE dbo.OpportunityItem SET TCBCostInfo=@Value WHERE ID=@ID;
 INSERT dbo.OpportunityChangeLog(EventID,OpportunityID,EntityLevel,ItemID,ItemLabel,Action,
  FieldName,OldValue,NewValue,ChangedBy,Source,Reason)
 SELECT NEWID(),@OpportunityID,'Item',@ID,p.ProductCode,'Update','TCBCostInfo',@Old,@Value,@Username,'User','TCB Calculator'
 FROM dbo.OpportunityItem i JOIN dbo.Product p ON p.ID=i.ProductID WHERE i.ID=@ID;
 SELECT ID,RowVersion FROM dbo.OpportunityItem WHERE ID=@ID;
 COMMIT;
 END TRY
 BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
 END CATCH
END;
GO
-- END MIGRATION 92_loss_process_master.sql
GO
-- BEGIN MIGRATION 93_loss_process_names.sql
PRINT N'Applying 93_loss_process_names.sql';
GO
-- After 92. Free-text process types, Product-owned Product losses and Opportunity snapshots.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
IF OBJECT_ID('dbo.LossProcessMaster','U') IS NULL THROW 52996,'Apply migration 92 first.',1;
IF EXISTS(SELECT 1 FROM sys.check_constraints WHERE name='CK_LossProcessMaster_Type' AND parent_object_id=OBJECT_ID('dbo.LossProcessMaster'))
 ALTER TABLE dbo.LossProcessMaster DROP CONSTRAINT CK_LossProcessMaster_Type;
IF EXISTS(SELECT 1 FROM sys.indexes WHERE name='UX_LossProcessMaster_ActiveValues' AND object_id=OBJECT_ID('dbo.LossProcessMaster'))
 DROP INDEX UX_LossProcessMaster_ActiveValues ON dbo.LossProcessMaster;
ALTER TABLE dbo.LossProcessMaster ALTER COLUMN ProcessType NVARCHAR(100) NOT NULL;
IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE name='CK_LossProcessMaster_Name' AND parent_object_id=OBJECT_ID('dbo.LossProcessMaster'))
 ALTER TABLE dbo.LossProcessMaster ADD CONSTRAINT CK_LossProcessMaster_Name CHECK(LEN(LTRIM(RTRIM(ProcessType)))>0);
CREATE UNIQUE INDEX UX_LossProcessMaster_ActiveValues ON dbo.LossProcessMaster(ProcessType,Sequence,LossPct) WHERE Status='Active';
IF COL_LENGTH('dbo.Product','LossProcesses') IS NULL ALTER TABLE dbo.Product ADD LossProcesses NVARCHAR(MAX) NULL;
IF COL_LENGTH('dbo.OpportunityItem','ProductLossSnapshot') IS NULL ALTER TABLE dbo.OpportunityItem ADD ProductLossSnapshot NVARCHAR(MAX) NULL;
GO
IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE name='CK_Product_LossProcesses')
 ALTER TABLE dbo.Product ADD CONSTRAINT CK_Product_LossProcesses CHECK(LossProcesses IS NULL OR ISJSON(LossProcesses)=1);
IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE name='CK_Opportunity_ProductLossSnapshot')
 ALTER TABLE dbo.OpportunityItem ADD CONSTRAINT CK_Opportunity_ProductLossSnapshot CHECK(ProductLossSnapshot IS NULL OR ISJSON(ProductLossSnapshot)=1);
UPDATE i SET ProductLossSnapshot=COALESCE(p.LossProcesses,'[]')
 FROM dbo.OpportunityItem i JOIN dbo.Product p ON p.ID=i.ProductID WHERE i.ProductLossSnapshot IS NULL;
GO
CREATE OR ALTER TRIGGER dbo.tr_OpportunityItem_ProductLossSnapshot ON dbo.OpportunityItem AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS(SELECT 1 FROM inserted fresh LEFT JOIN deleted old ON old.ID=fresh.ID
  WHERE old.ID IS NULL OR old.ProductID<>fresh.ProductID) RETURN;
 UPDATE item SET ProductLossSnapshot=COALESCE(product.LossProcesses,'[]')
 FROM dbo.OpportunityItem item JOIN inserted fresh ON fresh.ID=item.ID
 LEFT JOIN deleted old ON old.ID=fresh.ID JOIN dbo.Product product ON product.ID=fresh.ProductID
 WHERE old.ID IS NULL OR old.ProductID<>fresh.ProductID;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_ProductLossProcesses_Save
 @Username NVARCHAR(100),@ID INT,@ExpectedRowVersion VARBINARY(8),@Value NVARCHAR(MAX)
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 DECLARE @Actor INT;
 SELECT @Actor=u.ID FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
 WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope IN('Admin','Product');
 IF @Actor IS NULL THROW 52998,'Product access is required.',1;
 IF @Value IS NULL OR ISJSON(@Value)<>1 OR LEFT(LTRIM(@Value),1)<>'[' THROW 52996,'Product loss processes must be an array.',1;
 BEGIN TRY
 BEGIN TRANSACTION;
 IF NOT EXISTS(SELECT 1 FROM dbo.Product WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@ExpectedRowVersion)
  THROW 52997,'Product changed. Refresh before saving.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Value) WITH(MasterID INT,MasterVersion VARCHAR(18),ProcessType VARCHAR(32),
   ProcessName NVARCHAR(100),Sequence INT,LossPct DECIMAL(5,2)) assigned
  LEFT JOIN dbo.LossProcessMaster master WITH(UPDLOCK,HOLDLOCK) ON master.ID=assigned.MasterID
  WHERE master.ID IS NULL OR master.Status<>'Active' OR assigned.ProcessType IS NULL OR assigned.ProcessType<>'Processing'
   OR TRY_CONVERT(VARBINARY(8),assigned.MasterVersion,1) IS NULL
   OR TRY_CONVERT(VARBINARY(8),assigned.MasterVersion,1)<>master.RowVersion
   OR assigned.ProcessName IS NULL OR assigned.ProcessName<>master.ProcessType
   OR assigned.Sequence IS NULL OR assigned.Sequence NOT BETWEEN 1 AND 1000
   OR assigned.LossPct IS NULL OR assigned.LossPct NOT BETWEEN 0 AND 100)
  THROW 52997,'Loss Process changed. Refresh before saving.',1;
 IF (SELECT COUNT(*) FROM OPENJSON(@Value))>100 OR EXISTS(
  SELECT Sequence FROM OPENJSON(@Value) WITH(Sequence INT) GROUP BY Sequence HAVING COUNT(*)>1)
  THROW 52996,'Use up to 100 processes with unique sequences.',1;
 UPDATE dbo.Product SET LossProcesses=@Value,UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME() WHERE ID=@ID;
 SELECT ID,RowVersion FROM dbo.Product WHERE ID=@ID;
 COMMIT;
 END TRY
 BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
 END CATCH
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_LossProcessMaster_Save
 @Username NVARCHAR(100),@ID INT=NULL,@ExpectedRowVersion VARBINARY(8)=NULL,
 @ProcessType NVARCHAR(100)=NULL,@Sequence INT=NULL,@LossPct DECIMAL(5,2)=NULL,@Status VARCHAR(10)='Active'
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 DECLARE @Actor INT;
 SELECT @Actor=u.ID FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
 WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope='Admin';
 IF @Actor IS NULL THROW 52998,'Admin access is required to maintain Loss Process Master.',1;
 SET @ProcessType=LTRIM(RTRIM(@ProcessType));
 IF NULLIF(@ProcessType,'') IS NULL
  OR @Sequence IS NULL OR @Sequence NOT BETWEEN 1 AND 1000 OR @LossPct IS NULL OR @LossPct NOT BETWEEN 0 AND 100
  OR @Status IS NULL OR @Status NOT IN('Active','Block') THROW 52996,'Check process type, sequence, loss and status.',1;
 BEGIN TRY
 BEGIN TRANSACTION;
 IF @Status='Active' AND EXISTS(SELECT 1 FROM dbo.LossProcessMaster WITH(UPDLOCK,HOLDLOCK)
  WHERE ProcessType=@ProcessType AND Sequence=@Sequence AND LossPct=@LossPct AND Status='Active'
   AND (@ID IS NULL OR ID<>@ID))
  THROW 52996,'An active Loss Process with these values already exists.',1;
 IF @ID IS NULL
 BEGIN
  INSERT dbo.LossProcessMaster(ProcessType,Sequence,LossPct,Status,CreatedBy)
  VALUES(@ProcessType,@Sequence,@LossPct,@Status,@Actor);
  SET @ID=CONVERT(INT,SCOPE_IDENTITY());
 END ELSE BEGIN
  IF NOT EXISTS(SELECT 1 FROM dbo.LossProcessMaster WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@ExpectedRowVersion)
   THROW 52997,'Loss Process changed. Refresh before saving.',1;
  UPDATE dbo.LossProcessMaster SET ProcessType=@ProcessType,Sequence=@Sequence,LossPct=@LossPct,Status=@Status,
   UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME() WHERE ID=@ID;
 END;
 SELECT ID,RowVersion FROM dbo.LossProcessMaster WHERE ID=@ID;
 COMMIT;
 END TRY
 BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
 END CATCH
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_OpportunityTCB_Save
 @Username NVARCHAR(100),@ID INT,@ExpectedRowVersion VARBINARY(8),@Value NVARCHAR(MAX)
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 DECLARE @Actor INT,@OpportunityID INT,@Old NVARCHAR(MAX);
 SELECT @Actor=u.ID FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
 WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope IN('Admin','Opportunity');
 IF @Actor IS NULL THROW 52998,'Opportunity access is required.',1;
 IF @Value IS NULL OR ISJSON(@Value)<>1 OR LEFT(LTRIM(@Value),1)<>'{' THROW 52996,'TCB information must be JSON.',1;
 BEGIN TRY
 BEGIN TRANSACTION;
 SELECT @OpportunityID=i.OpportunityID,@Old=i.TCBCostInfo
 FROM dbo.OpportunityItem i WITH(UPDLOCK,HOLDLOCK)
 JOIN dbo.Opportunity o WITH(UPDLOCK,HOLDLOCK) ON o.ID=i.OpportunityID
 WHERE i.ID=@ID AND i.RowVersion=@ExpectedRowVersion AND i.Stage='Draft' AND o.Stage='Draft';
 IF @OpportunityID IS NULL THROW 52997,'Item changed or is no longer Draft. Refresh before saving TCB.',1;
 -- A price cannot change between API calculation and this write.
 IF EXISTS(SELECT 1 FROM OPENJSON(@Value,'$.PriceSnapshots') WITH
  (PriceID INT,PriceVersion VARCHAR(18)) selected
  LEFT JOIN dbo.RawMaterialPrice p WITH(UPDLOCK,HOLDLOCK) ON p.ID=selected.PriceID
  WHERE p.ID IS NULL OR TRY_CONVERT(VARBINARY(8),selected.PriceVersion,1) IS NULL
   OR TRY_CONVERT(VARBINARY(8),selected.PriceVersion,1)<>p.RowVersion)
  THROW 52997,'Selected raw-material price changed. Refresh before saving TCB.',1;
 -- Values may be overridden, but assignments must refer to a saved snapshot
 -- or a currently active master. Product assignments originate in Product Master.
 DECLARE @ProductSnapshot NVARCHAR(MAX);
 SELECT @ProductSnapshot=ProductLossSnapshot FROM dbo.OpportunityItem WHERE ID=@ID;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Value,'$.Inputs.LossProcesses') WITH
  (MasterID INT,MasterVersion VARCHAR(18),ProcessType VARCHAR(32),Sequence INT,LossPct DECIMAL(38,12)) assigned
  LEFT JOIN dbo.LossProcessMaster master WITH(UPDLOCK,HOLDLOCK) ON master.ID=assigned.MasterID
  WHERE assigned.LossPct IS NULL OR assigned.LossPct NOT BETWEEN 0 AND 100
  OR (
   NOT EXISTS(SELECT 1 FROM OPENJSON(@Old,'$.Inputs.LossProcesses') WITH
    (MasterID INT,MasterVersion VARCHAR(18),ProcessType VARCHAR(32),Sequence INT) previous
    WHERE ISNULL(previous.MasterID,-1)=ISNULL(assigned.MasterID,-1)
     AND ISNULL(previous.MasterVersion,'')=ISNULL(assigned.MasterVersion,'')
     AND previous.ProcessType=assigned.ProcessType AND previous.Sequence=assigned.Sequence)
   AND NOT EXISTS(SELECT 1 FROM OPENJSON(@ProductSnapshot) WITH
    (MasterID INT,MasterVersion VARCHAR(18),ProcessType VARCHAR(32),Sequence INT) captured
    WHERE captured.MasterID=assigned.MasterID AND captured.MasterVersion=assigned.MasterVersion
     AND captured.ProcessType=assigned.ProcessType AND captured.Sequence=assigned.Sequence)
   AND NOT (assigned.MasterID IS NULL AND JSON_QUERY(@Old,'$.Inputs.LossProcesses') IS NULL
    AND JSON_VALUE(@Old,CASE assigned.ProcessType
     WHEN 'Processing' THEN '$.Inputs.LossProductPct'
     WHEN 'PrimaryPackaging' THEN '$.Inputs.PrimaryLossPct' WHEN 'SecondaryPackaging' THEN '$.Inputs.SecondaryLossPct'
     WHEN 'TertiaryPackaging' THEN '$.Inputs.TertiaryLossPct' WHEN 'MixPrimaryPackaging' THEN '$.Inputs.MixPrimaryLossPct'
     WHEN 'MixSecondaryPackaging' THEN '$.Inputs.MixSecondaryLossPct' WHEN 'MixTertiaryPackaging' THEN '$.Inputs.MixTertiaryLossPct'
     ELSE '$.Inputs.Unknown' END) IS NOT NULL)
   AND (assigned.ProcessType IN('Sorting','Processing') OR master.ID IS NULL OR master.Status<>'Active'
    OR TRY_CONVERT(VARBINARY(8),assigned.MasterVersion,1) IS NULL
    OR TRY_CONVERT(VARBINARY(8),assigned.MasterVersion,1)<>master.RowVersion)
  ))
 THROW 52997,'Loss assignment changed or is invalid. Refresh before saving.',1;
 UPDATE dbo.OpportunityItem SET TCBCostInfo=@Value WHERE ID=@ID;
 INSERT dbo.OpportunityChangeLog(EventID,OpportunityID,EntityLevel,ItemID,ItemLabel,Action,
  FieldName,OldValue,NewValue,ChangedBy,Source,Reason)
 SELECT NEWID(),@OpportunityID,'Item',@ID,p.ProductCode,'Update','TCBCostInfo',@Old,@Value,@Username,'User','TCB Calculator'
 FROM dbo.OpportunityItem i JOIN dbo.Product p ON p.ID=i.ProductID WHERE i.ID=@ID;
 SELECT ID,RowVersion FROM dbo.OpportunityItem WHERE ID=@ID;
 COMMIT;
 END TRY
 BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
 END CATCH
END;
GO
-- END MIGRATION 93_loss_process_names.sql
GO
-- BEGIN MIGRATION 94_opportunity_owned_losses.sql
PRINT N'Applying 94_opportunity_owned_losses.sql';
GO
-- After 93. Process Master holds names; all assignments and losses are Opportunity-owned.
-- Historical columns/JSON are retained, not deleted.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
DROP TRIGGER IF EXISTS dbo.tr_OpportunityItem_ProductLossSnapshot;
DROP PROCEDURE IF EXISTS dbo.usp_ProductLossProcesses_Save;
GO
CREATE OR ALTER PROCEDURE dbo.usp_LossProcessMaster_Save
 @Username NVARCHAR(100),@ID INT=NULL,@ExpectedRowVersion VARBINARY(8)=NULL,
 @ProcessType NVARCHAR(100)=NULL,@Sequence INT=NULL,@LossPct DECIMAL(5,2)=NULL,@Status VARCHAR(10)='Active'
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 DECLARE @Actor INT;
 SELECT @Actor=u.ID FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
 WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope='Admin';
 IF @Actor IS NULL THROW 52998,'Admin access is required to maintain Loss Process Master.',1;
 SET @ProcessType=LTRIM(RTRIM(@ProcessType));
 IF NULLIF(@ProcessType,'') IS NULL
  OR @Sequence IS NULL OR @Sequence NOT BETWEEN 1 AND 1000 OR @LossPct IS NULL OR @LossPct NOT BETWEEN 0 AND 100
  OR @Status IS NULL OR @Status NOT IN('Active','Block') THROW 52996,'Check process type, sequence, loss and status.',1;
 BEGIN TRY
 BEGIN TRANSACTION;
 IF @Status='Active' AND EXISTS(SELECT 1 FROM dbo.LossProcessMaster WITH(UPDLOCK,HOLDLOCK)
  WHERE ProcessType=@ProcessType AND Status='Active'
   AND (@ID IS NULL OR ID<>@ID))
  THROW 52996,'An active Loss Process with these values already exists.',1;
 IF @ID IS NULL
 BEGIN
  INSERT dbo.LossProcessMaster(ProcessType,Sequence,LossPct,Status,CreatedBy)
  VALUES(@ProcessType,@Sequence,@LossPct,@Status,@Actor);
  SET @ID=CONVERT(INT,SCOPE_IDENTITY());
 END ELSE BEGIN
  IF NOT EXISTS(SELECT 1 FROM dbo.LossProcessMaster WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@ExpectedRowVersion)
   THROW 52997,'Loss Process changed. Refresh before saving.',1;
  UPDATE dbo.LossProcessMaster SET ProcessType=@ProcessType,Status=@Status,
   UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME() WHERE ID=@ID;
 END;
 SELECT ID,RowVersion FROM dbo.LossProcessMaster WHERE ID=@ID;
 COMMIT;
 END TRY
 BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
 END CATCH
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_OpportunityTCB_Save
 @Username NVARCHAR(100),@ID INT,@ExpectedRowVersion VARBINARY(8),@Value NVARCHAR(MAX),@LossOnly BIT=0
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 DECLARE @Actor INT,@OpportunityID INT,@Old NVARCHAR(MAX);
 SELECT @Actor=u.ID FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
 WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope IN('Admin','Opportunity');
 IF @Actor IS NULL THROW 52998,'Opportunity access is required.',1;
 IF @Value IS NULL OR ISJSON(@Value)<>1 OR LEFT(LTRIM(@Value),1)<>'{' THROW 52996,'TCB information must be JSON.',1;
 BEGIN TRY
 BEGIN TRANSACTION;
 SELECT @OpportunityID=i.OpportunityID,@Old=i.TCBCostInfo
 FROM dbo.OpportunityItem i WITH(UPDLOCK,HOLDLOCK)
 JOIN dbo.Opportunity o WITH(UPDLOCK,HOLDLOCK) ON o.ID=i.OpportunityID
 WHERE i.ID=@ID AND i.RowVersion=@ExpectedRowVersion AND i.Stage='Draft' AND o.Stage='Draft';
 IF @OpportunityID IS NULL THROW 52997,'Item changed or is no longer Draft. Refresh before saving TCB.',1;
 -- A price cannot change between API calculation and this write.
 IF @LossOnly=0
 AND EXISTS(SELECT 1 FROM OPENJSON(@Value,'$.PriceSnapshots') WITH
  (PriceID INT,PriceVersion VARCHAR(18)) selected
  LEFT JOIN dbo.RawMaterialPrice p WITH(UPDLOCK,HOLDLOCK) ON p.ID=selected.PriceID
  WHERE p.ID IS NULL OR TRY_CONVERT(VARBINARY(8),selected.PriceVersion,1) IS NULL
   OR TRY_CONVERT(VARBINARY(8),selected.PriceVersion,1)<>p.RowVersion)
  THROW 52997,'Selected raw-material price changed. Refresh before saving TCB.',1;
 -- Values may be overridden, but assignments must refer to a saved snapshot
 -- or a currently active process name. Sequence and Loss % belong to the item.
 IF EXISTS(SELECT 1 FROM OPENJSON(@Value,'$.Inputs.LossProcesses') WITH
  (MasterID INT,MasterVersion VARCHAR(18),ProcessType VARCHAR(32),Sequence INT,LossPct DECIMAL(38,12)) assigned
  LEFT JOIN dbo.LossProcessMaster master WITH(UPDLOCK,HOLDLOCK) ON master.ID=assigned.MasterID
  WHERE assigned.LossPct IS NULL OR assigned.LossPct NOT BETWEEN 0 AND 100
  OR (
   NOT EXISTS(SELECT 1 FROM OPENJSON(@Old,'$.Inputs.LossProcesses') WITH
    (MasterID INT,MasterVersion VARCHAR(18),ProcessType VARCHAR(32),Sequence INT) previous
    WHERE ISNULL(previous.MasterID,-1)=ISNULL(assigned.MasterID,-1)
     AND ISNULL(previous.MasterVersion,'')=ISNULL(assigned.MasterVersion,'')
     AND previous.ProcessType=assigned.ProcessType)
   AND NOT (assigned.MasterID IS NULL AND JSON_QUERY(@Old,'$.Inputs.LossProcesses') IS NULL
    AND JSON_VALUE(@Old,CASE assigned.ProcessType
     WHEN 'Processing' THEN '$.Inputs.LossProductPct'
     WHEN 'PrimaryPackaging' THEN '$.Inputs.PrimaryLossPct' WHEN 'SecondaryPackaging' THEN '$.Inputs.SecondaryLossPct'
     WHEN 'TertiaryPackaging' THEN '$.Inputs.TertiaryLossPct' WHEN 'MixPrimaryPackaging' THEN '$.Inputs.MixPrimaryLossPct'
     WHEN 'MixSecondaryPackaging' THEN '$.Inputs.MixSecondaryLossPct' WHEN 'MixTertiaryPackaging' THEN '$.Inputs.MixTertiaryLossPct'
     ELSE '$.Inputs.Unknown' END) IS NOT NULL)
   AND (master.ID IS NULL OR master.Status<>'Active'
    OR TRY_CONVERT(VARBINARY(8),assigned.MasterVersion,1) IS NULL
    OR TRY_CONVERT(VARBINARY(8),assigned.MasterVersion,1)<>master.RowVersion)
  ))
 THROW 52997,'Loss assignment changed or is invalid. Refresh before saving.',1;
 UPDATE dbo.OpportunityItem SET TCBCostInfo=@Value WHERE ID=@ID;
 INSERT dbo.OpportunityChangeLog(EventID,OpportunityID,EntityLevel,ItemID,ItemLabel,Action,
  FieldName,OldValue,NewValue,ChangedBy,Source,Reason)
 SELECT NEWID(),@OpportunityID,'Item',@ID,p.ProductCode,'Update','TCBCostInfo',@Old,@Value,@Username,'User','TCB Calculator'
 FROM dbo.OpportunityItem i JOIN dbo.Product p ON p.ID=i.ProductID WHERE i.ID=@ID;
 SELECT ID,RowVersion FROM dbo.OpportunityItem WHERE ID=@ID;
 COMMIT;
 END TRY
 BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
 END CATCH
END;
GO
-- END MIGRATION 94_opportunity_owned_losses.sql
GO
-- BEGIN MIGRATION 95_item_loss_formula.sql
PRINT N'Applying 95_item_loss_formula.sql';
GO
-- After 94. Item packaging loss is a direct ratio per layer; Product formula is stored in TCB JSON.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
CREATE OR ALTER PROCEDURE dbo.usp_OpportunityTCB_Save
 @Username NVARCHAR(100),@ID INT,@ExpectedRowVersion VARBINARY(8),@Value NVARCHAR(MAX),@LossOnly BIT=0
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 DECLARE @Actor INT,@OpportunityID INT,@Old NVARCHAR(MAX);
 SELECT @Actor=u.ID FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
 WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope IN('Admin','Opportunity');
 IF @Actor IS NULL THROW 52998,'Opportunity access is required.',1;
 IF @Value IS NULL OR ISJSON(@Value)<>1 OR LEFT(LTRIM(@Value),1)<>'{' THROW 52996,'TCB information must be JSON.',1;
 BEGIN TRY
 BEGIN TRANSACTION;
 SELECT @OpportunityID=i.OpportunityID,@Old=i.TCBCostInfo
 FROM dbo.OpportunityItem i WITH(UPDLOCK,HOLDLOCK)
 JOIN dbo.Opportunity o WITH(UPDLOCK,HOLDLOCK) ON o.ID=i.OpportunityID
 WHERE i.ID=@ID AND i.RowVersion=@ExpectedRowVersion AND i.Stage='Draft' AND o.Stage='Draft';
 IF @OpportunityID IS NULL THROW 52997,'Item changed or is no longer Draft. Refresh before saving TCB.',1;
 -- A price cannot change between API calculation and this write.
 IF @LossOnly=0
 AND EXISTS(SELECT 1 FROM OPENJSON(@Value,'$.PriceSnapshots') WITH
  (PriceID INT,PriceVersion VARCHAR(18)) selected
  LEFT JOIN dbo.RawMaterialPrice p WITH(UPDLOCK,HOLDLOCK) ON p.ID=selected.PriceID
  WHERE p.ID IS NULL OR TRY_CONVERT(VARBINARY(8),selected.PriceVersion,1) IS NULL
   OR TRY_CONVERT(VARBINARY(8),selected.PriceVersion,1)<>p.RowVersion)
  THROW 52997,'Selected raw-material price changed. Refresh before saving TCB.',1;
 -- Values may be overridden, but assignments must refer to a saved snapshot
 -- or a currently active process name. Sequence and Loss % belong to the item.
 IF EXISTS(SELECT 1 FROM OPENJSON(@Value,'$.Inputs.LossProcesses') WITH
  (MasterID INT,MasterVersion VARCHAR(18),ProcessType VARCHAR(32),Sequence INT,LossPct DECIMAL(38,12)) assigned
  LEFT JOIN dbo.LossProcessMaster master WITH(UPDLOCK,HOLDLOCK) ON master.ID=assigned.MasterID
  WHERE assigned.LossPct IS NULL OR assigned.LossPct NOT BETWEEN 0 AND 100
  OR (
   NOT (assigned.MasterID IS NULL AND assigned.ProcessType IN('PrimaryPackaging','SecondaryPackaging','TertiaryPackaging','MixPrimaryPackaging','MixSecondaryPackaging','MixTertiaryPackaging') AND assigned.Sequence=1)
   AND NOT EXISTS(SELECT 1 FROM OPENJSON(@Old,'$.Inputs.LossProcesses') WITH
    (MasterID INT,MasterVersion VARCHAR(18),ProcessType VARCHAR(32),Sequence INT) previous
    WHERE ISNULL(previous.MasterID,-1)=ISNULL(assigned.MasterID,-1)
     AND ISNULL(previous.MasterVersion,'')=ISNULL(assigned.MasterVersion,'')
     AND previous.ProcessType=assigned.ProcessType)
   AND NOT (assigned.MasterID IS NULL AND JSON_QUERY(@Old,'$.Inputs.LossProcesses') IS NULL
    AND JSON_VALUE(@Old,CASE assigned.ProcessType
     WHEN 'Processing' THEN '$.Inputs.LossProductPct'
     WHEN 'PrimaryPackaging' THEN '$.Inputs.PrimaryLossPct' WHEN 'SecondaryPackaging' THEN '$.Inputs.SecondaryLossPct'
     WHEN 'TertiaryPackaging' THEN '$.Inputs.TertiaryLossPct' WHEN 'MixPrimaryPackaging' THEN '$.Inputs.MixPrimaryLossPct'
     WHEN 'MixSecondaryPackaging' THEN '$.Inputs.MixSecondaryLossPct' WHEN 'MixTertiaryPackaging' THEN '$.Inputs.MixTertiaryLossPct'
     ELSE '$.Inputs.Unknown' END) IS NOT NULL)
   AND (master.ID IS NULL OR master.Status<>'Active'
    OR TRY_CONVERT(VARBINARY(8),assigned.MasterVersion,1) IS NULL
    OR TRY_CONVERT(VARBINARY(8),assigned.MasterVersion,1)<>master.RowVersion)
  ))
 THROW 52997,'Loss assignment changed or is invalid. Refresh before saving.',1;
 UPDATE dbo.OpportunityItem SET TCBCostInfo=@Value WHERE ID=@ID;
 INSERT dbo.OpportunityChangeLog(EventID,OpportunityID,EntityLevel,ItemID,ItemLabel,Action,
  FieldName,OldValue,NewValue,ChangedBy,Source,Reason)
 SELECT NEWID(),@OpportunityID,'Item',@ID,p.ProductCode,'Update','TCBCostInfo',@Old,@Value,@Username,'User','TCB Calculator'
 FROM dbo.OpportunityItem i JOIN dbo.Product p ON p.ID=i.ProductID WHERE i.ID=@ID;
 SELECT ID,RowVersion FROM dbo.OpportunityItem WHERE ID=@ID;
 COMMIT;
 END TRY
 BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
 END CATCH
END;
GO
-- END MIGRATION 95_item_loss_formula.sql
GO
-- BEGIN MIGRATION 96_tcb_direct_grade_prices.sql
PRINT N'Applying 96_tcb_direct_grade_prices.sql';
GO
-- After 95. Opportunity-only direct grade prices; master quote version checks remain enforced.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
CREATE OR ALTER PROCEDURE dbo.usp_OpportunityTCB_Save
 @Username NVARCHAR(100),@ID INT,@ExpectedRowVersion VARBINARY(8),@Value NVARCHAR(MAX),@LossOnly BIT=0
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 DECLARE @Actor INT,@OpportunityID INT,@Old NVARCHAR(MAX);
 SELECT @Actor=u.ID FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
 WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope IN('Admin','Opportunity');
 IF @Actor IS NULL THROW 52998,'Opportunity access is required.',1;
 IF @Value IS NULL OR ISJSON(@Value)<>1 OR LEFT(LTRIM(@Value),1)<>'{' THROW 52996,'TCB information must be JSON.',1;
 BEGIN TRY
 BEGIN TRANSACTION;
 SELECT @OpportunityID=i.OpportunityID,@Old=i.TCBCostInfo
 FROM dbo.OpportunityItem i WITH(UPDLOCK,HOLDLOCK)
 JOIN dbo.Opportunity o WITH(UPDLOCK,HOLDLOCK) ON o.ID=i.OpportunityID
 WHERE i.ID=@ID AND i.RowVersion=@ExpectedRowVersion AND i.Stage='Draft' AND o.Stage='Draft';
 IF @OpportunityID IS NULL THROW 52997,'Item changed or is no longer Draft. Refresh before saving TCB.',1;
 -- A price cannot change between API calculation and this write.
 IF @LossOnly=0
 AND EXISTS(SELECT 1 FROM OPENJSON(@Value,'$.PriceSnapshots') WITH
  (PriceID INT,PriceVersion VARCHAR(18),Source VARCHAR(16)) selected
  LEFT JOIN dbo.RawMaterialPrice p WITH(UPDLOCK,HOLDLOCK) ON p.ID=selected.PriceID
  WHERE ISNULL(selected.Source,'Master')<>'Direct' AND (p.ID IS NULL OR TRY_CONVERT(VARBINARY(8),selected.PriceVersion,1) IS NULL
   OR TRY_CONVERT(VARBINARY(8),selected.PriceVersion,1)<>p.RowVersion))
  THROW 52997,'Selected raw-material price changed. Refresh before saving TCB.',1;
 -- Direct snapshots must match explicit, non-negative Opportunity-only inputs.
 IF @LossOnly=0 AND EXISTS(
  SELECT 1 FROM OPENJSON(@Value,'$.PriceSnapshots') WITH
   (Source VARCHAR(16),Path NVARCHAR(100),PriceID INT,PriceVersion VARCHAR(18),USDPerLb DECIMAL(19,6)) snapshot
  WHERE snapshot.Source='Direct' AND
   (snapshot.PriceID IS NOT NULL OR snapshot.PriceVersion IS NOT NULL OR snapshot.USDPerLb IS NULL OR snapshot.USDPerLb<0
    OR NOT EXISTS(SELECT 1 FROM OPENJSON(@Value,'$.Inputs.Prices') WITH
     (Path NVARCHAR(100),PriceID INT,PriceVersion VARCHAR(18),DirectUSDPerLb DECIMAL(19,6)) input
     WHERE input.Path=snapshot.Path AND input.PriceID IS NULL AND input.PriceVersion IS NULL
      AND input.DirectUSDPerLb=snapshot.USDPerLb)))
  THROW 52996,'Invalid direct grade price snapshot.',1;
 -- Values may be overridden, but assignments must refer to a saved snapshot
 -- or a currently active process name. Sequence and Loss % belong to the item.
 IF EXISTS(SELECT 1 FROM OPENJSON(@Value,'$.Inputs.LossProcesses') WITH
  (MasterID INT,MasterVersion VARCHAR(18),ProcessType VARCHAR(32),Sequence INT,LossPct DECIMAL(38,12)) assigned
  LEFT JOIN dbo.LossProcessMaster master WITH(UPDLOCK,HOLDLOCK) ON master.ID=assigned.MasterID
  WHERE assigned.LossPct IS NULL OR assigned.LossPct NOT BETWEEN 0 AND 100
  OR (
   NOT (assigned.MasterID IS NULL AND assigned.ProcessType IN('PrimaryPackaging','SecondaryPackaging','TertiaryPackaging','MixPrimaryPackaging','MixSecondaryPackaging','MixTertiaryPackaging') AND assigned.Sequence=1)
   AND NOT EXISTS(SELECT 1 FROM OPENJSON(@Old,'$.Inputs.LossProcesses') WITH
    (MasterID INT,MasterVersion VARCHAR(18),ProcessType VARCHAR(32),Sequence INT) previous
    WHERE ISNULL(previous.MasterID,-1)=ISNULL(assigned.MasterID,-1)
     AND ISNULL(previous.MasterVersion,'')=ISNULL(assigned.MasterVersion,'')
     AND previous.ProcessType=assigned.ProcessType)
   AND NOT (assigned.MasterID IS NULL AND JSON_QUERY(@Old,'$.Inputs.LossProcesses') IS NULL
    AND JSON_VALUE(@Old,CASE assigned.ProcessType
     WHEN 'Processing' THEN '$.Inputs.LossProductPct'
     WHEN 'PrimaryPackaging' THEN '$.Inputs.PrimaryLossPct' WHEN 'SecondaryPackaging' THEN '$.Inputs.SecondaryLossPct'
     WHEN 'TertiaryPackaging' THEN '$.Inputs.TertiaryLossPct' WHEN 'MixPrimaryPackaging' THEN '$.Inputs.MixPrimaryLossPct'
     WHEN 'MixSecondaryPackaging' THEN '$.Inputs.MixSecondaryLossPct' WHEN 'MixTertiaryPackaging' THEN '$.Inputs.MixTertiaryLossPct'
     ELSE '$.Inputs.Unknown' END) IS NOT NULL)
   AND (master.ID IS NULL OR master.Status<>'Active'
    OR TRY_CONVERT(VARBINARY(8),assigned.MasterVersion,1) IS NULL
    OR TRY_CONVERT(VARBINARY(8),assigned.MasterVersion,1)<>master.RowVersion)
  ))
 THROW 52997,'Loss assignment changed or is invalid. Refresh before saving.',1;
 UPDATE dbo.OpportunityItem SET TCBCostInfo=@Value WHERE ID=@ID;
 INSERT dbo.OpportunityChangeLog(EventID,OpportunityID,EntityLevel,ItemID,ItemLabel,Action,
  FieldName,OldValue,NewValue,ChangedBy,Source,Reason)
 SELECT NEWID(),@OpportunityID,'Item',@ID,p.ProductCode,'Update','TCBCostInfo',@Old,@Value,@Username,'User','TCB Calculator'
 FROM dbo.OpportunityItem i JOIN dbo.Product p ON p.ID=i.ProductID WHERE i.ID=@ID;
 SELECT ID,RowVersion FROM dbo.OpportunityItem WHERE ID=@ID;
 COMMIT;
 END TRY
 BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
 END CATCH
END;
GO
-- END MIGRATION 96_tcb_direct_grade_prices.sql
GO
-- VERIFY UPGRADE
IF @@TRANCOUNT<>0
 THROW 52995,'Upgrade left an open transaction. Stop and investigate.',1;
IF COL_LENGTH('dbo.OpportunityItem','ShipmentCostInfo') IS NULL
 OR COL_LENGTH('dbo.OpportunityItem','TCBCostInfo') IS NULL
 OR OBJECT_ID('dbo.PortOfEntry','U') IS NULL
 OR OBJECT_ID('dbo.LossProcessMaster','U') IS NULL
 OR OBJECT_ID('dbo.usp_PortOfEntry_Save','P') IS NULL
 OR OBJECT_ID('dbo.usp_LossProcessMaster_Save','P') IS NULL
 OR OBJECT_ID('dbo.usp_OpportunityTCB_Save','P') IS NULL
 THROW 52995,'Upgrade verification failed: required objects are missing.',1;
IF NOT EXISTS(SELECT 1 FROM sys.parameters WHERE object_id=OBJECT_ID('dbo.usp_OpportunityTCB_Save') AND name=N'@LossOnly')
 OR CHARINDEX(N'DirectUSDPerLb',COALESCE(OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityTCB_Save')),N''))=0
 THROW 52995,'Upgrade verification failed: latest TCB price/loss procedure is missing.',1;
IF OBJECT_ID('dbo.tr_OpportunityItem_ProductLossSnapshot','TR') IS NOT NULL
 OR OBJECT_ID('dbo.usp_ProductLossProcesses_Save','P') IS NOT NULL
 THROW 52995,'Upgrade verification failed: obsolete Product-owned loss objects remain.',1;
PRINT N'PythonBridge upgrade 89-96 verified. Deploy matching application files before restarting.';
GO
