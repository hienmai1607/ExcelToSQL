USE [test]
GO
IF COL_LENGTH('dbo.Opportunity','ExchangeRateVNDPerUSD') IS NULL
 ALTER TABLE dbo.Opportunity ADD ExchangeRateVNDPerUSD DECIMAL(19,6) NULL CONSTRAINT CK_Opportunity_USDVND CHECK(ExchangeRateVNDPerUSD>0);
IF COL_LENGTH('dbo.Opportunity','ExchangeRateCustomerCurrencyPerUSD') IS NULL
 ALTER TABLE dbo.Opportunity ADD ExchangeRateCustomerCurrencyPerUSD DECIMAL(19,6) NULL CONSTRAINT CK_Opportunity_USDCustomer CHECK(ExchangeRateCustomerCurrencyPerUSD>0);
IF COL_LENGTH('dbo.Opportunity','RateCustomerCurrencyID') IS NULL
 ALTER TABLE dbo.Opportunity ADD RateCustomerCurrencyID INT NULL REFERENCES dbo.Currency(ID);
GO
-- Only legacy USD-based rates have the same meaning. Never guess other conversions.
UPDATE o SET ExchangeRateVNDPerUSD=o.ExchangeRateToVND FROM dbo.Opportunity o
 JOIN dbo.Currency c ON c.ID=o.CurrencyID
 WHERE c.CurrencyCode='USD' AND o.ExchangeRateVNDPerUSD IS NULL AND o.ExchangeRateToVND IS NOT NULL;
GO
CREATE OR ALTER PROCEDURE dbo.usp_Opportunity_Fields_Save
 @Username NVARCHAR(100),@ID INT,@ExpectedRowVersion VARBINARY(8),@Fields NVARCHAR(MAX),@IsCreate BIT=0
AS
BEGIN
 SET NOCOUNT ON;
 IF @@TRANCOUNT=0 THROW 52956,'Additional fields must be saved inside the document transaction.',1;
 DECLARE @Actor INT,@Admin BIT=0;
 SELECT @Actor=u.ID FROM dbo.Users u WHERE u.UserName=@Username AND u.IsActive=1;
 IF @Actor IS NULL THROW 52953,'Username is incorrect.',1;
 IF EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope='Admin') SET @Admin=1;
 IF @Admin=0 AND NOT EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope='Opportunity')
 THROW 52954,'Opportunity access is required for this action.',1;
 IF ISJSON(@Fields)<>1 THROW 52957,'Invalid additional fields.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] NOT IN('CurrencyID','ExchangeRateToVND','ExchangeRateVNDPerUSD','ExchangeRateCustomerCurrencyPerUSD'))
 THROW 52957,'Unknown additional field.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.Opportunity WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@ExpectedRowVersion)
 THROW 52958,'Concurrency conflict. Refresh before saving.',1;
 
 IF EXISTS(SELECT 1 FROM dbo.Opportunity WHERE ID=@ID AND Stage<>'Draft')
 THROW 52960,'Only Draft Opportunities can be edited.',1;
 
 
 DECLARE @CustomerCurrencyID INT;
 SELECT @CustomerCurrencyID=c.CurrencyID FROM dbo.Opportunity o JOIN dbo.Customer c ON c.ID=o.CustomerID WHERE o.ID=@ID;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] IN('ExchangeRateVNDPerUSD','ExchangeRateCustomerCurrencyPerUSD') AND ([type]<>0 AND TRY_CONVERT(DECIMAL(19,6),value)<=0))
 THROW 52957,'Exchange rates must be positive.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='ExchangeRateCustomerCurrencyPerUSD' AND [type]<>0) AND @CustomerCurrencyID IS NULL
 THROW 52957,'Maintain Customer currency in Customer Master first.',1;
 DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeUser'),@OldSource SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeSource');
 BEGIN TRY
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@Username;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',N'User';
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields))
 UPDATE t SET
 ExchangeRateVNDPerUSD=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='ExchangeRateVNDPerUSD') THEN j.ExchangeRateVNDPerUSD ELSE t.ExchangeRateVNDPerUSD END,
 ExchangeRateCustomerCurrencyPerUSD=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='ExchangeRateCustomerCurrencyPerUSD') THEN j.ExchangeRateCustomerCurrencyPerUSD ELSE t.ExchangeRateCustomerCurrencyPerUSD END,
 RateCustomerCurrencyID=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='ExchangeRateCustomerCurrencyPerUSD') THEN @CustomerCurrencyID ELSE t.RateCustomerCurrencyID END,
 CurrencyID=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='ExchangeRateVNDPerUSD') THEN CASE WHEN j.ExchangeRateVNDPerUSD IS NOT NULL THEN (SELECT ID FROM dbo.Currency WHERE CurrencyCode='USD') END WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='CurrencyID') THEN j.CurrencyID ELSE t.CurrencyID END,
 ExchangeRateToVND=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='ExchangeRateVNDPerUSD') THEN j.ExchangeRateVNDPerUSD WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='ExchangeRateToVND') THEN j.ExchangeRateToVND ELSE t.ExchangeRateToVND END,
 UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()
 FROM dbo.Opportunity t CROSS APPLY OPENJSON(@Fields) WITH(CurrencyID INT,ExchangeRateToVND DECIMAL(19,6),ExchangeRateVNDPerUSD DECIMAL(19,6),ExchangeRateCustomerCurrencyPerUSD DECIMAL(19,6)) j
 WHERE t.ID=@ID AND t.RowVersion=@ExpectedRowVersion;
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',@OldSource;
 END TRY
 BEGIN CATCH
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',@OldSource;
 THROW;
 END CATCH;
 SELECT RowVersion FROM dbo.Opportunity WHERE ID=@ID;
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
 ('ExchangeRateVNDPerUSD',CONVERT(NVARCHAR(MAX),d.ExchangeRateVNDPerUSD),CONVERT(NVARCHAR(MAX),i.ExchangeRateVNDPerUSD)),
 ('ExchangeRateCustomerCurrencyPerUSD',CONVERT(NVARCHAR(MAX),d.ExchangeRateCustomerCurrencyPerUSD),CONVERT(NVARCHAR(MAX),i.ExchangeRateCustomerCurrencyPerUSD)),
 ('RateCustomerCurrencyID',CONVERT(NVARCHAR(MAX),d.RateCustomerCurrencyID),CONVERT(NVARCHAR(MAX),i.RateCustomerCurrencyID)),
 ('Stage',CONVERT(NVARCHAR(MAX),d.Stage,126),CONVERT(NVARCHAR(MAX),i.Stage,126))
 )v(FieldName,OldValue,NewValue)
 WHERE d.ID IS NULL OR i.ID IS NULL
 OR (v.OldValue IS NULL AND v.NewValue IS NOT NULL)
 OR (v.OldValue IS NOT NULL AND v.NewValue IS NULL)
 OR CONVERT(VARBINARY(MAX),v.OldValue)<>CONVERT(VARBINARY(MAX),v.NewValue);
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_OpportunityCustomerLookup_Read
    @Username NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS(
        SELECT 1 FROM dbo.Users AS u
        JOIN dbo.UserAccess AS a ON a.UserID=u.ID
        WHERE u.UserName=@Username AND u.IsActive=1
          AND a.Scope IN(N'Admin',N'Opportunity')
    ) THROW 51043,'Opportunity access is required for this action.',1;
    SELECT c.ID,c.CustomerName,c.CurrencyID,cu.CurrencyCode AS CustomerCurrencyCode FROM dbo.Customer c LEFT JOIN dbo.Currency cu ON cu.ID=c.CurrencyID
    WHERE c.Status='Active' ORDER BY c.CustomerName;
END
GO
