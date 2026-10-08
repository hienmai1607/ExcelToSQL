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
