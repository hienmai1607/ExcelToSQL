USE [test]
GO
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.Product','Status') IS NULL
    EXEC(N'ALTER TABLE dbo.Product ADD Status VARCHAR(10) NOT NULL
        CONSTRAINT DF_Product_Status DEFAULT(''Active'')');
IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE name='CK_Product_Status')
    EXEC(N'ALTER TABLE dbo.Product WITH CHECK ADD CONSTRAINT CK_Product_Status
        CHECK(Status IN(''Active'',''Block''))');
IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE name='CK_Product_WeightGrams_Positive')
    EXEC(N'ALTER TABLE dbo.Product WITH CHECK ADD CONSTRAINT CK_Product_WeightGrams_Positive
        CHECK(WeightGrams>0)');
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.Customer') AND name='IX_Customer_Market_Status_Name')
    CREATE INDEX IX_Customer_Market_Status_Name
        ON dbo.Customer(MarketID,Status,CustomerName) INCLUDE(CurrencyID);
COMMIT TRANSACTION;
GO

/* Product Status was added after the original TVP was created. Rebuild the
   type once so Product updates can explicitly reactivate a blocked row. */
IF NOT EXISTS(
    SELECT 1 FROM sys.table_types AS t
    JOIN sys.columns AS c ON c.object_id=t.type_table_object_id
    WHERE SCHEMA_NAME(t.schema_id)='dbo' AND t.name='ProductBatchType' AND c.name='Status'
)
BEGIN
    DROP PROCEDURE IF EXISTS dbo.usp_Product_Batch;
    DROP TYPE dbo.ProductBatchType;
    EXEC(N'CREATE TYPE dbo.ProductBatchType AS TABLE(
        RowNum INT NOT NULL, Command CHAR(1) NOT NULL, ID INT NULL,
        ProductCode VARCHAR(20) NULL, ProductName VARCHAR(200) NULL,
        WeightValue DECIMAL(10,4) NULL, WeightUnit VARCHAR(2) NULL,
        Status VARCHAR(10) NULL, RowVersionB64 VARBINARY(8) NULL
    )');
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_OpportunityProductLookup_Read
    @Username NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS(
        SELECT 1 FROM dbo.Users AS u
        JOIN dbo.UserAccess AS a ON a.UserID=u.ID
        WHERE u.UserName=@Username AND u.IsActive=1
          AND a.Scope IN(N'Admin',N'Opportunity')
    ) THROW 51042,'Opportunity access is required for this action.',1;
    SELECT ID,ProductCode,ProductName FROM dbo.Product
    WHERE Status='Active' ORDER BY ProductCode;
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
    SELECT ID,CustomerName FROM dbo.Customer
    WHERE Status='Active' ORDER BY CustomerName;
END
GO

/* Customer and Product are User Master entities. Their batch interface is
   identical to Admin Master, but authorization accepts either Admin or the
   matching entity scope. @IsAdmin is retained only for client compatibility;
   SQL always rechecks live Users/UserAccess data. */
CREATE OR ALTER PROCEDURE dbo.usp_Product_Batch
    @Rows dbo.ProductBatchType READONLY,
    @Username NVARCHAR(100),
    @IsAdmin BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT OFF;

    DECLARE @Result TABLE(
        RowNum INT, Status VARCHAR(10), Message VARCHAR(500),
        NewID INT NULL, NewRowVersion VARBINARY(8) NULL
    );
    DECLARE @UserID INT = (
        SELECT u.ID FROM dbo.Users AS u
        WHERE u.UserName=@Username AND u.IsActive=1
    );

    IF @UserID IS NULL OR NOT EXISTS(
        SELECT 1 FROM dbo.UserAccess AS a
        WHERE a.UserID=@UserID AND a.Scope IN(N'Admin',N'Product')
    )
    BEGIN
        INSERT @Result
        SELECT RowNum,'ERROR','Product access is required for this action.',NULL,NULL
        FROM @Rows;
        SELECT * FROM @Result ORDER BY RowNum;
        RETURN;
    END;

    DECLARE @RowNum INT,@Command CHAR(1),@ID INT,@Code VARCHAR(20),
            @Name VARCHAR(200),@WeightValue DECIMAL(10,4),@WeightUnit VARCHAR(2),@Status VARCHAR(10),
            @WeightGrams DECIMAL(10,2),@ClientRV VARBINARY(8),@OwnTran BIT;
    DECLARE row_cursor CURSOR LOCAL FAST_FORWARD FOR
        SELECT RowNum,UPPER(Command),ID,NULLIF(LTRIM(RTRIM(ProductCode)),''),
               NULLIF(LTRIM(RTRIM(ProductName)),''),
               NULLIF(WeightValue,CONVERT(DECIMAL(10,4),-999999.9999)),
               LOWER(NULLIF(LTRIM(RTRIM(WeightUnit)),'')),
               CASE UPPER(NULLIF(LTRIM(RTRIM(Status)),''))
                   WHEN 'ACTIVE' THEN 'Active' WHEN 'BLOCK' THEN 'Block'
                   ELSE NULLIF(LTRIM(RTRIM(Status)),'') END,
               RowVersionB64
        FROM @Rows ORDER BY RowNum;

    OPEN row_cursor;
    FETCH NEXT FROM row_cursor INTO @RowNum,@Command,@ID,@Code,@Name,@WeightValue,@WeightUnit,@Status,@ClientRV;
    WHILE @@FETCH_STATUS=0
    BEGIN
        BEGIN TRY
            SET @OwnTran=0;
            IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION; SET @OwnTran=1; END
            ELSE SAVE TRANSACTION ProductUserMasterRow;

            IF @Command='C'
            BEGIN
                IF @Code IS NULL OR @Name IS NULL OR @WeightValue IS NULL
                    INSERT @Result VALUES(@RowNum,'ERROR','Product Code, Product Name, and Weight Value are required.',NULL,NULL);
                ELSE IF @WeightValue<=0
                    INSERT @Result VALUES(@RowNum,'ERROR','Weight Value must be greater than zero.',NULL,NULL);
                ELSE IF COALESCE(@WeightUnit,'g') NOT IN('g','oz')
                    INSERT @Result VALUES(@RowNum,'ERROR','Weight Unit must be g or oz.',NULL,NULL);
                ELSE IF COALESCE(@Status,'Active') NOT IN('Active','Block')
                    INSERT @Result VALUES(@RowNum,'ERROR','Status must be Active or Block.',NULL,NULL);
                ELSE BEGIN
                    SET @WeightGrams=ROUND(CASE WHEN COALESCE(@WeightUnit,'g')='oz'
                        THEN @WeightValue*28.3495231 ELSE @WeightValue END,2);
                    INSERT dbo.Product(ProductCode,ProductName,WeightGrams,Status,CreatedBy)
                    VALUES(UPPER(@Code),@Name,@WeightGrams,COALESCE(@Status,'Active'),@UserID);
                    DECLARE @NewID INT=SCOPE_IDENTITY();
                    INSERT @Result SELECT @RowNum,'OK','Created',ID,RowVersion
                    FROM dbo.Product WHERE ID=@NewID;
                END;
            END
            ELSE IF @Command IN('U','D')
            BEGIN
                IF NOT EXISTS(SELECT 1 FROM dbo.Product WHERE ID=@ID)
                    INSERT @Result VALUES(@RowNum,'ERROR','Row not found',NULL,NULL);
                ELSE IF NOT EXISTS(SELECT 1 FROM dbo.Product WHERE ID=@ID AND RowVersion=@ClientRV)
                    INSERT @Result VALUES(@RowNum,'ERROR','Concurrency conflict',NULL,NULL);
                ELSE IF @Command='D' BEGIN
                    UPDATE dbo.Product SET Status='Block',UpdatedBy=@UserID,UpdatedAt=SYSUTCDATETIME()
                    WHERE ID=@ID AND RowVersion=@ClientRV;
                    INSERT @Result SELECT @RowNum,'OK','Blocked',ID,RowVersion FROM dbo.Product WHERE ID=@ID;
                END
                ELSE IF @Code IS NULL OR @Name IS NULL OR @WeightValue IS NULL
                    INSERT @Result VALUES(@RowNum,'ERROR','Product Code, Product Name, and Weight Value are required.',NULL,NULL);
                ELSE IF @WeightValue<=0
                    INSERT @Result VALUES(@RowNum,'ERROR','Weight Value must be greater than zero.',NULL,NULL);
                ELSE IF COALESCE(@WeightUnit,'g') NOT IN('g','oz')
                    INSERT @Result VALUES(@RowNum,'ERROR','Weight Unit must be g or oz.',NULL,NULL);
                ELSE IF @Status IS NOT NULL AND @Status NOT IN('Active','Block')
                    INSERT @Result VALUES(@RowNum,'ERROR','Status must be Active or Block.',NULL,NULL);
                ELSE BEGIN
                    SET @WeightGrams=ROUND(CASE WHEN COALESCE(@WeightUnit,'g')='oz'
                        THEN @WeightValue*28.3495231 ELSE @WeightValue END,2);
                    UPDATE dbo.Product SET ProductCode=UPPER(@Code),ProductName=@Name,
                        WeightGrams=@WeightGrams,Status=COALESCE(@Status,Status),
                        UpdatedBy=@UserID,UpdatedAt=SYSUTCDATETIME()
                    WHERE ID=@ID AND RowVersion=@ClientRV;
                    INSERT @Result SELECT @RowNum,'OK','Updated',ID,RowVersion
                    FROM dbo.Product WHERE ID=@ID;
                END;
            END
            ELSE
                INSERT @Result VALUES(@RowNum,'ERROR','Invalid command; use C, U, or D.',NULL,NULL);

            IF @OwnTran=1 COMMIT TRANSACTION;
        END TRY
        BEGIN CATCH
            IF @OwnTran=1 AND XACT_STATE()<>0 ROLLBACK TRANSACTION;
            ELSE IF @OwnTran=0 AND XACT_STATE()=1 ROLLBACK TRANSACTION ProductUserMasterRow;
            INSERT @Result VALUES(@RowNum,'ERROR',ERROR_MESSAGE(),NULL,NULL);
        END CATCH;
        FETCH NEXT FROM row_cursor INTO @RowNum,@Command,@ID,@Code,@Name,@WeightValue,@WeightUnit,@Status,@ClientRV;
    END;
    CLOSE row_cursor;
    DEALLOCATE row_cursor;
    SELECT * FROM @Result ORDER BY RowNum;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_Product_Read
    @Username NVARCHAR(100),
    @IsAdmin BIT = 0,
    @ProductCode VARCHAR(20) = NULL,
    @ProductName VARCHAR(200) = NULL,
    @PageNumber INT = 1,
    @PageSize INT = 200
AS
BEGIN
    SET NOCOUNT ON;
    IF @PageSize>500 SET @PageSize=500;
    IF @PageSize<1 SET @PageSize=1;
    IF @PageNumber<1 SET @PageNumber=1;

    IF NOT EXISTS(
        SELECT 1
        FROM dbo.Users AS u
        JOIN dbo.UserAccess AS a ON a.UserID=u.ID
        WHERE u.UserName=@Username AND u.IsActive=1
          AND a.Scope IN(N'Admin',N'Product',N'Opportunity')
    ) THROW 51040,'Product access is required for this action.',1;

    SELECT p.ID,p.ProductCode,p.ProductName,p.WeightGrams,p.WeightOz,p.Status,
           p.CreatedAt,p.CreatedBy,p.UpdatedAt,p.UpdatedBy,p.RowVersion,
           COUNT(*) OVER() AS TotalMatchingRows
    FROM dbo.Product AS p
    WHERE (@ProductCode IS NULL OR p.ProductCode LIKE @ProductCode+'%')
      AND (@ProductName IS NULL OR p.ProductName LIKE @ProductName+'%')
    ORDER BY p.ProductCode
    OFFSET (@PageNumber-1)*@PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_Customer_Read
    @Username NVARCHAR(100),
    @IsAdmin BIT = 0,
    @CustomerName VARCHAR(200) = NULL,
    @MarketID INT = NULL,
    @Status VARCHAR(10) = NULL,
    @PageNumber INT = 1,
    @PageSize INT = 200
AS
BEGIN
    SET NOCOUNT ON;
    IF @PageSize>500 SET @PageSize=500;
    IF @PageSize<1 SET @PageSize=1;
    IF @PageNumber<1 SET @PageNumber=1;

    IF NOT EXISTS(
        SELECT 1
        FROM dbo.Users AS u
        JOIN dbo.UserAccess AS a ON a.UserID=u.ID
        WHERE u.UserName=@Username AND u.IsActive=1
          AND a.Scope IN(N'Admin',N'Customer',N'Opportunity')
    ) THROW 51041,'Customer access is required for this action.',1;

    SELECT c.ID,c.CustomerName,c.MarketID,m.MarketCode,
           c.CurrencyID,cur.CurrencyCode,c.Status,c.CreatedAt,c.CreatedBy,
           c.UpdatedAt,c.UpdatedBy,c.RowVersion,
           COUNT(*) OVER() AS TotalMatchingRows
    FROM dbo.Customer AS c
    JOIN dbo.Market AS m ON m.ID=c.MarketID
    JOIN dbo.Currency AS cur ON cur.ID=c.CurrencyID
    WHERE (@CustomerName IS NULL OR c.CustomerName LIKE @CustomerName+'%')
      AND (@MarketID IS NULL OR c.MarketID=@MarketID)
      AND (@Status IS NULL OR c.Status=@Status)
    ORDER BY c.CustomerName
    OFFSET (@PageNumber-1)*@PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_Customer_Batch
    @Rows dbo.CustomerBatchType READONLY,
    @Username NVARCHAR(100),
    @IsAdmin BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT OFF;

    DECLARE @Result TABLE(
        RowNum INT, Status VARCHAR(10), Message VARCHAR(500),
        NewID INT NULL, NewRowVersion VARBINARY(8) NULL
    );
    DECLARE @UserID INT=(
        SELECT u.ID FROM dbo.Users AS u
        WHERE u.UserName=@Username AND u.IsActive=1
    );

    IF @UserID IS NULL OR NOT EXISTS(
        SELECT 1 FROM dbo.UserAccess AS a
        WHERE a.UserID=@UserID AND a.Scope IN(N'Admin',N'Customer')
    )
    BEGIN
        INSERT @Result
        SELECT RowNum,'ERROR','Customer access is required for this action.',NULL,NULL
        FROM @Rows;
        SELECT * FROM @Result ORDER BY RowNum;
        RETURN;
    END;

    DECLARE @RowNum INT,@Command CHAR(1),@ID INT,@Name VARCHAR(200),
            @MarketID INT,@CurrencyID INT,@Status VARCHAR(10),
            @ClientRV VARBINARY(8),@OwnTran BIT;
    DECLARE row_cursor CURSOR LOCAL FAST_FORWARD FOR
        SELECT RowNum,UPPER(Command),ID,NULLIF(LTRIM(RTRIM(CustomerName)),''),
               MarketID,CurrencyID,
               CASE UPPER(NULLIF(LTRIM(RTRIM(Status)),''))
                   WHEN 'ACTIVE' THEN 'Active' WHEN 'BLOCK' THEN 'Block'
                   ELSE NULLIF(LTRIM(RTRIM(Status)),'') END,
               RowVersionB64
        FROM @Rows ORDER BY RowNum;

    OPEN row_cursor;
    FETCH NEXT FROM row_cursor INTO @RowNum,@Command,@ID,@Name,@MarketID,@CurrencyID,@Status,@ClientRV;
    WHILE @@FETCH_STATUS=0
    BEGIN
        BEGIN TRY
            SET @OwnTran=0;
            IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION; SET @OwnTran=1; END
            ELSE SAVE TRANSACTION CustomerUserMasterRow;

            IF @Command='C'
            BEGIN
                IF @Name IS NULL OR @MarketID IS NULL OR @CurrencyID IS NULL
                    INSERT @Result VALUES(@RowNum,'ERROR','Customer Name, Market Code, and Currency Code are required.',NULL,NULL);
                ELSE IF NOT EXISTS(SELECT 1 FROM dbo.Market WHERE ID=@MarketID)
                    INSERT @Result VALUES(@RowNum,'ERROR','Invalid Market ID',NULL,NULL);
                ELSE IF NOT EXISTS(SELECT 1 FROM dbo.Currency WHERE ID=@CurrencyID)
                    INSERT @Result VALUES(@RowNum,'ERROR','Invalid Currency ID',NULL,NULL);
                ELSE IF COALESCE(@Status,'Active') NOT IN('Active','Block')
                    INSERT @Result VALUES(@RowNum,'ERROR','Status must be Active or Block.',NULL,NULL);
                ELSE BEGIN
                    INSERT dbo.Customer(CustomerName,MarketID,CurrencyID,Status,CreatedBy)
                    VALUES(@Name,@MarketID,@CurrencyID,COALESCE(@Status,'Active'),@UserID);
                    DECLARE @NewID INT=SCOPE_IDENTITY();
                    INSERT @Result SELECT @RowNum,'OK','Created',ID,RowVersion
                    FROM dbo.Customer WHERE ID=@NewID;
                END;
            END
            ELSE IF @Command IN('U','D')
            BEGIN
                IF NOT EXISTS(SELECT 1 FROM dbo.Customer WHERE ID=@ID)
                    INSERT @Result VALUES(@RowNum,'ERROR','Row not found',NULL,NULL);
                ELSE IF NOT EXISTS(SELECT 1 FROM dbo.Customer WHERE ID=@ID AND RowVersion=@ClientRV)
                    INSERT @Result VALUES(@RowNum,'ERROR','Concurrency conflict',NULL,NULL);
                ELSE IF @Command='D' BEGIN
                    UPDATE dbo.Customer SET Status='Block',UpdatedBy=@UserID,UpdatedAt=SYSUTCDATETIME()
                    WHERE ID=@ID AND RowVersion=@ClientRV;
                    INSERT @Result SELECT @RowNum,'OK','Blocked',ID,RowVersion FROM dbo.Customer WHERE ID=@ID;
                END
                ELSE IF @Name IS NULL OR @MarketID IS NULL OR @CurrencyID IS NULL
                    INSERT @Result VALUES(@RowNum,'ERROR','Customer Name, Market Code, and Currency Code are required.',NULL,NULL);
                ELSE IF NOT EXISTS(SELECT 1 FROM dbo.Market WHERE ID=@MarketID)
                    INSERT @Result VALUES(@RowNum,'ERROR','Invalid Market ID',NULL,NULL);
                ELSE IF NOT EXISTS(SELECT 1 FROM dbo.Currency WHERE ID=@CurrencyID)
                    INSERT @Result VALUES(@RowNum,'ERROR','Invalid Currency ID',NULL,NULL);
                ELSE IF @Status IS NOT NULL AND @Status NOT IN('Active','Block')
                    INSERT @Result VALUES(@RowNum,'ERROR','Status must be Active or Block.',NULL,NULL);
                ELSE BEGIN
                    UPDATE dbo.Customer SET CustomerName=@Name,MarketID=@MarketID,
                        CurrencyID=@CurrencyID,Status=COALESCE(@Status,Status),
                        UpdatedBy=@UserID,UpdatedAt=SYSUTCDATETIME()
                    WHERE ID=@ID AND RowVersion=@ClientRV;
                    INSERT @Result SELECT @RowNum,'OK','Updated',ID,RowVersion
                    FROM dbo.Customer WHERE ID=@ID;
                END;
            END
            ELSE
                INSERT @Result VALUES(@RowNum,'ERROR','Invalid command; use C, U, or D.',NULL,NULL);

            IF @OwnTran=1 COMMIT TRANSACTION;
        END TRY
        BEGIN CATCH
            IF @OwnTran=1 AND XACT_STATE()<>0 ROLLBACK TRANSACTION;
            ELSE IF @OwnTran=0 AND XACT_STATE()=1 ROLLBACK TRANSACTION CustomerUserMasterRow;
            INSERT @Result VALUES(@RowNum,'ERROR',ERROR_MESSAGE(),NULL,NULL);
        END CATCH;
        FETCH NEXT FROM row_cursor INTO @RowNum,@Command,@ID,@Name,@MarketID,@CurrencyID,@Status,@ClientRV;
    END;
    CLOSE row_cursor;
    DEALLOCATE row_cursor;
    SELECT * FROM @Result ORDER BY RowNum;
END
GO
