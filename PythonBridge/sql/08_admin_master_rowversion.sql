USE [test]
GO

SET XACT_ABORT ON;
GO

BEGIN TRANSACTION;
IF COL_LENGTH('dbo.Market', 'RowVersion') IS NULL
    ALTER TABLE dbo.Market ADD RowVersion ROWVERSION NOT NULL;
IF COL_LENGTH('dbo.Currency', 'RowVersion') IS NULL
    ALTER TABLE dbo.Currency ADD RowVersion ROWVERSION NOT NULL;
COMMIT TRANSACTION;
GO

/* Market and Currency expose the same Admin Master batch interface:
   RowNum, Status, Message, NewID, NewRowVersion. Authorization is
   rechecked from Users/UserAccess; @IsAdmin remains only for compatibility. */
CREATE OR ALTER PROCEDURE dbo.usp_Market_Batch
    @Rows dbo.MarketBatchType READONLY,
    @Username NVARCHAR(100),
    @IsAdmin BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT OFF;
    DECLARE @Result TABLE(RowNum INT,Status VARCHAR(10),Message VARCHAR(500),NewID INT NULL,NewRowVersion VARBINARY(8) NULL);
    IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID AND a.Scope=N'Admin' WHERE u.UserName=@Username AND u.IsActive=1)
    BEGIN
        INSERT @Result SELECT RowNum,'ERROR','Admin access is required for this action.',NULL,NULL FROM @Rows;
        SELECT * FROM @Result ORDER BY RowNum; RETURN;
    END;

    DECLARE @RowNum INT,@Command CHAR(1),@ID INT,@Code VARCHAR(10),@Name VARCHAR(100),@ClientRV VARBINARY(8),@OwnTran BIT;
    DECLARE row_cursor CURSOR LOCAL FAST_FORWARD FOR
        SELECT RowNum,UPPER(Command),ID,NULLIF(LTRIM(RTRIM(MarketCode)),''),NULLIF(LTRIM(RTRIM(MarketName)),''),RowVersionB64 FROM @Rows ORDER BY RowNum;
    OPEN row_cursor; FETCH NEXT FROM row_cursor INTO @RowNum,@Command,@ID,@Code,@Name,@ClientRV;
    WHILE @@FETCH_STATUS=0
    BEGIN
        BEGIN TRY
            SET @OwnTran=0; IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION; SET @OwnTran=1; END;
            IF @Command='C'
            BEGIN
                IF @Code IS NULL OR @Name IS NULL INSERT @Result VALUES(@RowNum,'ERROR','Market Code and Market Name are required.',NULL,NULL);
                ELSE BEGIN
                    INSERT dbo.Market(MarketCode,MarketName) VALUES(@Code,@Name);
                    DECLARE @NewID INT=SCOPE_IDENTITY();
                    INSERT @Result SELECT @RowNum,'OK','Created',ID,RowVersion FROM dbo.Market WHERE ID=@NewID;
                END;
            END
            ELSE IF @Command IN('U','D')
            BEGIN
                IF NOT EXISTS(SELECT 1 FROM dbo.Market WHERE ID=@ID) INSERT @Result VALUES(@RowNum,'ERROR','Row not found',NULL,NULL);
                ELSE IF NOT EXISTS(SELECT 1 FROM dbo.Market WHERE ID=@ID AND RowVersion=@ClientRV) INSERT @Result VALUES(@RowNum,'ERROR','Concurrency conflict',NULL,NULL);
                ELSE IF @Command='D' BEGIN DELETE dbo.Market WHERE ID=@ID AND RowVersion=@ClientRV; INSERT @Result VALUES(@RowNum,'OK','Deleted',@ID,NULL); END
                ELSE IF @Code IS NULL OR @Name IS NULL INSERT @Result VALUES(@RowNum,'ERROR','Market Code and Market Name are required.',NULL,NULL);
                ELSE BEGIN
                    UPDATE dbo.Market SET MarketCode=@Code,MarketName=@Name WHERE ID=@ID AND RowVersion=@ClientRV;
                    INSERT @Result SELECT @RowNum,'OK','Updated',ID,RowVersion FROM dbo.Market WHERE ID=@ID;
                END;
            END
            ELSE INSERT @Result VALUES(@RowNum,'ERROR','Invalid command; use C, U, or D.',NULL,NULL);
            IF @OwnTran=1 COMMIT TRANSACTION;
        END TRY
        BEGIN CATCH
            IF @OwnTran=1 AND XACT_STATE()<>0 ROLLBACK TRANSACTION;
            INSERT @Result VALUES(@RowNum,'ERROR',ERROR_MESSAGE(),NULL,NULL);
        END CATCH;
        FETCH NEXT FROM row_cursor INTO @RowNum,@Command,@ID,@Code,@Name,@ClientRV;
    END;
    CLOSE row_cursor; DEALLOCATE row_cursor; SELECT * FROM @Result ORDER BY RowNum;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_Currency_Batch
    @Rows dbo.CurrencyBatchType READONLY,
    @Username NVARCHAR(100),
    @IsAdmin BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT OFF;
    DECLARE @Result TABLE(RowNum INT,Status VARCHAR(10),Message VARCHAR(500),NewID INT NULL,NewRowVersion VARBINARY(8) NULL);
    IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID AND a.Scope=N'Admin' WHERE u.UserName=@Username AND u.IsActive=1)
    BEGIN
        INSERT @Result SELECT RowNum,'ERROR','Admin access is required for this action.',NULL,NULL FROM @Rows;
        SELECT * FROM @Result ORDER BY RowNum; RETURN;
    END;

    DECLARE @RowNum INT,@Command CHAR(1),@ID INT,@Code CHAR(3),@Name VARCHAR(50),@ClientRV VARBINARY(8),@OwnTran BIT;
    DECLARE row_cursor CURSOR LOCAL FAST_FORWARD FOR
        SELECT RowNum,UPPER(Command),ID,NULLIF(LTRIM(RTRIM(CurrencyCode)),''),NULLIF(LTRIM(RTRIM(CurrencyName)),''),RowVersionB64 FROM @Rows ORDER BY RowNum;
    OPEN row_cursor; FETCH NEXT FROM row_cursor INTO @RowNum,@Command,@ID,@Code,@Name,@ClientRV;
    WHILE @@FETCH_STATUS=0
    BEGIN
        BEGIN TRY
            SET @OwnTran=0; IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION; SET @OwnTran=1; END;
            IF @Command='C'
            BEGIN
                IF @Code IS NULL OR @Name IS NULL INSERT @Result VALUES(@RowNum,'ERROR','Currency Code and Currency Name are required.',NULL,NULL);
                ELSE BEGIN
                    INSERT dbo.Currency(CurrencyCode,CurrencyName) VALUES(@Code,@Name);
                    DECLARE @NewID INT=SCOPE_IDENTITY();
                    INSERT @Result SELECT @RowNum,'OK','Created',ID,RowVersion FROM dbo.Currency WHERE ID=@NewID;
                END;
            END
            ELSE IF @Command IN('U','D')
            BEGIN
                IF NOT EXISTS(SELECT 1 FROM dbo.Currency WHERE ID=@ID) INSERT @Result VALUES(@RowNum,'ERROR','Row not found',NULL,NULL);
                ELSE IF NOT EXISTS(SELECT 1 FROM dbo.Currency WHERE ID=@ID AND RowVersion=@ClientRV) INSERT @Result VALUES(@RowNum,'ERROR','Concurrency conflict',NULL,NULL);
                ELSE IF @Command='D' BEGIN DELETE dbo.Currency WHERE ID=@ID AND RowVersion=@ClientRV; INSERT @Result VALUES(@RowNum,'OK','Deleted',@ID,NULL); END
                ELSE IF @Code IS NULL OR @Name IS NULL INSERT @Result VALUES(@RowNum,'ERROR','Currency Code and Currency Name are required.',NULL,NULL);
                ELSE BEGIN
                    UPDATE dbo.Currency SET CurrencyCode=@Code,CurrencyName=@Name WHERE ID=@ID AND RowVersion=@ClientRV;
                    INSERT @Result SELECT @RowNum,'OK','Updated',ID,RowVersion FROM dbo.Currency WHERE ID=@ID;
                END;
            END
            ELSE INSERT @Result VALUES(@RowNum,'ERROR','Invalid command; use C, U, or D.',NULL,NULL);
            IF @OwnTran=1 COMMIT TRANSACTION;
        END TRY
        BEGIN CATCH
            IF @OwnTran=1 AND XACT_STATE()<>0 ROLLBACK TRANSACTION;
            INSERT @Result VALUES(@RowNum,'ERROR',ERROR_MESSAGE(),NULL,NULL);
        END CATCH;
        FETCH NEXT FROM row_cursor INTO @RowNum,@Command,@ID,@Code,@Name,@ClientRV;
    END;
    CLOSE row_cursor; DEALLOCATE row_cursor; SELECT * FROM @Result ORDER BY RowNum;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_Market_Read @Username NVARCHAR(100) AS
BEGIN SET NOCOUNT ON;
    IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID AND a.Scope=N'Admin' WHERE u.UserName=@Username AND u.IsActive=1)
        THROW 51030,'Admin access is required for this action.',1;
    SELECT TOP (1000) ID,MarketCode,MarketName,RowVersion FROM dbo.Market ORDER BY MarketName;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_Currency_Read @Username NVARCHAR(100) AS
BEGIN SET NOCOUNT ON;
    IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID AND a.Scope=N'Admin' WHERE u.UserName=@Username AND u.IsActive=1)
        THROW 51031,'Admin access is required for this action.',1;
    SELECT TOP (1000) ID,CurrencyCode,CurrencyName,RowVersion FROM dbo.Currency ORDER BY CurrencyName;
END
GO

/* Explicit read-only lookup seam for Customer maintenance. */
CREATE OR ALTER PROCEDURE dbo.usp_CustomerMarketLookup_Read @Username NVARCHAR(100) AS
BEGIN SET NOCOUNT ON;
    IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID AND a.Scope IN(N'Admin',N'Customer') WHERE u.UserName=@Username AND u.IsActive=1)
        THROW 51032,'Customer access is required for this action.',1;
    SELECT ID,MarketCode FROM dbo.Market ORDER BY MarketCode;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_CustomerCurrencyLookup_Read @Username NVARCHAR(100) AS
BEGIN SET NOCOUNT ON;
    IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID AND a.Scope IN(N'Admin',N'Customer') WHERE u.UserName=@Username AND u.IsActive=1)
        THROW 51033,'Customer access is required for this action.',1;
    SELECT ID,CurrencyCode FROM dbo.Currency ORDER BY CurrencyCode;
END
GO
