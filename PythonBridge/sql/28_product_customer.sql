USE [test]
GO
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Existing ownership is deliberately NOT inferred or reassigned.
IF OBJECT_ID('dbo.ProductGradeVersion','U') IS NULL
 THROW 52960,'Apply migration 27 before Product Customer.',1;
IF COL_LENGTH('dbo.Product','CustomerID') IS NULL
 ALTER TABLE dbo.Product ADD CustomerID INT NULL;
GO
IF NOT EXISTS(SELECT 1 FROM sys.foreign_keys WHERE name='FK_Product_Customer')
 ALTER TABLE dbo.Product ADD CONSTRAINT FK_Product_Customer FOREIGN KEY(CustomerID) REFERENCES dbo.Customer(ID);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.Product') AND name='IX_Product_Customer')
 CREATE INDEX IX_Product_Customer ON dbo.Product(CustomerID);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.OpportunityItem') AND name='IX_OpportunityItem_ProductCustomer')
 CREATE INDEX IX_OpportunityItem_ProductCustomer ON dbo.OpportunityItem(ProductID,OpportunityID);
GO
CREATE OR ALTER TRIGGER dbo.tr_Product_Customer ON dbo.Product AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 -- Nullable only for untouched legacy rows. All new/edited products need an owner.
 IF EXISTS(SELECT 1 FROM inserted WHERE CustomerID IS NULL)
  THROW 52962,'Customer is required for Product. Assign a Customer before saving.',1;
 IF EXISTS(SELECT 1 FROM inserted i LEFT JOIN deleted d ON d.ID=i.ID
  LEFT JOIN dbo.Customer c WITH(UPDLOCK,HOLDLOCK) ON c.ID=i.CustomerID
  WHERE (d.ID IS NULL OR d.CustomerID IS NULL OR d.CustomerID<>i.CustomerID)
  AND (c.ID IS NULL OR c.Status<>'Active'))
  THROW 52962,'Choose an active Customer for Product.',1;
 IF EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON d.ID=i.ID
  JOIN dbo.OpportunityItem oi WITH(UPDLOCK,HOLDLOCK) ON oi.ProductID=i.ID
  WHERE d.CustomerID IS NOT NULL AND i.CustomerID<>d.CustomerID)
  THROW 52962,'Customer cannot change after Product is used in an Opportunity. Create a separate Product.',1;
END
GO
CREATE OR ALTER TRIGGER dbo.tr_OpportunityItem_ProductCustomer ON dbo.OpportunityItem AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM inserted i LEFT JOIN deleted d ON d.ID=i.ID
  JOIN dbo.Opportunity o WITH(UPDLOCK,HOLDLOCK) ON o.ID=i.OpportunityID
  JOIN dbo.Product p WITH(UPDLOCK,HOLDLOCK) ON p.ID=i.ProductID
  WHERE (d.ID IS NULL OR d.ProductID<>i.ProductID OR d.OpportunityID<>i.OpportunityID)
   AND (p.CustomerID IS NULL OR p.CustomerID<>o.CustomerID))
  THROW 52963,'Product must belong to the Opportunity Customer.',1;
END
GO
CREATE OR ALTER TRIGGER dbo.tr_Opportunity_CustomerProducts ON dbo.Opportunity AFTER UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON d.ID=i.ID
  JOIN dbo.OpportunityItem oi WITH(UPDLOCK,HOLDLOCK) ON oi.OpportunityID=i.ID
  JOIN dbo.Product p WITH(UPDLOCK,HOLDLOCK) ON p.ID=oi.ProductID
  WHERE i.CustomerID<>d.CustomerID AND (p.CustomerID IS NULL OR p.CustomerID<>i.CustomerID))
  THROW 52963,'Customer cannot change while Opportunity items belong to another or unassigned Customer.',1;
END
GO
CREATE OR ALTER PROCEDURE dbo.usp_Product_Batch
    @Rows dbo.ProductBatchType READONLY,
    @Username NVARCHAR(100),
    @IsAdmin BIT = 0,
    @CustomerID INT = NULL
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
                IF @CustomerID IS NULL
                    INSERT @Result VALUES(@RowNum,'ERROR','Customer is required for Product.',NULL,NULL);
                ELSE IF NOT EXISTS(SELECT 1 FROM dbo.Customer WITH(UPDLOCK,HOLDLOCK) WHERE ID=@CustomerID AND Status='Active')
                    INSERT @Result VALUES(@RowNum,'ERROR','Choose an active Customer for Product.',NULL,NULL);
                ELSE IF @Code IS NOT NULL
                    INSERT @Result VALUES(@RowNum,'ERROR','Product code is generated automatically. Leave it blank for new products.',NULL,NULL);
                ELSE IF @Name IS NULL OR @WeightValue IS NULL
                    INSERT @Result VALUES(@RowNum,'ERROR','Product Name and Weight Value are required.',NULL,NULL);
                ELSE IF @WeightValue<=0
                    INSERT @Result VALUES(@RowNum,'ERROR','Weight Value must be greater than zero.',NULL,NULL);
                ELSE IF COALESCE(@WeightUnit,'g') NOT IN('g','oz')
                    INSERT @Result VALUES(@RowNum,'ERROR','Weight Unit must be g or oz.',NULL,NULL);
                ELSE IF COALESCE(@Status,'Active') NOT IN('Active','Block')
                    INSERT @Result VALUES(@RowNum,'ERROR','Status must be Active or Block.',NULL,NULL);
                ELSE BEGIN
                    SET @WeightGrams=ROUND(CASE WHEN COALESCE(@WeightUnit,'g')='oz'
                        THEN @WeightValue*28.3495231 ELSE @WeightValue END,2);
                    DECLARE @Number BIGINT;
                    SET @Number=NEXT VALUE FOR dbo.ProductCodeSequence;
                    SET @Code='PRD-'+RIGHT(REPLICATE('0',10)+CONVERT(VARCHAR(10),@Number),10);
                    WHILE EXISTS(SELECT 1 FROM dbo.Product WHERE ProductCode=@Code)
                    BEGIN
                        SET @Number=NEXT VALUE FOR dbo.ProductCodeSequence;
                        SET @Code='PRD-'+RIGHT(REPLICATE('0',10)+CONVERT(VARCHAR(10),@Number),10);
                    END;
                    INSERT dbo.Product(ProductCode,ProductName,WeightGrams,Status,CreatedBy,CustomerID)
                    VALUES(UPPER(@Code),@Name,@WeightGrams,COALESCE(@Status,'Active'),@UserID,@CustomerID);
                    DECLARE @NewID INT=SCOPE_IDENTITY();
                    INSERT @Result SELECT @RowNum,'OK','Created',ID,RowVersion
                    FROM dbo.Product WHERE ID=@NewID;
                END;
            END
            ELSE IF @Command IN('U','D')
            BEGIN
                IF NOT EXISTS(SELECT 1 FROM dbo.Product WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID)
                    INSERT @Result VALUES(@RowNum,'ERROR','Row not found',NULL,NULL);
                ELSE IF NOT EXISTS(SELECT 1 FROM dbo.Product WHERE ID=@ID AND RowVersion=@ClientRV)
                    INSERT @Result VALUES(@RowNum,'ERROR','Concurrency conflict',NULL,NULL);
                ELSE IF @Code IS NOT NULL AND EXISTS(SELECT 1 FROM dbo.Product WHERE ID=@ID AND ProductCode COLLATE Latin1_General_100_BIN2<>@Code COLLATE Latin1_General_100_BIN2)
                    INSERT @Result VALUES(@RowNum,'ERROR','Product code is read-only.',NULL,NULL);
                ELSE IF @Command='D' BEGIN
                    UPDATE dbo.Product SET Status='Block',UpdatedBy=@UserID,UpdatedAt=SYSUTCDATETIME()
                    WHERE ID=@ID AND RowVersion=@ClientRV;
                    INSERT @Result SELECT @RowNum,'OK','Blocked',ID,RowVersion FROM dbo.Product WHERE ID=@ID;
                END
                ELSE IF @Name IS NULL OR @WeightValue IS NULL
                    INSERT @Result VALUES(@RowNum,'ERROR','Product Name and Weight Value are required.',NULL,NULL);
                ELSE IF @WeightValue<=0
                    INSERT @Result VALUES(@RowNum,'ERROR','Weight Value must be greater than zero.',NULL,NULL);
                ELSE IF COALESCE(@WeightUnit,'g') NOT IN('g','oz')
                    INSERT @Result VALUES(@RowNum,'ERROR','Weight Unit must be g or oz.',NULL,NULL);
                ELSE IF @Status IS NOT NULL AND @Status NOT IN('Active','Block')
                    INSERT @Result VALUES(@RowNum,'ERROR','Status must be Active or Block.',NULL,NULL);
                ELSE BEGIN
                    SET @WeightGrams=ROUND(CASE WHEN COALESCE(@WeightUnit,'g')='oz'
                        THEN @WeightValue*28.3495231 ELSE @WeightValue END,2);
                    UPDATE dbo.Product SET CustomerID=COALESCE(@CustomerID,CustomerID),ProductName=@Name,
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
            IF @OwnTran=0 AND XACT_STATE()=-1 THROW;
            IF @OwnTran=1 AND XACT_STATE()<>0 ROLLBACK TRANSACTION;
            ELSE IF @OwnTran=0 AND XACT_STATE()=1 ROLLBACK TRANSACTION ProductUserMasterRow;
            INSERT @Result VALUES(@RowNum,'ERROR',ERROR_MESSAGE(),NULL,NULL);
        END CATCH;
        FETCH NEXT FROM row_cursor INTO @RowNum,@Command,@ID,@Code,@Name,@WeightValue,@WeightUnit,@Status,@ClientRV;
    END;
    CLOSE row_cursor;
    DEALLOCATE row_cursor;
    SELECT r.*,p.ProductCode AS NewProductCode FROM @Result r
    LEFT JOIN dbo.Product p ON p.ID=r.NewID ORDER BY r.RowNum;
END
GO
CREATE OR ALTER PROCEDURE dbo.usp_Product_Fields_Save
 @Username NVARCHAR(100),@ID INT,@ExpectedRowVersion VARBINARY(8),@Fields NVARCHAR(MAX),@IsCreate BIT=0
AS
BEGIN
 SET NOCOUNT ON;
 IF @@TRANCOUNT=0 THROW 52956,'Additional fields must be saved inside the document transaction.',1;
 DECLARE @Actor INT,@Admin BIT=0;
 SELECT @Actor=u.ID FROM dbo.Users u WHERE u.UserName=@Username AND u.IsActive=1;
 IF @Actor IS NULL THROW 52953,'Username is incorrect.',1;
 IF EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope='Admin') SET @Admin=1;
 IF @Admin=0 AND NOT EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope='Product')
 THROW 52954,'Product access is required for this action.',1;
 IF ISJSON(@Fields)<>1 THROW 52957,'Invalid additional fields.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] NOT IN('Category','ProductName','WeightGrams','Status','CustomerID'))
 THROW 52957,'Unknown additional field.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE
 ([key]='ProductName' AND (LEN(LTRIM(RTRIM(COALESCE([value],''))))=0 OR LEN([value])>200)) OR
 ([key]='WeightGrams' AND (TRY_CONVERT(DECIMAL(10,2),[value]) IS NULL OR TRY_CONVERT(DECIMAL(10,2),[value])<=0)) OR
 ([key]='Status' AND ([value] IS NULL OR [value] NOT IN('Active','Block'))) OR
 ([key]='Category' AND LEN([value])>100) OR
 ([key]='CustomerID' AND (TRY_CONVERT(INT,[value]) IS NULL OR TRY_CONVERT(INT,[value])<1 OR [value] LIKE '%[^0-9]%')) OR
 [type] IN(4,5))
 THROW 52957,'Invalid Product field value.',1;
 IF EXISTS(SELECT [key] FROM OPENJSON(@Fields) GROUP BY [key] HAVING COUNT(*)>1)
 THROW 52957,'Duplicate Product field.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.Product WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@ExpectedRowVersion)
 THROW 52958,'Concurrency conflict. Refresh before saving.',1;
 IF @IsCreate=1 AND NULLIF(LTRIM(RTRIM(JSON_VALUE(@Fields,'$.Category'))),'') IS NULL
 THROW 52959,'Category is required when creating a Product.',1;
 
 
 
 DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeUser'),@OldSource SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeSource');
 BEGIN TRY
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@Username;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',N'User';
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields))
 UPDATE t SET
 CustomerID=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='CustomerID') THEN j.CustomerID ELSE t.CustomerID END,
 ProductName=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='ProductName') THEN LTRIM(RTRIM(j.ProductName)) ELSE t.ProductName END,
 WeightGrams=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='WeightGrams') THEN j.WeightGrams ELSE t.WeightGrams END,
 Status=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='Status') THEN j.Status ELSE t.Status END,
 Category=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='Category') THEN NULLIF(LTRIM(RTRIM(j.Category)),N'') ELSE t.Category END,
 UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()
 FROM dbo.Product t CROSS APPLY OPENJSON(@Fields) WITH(CustomerID INT,ProductName VARCHAR(200),WeightGrams DECIMAL(10,2),Status VARCHAR(10),Category NVARCHAR(100)) j
 WHERE t.ID=@ID AND t.RowVersion=@ExpectedRowVersion;
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',@OldSource;
 END TRY
 BEGIN CATCH
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',@OldSource;
 THROW;
 END CATCH;
 SELECT RowVersion FROM dbo.Product WHERE ID=@ID;
END;
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
    SELECT p.ID,p.ProductCode,p.ProductName,p.CustomerID FROM dbo.Product p
    JOIN dbo.Customer c ON c.ID=p.CustomerID
    WHERE p.Status='Active' AND c.Status='Active' ORDER BY p.ProductCode;
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

    SELECT p.CustomerID,c.CustomerName,p.ID,p.ProductCode,p.ProductName,p.WeightGrams,p.WeightOz,p.Status,
           p.CreatedAt,p.CreatedBy,p.UpdatedAt,p.UpdatedBy,p.RowVersion,
           COUNT(*) OVER() AS TotalMatchingRows
    FROM dbo.Product AS p LEFT JOIN dbo.Customer c ON c.ID=p.CustomerID
    WHERE (@ProductCode IS NULL OR p.ProductCode LIKE @ProductCode+'%')
      AND (@ProductName IS NULL OR p.ProductName LIKE @ProductName+'%')
    ORDER BY p.ProductCode
    OFFSET (@PageNumber-1)*@PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;
END
GO
