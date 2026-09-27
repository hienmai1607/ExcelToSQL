USE [test]
GO

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF COL_LENGTH('dbo.Product','CustomerID') IS NULL THROW 52960,'Apply migration 28 first.',1;
IF COL_LENGTH('dbo.Product','IsMix') IS NULL
 ALTER TABLE dbo.Product ADD IsMix BIT NOT NULL CONSTRAINT DF_Product_IsMix DEFAULT(0);
GO
IF OBJECT_ID('dbo.CK_Product_WeightGrams_Positive','C') IS NOT NULL
 ALTER TABLE dbo.Product DROP CONSTRAINT CK_Product_WeightGrams_Positive;
ALTER TABLE dbo.Product WITH CHECK ADD CONSTRAINT CK_Product_WeightGrams_Positive
 CHECK((IsMix=0 AND WeightGrams>0) OR (IsMix=1 AND WeightGrams>=0));
IF OBJECT_ID('dbo.ProductMixVersion','U') IS NULL
BEGIN
 CREATE TABLE dbo.ProductMixVersion(
 ID INT IDENTITY PRIMARY KEY,ProductID INT NOT NULL REFERENCES dbo.Product(ID),
 Version INT NOT NULL CHECK(Version>0),
 Status VARCHAR(10) NOT NULL CHECK(Status IN('Draft','Active','Inactive')),
 CreatedBy INT NOT NULL REFERENCES dbo.Users(ID),CreatedAt DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
 UpdatedBy INT NULL REFERENCES dbo.Users(ID),UpdatedAt DATETIME2(3) NULL,
 RowVersion ROWVERSION NOT NULL,CONSTRAINT UQ_ProductMixVersion UNIQUE(ProductID,Version));
 CREATE UNIQUE INDEX UX_ProductMix_Active ON dbo.ProductMixVersion(ProductID) WHERE Status='Active';
 CREATE TABLE dbo.ProductMixItem(
 VersionID INT NOT NULL REFERENCES dbo.ProductMixVersion(ID),
 ProductID INT NOT NULL REFERENCES dbo.Product(ID),
 UnitQuantity DECIMAL(12,4) NOT NULL CHECK(UnitQuantity>0),
 CONSTRAINT PK_ProductMixItem PRIMARY KEY(VersionID,ProductID));
 CREATE INDEX IX_ProductMixItem_Product ON dbo.ProductMixItem(ProductID,VersionID);
END
GO
-- Also protects legacy Excel / SQL callers from entering a calculated weight.
CREATE OR ALTER TRIGGER dbo.tr_Product_Mix ON dbo.Product AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON d.ID=i.ID
  WHERE i.IsMix<>d.IsMix AND EXISTS(SELECT 1 FROM dbo.ProductMixVersion v WITH(UPDLOCK,HOLDLOCK) WHERE v.ProductID=i.ID))
  THROW 52960,'Product Mix cannot be disabled after versions exist.',1;
 IF EXISTS(SELECT 1 FROM inserted i JOIN dbo.ProductMixItem mi WITH(UPDLOCK,HOLDLOCK) ON mi.ProductID=i.ID
  JOIN dbo.ProductMixVersion v ON v.ID=mi.VersionID JOIN dbo.Product p ON p.ID=v.ProductID
  WHERE i.IsMix=1 OR i.CustomerID<>p.CustomerID OR i.CustomerID IS NULL)
  THROW 52960,'A mix child must remain a normal Product belonging to the same Customer.',1;
 IF EXISTS(SELECT 1 FROM inserted i JOIN dbo.ProductMixVersion v ON v.ProductID=i.ID
  JOIN dbo.ProductMixItem mi ON mi.VersionID=v.ID JOIN dbo.Product c WITH(UPDLOCK,HOLDLOCK) ON c.ID=mi.ProductID
  WHERE i.CustomerID<>c.CustomerID OR i.CustomerID IS NULL)
  THROW 52960,'Product Mix and its children must have the same Customer.',1;
 IF EXISTS(SELECT 1 FROM inserted i OUTER APPLY(
  SELECT SUM(CONVERT(DECIMAL(28,6),p.WeightGrams*mi.UnitQuantity)) Total
  FROM dbo.ProductMixVersion v JOIN dbo.ProductMixItem mi ON mi.VersionID=v.ID JOIN dbo.Product p ON p.ID=mi.ProductID
  WHERE v.ProductID=i.ID AND v.Status='Active') x
  WHERE i.IsMix=1 AND i.WeightGrams<>ROUND(COALESCE(x.Total,0),2))
  THROW 52960,'Product Mix net weight is calculated from its active mix.',1;
 -- Only normal child weight changes propagate; nested mixes are prohibited.
 IF EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON d.ID=i.ID WHERE i.IsMix=0 AND i.WeightGrams<>d.WeightGrams)
 BEGIN
  DECLARE @Affected TABLE(ID INT PRIMARY KEY,Total DECIMAL(38,6));
  INSERT @Affected
  SELECT v.ProductID,SUM(CONVERT(DECIMAL(28,6),p.WeightGrams*mi.UnitQuantity))
  FROM dbo.ProductMixVersion v JOIN dbo.ProductMixItem mi ON mi.VersionID=v.ID JOIN dbo.Product p WITH(UPDLOCK,HOLDLOCK) ON p.ID=mi.ProductID
  WHERE v.Status='Active' AND EXISTS(SELECT 1 FROM dbo.ProductMixItem changed JOIN inserted i ON i.ID=changed.ProductID
   JOIN deleted d ON d.ID=i.ID WHERE changed.VersionID=v.ID AND i.WeightGrams<>d.WeightGrams)
  GROUP BY v.ProductID;
  IF EXISTS(SELECT 1 FROM @Affected WHERE ROUND(Total,2)>99999999.99 OR ROUND(Total,2)<=0)
   THROW 52960,'Calculated mix weight is outside the supported range.',1;
  UPDATE p SET WeightGrams=ROUND(a.Total,2),UpdatedAt=SYSUTCDATETIME()
  FROM dbo.Product p JOIN @Affected a ON a.ID=p.ID;
 END
END
GO
CREATE OR ALTER TRIGGER dbo.tr_OpportunityItem_MixReady ON dbo.OpportunityItem AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM inserted i LEFT JOIN deleted d ON d.ID=i.ID JOIN dbo.Product p WITH(UPDLOCK,HOLDLOCK) ON p.ID=i.ProductID
  WHERE (d.ID IS NULL OR d.ProductID<>i.ProductID OR d.OpportunityID<>i.OpportunityID)
  AND p.IsMix=1 AND NOT EXISTS(SELECT 1 FROM dbo.ProductMixVersion v WHERE v.ProductID=p.ID AND v.Status='Active'))
  THROW 52960,'Activate a Product Mix version before selecting it for an Opportunity.',1;
END
GO
CREATE OR ALTER PROCEDURE dbo.usp_Product_Batch
    @Rows dbo.ProductBatchType READONLY,
    @Username NVARCHAR(100),
    @IsAdmin BIT = 0,
    @CustomerID INT = NULL,
    @IsMix BIT = NULL
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

            IF @Command='C' AND @IsMix=1 BEGIN SET @WeightValue=0; SET @WeightUnit='g'; END;
            IF @Command IN('U','D') AND COALESCE(@IsMix,(SELECT IsMix FROM dbo.Product WHERE ID=@ID),0)=1 BEGIN SET @WeightValue=0; SET @WeightUnit='g'; END;
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
                ELSE IF @WeightValue<=0 AND COALESCE(@IsMix,(SELECT IsMix FROM dbo.Product WHERE ID=@ID),0)=0
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
                    INSERT dbo.Product(ProductCode,ProductName,WeightGrams,Status,CreatedBy,CustomerID,IsMix)
                    VALUES(UPPER(@Code),@Name,@WeightGrams,COALESCE(@Status,'Active'),@UserID,@CustomerID,COALESCE(@IsMix,0));
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
                ELSE IF @WeightValue<=0 AND COALESCE(@IsMix,(SELECT IsMix FROM dbo.Product WHERE ID=@ID),0)=0
                    INSERT @Result VALUES(@RowNum,'ERROR','Weight Value must be greater than zero.',NULL,NULL);
                ELSE IF COALESCE(@WeightUnit,'g') NOT IN('g','oz')
                    INSERT @Result VALUES(@RowNum,'ERROR','Weight Unit must be g or oz.',NULL,NULL);
                ELSE IF @Status IS NOT NULL AND @Status NOT IN('Active','Block')
                    INSERT @Result VALUES(@RowNum,'ERROR','Status must be Active or Block.',NULL,NULL);
                ELSE BEGIN
                    SET @WeightGrams=ROUND(CASE WHEN COALESCE(@WeightUnit,'g')='oz'
                        THEN @WeightValue*28.3495231 ELSE @WeightValue END,2);
                    UPDATE dbo.Product SET CustomerID=COALESCE(@CustomerID,CustomerID),ProductName=@Name,
                        WeightGrams=CASE WHEN COALESCE(@IsMix,IsMix)=1 THEN CASE WHEN IsMix=1 THEN WeightGrams ELSE 0 END ELSE @WeightGrams END,
                        IsMix=COALESCE(@IsMix,IsMix),Status=COALESCE(@Status,Status),
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
 IF EXISTS(SELECT 1 FROM dbo.Product WHERE ID=@ID AND IsMix=1) AND EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='WeightGrams')
 THROW 52960,'Product Mix net weight is calculated from its active mix. Edit the mix instead.',1;
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
    WHERE p.Status='Active' AND c.Status='Active' AND (p.IsMix=0 OR EXISTS(SELECT 1 FROM dbo.ProductMixVersion mv WHERE mv.ProductID=p.ID AND mv.Status='Active')) ORDER BY p.ProductCode;
END
GO
CREATE OR ALTER PROCEDURE dbo.usp_ProductMix_Read @ProductID INT,@Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope IN('Admin','Product'))
  THROW 52954,'Product access is required for this action.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.Product WHERE ID=@ProductID) THROW 52960,'Product not found.',1;
 SELECT ID,ProductCode,ProductName,CustomerID,IsMix,WeightGrams,RowVersion FROM dbo.Product WHERE ID=@ProductID;
 SELECT ID,ProductID,Version,Status,RowVersion FROM dbo.ProductMixVersion WHERE ProductID=@ProductID ORDER BY Version DESC;
 SELECT mi.VersionID,mi.ProductID,mi.UnitQuantity,p.ProductCode,p.ProductName,p.WeightGrams,p.Status
 FROM dbo.ProductMixItem mi JOIN dbo.ProductMixVersion v ON v.ID=mi.VersionID JOIN dbo.Product p ON p.ID=mi.ProductID
 WHERE v.ProductID=@ProductID ORDER BY mi.VersionID,p.ProductCode;
 SELECT c.ID,c.ProductCode,c.ProductName,c.WeightGrams,c.RowVersion
 FROM dbo.Product c JOIN dbo.Product p ON p.CustomerID=c.CustomerID
 WHERE p.ID=@ProductID AND c.ID<>p.ID AND c.IsMix=0 AND c.Status='Active' ORDER BY c.ProductCode;
END
GO
CREATE OR ALTER PROCEDURE dbo.usp_ProductMix_Save
 @ProductID INT,@Username NVARCHAR(100),@VersionID INT=NULL,@ExpectedRowVersion VARBINARY(8)=NULL,
 @ExpectedProductRowVersion VARBINARY(8)=NULL,@Status VARCHAR(10)='Draft',@Items NVARCHAR(MAX)
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 DECLARE @Actor INT,@OwnTran BIT=0,@Customer INT,@Version INT,@Total DECIMAL(38,6);
 SELECT @Actor=ID FROM dbo.Users WHERE UserName=@Username AND IsActive=1;
 IF @Actor IS NULL THROW 52953,'Username is incorrect.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope IN('Admin','Product'))
  THROW 52954,'Product access is required for this action.',1;
 IF @Status IS NULL OR @Status NOT IN('Draft','Active') THROW 52960,'Mix status must be Draft or Active.',1;
 IF @Items IS NULL OR ISJSON(@Items)<>1 OR LEFT(LTRIM(@Items),1)<>'[' THROW 52960,'Mix items must be an array.',1;
 IF (SELECT COUNT(*) FROM OPENJSON(@Items)) NOT BETWEEN 1 AND 500 THROW 52960,'Enter between 1 and 500 mix items.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Items) WHERE type<>5) THROW 52960,'Each mix item must be an object.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Items) j WHERE
  (SELECT COUNT(*) FROM OPENJSON(j.value))<>3 OR
  (SELECT COUNT(DISTINCT [key]) FROM OPENJSON(j.value) WHERE [key] COLLATE Latin1_General_100_BIN2 IN('ProductID','UnitQuantity','RowVersion'))<>3 OR
  TRY_CONVERT(INT,JSON_VALUE(j.value,'$.ProductID')) IS NULL OR JSON_VALUE(j.value,'$.ProductID') LIKE '%[^0-9]%' OR
  TRY_CONVERT(DECIMAL(12,4),JSON_VALUE(j.value,'$.UnitQuantity')) IS NULL OR
  TRY_CONVERT(DECIMAL(12,4),JSON_VALUE(j.value,'$.UnitQuantity'))<=0 OR
  JSON_VALUE(j.value,'$.UnitQuantity') LIKE '%[^0-9.]%' OR
  (CHARINDEX('.',JSON_VALUE(j.value,'$.UnitQuantity'))>0 AND LEN(JSON_VALUE(j.value,'$.UnitQuantity'))-CHARINDEX('.',JSON_VALUE(j.value,'$.UnitQuantity'))>4) OR
  TRY_CONVERT(VARBINARY(8),JSON_VALUE(j.value,'$.RowVersion'),1) IS NULL OR LEN(JSON_VALUE(j.value,'$.RowVersion'))<>18)
  THROW 52960,'Invalid Product, quantity or child RowVersion.',1;
 DECLARE @Lines TABLE(ProductID INT,UnitQuantity DECIMAL(12,4),RowVersion VARBINARY(8));
 INSERT @Lines SELECT ProductID,UnitQuantity,CONVERT(VARBINARY(8),RowVersion,1)
 FROM OPENJSON(@Items) WITH(ProductID INT,UnitQuantity DECIMAL(12,4),RowVersion VARCHAR(18));
 IF EXISTS(SELECT ProductID FROM @Lines GROUP BY ProductID HAVING COUNT(*)>1) THROW 52960,'Duplicate child Product.',1;
 BEGIN TRY
  IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION; SET @OwnTran=1; END ELSE SAVE TRANSACTION ProductMixSave;
  SELECT @Customer=CustomerID FROM dbo.Product WITH(UPDLOCK,HOLDLOCK)
  WHERE ID=@ProductID AND IsMix=1 AND RowVersion=@ExpectedProductRowVersion;
  IF @Customer IS NULL THROW 52958,'Product changed or Product Mix is not enabled. Refresh before saving.',1;
  IF EXISTS(SELECT 1 FROM @Lines l LEFT JOIN dbo.Product c WITH(UPDLOCK,HOLDLOCK) ON c.ID=l.ProductID
   WHERE c.ID IS NULL OR c.ID=@ProductID OR c.IsMix=1 OR c.Status<>'Active' OR c.CustomerID IS NULL OR c.CustomerID<>@Customer)
   THROW 52960,'Choose active normal Products from the same Customer. Nested mixes are not allowed.',1;
  IF EXISTS(SELECT 1 FROM @Lines l JOIN dbo.Product c ON c.ID=l.ProductID WHERE c.RowVersion<>l.RowVersion)
   THROW 52958,'A child Product changed. Reload the mix before saving.',1;
  SELECT @Total=SUM(CONVERT(DECIMAL(28,6),c.WeightGrams*l.UnitQuantity)) FROM @Lines l JOIN dbo.Product c ON c.ID=l.ProductID;
  IF ROUND(@Total,2)>99999999.99 OR ROUND(@Total,2)<=0 THROW 52960,'Calculated mix weight is outside the supported range.',1;
  IF @VersionID IS NULL
  BEGIN
   IF @ExpectedRowVersion IS NOT NULL THROW 52960,'New mix versions cannot have a RowVersion.',1;
   SELECT @Version=COALESCE(MAX(Version),0)+1 FROM dbo.ProductMixVersion WHERE ProductID=@ProductID;
   INSERT dbo.ProductMixVersion(ProductID,Version,Status,CreatedBy) VALUES(@ProductID,@Version,'Draft',@Actor);
   SET @VersionID=SCOPE_IDENTITY();
  END
  ELSE
  BEGIN
   IF NOT EXISTS(SELECT 1 FROM dbo.ProductMixVersion WHERE ID=@VersionID AND ProductID=@ProductID AND RowVersion=@ExpectedRowVersion)
    THROW 52958,'Mix version changed. Refresh before saving.',1;
   IF EXISTS(SELECT 1 FROM dbo.ProductMixVersion WHERE ID=@VersionID AND Status<>'Draft')
    THROW 52961,'Create a new version to change an Active or Inactive mix.',1;
   DELETE dbo.ProductMixItem WHERE VersionID=@VersionID;
  END
  INSERT dbo.ProductMixItem(VersionID,ProductID,UnitQuantity) SELECT @VersionID,ProductID,UnitQuantity FROM @Lines;
  IF @Status='Active'
   UPDATE dbo.ProductMixVersion SET Status='Inactive',UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()
   WHERE ProductID=@ProductID AND Status='Active' AND ID<>@VersionID;
  UPDATE dbo.ProductMixVersion SET Status=@Status,UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME() WHERE ID=@VersionID;
  UPDATE dbo.Product SET WeightGrams=CASE WHEN @Status='Active' THEN ROUND(@Total,2) ELSE WeightGrams END,
   UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME() WHERE ID=@ProductID;
  SELECT ID,Version,Status,RowVersion,(SELECT RowVersion FROM dbo.Product WHERE ID=@ProductID) ProductRowVersion
  FROM dbo.ProductMixVersion WHERE ID=@VersionID;
  IF @OwnTran=1 COMMIT;
 END TRY
 BEGIN CATCH
  IF @OwnTran=1 AND XACT_STATE()<>0 ROLLBACK;
  ELSE IF @OwnTran=0 AND XACT_STATE()=1 ROLLBACK TRANSACTION ProductMixSave;
  THROW;
 END CATCH
END
GO
