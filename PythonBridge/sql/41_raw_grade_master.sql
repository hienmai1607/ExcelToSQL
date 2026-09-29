USE [test];
GO
-- After 40. Historical grade labels are preserved; no guessed legacy mappings.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
IF OBJECT_ID('dbo.RawGrade','U') IS NULL
BEGIN
 CREATE TABLE dbo.RawGrade(
 ID INT IDENTITY PRIMARY KEY,
 MaterialID INT NOT NULL REFERENCES dbo.RawMaterial(ID),
 GradeName NVARCHAR(100) NOT NULL CHECK(LEN(LTRIM(RTRIM(GradeName)))>0),
 Status VARCHAR(10) NOT NULL DEFAULT('Active') CHECK(Status IN('Active','Block')),
 CreatedAt DATETIME2(7) NOT NULL DEFAULT(SYSUTCDATETIME()),
 CreatedBy INT NOT NULL REFERENCES dbo.Users(ID),
 UpdatedAt DATETIME2(7) NULL,
 UpdatedBy INT NULL REFERENCES dbo.Users(ID),
 RowVersion ROWVERSION NOT NULL,
 CONSTRAINT UQ_RawGrade_MaterialName UNIQUE(MaterialID,GradeName)
 );
END;
IF COL_LENGTH('dbo.ProductGradeItem','RawGradeID') IS NULL
 ALTER TABLE dbo.ProductGradeItem ADD RawGradeID INT NULL REFERENCES dbo.RawGrade(ID);
GO
IF TYPE_ID('dbo.RawGradeBatchType') IS NULL
 EXEC(N'CREATE TYPE dbo.RawGradeBatchType AS TABLE(
 RowNum INT NOT NULL PRIMARY KEY,Command CHAR(1),ID INT,MaterialID INT,
 GradeName NVARCHAR(100),Status VARCHAR(10),RowVersionB64 VARBINARY(8))');
GO
CREATE OR ALTER PROCEDURE dbo.usp_RawGrade_Batch
 @Rows dbo.RawGradeBatchType READONLY,@Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT OFF;
 DECLARE @Actor INT;EXEC dbo.usp_RawMaterial_Authorize @Username,@Actor OUTPUT;
 IF (SELECT COUNT(*) FROM @Rows)>500 THROW 51105,'Maximum 500 rows per batch.',1;
 IF EXISTS(SELECT ID FROM @Rows WHERE ID IS NOT NULL GROUP BY ID HAVING COUNT(*)>1) THROW 51106,'Duplicate IDs.',1;
 DECLARE @Result TABLE(RowNum INT,Status VARCHAR(10),Message NVARCHAR(2048),NewID INT,NewRowVersion VARBINARY(8));
 DECLARE @Row INT,@Cmd CHAR(1),@ID INT,@Material INT,@Name NVARCHAR(100),@Status VARCHAR(10),@RV VARBINARY(8),@Own BIT;
 DECLARE c CURSOR LOCAL FAST_FORWARD FOR
 SELECT RowNum,Command,ID,MaterialID,NULLIF(LTRIM(RTRIM(GradeName)),''),Status,RowVersionB64 FROM @Rows ORDER BY RowNum;
 OPEN c;FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@Material,@Name,@Status,@RV;
 WHILE @@FETCH_STATUS=0
 BEGIN
  SET @Own=0;
  BEGIN TRY
   IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION;SET @Own=1;END ELSE SAVE TRANSACTION RawGradeRow;
   IF @Cmd NOT IN('C','U','D') THROW 51107,'Use C, U or D.',1;
   IF @Cmd IN('U','D') AND NOT EXISTS(SELECT 1 FROM dbo.RawGrade WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@RV)
    THROW 51108,'Concurrency conflict. Refresh first.',1;
   IF @Cmd<>'D'
   BEGIN
    IF @Name IS NULL THROW 51111,'Grade name is required.',1;
    IF @Status IS NOT NULL AND @Status NOT IN('Active','Block') THROW 51111,'Invalid status.',1;
    IF NOT EXISTS(SELECT 1 FROM dbo.RawMaterial WITH(UPDLOCK,HOLDLOCK) WHERE ID=@Material AND
     (Status='Active' OR (@Cmd='U' AND EXISTS(SELECT 1 FROM dbo.RawGrade WHERE ID=@ID AND MaterialID=@Material))))
     THROW 51111,'Choose an active Raw Material.',1;
    IF @Cmd='U' AND EXISTS(SELECT 1 FROM dbo.RawGrade WHERE ID=@ID AND MaterialID<>@Material)
     AND EXISTS(SELECT 1 FROM dbo.ProductGradeItem WHERE RawGradeID=@ID)
     THROW 51111,'This grade is used by Product versions. Create a new grade to change its Raw Material.',1;
   END;
   IF @Cmd='C'
    INSERT dbo.RawGrade(MaterialID,GradeName,Status,CreatedBy)
    OUTPUT @Row,'OK','Created',inserted.ID,inserted.RowVersion INTO @Result
    VALUES(@Material,@Name,COALESCE(@Status,'Active'),@Actor);
   ELSE IF @Cmd='D'
    UPDATE dbo.RawGrade SET Status='Block',UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()
    OUTPUT @Row,'OK','Blocked',inserted.ID,inserted.RowVersion INTO @Result WHERE ID=@ID AND RowVersion=@RV;
   ELSE
    UPDATE dbo.RawGrade SET MaterialID=@Material,GradeName=@Name,Status=COALESCE(@Status,Status),UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()
    OUTPUT @Row,'OK','Updated',inserted.ID,inserted.RowVersion INTO @Result WHERE ID=@ID AND RowVersion=@RV;
   IF @Own=1 COMMIT;
  END TRY
  BEGIN CATCH
   IF @Own=1 AND XACT_STATE()<>0 ROLLBACK;
   ELSE IF XACT_STATE()=1 ROLLBACK TRANSACTION RawGradeRow;
   ELSE IF XACT_STATE()=-1 THROW;
   DELETE @Result WHERE RowNum=@Row;
   INSERT @Result VALUES(@Row,'ERROR',ERROR_MESSAGE(),@ID,NULL);
  END CATCH;
  FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@Material,@Name,@Status,@RV;
 END;
 CLOSE c;DEALLOCATE c;SELECT * FROM @Result ORDER BY RowNum;
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
  (SELECT COUNT(*) FROM OPENJSON(j.value))<>5 OR
  (SELECT COUNT(DISTINCT [key]) FROM OPENJSON(j.value) WHERE [key] COLLATE Latin1_General_100_BIN2 IN('ParentID','ID','Grade','RatioPct','RawGradeID'))<>5)
  THROW 52960,'Each grade item requires ParentID, ID, Grade, RatioPct and RawGradeID.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Items) j WHERE
  TRY_CONVERT(INT,JSON_VALUE(j.value,'$.RawGradeID')) IS NULL OR
  TRY_CONVERT(INT,JSON_VALUE(j.value,'$.RawGradeID'))<1 OR
  TRY_CONVERT(DECIMAL(18,8),JSON_VALUE(j.value,'$.RawGradeID'))<>TRY_CONVERT(INT,JSON_VALUE(j.value,'$.RawGradeID')) OR
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
 DECLARE @Tree TABLE(ParentID NVARCHAR(60),ID INT,Grade NVARCHAR(100),RatioPct DECIMAL(5,2),NodePath NVARCHAR(66),RawGradeID INT);
 INSERT @Tree
 SELECT ParentID,ID,LTRIM(RTRIM(Grade)),RatioPct,ParentID+N'/'+CONVERT(NVARCHAR(4),ID),RawGradeID
 FROM OPENJSON(@Items) WITH(ParentID NVARCHAR(60),ID INT,Grade NVARCHAR(100),RatioPct DECIMAL(5,2),RawGradeID INT);
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
  IF EXISTS(SELECT 1 FROM @Tree t WHERE NOT EXISTS(
   SELECT 1 FROM dbo.RawGrade g WITH(UPDLOCK,HOLDLOCK)
   JOIN dbo.RawMaterial m WITH(UPDLOCK,HOLDLOCK) ON m.ID=g.MaterialID
   WHERE g.ID=t.RawGradeID AND g.Status='Active' AND m.Status='Active'))
   THROW 52960,'Select an active Raw Grade linked to an active Raw Material for every item.',1;
  UPDATE t SET Grade=g.GradeName FROM @Tree t JOIN dbo.RawGrade g ON g.ID=t.RawGradeID;
  -- Serializes all version allocation, edits and activation for one Product.
  IF NOT EXISTS(SELECT 1 FROM dbo.Product WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ProductID AND RowVersion=@ExpectedProductRowVersion)
   THROW 52958,'Product or its grade versions changed. Refresh before saving.',1;
  IF EXISTS(SELECT 1 FROM dbo.Product WHERE ID=@ProductID AND IsMix=1)
   THROW 52960,'Product Mix cannot maintain its own grades. Maintain grades on its child Products.',1;
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
  INSERT dbo.ProductGradeItem(VersionID,ParentID,ID,Grade,RatioPct,RawGradeID)
   SELECT @VersionID,ParentID,ID,Grade,RatioPct,RawGradeID FROM @Tree;
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
