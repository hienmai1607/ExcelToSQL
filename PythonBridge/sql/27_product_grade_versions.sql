USE [test]
GO
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
-- Incremental migration after 26. Preserve original Grade/MixRatioPct for legacy
-- request snapshots; retired fields are not editable in Product master.
IF OBJECT_ID(N'dbo.usp_Product_Fields_Save',N'P') IS NULL
 THROW 52960,'Apply migrations through 26 before Product grades.',1;
IF OBJECT_ID(N'dbo.ProductCodeSequence',N'SO') IS NULL
BEGIN
 DECLARE @Start BIGINT=1;
 SELECT @Start=COALESCE(MAX(TRY_CONVERT(BIGINT,SUBSTRING(ProductCode,5,10))),0)+1
 FROM dbo.Product WHERE ProductCode LIKE 'PRD-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]' AND LEN(ProductCode)=14;
 DECLARE @DDL NVARCHAR(MAX)=N'CREATE SEQUENCE dbo.ProductCodeSequence AS BIGINT START WITH '+CONVERT(NVARCHAR(20),@Start)+N' INCREMENT BY 1 MINVALUE 1 MAXVALUE 9999999999 NO CYCLE CACHE 50;';
 EXEC sys.sp_executesql @DDL;
END;
IF OBJECT_ID(N'dbo.ProductGradeVersion',N'U') IS NULL
BEGIN
 CREATE TABLE dbo.ProductGradeVersion(
  ID INT IDENTITY PRIMARY KEY,
  ProductID INT NOT NULL REFERENCES dbo.Product(ID),
  Version INT NOT NULL CHECK(Version>0),
  Status VARCHAR(10) NOT NULL CHECK(Status IN('Draft','Active','Inactive')),
  CreatedBy INT NOT NULL REFERENCES dbo.Users(ID),
  CreatedAt DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  UpdatedBy INT NULL REFERENCES dbo.Users(ID),
  UpdatedAt DATETIME2(3) NULL,
  RowVersion ROWVERSION NOT NULL,
  CONSTRAINT UQ_ProductGradeVersion UNIQUE(ProductID,Version)
 );
 CREATE UNIQUE INDEX UX_ProductGradeVersion_Active ON dbo.ProductGradeVersion(ProductID) WHERE Status='Active';
END;
IF OBJECT_ID(N'dbo.ProductGradeItem',N'U') IS NULL
 CREATE TABLE dbo.ProductGradeItem(
  VersionID INT NOT NULL REFERENCES dbo.ProductGradeVersion(ID),
  ParentID NVARCHAR(60) NOT NULL,
  ID INT NOT NULL CHECK(ID BETWEEN 1 AND 9999),
  Grade NVARCHAR(100) NOT NULL CHECK(LEN(LTRIM(RTRIM(Grade)))>0),
  RatioPct DECIMAL(5,2) NOT NULL CHECK(RatioPct>0 AND RatioPct<=100),
  NodePath AS CONVERT(NVARCHAR(66),ParentID+N'/'+CONVERT(NVARCHAR(4),ID)) PERSISTED,
  CONSTRAINT PK_ProductGradeItem PRIMARY KEY(VersionID,ParentID,ID),
  CONSTRAINT UQ_ProductGradeItem_Path UNIQUE(VersionID,NodePath)
 );
GO
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
                IF @Code IS NOT NULL
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
                    INSERT dbo.Product(ProductCode,ProductName,WeightGrams,Status,CreatedBy)
                    VALUES(UPPER(@Code),@Name,@WeightGrams,COALESCE(@Status,'Active'),@UserID);
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
                    UPDATE dbo.Product SET ProductName=@Name,
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
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] NOT IN('Category','ProductName','WeightGrams','Status'))
 THROW 52957,'Unknown additional field.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE
 ([key]='ProductName' AND (LEN(LTRIM(RTRIM(COALESCE([value],''))))=0 OR LEN([value])>200)) OR
 ([key]='WeightGrams' AND (TRY_CONVERT(DECIMAL(10,2),[value]) IS NULL OR TRY_CONVERT(DECIMAL(10,2),[value])<=0)) OR
 ([key]='Status' AND ([value] IS NULL OR [value] NOT IN('Active','Block'))) OR
 ([key]='Category' AND LEN([value])>100) OR
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
 ProductName=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='ProductName') THEN LTRIM(RTRIM(j.ProductName)) ELSE t.ProductName END,
 WeightGrams=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='WeightGrams') THEN j.WeightGrams ELSE t.WeightGrams END,
 Status=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='Status') THEN j.Status ELSE t.Status END,
 Category=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='Category') THEN NULLIF(LTRIM(RTRIM(j.Category)),N'') ELSE t.Category END,
 UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()
 FROM dbo.Product t CROSS APPLY OPENJSON(@Fields) WITH(ProductName VARCHAR(200),WeightGrams DECIMAL(10,2),Status VARCHAR(10),Category NVARCHAR(100)) j
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

CREATE OR ALTER PROCEDURE dbo.usp_ProductGrade_Read @ProductID INT,@Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @Actor INT;
 SELECT @Actor=ID FROM dbo.Users WHERE UserName=@Username AND IsActive=1;
 IF @Actor IS NULL THROW 52953,'Username is incorrect.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope IN('Product','Admin'))
  THROW 52954,'Product access is required for this action.',1;
 BEGIN TRY
  BEGIN TRANSACTION;
  IF NOT EXISTS(SELECT 1 FROM dbo.Product WITH(HOLDLOCK) WHERE ID=@ProductID)
   THROW 52960,'Product was not found.',1;
  SELECT ID,ProductCode,ProductName,RowVersion FROM dbo.Product WHERE ID=@ProductID;
  SELECT v.*,c.UserName CreatedByName,u.UserName UpdatedByName
  FROM dbo.ProductGradeVersion v
  JOIN dbo.Users c ON c.ID=v.CreatedBy LEFT JOIN dbo.Users u ON u.ID=v.UpdatedBy
  WHERE ProductID=@ProductID ORDER BY Version DESC;
  SELECT i.* FROM dbo.ProductGradeItem i JOIN dbo.ProductGradeVersion v ON v.ID=i.VersionID
  WHERE v.ProductID=@ProductID ORDER BY v.Version DESC,LEN(i.ParentID),i.ParentID,i.ID;
  COMMIT;
 END TRY
 BEGIN CATCH
  IF @@TRANCOUNT>0 ROLLBACK;
  THROW;
 END CATCH
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_ProductGrade_Save
 @ProductID INT,@Username NVARCHAR(100),@VersionID INT=NULL,
 @ExpectedRowVersion VARBINARY(8)=NULL,@ExpectedProductRowVersion VARBINARY(8)=NULL,
 @Status VARCHAR(10)='Draft',@Items NVARCHAR(MAX)
AS
BEGIN
 SET NOCOUNT ON;
 SET XACT_ABORT ON;
 DECLARE @Actor INT,@OwnTran BIT=0,@Version INT;
 SELECT @Actor=ID FROM dbo.Users WHERE UserName=@Username AND IsActive=1;
 IF @Actor IS NULL THROW 52953,'Username is incorrect.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope IN('Admin','Product'))
  THROW 52954,'Product access is required for this action.',1;
 IF @Status IS NULL OR @Status NOT IN('Draft','Active')
  THROW 52960,'Grade status must be Draft or Active.',1;
 IF @Items IS NULL OR ISJSON(@Items)<>1 OR LEFT(LTRIM(@Items),1)<>'['
  THROW 52960,'Grade items must be a JSON array.',1;
 IF (SELECT COUNT(*) FROM OPENJSON(@Items)) NOT BETWEEN 1 AND 1000
  THROW 52960,'Enter between 1 and 1000 grade items.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Items) WHERE type<>5)
  THROW 52960,'Each grade item must be an object.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Items) j WHERE
  (SELECT COUNT(*) FROM OPENJSON(j.value))<>4 OR
  (SELECT COUNT(DISTINCT [key]) FROM OPENJSON(j.value) WHERE [key] COLLATE Latin1_General_100_BIN2 IN('ParentID','ID','Grade','RatioPct'))<>4)
  THROW 52960,'Each grade item requires ParentID, ID, Grade and RatioPct.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Items) j WHERE
  JSON_VALUE(j.value,'$.ParentID') IS NULL OR LEN(JSON_VALUE(j.value,'$.ParentID'))>60 OR
  JSON_VALUE(j.value,'$.Grade') IS NULL OR LEN(LTRIM(RTRIM(JSON_VALUE(j.value,'$.Grade'))))=0 OR LEN(JSON_VALUE(j.value,'$.Grade'))>100 OR
  TRY_CONVERT(INT,JSON_VALUE(j.value,'$.ID')) IS NULL OR
  TRY_CONVERT(INT,JSON_VALUE(j.value,'$.ID')) NOT BETWEEN 1 AND 9999 OR
  TRY_CONVERT(DECIMAL(18,8),JSON_VALUE(j.value,'$.ID'))<>TRY_CONVERT(INT,JSON_VALUE(j.value,'$.ID')) OR
  TRY_CONVERT(DECIMAL(18,8),JSON_VALUE(j.value,'$.RatioPct')) IS NULL OR
  JSON_VALUE(j.value,'$.RatioPct') COLLATE Latin1_General_100_BIN2 LIKE '%[^0-9.]%' OR
  (CHARINDEX('.',JSON_VALUE(j.value,'$.RatioPct'))>0 AND LEN(JSON_VALUE(j.value,'$.RatioPct'))-CHARINDEX('.',JSON_VALUE(j.value,'$.RatioPct'))>2) OR
  TRY_CONVERT(DECIMAL(18,8),JSON_VALUE(j.value,'$.RatioPct')) NOT BETWEEN 0.01 AND 100 OR
  TRY_CONVERT(DECIMAL(18,8),JSON_VALUE(j.value,'$.RatioPct'))<>TRY_CONVERT(DECIMAL(5,2),JSON_VALUE(j.value,'$.RatioPct')))
  THROW 52960,'Invalid grade, ID or ratio. Use positive percentages with at most 2 decimals.',1;
 DECLARE @Tree TABLE(ParentID NVARCHAR(60),ID INT,Grade NVARCHAR(100),RatioPct DECIMAL(5,2),NodePath NVARCHAR(66));
 INSERT @Tree
 SELECT ParentID,ID,LTRIM(RTRIM(Grade)),RatioPct,ParentID+N'/'+CONVERT(NVARCHAR(4),ID)
 FROM OPENJSON(@Items) WITH(ParentID NVARCHAR(60),ID INT,Grade NVARCHAR(100),RatioPct DECIMAL(5,2));
 IF EXISTS(SELECT 1 FROM @Tree WHERE ParentID COLLATE Latin1_General_100_BIN2 LIKE '%[^0-9/]%' OR (ParentID<>'0' AND (
  LEFT(ParentID,2)<>'0/' OR RIGHT(ParentID,1)='/' OR ParentID LIKE '%//%' OR
  ParentID COLLATE Latin1_General_100_BIN2 LIKE '%[^0-9/]%' OR
  LEN(ParentID)-LEN(REPLACE(ParentID,'/',''))>11 OR
  EXISTS(SELECT 1 FROM STRING_SPLIT(SUBSTRING(ParentID,3,60),'/') WHERE
   TRY_CONVERT(INT,value) IS NULL OR TRY_CONVERT(INT,value) NOT BETWEEN 1 AND 9999 OR
   value<>CONVERT(VARCHAR(4),TRY_CONVERT(INT,value))))))
  THROW 52960,'Invalid parent path.',1;
 IF EXISTS(SELECT NodePath FROM @Tree GROUP BY NodePath HAVING COUNT(*)>1)
  THROW 52960,'Duplicate grade ID under the same parent.',1;
 IF EXISTS(SELECT 1 FROM @Tree t WHERE ParentID<>'0' AND NOT EXISTS(SELECT 1 FROM @Tree p WHERE p.NodePath=t.ParentID))
  THROW 52960,'Every parent must exist in this grade version.',1;
 IF EXISTS(SELECT ParentID FROM @Tree GROUP BY ParentID HAVING SUM(RatioPct)<>100)
  THROW 52960,'Ratios under each parent must total exactly 100%.',1;
 BEGIN TRY
  IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION; SET @OwnTran=1; END
  ELSE SAVE TRANSACTION ProductGradeSave;
  -- Serializes all version allocation, edits and activation for one Product.
  IF NOT EXISTS(SELECT 1 FROM dbo.Product WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ProductID AND RowVersion=@ExpectedProductRowVersion)
   THROW 52958,'Product or its grade versions changed. Refresh before saving.',1;
  IF @VersionID IS NULL
  BEGIN
   IF @ExpectedRowVersion IS NOT NULL THROW 52960,'New grade versions cannot have a RowVersion.',1;
   SELECT @Version=COALESCE(MAX(Version),0)+1 FROM dbo.ProductGradeVersion WHERE ProductID=@ProductID;
   INSERT dbo.ProductGradeVersion(ProductID,Version,Status,CreatedBy) VALUES(@ProductID,@Version,'Draft',@Actor);
   SET @VersionID=SCOPE_IDENTITY();
  END
  ELSE
  BEGIN
   IF NOT EXISTS(SELECT 1 FROM dbo.ProductGradeVersion WHERE ID=@VersionID AND ProductID=@ProductID AND RowVersion=@ExpectedRowVersion)
    THROW 52958,'Grade version changed. Refresh before saving.',1;
   IF EXISTS(SELECT 1 FROM dbo.ProductGradeVersion WHERE ID=@VersionID AND Status<>'Draft')
    THROW 52961,'Create a new version to change an Active or Inactive grade structure.',1;
   DELETE dbo.ProductGradeItem WHERE VersionID=@VersionID;
  END;
  INSERT dbo.ProductGradeItem(VersionID,ParentID,ID,Grade,RatioPct)
   SELECT @VersionID,ParentID,ID,Grade,RatioPct FROM @Tree;
  IF @Status='Active'
   UPDATE dbo.ProductGradeVersion SET Status='Inactive',UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()
   WHERE ProductID=@ProductID AND Status='Active' AND ID<>@VersionID;
  UPDATE dbo.ProductGradeVersion SET Status=@Status,UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME() WHERE ID=@VersionID;
  UPDATE dbo.Product SET UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME() WHERE ID=@ProductID;
  SELECT ID,ProductID,Version,Status,RowVersion,
   (SELECT RowVersion FROM dbo.Product WHERE ID=@ProductID) AS ProductRowVersion
  FROM dbo.ProductGradeVersion WHERE ID=@VersionID;
  IF @OwnTran=1 COMMIT;
 END TRY
 BEGIN CATCH
  IF @OwnTran=1 AND XACT_STATE()<>0 ROLLBACK;
  ELSE IF @OwnTran=0 AND XACT_STATE()=1 ROLLBACK TRANSACTION ProductGradeSave;
  THROW;
 END CATCH
END;
GO
