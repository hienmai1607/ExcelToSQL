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
