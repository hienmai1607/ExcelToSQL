:on error exit
/*
PythonBridge VM upgrade: migrations 45-85 (41 scripts), generated 2026-10-04.

Existing application database only; migrations through 44 must already be applied.
Intended starting point: migration 44. If 45 or later is already installed,
review and execute only the missing migration sections; do not blindly rerun
the whole bundle against an already upgraded or partially upgraded database.
Back up the target database and stop the API before running. Some migrations
backfill existing fields or normalize master data; this is not a history purge.
Each source keeps its original transactions. The whole bundle is NOT atomic:
if a migration fails, earlier committed migrations remain. Stop and investigate.

SSMS: select the intended database, enable Query > SQLCMD Mode, execute this file.
sqlcmd: sqlcmd -S YOUR_SERVER -d YOUR_DATABASE -E -b -i upgrade_045_to_085_vm.sql
No USE directive is included: the selected connection database is the target.
No external include files, credentials, sample data, or local-ID PET jar merge.
Deploy the matching API and webapp/dist, restart the API, hard-refresh clients.
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
 THROW 52990,'Select the existing PythonBridge application database, not a system database.',1;
IF @@TRANCOUNT<>0
 THROW 52990,'Run the VM upgrade on a new connection without an existing transaction.',1;
IF (SELECT compatibility_level FROM sys.databases WHERE database_id=DB_ID())<130
 THROW 52990,'PythonBridge requires database compatibility level 130 or higher.',1;
IF OBJECT_ID(N'dbo.RawGrade',N'U') IS NULL
 OR OBJECT_ID(N'dbo.RawMaterial',N'U') IS NULL
 OR OBJECT_ID(N'dbo.ProductGradeItem',N'U') IS NULL
 OR OBJECT_ID(N'dbo.UnitConversion',N'U') IS NULL
 OR OBJECT_ID(N'dbo.PackagingConfigurationRequestItem',N'U') IS NULL
 OR OBJECT_ID(N'dbo.usp_ProductGrade_Save',N'P') IS NULL
 THROW 52990,'This upgrade requires an existing application database with migrations through 44; it is not a fresh-install script.',1;
PRINT N'Applying PythonBridge migrations 45-85 to '+QUOTENAME(DB_NAME());
GO
-- BEGIN MIGRATION 45_raw_material_grade_assignment.sql
-- SOURCE SHA256 5db4ee0b0d5f9eec36390645c86676e7e46bf737a8b70e80514d8c7fc8afc06f
PRINT N'Applying 45_raw_material_grade_assignment.sql';
GO
GO
-- After 44. Raw Material owns the assignment to a leaf Raw Grade.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.RawMaterial','GradeID') IS NULL
 ALTER TABLE dbo.RawMaterial ADD GradeID INT NULL;
GO
IF NOT EXISTS(SELECT 1 FROM sys.foreign_keys WHERE name='FK_RawMaterial_Grade')
 ALTER TABLE dbo.RawMaterial ADD CONSTRAINT FK_RawMaterial_Grade FOREIGN KEY(GradeID) REFERENCES dbo.RawGrade(ID);
IF EXISTS(SELECT MaterialID FROM dbo.RawGrade WHERE MaterialID IS NOT NULL GROUP BY MaterialID HAVING COUNT(*)>1)
 THROW 51120,'A Raw Material has multiple assigned grades. Resolve before migration 45.',1;
IF EXISTS(SELECT 1 FROM dbo.RawGrade g JOIN dbo.RawGrade child ON child.ParentGradeID=g.ID WHERE g.MaterialID IS NOT NULL)
 THROW 51121,'A parent grade has a material assignment. Resolve before migration 45.',1;
IF EXISTS(SELECT 1 FROM dbo.RawGrade g JOIN dbo.RawMaterial m ON m.ID=g.MaterialID WHERE m.GradeID IS NOT NULL AND m.GradeID<>g.ID)
 THROW 51122,'Raw Material grade conflicts with legacy assignment.',1;
UPDATE m SET GradeID=g.ID FROM dbo.RawMaterial m JOIN dbo.RawGrade g ON g.MaterialID=m.ID WHERE m.GradeID IS NULL;
-- Names may legitimately repeat under different branches once MaterialID is retired.
IF OBJECT_ID('dbo.UQ_RawGrade_MaterialName','UQ') IS NOT NULL
 ALTER TABLE dbo.RawGrade DROP CONSTRAINT UQ_RawGrade_MaterialName;
UPDATE dbo.RawGrade SET MaterialID=NULL WHERE MaterialID IS NOT NULL;
IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE name='CK_RawGrade_LegacyMaterialRetired')
 ALTER TABLE dbo.RawGrade ADD CONSTRAINT CK_RawGrade_LegacyMaterialRetired CHECK(MaterialID IS NULL);
COMMIT;
GO
IF TYPE_ID('dbo.RawMaterialBatchTypeV2') IS NULL
 EXEC(N'CREATE TYPE dbo.RawMaterialBatchTypeV2 AS TABLE(RowNum INT NOT NULL PRIMARY KEY,Command CHAR(1),ID INT,MaterialCode NVARCHAR(40),MaterialName NVARCHAR(200),Description NVARCHAR(500),UnitOfMeasure NVARCHAR(20),Status VARCHAR(10),RowVersionB64 VARBINARY(8),GradeID INT,GradeSet BIT)');
GO
IF TYPE_ID('dbo.RawGradeBatchTypeV4') IS NULL
 EXEC(N'CREATE TYPE dbo.RawGradeBatchTypeV4 AS TABLE(RowNum INT NOT NULL PRIMARY KEY,Command CHAR(1),ID INT,GradeName NVARCHAR(100),Status VARCHAR(10),RowVersionB64 VARBINARY(8),ParentGradeID INT,ParentGradeSet BIT)');
GO
CREATE OR ALTER PROCEDURE dbo.usp_RawMaterial_BatchV2
 @Rows dbo.RawMaterialBatchTypeV2 READONLY,@Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT OFF;
 DECLARE @Actor INT;EXEC dbo.usp_RawMaterial_Authorize @Username,@Actor OUTPUT;
 IF (SELECT COUNT(*) FROM @Rows)>500 THROW 51105,'Maximum 500 rows per batch.',1;
 IF EXISTS(SELECT ID FROM @Rows WHERE ID IS NOT NULL GROUP BY ID HAVING COUNT(*)>1) THROW 51106,'Duplicate IDs.',1;
 DECLARE @Result TABLE(RowNum INT,Status VARCHAR(10),Message NVARCHAR(2048),NewID INT,NewRowVersion VARBINARY(8),NewMaterialCode NVARCHAR(40));
 DECLARE @Row INT,@Cmd CHAR(1),@ID INT,@Code NVARCHAR(40),@Name NVARCHAR(200),@Description NVARCHAR(500),@Unit NVARCHAR(20),@Status VARCHAR(10),@RV VARBINARY(8),@Grade INT,@GradeSet BIT,@Own BIT,@Lock INT,@Number BIGINT;
 DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT RowNum,UPPER(Command),ID,NULLIF(LTRIM(RTRIM(MaterialCode)),''),NULLIF(LTRIM(RTRIM(MaterialName)),''),Description,NULLIF(LTRIM(RTRIM(UnitOfMeasure)),''),Status,RowVersionB64,GradeID,GradeSet FROM @Rows ORDER BY RowNum;
 OPEN c;FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@Code,@Name,@Description,@Unit,@Status,@RV,@Grade,@GradeSet;
 WHILE @@FETCH_STATUS=0
 BEGIN
  SET @Own=0;
  BEGIN TRY
   IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION;SET @Own=1;END ELSE SAVE TRANSACTION RawMaterialRow;
   EXEC @Lock=sys.sp_getapplock @Resource=N'RawGradeHierarchy',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
   IF @Lock<0 THROW 51108,'Grade hierarchy is busy. Try again.',1;
   IF @Cmd NOT IN('C','U','D') THROW 51107,'Use C, U or D.',1;
   IF @Cmd IN('U','D') AND NOT EXISTS(SELECT 1 FROM dbo.RawMaterial WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@RV) THROW 51108,'Concurrency conflict. Refresh first.',1;
   IF @Cmd<>'D'
   BEGIN
    IF @Cmd='U' AND COALESCE(@GradeSet,0)=0 SELECT @Grade=GradeID FROM dbo.RawMaterial WHERE ID=@ID;
    IF @Cmd='U' AND @Status IS NULL SELECT @Status=Status FROM dbo.RawMaterial WHERE ID=@ID;
    IF @Name IS NULL OR @Unit IS NULL THROW 51110,'Material Name and Unit of Measure are required.',1;
    IF @Status IS NOT NULL AND @Status NOT IN('Active','Block') THROW 51109,'Invalid status.',1;
    IF NOT EXISTS(SELECT 1 FROM dbo.UoM WITH(UPDLOCK,HOLDLOCK) WHERE UoMCode=@Unit AND (Status='Active' OR (@Cmd='U' AND EXISTS(SELECT 1 FROM dbo.RawMaterial WHERE ID=@ID AND UnitOfMeasure=@Unit)))) THROW 51111,'Choose an active Unit of Measure.',1;
    IF @Grade IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.RawGrade g WITH(UPDLOCK,HOLDLOCK) WHERE g.ID=@Grade
     AND (g.Status='Active' OR (@Cmd='U' AND EXISTS(SELECT 1 FROM dbo.RawMaterial WHERE ID=@ID AND GradeID=@Grade)))
     AND NOT EXISTS(SELECT 1 FROM dbo.RawGrade child WHERE child.ParentGradeID=g.ID))
     THROW 51111,'Choose an active leaf grade (a grade with no children).',1;
   END;
   IF @Cmd IN('U','D') AND @Code IS NOT NULL AND EXISTS(SELECT 1 FROM dbo.RawMaterial WHERE ID=@ID AND MaterialCode COLLATE Latin1_General_100_BIN2<>@Code COLLATE Latin1_General_100_BIN2) THROW 51110,'Material code is read-only.',1;
   IF @Cmd='C'
   BEGIN
    IF @Code IS NOT NULL THROW 51110,'Material code is generated automatically.',1;
    SET @Number=NEXT VALUE FOR dbo.RawMaterialCodeSequence;
    SET @Code='RAW-'+RIGHT(REPLICATE('0',10)+CONVERT(VARCHAR(10),@Number),10);
    WHILE EXISTS(SELECT 1 FROM dbo.RawMaterial WHERE MaterialCode=@Code)
    BEGIN SET @Number=NEXT VALUE FOR dbo.RawMaterialCodeSequence;SET @Code='RAW-'+RIGHT(REPLICATE('0',10)+CONVERT(VARCHAR(10),@Number),10);END;
    INSERT dbo.RawMaterial(MaterialCode,MaterialName,Description,UnitOfMeasure,Status,GradeID,CreatedBy)
    OUTPUT @Row,'OK','Created',inserted.ID,inserted.RowVersion,inserted.MaterialCode INTO @Result
    VALUES(@Code,@Name,@Description,@Unit,COALESCE(@Status,'Active'),@Grade,@Actor);
   END
   ELSE IF @Cmd='D'
    UPDATE dbo.RawMaterial SET Status='Block',UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@Actor
    OUTPUT @Row,'OK','Blocked',inserted.ID,inserted.RowVersion,inserted.MaterialCode INTO @Result WHERE ID=@ID AND RowVersion=@RV;
   ELSE
    UPDATE dbo.RawMaterial SET MaterialName=@Name,Description=@Description,UnitOfMeasure=@Unit,GradeID=@Grade,Status=COALESCE(@Status,Status),UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@Actor
    OUTPUT @Row,'OK','Updated',inserted.ID,inserted.RowVersion,inserted.MaterialCode INTO @Result WHERE ID=@ID AND RowVersion=@RV;
   IF @Own=1 COMMIT;
  END TRY
  BEGIN CATCH
   IF @Own=1 AND XACT_STATE()<>0 ROLLBACK;
   ELSE IF XACT_STATE()=1 ROLLBACK TRANSACTION RawMaterialRow;
   ELSE IF XACT_STATE()=-1 THROW;
   DELETE @Result WHERE RowNum=@Row;
   INSERT @Result VALUES(@Row,'ERROR',ERROR_MESSAGE(),@ID,NULL,NULL);
  END CATCH;
  FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@Code,@Name,@Description,@Unit,@Status,@RV,@Grade,@GradeSet;
 END;
 CLOSE c;DEALLOCATE c;SELECT * FROM @Result ORDER BY RowNum;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_RawGrade_BatchV4
 @Rows dbo.RawGradeBatchTypeV4 READONLY,@Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT OFF;
 DECLARE @Actor INT;EXEC dbo.usp_RawMaterial_Authorize @Username,@Actor OUTPUT;
 IF (SELECT COUNT(*) FROM @Rows)>500 THROW 51105,'Maximum 500 rows per batch.',1;
 IF EXISTS(SELECT ID FROM @Rows WHERE ID IS NOT NULL GROUP BY ID HAVING COUNT(*)>1) THROW 51106,'Duplicate IDs.',1;
 DECLARE @Result TABLE(RowNum INT,Status VARCHAR(10),Message NVARCHAR(2048),NewID INT,NewRowVersion VARBINARY(8));
 DECLARE @Row INT,@Cmd CHAR(1),@ID INT,@Name NVARCHAR(100),@Status VARCHAR(10),@RV VARBINARY(8),@Parent INT,@ParentSet BIT,@Ancestor INT,@Own BIT,@Lock INT;
 DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT RowNum,UPPER(Command),ID,NULLIF(LTRIM(RTRIM(GradeName)),''),Status,RowVersionB64,ParentGradeID,ParentGradeSet FROM @Rows ORDER BY RowNum;
 OPEN c;FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@Name,@Status,@RV,@Parent,@ParentSet;
 WHILE @@FETCH_STATUS=0
 BEGIN
  SET @Own=0;
  BEGIN TRY
   IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION;SET @Own=1;END ELSE SAVE TRANSACTION RawGradeRow;
   EXEC @Lock=sys.sp_getapplock @Resource=N'RawGradeHierarchy',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
   IF @Lock<0 THROW 51108,'Grade hierarchy is busy. Try again.',1;
   IF @Cmd NOT IN('C','U','D') THROW 51107,'Use C, U or D.',1;
   IF @Cmd IN('U','D') AND NOT EXISTS(SELECT 1 FROM dbo.RawGrade WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@RV) THROW 51108,'Concurrency conflict. Refresh first.',1;
   IF @Cmd<>'D'
   BEGIN
    IF @Name IS NULL THROW 51111,'Grade name is required.',1;
    IF @Status IS NOT NULL AND @Status NOT IN('Active','Block') THROW 51111,'Invalid status.',1;
    IF @Cmd='U' AND COALESCE(@ParentSet,0)=0 SELECT @Parent=ParentGradeID FROM dbo.RawGrade WHERE ID=@ID;
    IF @Parent IS NOT NULL
    BEGIN
     IF NOT EXISTS(SELECT 1 FROM dbo.RawGrade WHERE ID=@Parent AND (Status='Active' OR (@Cmd='U' AND EXISTS(SELECT 1 FROM dbo.RawGrade WHERE ID=@ID AND ParentGradeID=@Parent)))) THROW 51111,'Choose an active Parent Grade.',1;
     IF EXISTS(SELECT 1 FROM dbo.RawMaterial WHERE GradeID=@Parent) THROW 51111,'A grade assigned to Raw Material cannot become a parent. Reassign the material first.',1;
     SET @Ancestor=@Parent;
     DECLARE @Visited TABLE(ID INT PRIMARY KEY);
     DELETE @Visited;
     WHILE @Ancestor IS NOT NULL
     BEGIN
      IF @Ancestor=@ID OR EXISTS(SELECT 1 FROM @Visited WHERE ID=@Ancestor) THROW 51111,'Parent Grade cannot be this grade or one of its descendants.',1;
      INSERT @Visited VALUES(@Ancestor);
      SELECT @Ancestor=ParentGradeID FROM dbo.RawGrade WHERE ID=@Ancestor;
     END;
    END;
   END;
   IF @Cmd='C'
    INSERT dbo.RawGrade(GradeName,Status,CreatedBy,ParentGradeID)
    OUTPUT @Row,'OK','Created',inserted.ID,inserted.RowVersion INTO @Result VALUES(@Name,COALESCE(@Status,'Active'),@Actor,@Parent);
   ELSE IF @Cmd='D'
    UPDATE dbo.RawGrade SET Status='Block',UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()
    OUTPUT @Row,'OK','Blocked',inserted.ID,inserted.RowVersion INTO @Result WHERE ID=@ID AND RowVersion=@RV;
   ELSE
    UPDATE dbo.RawGrade SET ParentGradeID=@Parent,GradeName=@Name,Status=COALESCE(@Status,Status),UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()
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
  FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@Name,@Status,@RV,@Parent,@ParentSet;
 END;
 CLOSE c;DEALLOCATE c;SELECT * FROM @Result ORDER BY RowNum;
END;
GO
-- Do not let older clients bypass the new leaf-grade rule through V3.
CREATE OR ALTER PROCEDURE dbo.usp_RawGrade_Batch
 @Rows dbo.RawGradeBatchType READONLY,@Username NVARCHAR(100)
AS
BEGIN
 THROW 51123,'Raw Grade assignment moved to Raw Material. Refresh the application and use the V4 endpoint.',1;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_RawGrade_BatchV2
 @Rows dbo.RawGradeBatchTypeV2 READONLY,@Username NVARCHAR(100)
AS
BEGIN
 THROW 51123,'Raw Grade assignment moved to Raw Material. Refresh the application and use the V4 endpoint.',1;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_RawGrade_BatchV3
 @Rows dbo.RawGradeBatchTypeV3 READONLY,@Username NVARCHAR(100)
AS
BEGIN
 THROW 51123,'Raw Grade assignment moved to Raw Material. Refresh the application and use the V4 endpoint.',1;
END;
GO
GO
-- END MIGRATION 45_raw_material_grade_assignment.sql

-- BEGIN MIGRATION 46_product_grade_raw_material.sql
-- SOURCE SHA256 a7ebbfe419c0086e246808228d58e0cfefe15751c60de4ee672ff9a7abeee7c5
PRINT N'Applying 46_product_grade_raw_material.sql';
GO
GO
-- After 45. Store an optional Raw Material choice for each child grade.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF COL_LENGTH('dbo.ProductGradeItem','RawMaterialID') IS NULL
 ALTER TABLE dbo.ProductGradeItem ADD RawMaterialID INT NULL REFERENCES dbo.RawMaterial(ID);
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
  (SELECT COUNT(*) FROM OPENJSON(j.value))<>6 OR
  (SELECT COUNT(DISTINCT [key]) FROM OPENJSON(j.value) WHERE [key] COLLATE Latin1_General_100_BIN2 IN('ParentID','ID','Grade','RatioPct','RawGradeID','RawMaterialID'))<>6)
  THROW 52960,'Each grade item requires ParentID, ID, Grade, RatioPct, RawGradeID and RawMaterialID.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Items) j WHERE
  TRY_CONVERT(INT,JSON_VALUE(j.value,'$.RawGradeID')) IS NULL OR
  TRY_CONVERT(INT,JSON_VALUE(j.value,'$.RawGradeID'))<1 OR
  TRY_CONVERT(DECIMAL(18,8),JSON_VALUE(j.value,'$.RawGradeID'))<>TRY_CONVERT(INT,JSON_VALUE(j.value,'$.RawGradeID')) OR
  (JSON_VALUE(j.value,'$.RawMaterialID') IS NOT NULL AND (
   TRY_CONVERT(INT,JSON_VALUE(j.value,'$.RawMaterialID')) IS NULL OR
   TRY_CONVERT(INT,JSON_VALUE(j.value,'$.RawMaterialID'))<1 OR
   TRY_CONVERT(DECIMAL(18,8),JSON_VALUE(j.value,'$.RawMaterialID'))<>TRY_CONVERT(INT,JSON_VALUE(j.value,'$.RawMaterialID')))) OR
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
 DECLARE @Tree TABLE(ParentID NVARCHAR(60),ID INT,Grade NVARCHAR(100),RatioPct DECIMAL(5,2),NodePath NVARCHAR(66),RawGradeID INT,RawMaterialID INT);
 INSERT @Tree
 SELECT ParentID,ID,LTRIM(RTRIM(Grade)),RatioPct,ParentID+N'/'+CONVERT(NVARCHAR(4),ID),RawGradeID,RawMaterialID
 FROM OPENJSON(@Items) WITH(ParentID NVARCHAR(60),ID INT,Grade NVARCHAR(100),RatioPct DECIMAL(5,2),RawGradeID INT,RawMaterialID INT);
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
   WHERE g.ID=t.RawGradeID AND g.Status='Active'))
   THROW 52960,'Select an active Raw Grade for every item.',1;
  IF EXISTS(SELECT 1 FROM @Tree WHERE ParentID='0' AND RawMaterialID IS NOT NULL)
   THROW 52960,'Raw Material may be selected only for child grades.',1;
  IF EXISTS(SELECT 1 FROM @Tree t WHERE t.RawMaterialID IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM dbo.RawMaterial m WITH(UPDLOCK,HOLDLOCK)
   WHERE m.ID=t.RawMaterialID AND m.Status='Active' AND m.GradeID=t.RawGradeID))
   THROW 52960,'Choose an active Raw Material assigned to the selected child grade.',1;
  IF EXISTS(
   SELECT 1 FROM @Tree child JOIN @Tree parent ON parent.NodePath=child.ParentID
   JOIN dbo.RawGrade g ON g.ID=child.RawGradeID
   WHERE g.ParentGradeID IS NULL OR g.ParentGradeID<>parent.RawGradeID)
   THROW 52960,'Each child grade must belong to its selected parent in Raw Grade Master.',1;
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
  INSERT dbo.ProductGradeItem(VersionID,ParentID,ID,Grade,RatioPct,RawGradeID,RawMaterialID)
   SELECT @VersionID,ParentID,ID,Grade,RatioPct,RawGradeID,RawMaterialID FROM @Tree;
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
GO
-- END MIGRATION 46_product_grade_raw_material.sql

-- BEGIN MIGRATION 47_opportunity_mix_children.sql
-- SOURCE SHA256 7339e456ba6a9db0d3770c5bf3dd71bbf88e8668aadb1691d362ef893c7cf9f3
PRINT N'Applying 47_opportunity_mix_children.sql';
GO
GO
-- After 46. Real child Opportunity items, with immutable mix membership.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
IF COL_LENGTH('dbo.OpportunityItem','ParentItemID') IS NULL
BEGIN
 ALTER TABLE dbo.OpportunityItem ADD ParentItemID INT NULL,
  MixUnitQuantity DECIMAL(12,4) NULL, MixChildNumber INT NULL;
END;
GO
IF OBJECT_ID('dbo.FK_OpportunityItem_MixParent','F') IS NULL
 ALTER TABLE dbo.OpportunityItem ADD CONSTRAINT FK_OpportunityItem_MixParent
  FOREIGN KEY(ParentItemID) REFERENCES dbo.OpportunityItem(ID);
IF OBJECT_ID('dbo.CK_OpportunityItem_MixChild','C') IS NULL
 ALTER TABLE dbo.OpportunityItem ADD CONSTRAINT CK_OpportunityItem_MixChild
  CHECK((ParentItemID IS NULL AND MixUnitQuantity IS NULL AND MixChildNumber IS NULL)
   OR (ParentItemID IS NOT NULL AND ParentItemID<>ID AND MixUnitQuantity IS NOT NULL
    AND MixChildNumber IS NOT NULL AND MixUnitQuantity>0 AND MixChildNumber>0));
IF EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.OpportunityItem') AND name='UX_OpportunityItem_MixChild' AND has_filter=1)
 DROP INDEX UX_OpportunityItem_MixChild ON dbo.OpportunityItem;
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.OpportunityItem') AND name='UX_OpportunityItem_MixChild')
 CREATE UNIQUE INDEX UX_OpportunityItem_MixChild
  ON dbo.OpportunityItem(ParentItemID,ProductID,OpportunityID);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.OpportunityItem') AND name='IX_OpportunityItem_MixTree')
 CREATE INDEX IX_OpportunityItem_MixTree ON dbo.OpportunityItem(OpportunityID,ParentItemID,ID);
GO
CREATE OR ALTER PROCEDURE dbo.usp_OpportunityMixLookup_Read @Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
  WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope IN('Admin','Opportunity'))
  THROW 51042,'Opportunity access is required for this action.',1;
 SELECT v.ProductID AS ParentProductID,v.ID AS MixVersionID,m.ProductID,
  m.UnitQuantity,p.ProductCode,p.ProductName,p.WeightGrams,p.Category
 FROM dbo.ProductMixVersion v JOIN dbo.ProductMixItem m ON m.VersionID=v.ID
 JOIN dbo.Product parent ON parent.ID=v.ProductID AND parent.Status='Active'
 JOIN dbo.Customer customer ON customer.ID=parent.CustomerID AND customer.Status='Active'
 JOIN dbo.Product p ON p.ID=m.ProductID
 WHERE v.Status='Active' ORDER BY v.ProductID,p.ProductCode,p.ID;
END;
GO
ALTER TABLE dbo.OpportunityItem ALTER COLUMN AnnualUnit DECIMAL(18,4) NOT NULL;
ALTER TABLE dbo.PackagingConfigurationRequestItem ALTER COLUMN AnnualUnit DECIMAL(18,4) NOT NULL;
GO
IF OBJECT_ID('dbo.UQ_OpportunityItem_OppProduct','UQ') IS NOT NULL
 ALTER TABLE dbo.OpportunityItem DROP CONSTRAINT UQ_OpportunityItem_OppProduct;
-- A normal unique index treats NULL as the root discriminator and remains
-- compatible with legacy stored procedures compiled with QUOTED_IDENTIFIER OFF.
IF EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.OpportunityItem') AND name='UX_OpportunityItem_RootProduct' AND has_filter=1)
 DROP INDEX UX_OpportunityItem_RootProduct ON dbo.OpportunityItem;
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.OpportunityItem') AND name='UX_OpportunityItem_RootProduct')
 CREATE UNIQUE INDEX UX_OpportunityItem_RootProduct ON dbo.OpportunityItem(OpportunityID,ProductID,ParentItemID);
GO
IF OBJECT_ID('dbo.OpportunityMixSnapshot','U') IS NULL
 CREATE TABLE dbo.OpportunityMixSnapshot(
  ParentItemID INT NOT NULL PRIMARY KEY REFERENCES dbo.OpportunityItem(ID),
  MixVersionID INT NOT NULL REFERENCES dbo.ProductMixVersion(ID),
  CapturedAt DATETIME2(7) NOT NULL DEFAULT SYSUTCDATETIME(),
  Origin VARCHAR(10) NOT NULL DEFAULT 'Save' CHECK(Origin IN('Save','Migration')));
GO
CREATE OR ALTER TRIGGER dbo.tr_OpportunityMixSnapshot_Immutable
ON dbo.OpportunityMixSnapshot AFTER UPDATE AS
BEGIN
 THROW 52960,'Saved Opportunity mix snapshots are immutable.',1;
END;
GO
CREATE OR ALTER TRIGGER dbo.tr_OpportunityItem_MixChildren
ON dbo.OpportunityItem AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 -- Membership and the multiplier are snapshots, not editable item fields.
 IF EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON d.ID=i.ID
  WHERE ISNULL(i.ParentItemID,0)<>ISNULL(d.ParentItemID,0)
   OR ISNULL(i.MixUnitQuantity,0)<>ISNULL(d.MixUnitQuantity,0)
   OR ISNULL(i.MixChildNumber,0)<>ISNULL(d.MixChildNumber,0)
   OR (d.ParentItemID IS NOT NULL AND
    (i.ProductID<>d.ProductID OR i.OpportunityID<>d.OpportunityID OR i.ItemDescription<>d.ItemDescription)))
  THROW 52960,'Mix child Product, description, parent and quantity multiplier are read-only.',1;
 IF EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON d.ID=i.ID
  JOIN dbo.OpportunityMixSnapshot s ON s.ParentItemID=i.ID
  WHERE i.ProductID<>d.ProductID OR i.OpportunityID<>d.OpportunityID)
  THROW 52960,'A saved mix composition cannot change Product. Create a new Opportunity item.',1;
 IF EXISTS(SELECT 1 FROM inserted i JOIN dbo.OpportunityItem p ON p.ID=i.ParentItemID
  LEFT JOIN dbo.OpportunityMixSnapshot s ON s.ParentItemID=p.ID
  LEFT JOIN dbo.ProductMixItem m ON m.VersionID=s.MixVersionID AND m.ProductID=i.ProductID
  WHERE p.ParentItemID IS NOT NULL OR p.OpportunityID<>i.OpportunityID OR m.ProductID IS NULL
   OR m.UnitQuantity<>i.MixUnitQuantity OR i.AnnualUnit<>p.AnnualUnit*i.MixUnitQuantity
   OR i.EstPctAwarded IS NOT NULL OR i.ShelfPrice IS NOT NULL)
  THROW 52960,'Mix child units are calculated from the parent; award and shelf price belong to the parent.',1;
 IF EXISTS(SELECT 1 FROM inserted i WHERE i.ParentItemID IS NULL
  AND (i.AnnualUnit<0 OR i.AnnualUnit<>FLOOR(i.AnnualUnit) OR i.AnnualUnit>2147483647))
  THROW 52960,'Parent annual units must be a whole number from 0 to 2,147,483,647.',1;
 IF EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON d.ID=i.ID
  JOIN dbo.OpportunityItem c WITH(UPDLOCK,HOLDLOCK) ON c.ParentItemID=i.ID
  WHERE i.AnnualUnit<>d.AnnualUnit AND (c.Stage<>'Draft' OR EXISTS(
   SELECT 1 FROM dbo.PackagingConfigurationRequestItem r WITH(UPDLOCK,HOLDLOCK)
   WHERE r.OpportunityItemID=c.ID AND r.IsOpen=1)))
  THROW 52960,'A mix child is processing. Its parent annual units cannot change.',1;
 -- Only a saved Active version is copied. Subsequent master activation has no effect.
 INSERT dbo.OpportunityMixSnapshot(ParentItemID,MixVersionID,Origin)
 SELECT i.ID,v.ID,CASE WHEN SESSION_CONTEXT(N'OpportunityMixMigration')=1 THEN 'Migration' ELSE 'Save' END
 FROM inserted i JOIN dbo.Product p WITH(UPDLOCK,HOLDLOCK) ON p.ID=i.ProductID AND p.IsMix=1
 JOIN dbo.ProductMixVersion v WITH(UPDLOCK,HOLDLOCK) ON v.ProductID=p.ID AND v.Status='Active'
 WHERE i.ParentItemID IS NULL AND i.Stage='Draft'
 AND NOT EXISTS(SELECT 1 FROM dbo.OpportunityMixSnapshot s WHERE s.ParentItemID=i.ID)
 AND NOT EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem r WHERE r.OpportunityItemID=i.ID);
 IF (SELECT COUNT(*) FROM dbo.OpportunityMixSnapshot s JOIN inserted i ON i.ID=s.ParentItemID
  JOIN dbo.ProductMixItem m ON m.VersionID=s.MixVersionID
  WHERE NOT EXISTS(SELECT 1 FROM dbo.OpportunityItem c WHERE c.ParentItemID=i.ID))>10000
  THROW 52960,'A save may generate at most 10000 mix child items.',1;
 IF EXISTS(SELECT 1 FROM inserted i JOIN dbo.OpportunityMixSnapshot s ON s.ParentItemID=i.ID
  JOIN dbo.ProductMixItem m ON m.VersionID=s.MixVersionID
  WHERE TRY_CONVERT(DECIMAL(18,4),i.AnnualUnit*m.UnitQuantity) IS NULL)
  THROW 52960,'Calculated mix child Annual units exceed the supported range.',1;
 INSERT dbo.OpportunityItem(OpportunityID,ProductID,ItemDescription,AnnualUnit,Stage,CreatedBy,
  ParentItemID,MixUnitQuantity,MixChildNumber)
 SELECT i.OpportunityID,m.ProductID,p.ProductName,CONVERT(DECIMAL(18,4),i.AnnualUnit*m.UnitQuantity),
  'Draft',i.CreatedBy,i.ID,m.UnitQuantity,
  ROW_NUMBER() OVER(PARTITION BY i.ID ORDER BY p.ProductCode,p.ID)
 FROM inserted i JOIN dbo.OpportunityMixSnapshot s ON s.ParentItemID=i.ID
 JOIN dbo.ProductMixItem m ON m.VersionID=s.MixVersionID JOIN dbo.Product p ON p.ID=m.ProductID
 WHERE NOT EXISTS(SELECT 1 FROM dbo.OpportunityItem c WHERE c.ParentItemID=i.ID);
 UPDATE c SET AnnualUnit=CONVERT(DECIMAL(18,4),i.AnnualUnit*c.MixUnitQuantity),
  UpdatedAt=SYSUTCDATETIME(),UpdatedBy=i.UpdatedBy
 FROM dbo.OpportunityItem c JOIN inserted i ON i.ID=c.ParentItemID JOIN deleted d ON d.ID=i.ID
 WHERE i.AnnualUnit<>d.AnnualUnit;
END;
GO
-- SQL Server cannot cascade a self-referencing FK. Delete the tree atomically.
CREATE OR ALTER TRIGGER dbo.tr_OpportunityItem_MixDelete
ON dbo.OpportunityItem INSTEAD OF DELETE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM deleted c WHERE c.ParentItemID IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM deleted p WHERE p.ID=c.ParentItemID))
  THROW 52960,'Mix children cannot be removed individually. Remove their parent item.',1;
 DELETE c FROM dbo.OpportunityItem c JOIN deleted p ON c.ParentItemID=p.ID;
 DELETE s FROM dbo.OpportunityMixSnapshot s JOIN deleted p ON p.ID=s.ParentItemID;
 DELETE i FROM dbo.OpportunityItem i JOIN deleted d ON i.ID=d.ID;
END;
GO
-- Backfill only editable mixes which have never had a Packaging Request.
-- This is explicitly today's composition, not an invented historical snapshot.
EXEC sys.sp_set_session_context N'OpportunityMixMigration',1;
BEGIN TRY
 UPDATE i SET ProductID=i.ProductID FROM dbo.OpportunityItem i
 JOIN dbo.Opportunity o ON o.ID=i.OpportunityID AND o.Stage='Draft'
 JOIN dbo.Product p ON p.ID=i.ProductID AND p.IsMix=1
 WHERE i.ParentItemID IS NULL AND i.Stage='Draft'
 AND NOT EXISTS(SELECT 1 FROM dbo.OpportunityMixSnapshot s WHERE s.ParentItemID=i.ID)
 AND NOT EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem r WHERE r.OpportunityItemID=i.ID);
 EXEC sys.sp_set_session_context N'OpportunityMixMigration',NULL;
END TRY
BEGIN CATCH
 EXEC sys.sp_set_session_context N'OpportunityMixMigration',NULL;
 THROW;
END CATCH;
GO
-- Typed scalar adapter avoids ODBC metadata discovery on a DECLARE-TVP batch.
-- The established Create procedure still owns authorization, locks and snapshots.
CREATE OR ALTER PROCEDURE dbo.usp_PackagingRequest_CreateJson
 @ItemsJson NVARCHAR(MAX),@Username NVARCHAR(100),@OpportunityID INT,
 @ExpectedRowVersion VARBINARY(8),@CreationKey UNIQUEIDENTIFIER,
 @ResponseDue DATE,@RequestNotes NVARCHAR(1000)=NULL
AS
BEGIN
 SET NOCOUNT ON;
 IF ISJSON(@ItemsJson)<>1 THROW 51121,'Invalid Packaging item selection.',1;
 DECLARE @Items dbo.PackagingRequestSelectionType;
 INSERT @Items(OpportunityItemID,ExpectedRowVersion,PackagingRequirement)
 SELECT OpportunityItemID,CONVERT(VARBINARY(8),ExpectedRowVersion,1),PackagingRequirement
 FROM OPENJSON(@ItemsJson) WITH(OpportunityItemID INT,ExpectedRowVersion VARCHAR(18),
  PackagingRequirement NVARCHAR(1000));
 EXEC dbo.usp_PackagingRequest_Create @Username,@OpportunityID,@ExpectedRowVersion,
  @CreationKey,@ResponseDue,@Items,@RequestNotes;
END;
GO
GO
-- END MIGRATION 47_opportunity_mix_children.sql

-- BEGIN MIGRATION 48_product_shelf_life_packaging_scope.sql
-- SOURCE SHA256 d8fd9b0359d0e58ae707d3775ad2747cacc461e2ae5a29e2a45b0df7609e2300
PRINT N'Applying 48_product_shelf_life_packaging_scope.sql';
GO
GO
-- After 47. Shelf life belongs to Product; logistics belong to root items.
-- Retain legacy columns and request snapshots. Do not rewrite historical data.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
GO
IF COL_LENGTH('dbo.Product','ShelfLifeDays') IS NULL
 ALTER TABLE dbo.Product ADD ShelfLifeDays INT NULL;
GO
IF OBJECT_ID('dbo.CK_Product_ShelfLifeDays','C') IS NULL
 ALTER TABLE dbo.Product WITH CHECK ADD CONSTRAINT CK_Product_ShelfLifeDays
 CHECK(ShelfLifeDays IS NULL OR ShelfLifeDays>=0);
GO
-- Extend the established partial-update procedure without replacing its guards.
DECLARE @Definition NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_Product_Fields_Save'));
IF @Definition IS NULL THROW 52957,'Run Product migrations through 47 first.',1;
IF CHARINDEX(N'''ShelfLifeDays''',@Definition)=0
BEGIN
 IF CHARINDEX(N'''Category'',''ProductName'',''WeightGrams'',''Status'',''CustomerID''',@Definition)=0
  THROW 52957,'Unexpected Product field procedure. Review before deploying.',1;
 SET @Definition=REPLACE(@Definition,N'''Category'',''ProductName'',''WeightGrams'',''Status'',''CustomerID''',
  N'''Category'',''ProductName'',''WeightGrams'',''Status'',''CustomerID'',''ShelfLifeDays''');
 SET @Definition=REPLACE(@Definition,N'[type] IN(4,5))',
  N'([key]=''ShelfLifeDays'' AND [type]<>0 AND
   ([type] NOT IN(1,2) OR TRY_CONVERT(INT,[value]) IS NULL OR TRY_CONVERT(INT,[value])<0 OR [value] LIKE ''%[^0-9]%'')) OR
   [type] IN(4,5))');
 SET @Definition=REPLACE(@Definition,N'UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()',
  N'ShelfLifeDays=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''ShelfLifeDays'') THEN j.ShelfLifeDays ELSE t.ShelfLifeDays END,
  UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()');
 SET @Definition=REPLACE(@Definition,N'Category NVARCHAR(100)) j',N'Category NVARCHAR(100),ShelfLifeDays INT) j');
 SET @Definition=REPLACE(@Definition,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE');
 SET @Definition=REPLACE(@Definition,N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 SET @Definition=REPLACE(@Definition,N'CREATE   PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @Definition;
END;
GO
-- Retired requirements cannot be written, even by old clients or direct calls.
DECLARE @Definition NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityItem_Fields_Save'));
IF @Definition IS NULL THROW 52957,'Run Opportunity field migrations first.',1;
IF CHARINDEX(N'Parent-only logistics',@Definition)=0
BEGIN
 SET @Definition=REPLACE(@Definition,N',''BarrierRequirement'',''ShelfLifeDays''',N'');
 SET @Definition=REPLACE(@Definition,
  N'BarrierRequirement=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''BarrierRequirement'') THEN NULLIF(LTRIM(RTRIM(j.BarrierRequirement)),N'''') ELSE t.BarrierRequirement END,',N'');
 SET @Definition=REPLACE(@Definition,
  N'ShelfLifeDays=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''ShelfLifeDays'') THEN j.ShelfLifeDays ELSE t.ShelfLifeDays END,',N'');
 SET @Definition=REPLACE(@Definition,N',BarrierRequirement NVARCHAR(500),ShelfLifeDays INT',N'');
 SET @Definition=REPLACE(@Definition,N'DECLARE @OldUser SQL_VARIANT=',
  N'-- Parent-only logistics: reject supplied keys, including NULL.
  IF EXISTS(SELECT 1 FROM dbo.OpportunityItem WHERE ID=@ID AND ParentItemID IS NOT NULL)
   AND EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] IN(''PalletSize'',''PalletStacking'',''MaxPalletHeightM'',''ContainerRequest''))
   THROW 52960,''Pallet and Container requirements belong to the parent item only.'',1;
  DECLARE @OldUser SQL_VARIANT=');
 SET @Definition=REPLACE(@Definition,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE');
 SET @Definition=REPLACE(@Definition,N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 SET @Definition=REPLACE(@Definition,N'CREATE   PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @Definition;
END;
GO
-- Current Opportunity readers use Product shelf life, not the retired item value.
-- Keep a NULL Barrier alias for backwards-compatible internal reader SQL.
DECLARE @Definition NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.v_OpportunityItemPackaging'));
IF @Definition IS NULL THROW 52957,'Opportunity Packaging view is missing.',1;
IF CHARINDEX(N'p.ShelfLifeDays',@Definition)=0
BEGIN
 SET @Definition=REPLACE(@Definition,N'oi.PalletSize',N'CASE WHEN oi.ParentItemID IS NULL THEN oi.PalletSize END AS PalletSize');
 SET @Definition=REPLACE(@Definition,N'oi.PalletStacking',N'CASE WHEN oi.ParentItemID IS NULL THEN oi.PalletStacking END AS PalletStacking');
 SET @Definition=REPLACE(@Definition,N'oi.MaxPalletHeightM',N'CASE WHEN oi.ParentItemID IS NULL THEN oi.MaxPalletHeightM END AS MaxPalletHeightM');
 SET @Definition=REPLACE(@Definition,N'oi.ContainerRequest',N'CASE WHEN oi.ParentItemID IS NULL THEN oi.ContainerRequest END AS ContainerRequest');
 SET @Definition=REPLACE(@Definition,N'oi.BarrierRequirement',N'CONVERT(NVARCHAR(500),NULL) AS BarrierRequirement');
 SET @Definition=REPLACE(@Definition,N'oi.ShelfLifeDays',N'p.ShelfLifeDays');
 SET @Definition=REPLACE(@Definition,N'CREATE OR ALTER VIEW',N'ALTER VIEW');
 SET @Definition=REPLACE(@Definition,N'CREATE VIEW',N'ALTER VIEW');
 SET @Definition=REPLACE(@Definition,N'CREATE   VIEW',N'ALTER VIEW');
 EXEC sys.sp_executesql @Definition;
END;
GO
-- Existing request snapshots stay immutable. Only new requests use these rules.
DECLARE @Definition NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingRequest_Create_AuditImplementation'));
IF @Definition IS NULL THROW 52957,'Packaging Request snapshot procedure is missing.',1;
IF CHARINDEX(N'p.ShelfLifeDays,i.SpecialComments',@Definition)=0
BEGIN
 IF CHARINDEX(N'i.BarrierRequirement,i.ShelfLifeDays,i.SpecialComments',@Definition)=0
  THROW 52957,'Unexpected Packaging Request snapshot procedure.',1;
 SET @Definition=REPLACE(@Definition,
  N'i.PalletSize,i.PalletStacking,i.MaxPalletHeightM,i.ContainerRequest,i.ConfigurationRequest',
  N'CASE WHEN i.ParentItemID IS NULL THEN i.PalletSize END,
   CASE WHEN i.ParentItemID IS NULL THEN i.PalletStacking END,
   CASE WHEN i.ParentItemID IS NULL THEN i.MaxPalletHeightM END,
   CASE WHEN i.ParentItemID IS NULL THEN i.ContainerRequest END,i.ConfigurationRequest');
 SET @Definition=REPLACE(@Definition,N'i.BarrierRequirement,i.ShelfLifeDays,i.SpecialComments',
  N'NULL,p.ShelfLifeDays,i.SpecialComments');
 SET @Definition=REPLACE(@Definition,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE');
 SET @Definition=REPLACE(@Definition,N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 SET @Definition=REPLACE(@Definition,N'CREATE   PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @Definition;
END;
GO
-- Product readers and both root/child dropdown lookup payloads include shelf life.
DECLARE @Name SYSNAME,@Definition NVARCHAR(MAX);
DECLARE readers CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM sys.procedures
 WHERE name IN('usp_Product_Read','usp_OpportunityProductLookup_Read','usp_OpportunityMixLookup_Read');
OPEN readers; FETCH NEXT FROM readers INTO @Name;
WHILE @@FETCH_STATUS=0
BEGIN
 SET @Definition=OBJECT_DEFINITION(OBJECT_ID(N'dbo.'+@Name));
 IF CHARINDEX(N'p.ShelfLifeDays',@Definition)=0
 BEGIN
  IF CHARINDEX(N'p.ProductName',@Definition)=0 THROW 52957,'Unexpected Product reader.',1;
  SET @Definition=REPLACE(@Definition,N'p.ProductName,',N'p.ProductName,p.ShelfLifeDays,');
  SET @Definition=REPLACE(@Definition,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE');
  SET @Definition=REPLACE(@Definition,N'CREATE PROCEDURE',N'ALTER PROCEDURE');
  SET @Definition=REPLACE(@Definition,N'CREATE   PROCEDURE',N'ALTER PROCEDURE');
  EXEC sys.sp_executesql @Definition;
 END;
 FETCH NEXT FROM readers INTO @Name;
END;
CLOSE readers; DEALLOCATE readers;
GO
COMMIT;
GO
GO
-- END MIGRATION 48_product_shelf_life_packaging_scope.sql

-- BEGIN MIGRATION 49_pallet_master.sql
-- SOURCE SHA256 9e38fae76a2a23d0b509578aedf691e947e0fb40c93d92c48f15a1b230c3174e
PRINT N'Applying 49_pallet_master.sql';
GO
GO
-- After 48. No UoMs or conversion factors are seeded.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
IF OBJECT_ID('dbo.Pallet','U') IS NULL
BEGIN
 CREATE TABLE dbo.Pallet(
  ID INT IDENTITY PRIMARY KEY,
  UoMID INT NOT NULL REFERENCES dbo.UoM(ID),
  Width DECIMAL(12,4) NOT NULL,
  Length DECIMAL(12,4) NOT NULL,
  Status VARCHAR(10) NOT NULL DEFAULT('Active'),
  CreatedAt DATETIME2(7) NOT NULL DEFAULT(SYSUTCDATETIME()),
  CreatedBy INT NOT NULL REFERENCES dbo.Users(ID),
  UpdatedAt DATETIME2(7) NULL,
  UpdatedBy INT NULL REFERENCES dbo.Users(ID),
  RowVersion ROWVERSION NOT NULL,
  CONSTRAINT CK_Pallet_Dimensions CHECK(Width>0 AND Length>0),
  CONSTRAINT CK_Pallet_Status CHECK(Status IN('Active','Block')),
  CONSTRAINT UQ_Pallet_Dimensions UNIQUE(UoMID,Width,Length)
 );
END;
GO
CREATE OR ALTER FUNCTION dbo.fn_PalletDimensionText(@Value DECIMAL(12,4))
RETURNS VARCHAR(32)
AS
BEGIN
 DECLARE @Text VARCHAR(32)=CONVERT(VARCHAR(32),@Value);
 WHILE RIGHT(@Text,1)='0' SET @Text=LEFT(@Text,LEN(@Text)-1);
 IF RIGHT(@Text,1)='.' SET @Text=LEFT(@Text,LEN(@Text)-1);
 RETURN @Text;
END;
GO
-- Shared calculation for validation and reads. A factor is mm per selected unit.
-- Round each converted dimension to eight places before multiplying.
CREATE OR ALTER FUNCTION dbo.fn_PalletArea(
 @Width DECIMAL(12,4),@Length DECIMAL(12,4),@Factor DECIMAL(24,9))
RETURNS TABLE
AS RETURN
 SELECT d.WidthMM,d.LengthMM,
  CASE WHEN d.WidthMM>0 AND d.LengthMM>0
   THEN CONVERT(DECIMAL(38,8),d.WidthMM*d.LengthMM) END AS PalletAreaMM2
 FROM (SELECT TRY_CONVERT(DECIMAL(18,8),@Width*@Factor) AS WidthMM,
              TRY_CONVERT(DECIMAL(18,8),@Length*@Factor) AS LengthMM) d;
GO
CREATE OR ALTER VIEW dbo.v_PalletMaster
AS
 SELECT p.*,u.UoMCode AS UnitOfMeasure,
  CONCAT(dbo.fn_PalletDimensionText(p.Width),'x',dbo.fn_PalletDimensionText(p.Length),u.UoMCode) AS PalletSize,
  f.FactorToMM,CASE WHEN a.PalletAreaMM2>0 THEN a.PalletAreaMM2 END AS PalletAreaMM2,
  CASE WHEN f.FactorToMM IS NULL THEN 'Conversion required'
       WHEN a.PalletAreaMM2 IS NULL OR a.PalletAreaMM2<=0 THEN 'Conversion out of range'
       ELSE 'Calculated' END AS ConversionStatus
 FROM dbo.Pallet p
 JOIN dbo.UoM u ON u.ID=p.UoMID
 OUTER APPLY dbo.fn_UnitConversion(u.UoMCode,N'MM',NULL,NULL,NULL) c
 CROSS APPLY (SELECT CASE WHEN u.Status<>'Active' THEN NULL
  WHEN u.UoMCode=N'MM' THEN CONVERT(DECIMAL(24,9),1) ELSE c.Factor END AS FactorToMM) f
 CROSS APPLY dbo.fn_PalletArea(p.Width,p.Length,f.FactorToMM) a;
GO
CREATE OR ALTER PROCEDURE dbo.usp_Pallet_Batch
 @Rows NVARCHAR(MAX),@Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT OFF;
 DECLARE @Actor INT;
 EXEC dbo.usp_Packaging_Authorize @Username,'Maintain',@Actor OUTPUT;
 IF ISJSON(@Rows)<>1 OR LEFT(LTRIM(@Rows),1)<>'['
  THROW 51105,'A JSON array of rows is required.',1;
 DECLARE @Input TABLE(RowNum INT,Command VARCHAR(10),ID INT,RowVersion VARBINARY(8),
  UnitOfMeasure NVARCHAR(4000),WidthText NVARCHAR(100),LengthText NVARCHAR(100),Status VARCHAR(20));
 INSERT @Input SELECT RowNum,Command,ID,TRY_CONVERT(VARBINARY(8),RowVersionHex,1),
  UnitOfMeasure,Width,Length,Status
 FROM OPENJSON(@Rows) WITH(RowNum INT,Command VARCHAR(10),ID INT,
  RowVersionHex VARCHAR(100),UnitOfMeasure NVARCHAR(4000),Width NVARCHAR(100),Length NVARCHAR(100),Status VARCHAR(20));
 IF (SELECT COUNT(*) FROM @Input) NOT BETWEEN 1 AND 500 THROW 51105,'Use 1 to 500 rows per batch.',1;
 IF EXISTS(SELECT RowNum FROM @Input GROUP BY RowNum HAVING COUNT(*)>1)
  OR EXISTS(SELECT ID FROM @Input WHERE ID IS NOT NULL GROUP BY ID HAVING COUNT(*)>1)
  THROW 51106,'Duplicate row numbers or record IDs.',1;
 DECLARE @Result TABLE(RowNum INT,Status VARCHAR(10),Message NVARCHAR(2048),NewID INT,NewRowVersion VARBINARY(8));
 DECLARE @Row INT,@Cmd VARCHAR(10),@ID INT,@RV VARBINARY(8),@Unit NVARCHAR(4000),
  @WText NVARCHAR(100),@LText NVARCHAR(100),@Status VARCHAR(20),@Own BIT,
  @UnitID INT,@W DECIMAL(12,4),@L DECIMAL(12,4),@Factor DECIMAL(24,9),@Area DECIMAL(38,8);
 DECLARE c CURSOR LOCAL FAST_FORWARD FOR
  SELECT RowNum,Command,ID,RowVersion,UnitOfMeasure,WidthText,LengthText,Status FROM @Input ORDER BY RowNum;
 OPEN c; FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@RV,@Unit,@WText,@LText,@Status;
 WHILE @@FETCH_STATUS=0
 BEGIN
  SET @Own=0;
  BEGIN TRY
   IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION; SET @Own=1; END
   ELSE SAVE TRANSACTION PalletRow;
   IF @Row IS NULL OR @Row<1 OR @Cmd IS NULL OR @Cmd NOT IN('C','U','D')
    THROW 51107,'Use a positive row number and C, U or D.',1;
   IF @Cmd='C' AND (@ID IS NOT NULL OR @RV IS NOT NULL)
    THROW 51107,'Create cannot have an ID or RowVersion.',1;
   IF @Cmd IN('U','D') AND NOT EXISTS(SELECT 1 FROM dbo.Pallet WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@RV)
    THROW 51108,'Concurrency conflict or row not found. Refresh first.',1;
   IF @Cmd<>'D'
   BEGIN
    SET @UnitID=NULL; SET @Factor=NULL; SET @Area=NULL;
    SET @W=TRY_CONVERT(DECIMAL(12,4),@WText); SET @L=TRY_CONVERT(DECIMAL(12,4),@LText);
    IF @W IS NULL OR @L IS NULL OR @W<=0 OR @L<=0
     OR TRY_CONVERT(DECIMAL(38,18),@WText)<>@W OR TRY_CONVERT(DECIMAL(38,18),@LText)<>@L
     THROW 51111,'Width and Length must be positive, with at most 8 whole digits and 4 decimals.',1;
    IF @Status IS NULL AND @Cmd='U' SELECT @Status=Status FROM dbo.Pallet WHERE ID=@ID;
    SET @Status=COALESCE(@Status,'Active');
    IF @Status NOT IN('Active','Block') THROW 51109,'Status must be Active or Block.',1;
    SELECT @UnitID=ID FROM dbo.UoM WITH(UPDLOCK,HOLDLOCK) WHERE UoMCode=LTRIM(RTRIM(@Unit))
     AND (Status='Active' OR (@Status='Block' AND @Cmd='U' AND EXISTS(SELECT 1 FROM dbo.Pallet WHERE ID=@ID AND UoMID=dbo.UoM.ID)));
    IF @UnitID IS NULL THROW 51111,'Choose an active UoM from UoM Master.',1;
    IF @Status='Active'
    BEGIN
     -- Lock the reference rows until this record is saved.
     SELECT @Factor=CASE WHEN u.UoMCode=N'MM' THEN CONVERT(DECIMAL(24,9),1) ELSE cv.Factor END
     FROM dbo.UoM u WITH(UPDLOCK,HOLDLOCK)
     LEFT JOIN dbo.UoM mm WITH(UPDLOCK,HOLDLOCK) ON mm.UoMCode=N'MM' AND mm.Status='Active'
     LEFT JOIN dbo.UnitConversion cv WITH(UPDLOCK,HOLDLOCK)
      ON cv.FromUoMID=u.ID AND cv.ToUoMID=mm.ID AND cv.Status='Active'
      AND cv.PackagingMaterialID IS NULL AND cv.RawMaterialID IS NULL AND cv.VendorID IS NULL
     WHERE u.ID=@UnitID AND u.Status='Active';
     IF @Factor IS NULL THROW 51111,'Admin must maintain an active general conversion from this UoM to MM.',1;
     SELECT @Area=PalletAreaMM2 FROM dbo.fn_PalletArea(@W,@L,@Factor);
     IF @Area IS NULL OR @Area<=0 THROW 51111,'Converted dimensions or area are out of range.',1;
    END;
    IF EXISTS(SELECT 1 FROM dbo.Pallet WITH(UPDLOCK,HOLDLOCK) WHERE UoMID=@UnitID AND Width=@W AND Length=@L AND (@Cmd='C' OR ID<>@ID))
     THROW 51111,'This pallet size already exists. Edit the existing record instead.',1;
   END;
   IF @Cmd='C'
    INSERT dbo.Pallet(UoMID,Width,Length,Status,CreatedBy)
    OUTPUT @Row,'OK','Created',inserted.ID,inserted.RowVersion INTO @Result
    VALUES(@UnitID,@W,@L,@Status,@Actor);
   ELSE IF @Cmd='D'
    UPDATE dbo.Pallet SET Status='Block',UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@Actor
    OUTPUT @Row,'OK','Blocked',inserted.ID,inserted.RowVersion INTO @Result WHERE ID=@ID AND RowVersion=@RV;
   ELSE
    UPDATE dbo.Pallet SET UoMID=@UnitID,Width=@W,Length=@L,Status=@Status,UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@Actor
    OUTPUT @Row,'OK','Updated',inserted.ID,inserted.RowVersion INTO @Result WHERE ID=@ID AND RowVersion=@RV;
   IF @Own=1 COMMIT;
  END TRY
  BEGIN CATCH
   IF @Own=1 AND XACT_STATE()<>0 ROLLBACK;
   ELSE IF XACT_STATE()=1 ROLLBACK TRANSACTION PalletRow;
   ELSE IF XACT_STATE()=-1 THROW;
   DELETE @Result WHERE RowNum=@Row;
   INSERT @Result VALUES(@Row,'ERROR',ERROR_MESSAGE(),@ID,NULL);
  END CATCH;
  FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@RV,@Unit,@WText,@LText,@Status;
 END;
 CLOSE c; DEALLOCATE c;
 SELECT * FROM @Result ORDER BY RowNum;
END;
GO
GO
-- END MIGRATION 49_pallet_master.sql

-- BEGIN MIGRATION 50_opportunity_pallet_lookup.sql
-- SOURCE SHA256 931edb5eb494ee65ffa009485bf677ed7a4d4d7c056491a21bafa763edc0300e
PRINT N'Applying 50_opportunity_pallet_lookup.sql';
GO
GO
-- After 49. Sales can choose pallets without access to Pallet Master maintenance.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.usp_OpportunityPalletLookup_Read
 @Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
  WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope IN(N'Admin',N'Opportunity'))
  THROW 51042,'Opportunity access is required for this action.',1;
 SELECT p.ID,p.PalletSize
 FROM dbo.v_PalletMaster p JOIN dbo.UoM u ON u.ID=p.UoMID
 WHERE p.Status='Active' AND u.Status='Active'
 ORDER BY p.PalletSize,p.ID;
END;
GO
GO
-- END MIGRATION 50_opportunity_pallet_lookup.sql

-- BEGIN MIGRATION 51_packaging_type_master.sql
-- SOURCE SHA256 719123561267f958e7b9473ddd2ca783f4d01c54b1b2b0245c547ee4370023f5
PRINT N'Applying 51_packaging_type_master.sql';
GO
GO
-- After 50. Packaging Type Master; no business records are seeded.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('dbo.PackagingType','U') IS NULL
BEGIN
 CREATE TABLE dbo.PackagingType(
  ID INT IDENTITY PRIMARY KEY,
  PackagingOrder NVARCHAR(9) NOT NULL,
  PackagingType NVARCHAR(100) NOT NULL,
  PriceBasis NVARCHAR(20) NOT NULL,
  TareWeight DECIMAL(17,3) NOT NULL,
  Status VARCHAR(10) NOT NULL DEFAULT('Active'),
  CreatedAt DATETIME2(7) NOT NULL DEFAULT(SYSUTCDATETIME()),
  CreatedBy INT NOT NULL REFERENCES dbo.Users(ID),
  UpdatedAt DATETIME2(7) NULL,
  UpdatedBy INT NULL REFERENCES dbo.Users(ID),
  RowVersion ROWVERSION NOT NULL,
  CONSTRAINT CK_PackagingType_Order CHECK(PackagingOrder COLLATE Latin1_General_100_BIN2 IN(N'Primary',N'Secondary')),
  CONSTRAINT CK_PackagingType_Name CHECK(LEN(LTRIM(RTRIM(PackagingType)))>0),
  CONSTRAINT CK_PackagingType_PriceBasis CHECK(PriceBasis COLLATE Latin1_General_100_BIN2 IN(N'Count',N'Square meter',N'Volume')),
  CONSTRAINT CK_PackagingType_Tare CHECK(TareWeight>=0),
  CONSTRAINT CK_PackagingType_Status CHECK(Status IN('Active','Block')),
  CONSTRAINT UQ_PackagingType_Order_Name UNIQUE(PackagingOrder,PackagingType)
 );
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingType_Batch
 @Rows NVARCHAR(MAX),@Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT OFF;
 DECLARE @Actor INT;
 EXEC dbo.usp_Packaging_Authorize @Username,'Maintain',@Actor OUTPUT;
 IF ISJSON(@Rows)<>1 OR LEFT(LTRIM(@Rows),1)<>'[' THROW 51105,'A JSON array of rows is required.',1;
 DECLARE @Input TABLE(RowNum INT,Command VARCHAR(10),ID INT,RowVersion VARBINARY(8),
  PackagingOrder NVARCHAR(4000),PackagingType NVARCHAR(4000),PriceBasis NVARCHAR(4000),TareText NVARCHAR(100),Status VARCHAR(20));
 INSERT @Input SELECT RowNum,Command,ID,TRY_CONVERT(VARBINARY(8),RowVersionHex,1),PackagingOrder,PackagingType,PriceBasis,TareWeight,Status
 FROM OPENJSON(@Rows) WITH(RowNum INT,Command VARCHAR(10),ID INT,RowVersionHex VARCHAR(100),
  PackagingOrder NVARCHAR(4000),PackagingType NVARCHAR(4000),PriceBasis NVARCHAR(4000),TareWeight NVARCHAR(100),Status VARCHAR(20));
 IF (SELECT COUNT(*) FROM @Input) NOT BETWEEN 1 AND 500 THROW 51105,'Use 1 to 500 rows per batch.',1;
 IF EXISTS(SELECT RowNum FROM @Input GROUP BY RowNum HAVING COUNT(*)>1)
  OR EXISTS(SELECT ID FROM @Input WHERE ID IS NOT NULL GROUP BY ID HAVING COUNT(*)>1)
  THROW 51106,'Duplicate row numbers or record IDs.',1;
 DECLARE @Result TABLE(RowNum INT,Status VARCHAR(10),Message NVARCHAR(2048),NewID INT,NewRowVersion VARBINARY(8));
 DECLARE @Row INT,@Cmd VARCHAR(10),@ID INT,@RV VARBINARY(8),@Order NVARCHAR(4000),@Name NVARCHAR(4000),
  @Basis NVARCHAR(4000),@TareText NVARCHAR(100),@Tare DECIMAL(17,3),@Status VARCHAR(20),@Own BIT;
 DECLARE c CURSOR LOCAL FAST_FORWARD FOR
  SELECT RowNum,Command,ID,RowVersion,PackagingOrder,PackagingType,PriceBasis,TareText,Status FROM @Input ORDER BY RowNum;
 OPEN c; FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@RV,@Order,@Name,@Basis,@TareText,@Status;
 WHILE @@FETCH_STATUS=0
 BEGIN
  SET @Own=0;
  BEGIN TRY
   IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION; SET @Own=1; END ELSE SAVE TRANSACTION PackagingTypeRow;
   IF @Row IS NULL OR @Row<1 OR @Cmd IS NULL OR @Cmd NOT IN('C','U','D') THROW 51107,'Use a positive row number and C, U or D.',1;
   IF @Cmd='C' AND (@ID IS NOT NULL OR @RV IS NOT NULL) THROW 51107,'Create cannot have an ID or RowVersion.',1;
   IF @Cmd IN('U','D') AND NOT EXISTS(SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@RV)
    THROW 51108,'Concurrency conflict or row not found. Refresh first.',1;
   IF @Cmd<>'D'
   BEGIN
    SET @Name=NULLIF(LTRIM(RTRIM(@Name)),N'');
    IF @Order IS NULL OR @Order COLLATE Latin1_General_100_BIN2 NOT IN(N'Primary',N'Secondary')
     THROW 51111,'Choose Primary or Secondary for Order.',1;
    IF @Basis IS NULL OR @Basis COLLATE Latin1_General_100_BIN2 NOT IN(N'Count',N'Square meter',N'Volume')
     THROW 51111,'Choose Count, Square meter or Volume for Price Basis.',1;
    IF @Name IS NULL OR LEN(@Name)>100 THROW 51111,'Packaging Type is required (maximum 100 characters).',1;
    SET @Tare=TRY_CONVERT(DECIMAL(17,3),@TareText);
    IF @Tare IS NULL OR @Tare<0 OR TRY_CONVERT(DECIMAL(38,18),@TareText)<>@Tare
     THROW 51111,'Tare weight must be nonnegative, with at most 14 whole digits and 3 decimals.',1;
    IF @Cmd='U' AND @Status IS NULL SELECT @Status=Status FROM dbo.PackagingType WHERE ID=@ID;
    SET @Status=COALESCE(@Status,'Active');
    IF @Status NOT IN('Active','Block') THROW 51109,'Status must be Active or Block.',1;
    IF EXISTS(SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK)
     WHERE PackagingOrder=@Order AND PackagingType=@Name AND (@Cmd='C' OR ID<>@ID))
     THROW 51111,'This Packaging Type already exists for this Order. Edit the existing record instead.',1;
   END;
   IF @Cmd='C'
    INSERT dbo.PackagingType(PackagingOrder,PackagingType,PriceBasis,TareWeight,Status,CreatedBy)
    OUTPUT @Row,'OK','Created',inserted.ID,inserted.RowVersion INTO @Result VALUES(@Order,@Name,@Basis,@Tare,@Status,@Actor);
   ELSE IF @Cmd='D'
    UPDATE dbo.PackagingType SET Status='Block',UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@Actor
    OUTPUT @Row,'OK','Blocked',inserted.ID,inserted.RowVersion INTO @Result WHERE ID=@ID AND RowVersion=@RV;
   ELSE
    UPDATE dbo.PackagingType SET PackagingOrder=@Order,PackagingType=@Name,PriceBasis=@Basis,TareWeight=@Tare,
     Status=@Status,UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@Actor
    OUTPUT @Row,'OK','Updated',inserted.ID,inserted.RowVersion INTO @Result WHERE ID=@ID AND RowVersion=@RV;
   IF @Own=1 COMMIT;
  END TRY
  BEGIN CATCH
   IF @Own=1 AND XACT_STATE()<>0 ROLLBACK;
   ELSE IF XACT_STATE()=1 ROLLBACK TRANSACTION PackagingTypeRow;
   ELSE IF XACT_STATE()=-1 THROW;
   DELETE @Result WHERE RowNum=@Row;
   INSERT @Result VALUES(@Row,'ERROR',ERROR_MESSAGE(),@ID,NULL);
  END CATCH;
  FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@RV,@Order,@Name,@Basis,@TareText,@Status;
 END;
 CLOSE c; DEALLOCATE c;
 SELECT * FROM @Result ORDER BY RowNum;
END;
GO
GO
-- END MIGRATION 51_packaging_type_master.sql

-- BEGIN MIGRATION 52_packaging_response_types.sql
-- SOURCE SHA256 a2f14ee144729330748a728e00c44d6ec8e748d225b654a8f6474b9bf5b18e4b
PRINT N'Applying 52_packaging_response_types.sql';
GO
GO
-- Run after 51. Preserve historical PalletType, Cost and CurrencyID columns.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingResponseTypeLookup_Read @Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @Actor INT;
 EXEC dbo.usp_Packaging_Authorize @Username,'MasterRead',@Actor OUTPUT;
 SELECT ID,PackagingOrder,PackagingType FROM dbo.PackagingType
 WHERE Status='Active' ORDER BY PackagingOrder,PackagingType,ID;
END;
GO

CREATE OR ALTER PROCEDURE dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation
 @Username NVARCHAR(100),@ID INT,@ExpectedRowVersion VARBINARY(8),@Fields NVARCHAR(MAX),@IsCreate BIT=0
AS
BEGIN
 SET NOCOUNT ON;
 IF @@TRANCOUNT=0 THROW 52956,'Additional fields must be saved inside the document transaction.',1;
 DECLARE @Actor INT,@Admin BIT=0;
 SELECT @Actor=u.ID FROM dbo.Users u WHERE u.UserName=@Username AND u.IsActive=1;
 IF @Actor IS NULL THROW 52953,'Username is incorrect.',1;
 IF EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope='Admin') SET @Admin=1;
 IF @Admin=0 AND NOT EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope='Packaging')
 THROW 52954,'Packaging access is required for this action.',1;
 IF ISJSON(@Fields)<>1 THROW 52957,'Invalid additional fields.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] NOT IN('FirstPMType','SecondPMType','UnitsPerCarton','PackagingDescription','FirstPMMOQ','SecondPMMOQ','CartonsPerLayer','LayersPerPallet','PacksPerPallet','CartonsPerContainer'))
 THROW 52957,'Unknown additional field.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@ExpectedRowVersion)
 THROW 52958,'Concurrency conflict. Refresh before saving.',1;
 
 
 
 IF NOT EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ID AND Stage IN('Assigned','Working','Returned') AND (@Admin=1 OR PICUserID=@Actor))
 THROW 52960,'Only the assigned PIC or Admin can edit an unlocked response.',1;

 -- New selections must be active types in the matching order. Unchanged legacy
 -- selections remain valid so unrelated edits do not rewrite historical data.
 IF EXISTS(
  SELECT 1 FROM OPENJSON(@Fields) j
  JOIN dbo.PackagingConfigurationRequestItem i ON i.ID=@ID
  CROSS APPLY(SELECT NULLIF(LTRIM(RTRIM(j.value)),N'') NewType,
   CASE j.[key] WHEN 'FirstPMType' THEN i.FirstPMType ELSE i.SecondPMType END OldType,
   CASE j.[key] WHEN 'FirstPMType' THEN N'Primary' ELSE N'Secondary' END PackagingOrder) v
  WHERE j.[key] IN('FirstPMType','SecondPMType') AND v.NewType IS NOT NULL
  AND (v.OldType IS NULL OR v.NewType COLLATE Latin1_General_100_BIN2<>v.OldType COLLATE Latin1_General_100_BIN2)
  AND NOT EXISTS(SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK)
   WHERE PackagingOrder=v.PackagingOrder AND PackagingType COLLATE Latin1_General_100_BIN2=v.NewType COLLATE Latin1_General_100_BIN2 AND Status='Active'))
  THROW 52961,'Choose an active Primary Type or Secondary Type in the matching Packaging Type Master order.',1;

 DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeUser'),@OldSource SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeSource');
 BEGIN TRY
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@Username;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',N'User';
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields))
 UPDATE t SET
 FirstPMType=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='FirstPMType') THEN NULLIF(LTRIM(RTRIM(j.FirstPMType)),N'') ELSE t.FirstPMType END,
 SecondPMType=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='SecondPMType') THEN NULLIF(LTRIM(RTRIM(j.SecondPMType)),N'') ELSE t.SecondPMType END,
 UnitsPerCarton=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='UnitsPerCarton') THEN j.UnitsPerCarton ELSE t.UnitsPerCarton END,
 PackagingDescription=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='PackagingDescription') THEN NULLIF(LTRIM(RTRIM(j.PackagingDescription)),N'') ELSE t.PackagingDescription END,
 FirstPMMOQ=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='FirstPMMOQ') THEN j.FirstPMMOQ ELSE t.FirstPMMOQ END,
 SecondPMMOQ=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='SecondPMMOQ') THEN j.SecondPMMOQ ELSE t.SecondPMMOQ END,
 CartonsPerLayer=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='CartonsPerLayer') THEN j.CartonsPerLayer ELSE t.CartonsPerLayer END,
 LayersPerPallet=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='LayersPerPallet') THEN j.LayersPerPallet ELSE t.LayersPerPallet END,
 PacksPerPallet=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='PacksPerPallet') THEN j.PacksPerPallet ELSE t.PacksPerPallet END,
 CartonsPerContainer=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='CartonsPerContainer') THEN j.CartonsPerContainer ELSE t.CartonsPerContainer END,
 UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()
 FROM dbo.PackagingConfigurationRequestItem t CROSS APPLY OPENJSON(@Fields) WITH(FirstPMType NVARCHAR(100),SecondPMType NVARCHAR(100),UnitsPerCarton INT,PackagingDescription NVARCHAR(500),FirstPMMOQ DECIMAL(18,4),SecondPMMOQ DECIMAL(18,4),CartonsPerLayer INT,LayersPerPallet INT,PacksPerPallet INT,CartonsPerContainer INT) j
 WHERE t.ID=@ID AND t.RowVersion=@ExpectedRowVersion;
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',@OldSource;
 END TRY
 BEGIN CATCH
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',@OldSource;
 THROW;
 END CATCH;
SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ID;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingConfigurationRequestItem_Fields_Save
 @Username NVARCHAR(100),@ID INT,@ExpectedRowVersion VARBINARY(8),@Fields NVARCHAR(MAX),@IsCreate BIT=0
AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT(N'PackagingChangeUser'),
 @OldSource SQL_VARIANT=SESSION_CONTEXT(N'PackagingChangeSource'),
 @OldEvent SQL_VARIANT=SESSION_CONTEXT(N'PackagingChangeEvent'),
 @OldReason SQL_VARIANT=SESSION_CONTEXT(N'PackagingChangeReason'),
 @Event UNIQUEIDENTIFIER=COALESCE(TRY_CONVERT(UNIQUEIDENTIFIER,SESSION_CONTEXT(N'PackagingChangeEvent')),NEWID());
 BEGIN TRY
 EXEC sys.sp_set_session_context N'PackagingChangeUser',@Username;
 EXEC sys.sp_set_session_context N'PackagingChangeSource',N'User';
 EXEC sys.sp_set_session_context N'PackagingChangeEvent',@Event;
 EXEC sys.sp_set_session_context N'PackagingChangeReason',NULL;
 EXEC dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation @Username,@ID,@ExpectedRowVersion,@Fields,@IsCreate;
 EXEC sys.sp_set_session_context N'PackagingChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'PackagingChangeSource',@OldSource;
 EXEC sys.sp_set_session_context N'PackagingChangeEvent',@OldEvent;
 EXEC sys.sp_set_session_context N'PackagingChangeReason',@OldReason;
 END TRY
 BEGIN CATCH
 EXEC sys.sp_set_session_context N'PackagingChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'PackagingChangeSource',@OldSource;
 EXEC sys.sp_set_session_context N'PackagingChangeEvent',@OldEvent;
 EXEC sys.sp_set_session_context N'PackagingChangeReason',@OldReason;
 THROW;
 END CATCH
END
GO
GO
-- END MIGRATION 52_packaging_response_types.sql

-- BEGIN MIGRATION 53_packaging_material_type.sql
-- SOURCE SHA256 f3cb40677bcb10b2e8620685b46c486cf8bd3e2d3d677df58ac6f95796760e1d
PRINT N'Applying 53_packaging_material_type.sql';
GO
GO
-- After 52. Optional FK assignment; existing materials remain unassigned.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
IF COL_LENGTH('dbo.PackagingMaterial','PackagingTypeID') IS NULL
 ALTER TABLE dbo.PackagingMaterial ADD PackagingTypeID INT NULL;
GO
IF NOT EXISTS(SELECT 1 FROM sys.foreign_keys WHERE name='FK_PackagingMaterial_PackagingType')
 ALTER TABLE dbo.PackagingMaterial WITH CHECK ADD CONSTRAINT FK_PackagingMaterial_PackagingType
 FOREIGN KEY(PackagingTypeID) REFERENCES dbo.PackagingType(ID);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.PackagingMaterial') AND name='IX_PackagingMaterial_PackagingType')
 CREATE INDEX IX_PackagingMaterial_PackagingType ON dbo.PackagingMaterial(PackagingTypeID);
GO
IF TYPE_ID('dbo.PackagingMaterialBatchTypeV2') IS NULL
 EXEC(N'CREATE TYPE dbo.PackagingMaterialBatchTypeV2 AS TABLE(
 RowNum INT NOT NULL PRIMARY KEY,Command CHAR(1),ID INT,MaterialCode NVARCHAR(40),MaterialName NVARCHAR(200),
 Description NVARCHAR(500),UnitOfMeasure NVARCHAR(20),Status VARCHAR(10),RowVersionB64 VARBINARY(8),
 PackagingTypeID INT,PackagingTypeSet BIT)');
GO

CREATE OR ALTER PROCEDURE dbo.usp_PackagingMaterial_BatchV2
    @Rows dbo.PackagingMaterialBatchTypeV2 READONLY, @Username NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT OFF;
    DECLARE @ActorID INT;
    EXEC dbo.usp_Packaging_Authorize @Username,'Maintain',@ActorID OUTPUT;
    IF (SELECT COUNT(*) FROM @Rows)>500 THROW 51105,'Maximum 500 rows per batch.',1;
    IF EXISTS(SELECT ID FROM @Rows WHERE ID IS NOT NULL GROUP BY ID HAVING COUNT(*)>1)
        THROW 51106,'Duplicate record IDs in batch.',1;
    DECLARE @Result TABLE(RowNum INT,Status VARCHAR(10),Message NVARCHAR(2048),NewID INT,NewRowVersion VARBINARY(8));
    DECLARE @RowNum INT,@Command CHAR(1),@ID INT,@RV VARBINARY(8),@OwnTran BIT,@Code NVARCHAR(40),@Name NVARCHAR(200),@Description NVARCHAR(500),@Unit NVARCHAR(20),@Status VARCHAR(10),@TypeID INT,@TypeSet BIT;
    DECLARE rows_cursor CURSOR LOCAL FAST_FORWARD FOR
        SELECT RowNum,UPPER(Command),ID,RowVersionB64,NULLIF(LTRIM(RTRIM(MaterialCode)),N''),NULLIF(LTRIM(RTRIM(MaterialName)),N''),Description,NULLIF(LTRIM(RTRIM(UnitOfMeasure)),N''),Status,PackagingTypeID,PackagingTypeSet FROM @Rows ORDER BY RowNum;
    OPEN rows_cursor;
    FETCH NEXT FROM rows_cursor INTO @RowNum,@Command,@ID,@RV,@Code,@Name,@Description,@Unit,@Status,@TypeID,@TypeSet;
    WHILE @@FETCH_STATUS=0
    BEGIN
        SET @OwnTran=0;
        BEGIN TRY
            IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION; SET @OwnTran=1; END
            ELSE SAVE TRANSACTION PackagingRow;
            IF @Command NOT IN('C','U','D') THROW 51107,'Use C, U or D.',1;
            IF @Command IN('U','D') AND NOT EXISTS(
                SELECT 1 FROM dbo.PackagingMaterial WITH(UPDLOCK,HOLDLOCK)
                WHERE ID=@ID AND RowVersion=@RV)
                THROW 51108,'Concurrency conflict or row not found. Refresh first.',1;
            IF @Command<>'D'
            BEGIN
                IF @Command='U' AND COALESCE(@TypeSet,0)=0
                    SELECT @TypeID=PackagingTypeID FROM dbo.PackagingMaterial WHERE ID=@ID;
                IF @TypeID IS NOT NULL AND NOT EXISTS(
                    SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK) WHERE ID=@TypeID
                    AND (Status='Active' OR (@Command='U' AND EXISTS(
                        SELECT 1 FROM dbo.PackagingMaterial WHERE ID=@ID AND PackagingTypeID=@TypeID))))
                    THROW 51111,'Choose an active Packaging Type from Packaging Type Master.',1;

                IF @Command='U' AND @Status IS NULL
                    SELECT @Status=Status FROM dbo.PackagingMaterial WHERE ID=@ID;
                IF @Status IS NOT NULL AND @Status NOT IN('Active','Block')
                    THROW 51109,'Status must be Active or Block.',1;
                IF @Name IS NULL OR @Unit IS NULL THROW 51110,'Material Name and Unit of Measure are required.',1;
                IF NOT EXISTS(SELECT 1 FROM dbo.UoM WITH(UPDLOCK,HOLDLOCK) WHERE UoMCode=@Unit AND
                 (Status='Active' OR (@Command='U' AND EXISTS(SELECT 1 FROM dbo.PackagingMaterial WHERE ID=@ID AND UnitOfMeasure=@Unit))))
                 THROW 51111,'Choose an active Unit of Measure from UoM Master.',1;
            END;
            IF @Command IN('U','D') AND @Code IS NOT NULL AND EXISTS(SELECT 1 FROM dbo.PackagingMaterial WHERE ID=@ID AND MaterialCode COLLATE Latin1_General_100_BIN2<>@Code COLLATE Latin1_General_100_BIN2)
                THROW 51110,'Material code is read-only.',1;
            IF @Command='C'
            BEGIN
                IF @Code IS NOT NULL THROW 51110,'Material code is generated automatically. Leave it blank.',1;
                DECLARE @Number BIGINT;
                SET @Number=NEXT VALUE FOR dbo.PackagingMaterialCodeSequence;
                SET @Code='PKG-'+RIGHT(REPLICATE('0',10)+CONVERT(VARCHAR(10),@Number),10);
                WHILE EXISTS(SELECT 1 FROM dbo.PackagingMaterial WHERE MaterialCode=@Code)
                BEGIN
                    SET @Number=NEXT VALUE FOR dbo.PackagingMaterialCodeSequence;
                    SET @Code='PKG-'+RIGHT(REPLICATE('0',10)+CONVERT(VARCHAR(10),@Number),10);
                END;
                INSERT dbo.PackagingMaterial(MaterialCode,MaterialName,Description,UnitOfMeasure,Status,CreatedBy,PackagingTypeID)
                OUTPUT @RowNum,'OK','Created',inserted.ID,inserted.RowVersion INTO @Result
                VALUES(@Code,@Name,@Description,@Unit,COALESCE(@Status,'Active'),@ActorID,@TypeID);
            END
            ELSE IF @Command='D'
                UPDATE dbo.PackagingMaterial SET Status='Block',UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@ActorID
                OUTPUT @RowNum,'OK','Blocked',inserted.ID,inserted.RowVersion INTO @Result
                WHERE ID=@ID AND RowVersion=@RV;
            ELSE
                UPDATE dbo.PackagingMaterial SET MaterialName=@Name,Description=@Description,UnitOfMeasure=@Unit,PackagingTypeID=@TypeID,Status=COALESCE(@Status,Status),UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@ActorID
                OUTPUT @RowNum,'OK','Updated',inserted.ID,inserted.RowVersion INTO @Result
                WHERE ID=@ID AND RowVersion=@RV;
            IF @OwnTran=1 COMMIT;
        END TRY
        BEGIN CATCH
            IF @OwnTran=1 AND XACT_STATE()<>0 ROLLBACK;
            ELSE IF XACT_STATE()=1 ROLLBACK TRANSACTION PackagingRow;
            ELSE IF XACT_STATE()=-1 THROW;
            DELETE @Result WHERE RowNum=@RowNum;
            INSERT @Result VALUES(@RowNum,'ERROR',ERROR_MESSAGE(),@ID,NULL);
        END CATCH;
        FETCH NEXT FROM rows_cursor INTO @RowNum,@Command,@ID,@RV,@Code,@Name,@Description,@Unit,@Status,@TypeID,@TypeSet;
    END;
    CLOSE rows_cursor; DEALLOCATE rows_cursor;
    SELECT r.*,m.MaterialCode AS NewMaterialCode FROM @Result r LEFT JOIN dbo.PackagingMaterial m ON m.ID=r.NewID ORDER BY r.RowNum;
END;
GO
GO
-- END MIGRATION 53_packaging_material_type.sql

-- BEGIN MIGRATION 54_packaging_type_parent.sql
-- SOURCE SHA256 78a8dae1ebbcd2deca98d5709adf70b93112392c670599b46ddc3739c2300837
PRINT N'Applying 54_packaging_type_parent.sql';
GO
GO
-- After 53. Optional self-reference; existing types remain roots.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.PackagingType','ParentTypeID') IS NULL
 ALTER TABLE dbo.PackagingType ADD ParentTypeID INT NULL;
GO
IF NOT EXISTS(SELECT 1 FROM sys.foreign_keys WHERE name='FK_PackagingType_Parent')
 ALTER TABLE dbo.PackagingType WITH CHECK ADD CONSTRAINT FK_PackagingType_Parent
 FOREIGN KEY(ParentTypeID) REFERENCES dbo.PackagingType(ID);
IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE name='CK_PackagingType_Parent')
 ALTER TABLE dbo.PackagingType WITH CHECK ADD CONSTRAINT CK_PackagingType_Parent CHECK(ParentTypeID<>ID);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.PackagingType') AND name='IX_PackagingType_Parent')
 CREATE INDEX IX_PackagingType_Parent ON dbo.PackagingType(ParentTypeID,ID);
COMMIT;
GO

CREATE OR ALTER PROCEDURE dbo.usp_PackagingType_Batch
 @Rows NVARCHAR(MAX),@Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT OFF;
 DECLARE @Actor INT;
 EXEC dbo.usp_Packaging_Authorize @Username,'Maintain',@Actor OUTPUT;
 IF ISJSON(@Rows)<>1 OR LEFT(LTRIM(@Rows),1)<>'[' THROW 51105,'A JSON array of rows is required.',1;
 DECLARE @Input TABLE(RowNum INT,Command VARCHAR(10),ID INT,RowVersion VARBINARY(8),
  PackagingOrder NVARCHAR(4000),PackagingType NVARCHAR(4000),PriceBasis NVARCHAR(4000),TareText NVARCHAR(100),Status VARCHAR(20),ParentTypeID INT,ParentTypeSet BIT);
 INSERT @Input SELECT RowNum,Command,ID,TRY_CONVERT(VARBINARY(8),RowVersionHex,1),PackagingOrder,PackagingType,PriceBasis,TareWeight,Status,ParentTypeID,
  CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(r.value) WHERE [key]='ParentTypeID') THEN 1 ELSE 0 END
 FROM OPENJSON(@Rows) r CROSS APPLY OPENJSON(r.value) WITH(RowNum INT,Command VARCHAR(10),ID INT,RowVersionHex VARCHAR(100),
  PackagingOrder NVARCHAR(4000),PackagingType NVARCHAR(4000),PriceBasis NVARCHAR(4000),TareWeight NVARCHAR(100),Status VARCHAR(20),ParentTypeID INT);
 IF (SELECT COUNT(*) FROM @Input) NOT BETWEEN 1 AND 500 THROW 51105,'Use 1 to 500 rows per batch.',1;
 IF EXISTS(SELECT RowNum FROM @Input GROUP BY RowNum HAVING COUNT(*)>1)
  OR EXISTS(SELECT ID FROM @Input WHERE ID IS NOT NULL GROUP BY ID HAVING COUNT(*)>1)
  THROW 51106,'Duplicate row numbers or record IDs.',1;
 DECLARE @Result TABLE(RowNum INT,Status VARCHAR(10),Message NVARCHAR(2048),NewID INT,NewRowVersion VARBINARY(8));
 DECLARE @Row INT,@Cmd VARCHAR(10),@ID INT,@RV VARBINARY(8),@Order NVARCHAR(4000),@Name NVARCHAR(4000),
  @Basis NVARCHAR(4000),@TareText NVARCHAR(100),@Tare DECIMAL(17,3),@Status VARCHAR(20),@Own BIT,@Parent INT,@ParentSet BIT,@Ancestor INT,@Lock INT;
 DECLARE @Visited TABLE(ID INT PRIMARY KEY);
 DECLARE c CURSOR LOCAL FAST_FORWARD FOR
  SELECT RowNum,Command,ID,RowVersion,PackagingOrder,PackagingType,PriceBasis,TareText,Status,ParentTypeID,ParentTypeSet FROM @Input ORDER BY RowNum;
 OPEN c; FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@RV,@Order,@Name,@Basis,@TareText,@Status,@Parent,@ParentSet;
 WHILE @@FETCH_STATUS=0
 BEGIN
  SET @Own=0;
  BEGIN TRY
   IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION; SET @Own=1; END ELSE SAVE TRANSACTION PackagingTypeRow;
   EXEC @Lock=sys.sp_getapplock @Resource=N'PackagingTypeHierarchy',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
   IF @Lock<0 THROW 51108,'Packaging Type hierarchy is busy. Try again.',1;
   IF @Row IS NULL OR @Row<1 OR @Cmd IS NULL OR @Cmd NOT IN('C','U','D') THROW 51107,'Use a positive row number and C, U or D.',1;
   IF @Cmd='C' AND (@ID IS NOT NULL OR @RV IS NOT NULL) THROW 51107,'Create cannot have an ID or RowVersion.',1;
   IF @Cmd IN('U','D') AND NOT EXISTS(SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@RV)
    THROW 51108,'Concurrency conflict or row not found. Refresh first.',1;
   IF @Cmd<>'D'
   BEGIN
    IF @Cmd='U' AND COALESCE(@ParentSet,0)=0
     SELECT @Parent=ParentTypeID FROM dbo.PackagingType WHERE ID=@ID;
    IF @Parent IS NOT NULL
    BEGIN
     IF NOT EXISTS(SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK) WHERE ID=@Parent
      AND (Status='Active' OR (@Cmd='U' AND EXISTS(SELECT 1 FROM dbo.PackagingType WHERE ID=@ID AND ParentTypeID=@Parent))))
      THROW 51111,'Choose an active Parent Type from Packaging Type Master.',1;
     DELETE @Visited;
     SET @Ancestor=@Parent;
     WHILE @Ancestor IS NOT NULL
     BEGIN
      IF @Ancestor=@ID OR EXISTS(SELECT 1 FROM @Visited WHERE ID=@Ancestor)
       THROW 51111,'Parent Type cannot be this type or one of its descendants.',1;
      INSERT @Visited VALUES(@Ancestor);
      SELECT @Ancestor=ParentTypeID FROM dbo.PackagingType WHERE ID=@Ancestor;
     END;
    END;

    SET @Name=NULLIF(LTRIM(RTRIM(@Name)),N'');
    IF @Order IS NULL OR @Order COLLATE Latin1_General_100_BIN2 NOT IN(N'Primary',N'Secondary')
     THROW 51111,'Choose Primary or Secondary for Order.',1;
    IF @Basis IS NULL OR @Basis COLLATE Latin1_General_100_BIN2 NOT IN(N'Count',N'Square meter',N'Volume')
     THROW 51111,'Choose Count, Square meter or Volume for Price Basis.',1;
    IF @Name IS NULL OR LEN(@Name)>100 THROW 51111,'Packaging Type is required (maximum 100 characters).',1;
    SET @Tare=TRY_CONVERT(DECIMAL(17,3),@TareText);
    IF @Tare IS NULL OR @Tare<0 OR TRY_CONVERT(DECIMAL(38,18),@TareText)<>@Tare
     THROW 51111,'Tare weight must be nonnegative, with at most 14 whole digits and 3 decimals.',1;
    IF @Cmd='U' AND @Status IS NULL SELECT @Status=Status FROM dbo.PackagingType WHERE ID=@ID;
    SET @Status=COALESCE(@Status,'Active');
    IF @Status NOT IN('Active','Block') THROW 51109,'Status must be Active or Block.',1;
    IF EXISTS(SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK)
     WHERE PackagingOrder=@Order AND PackagingType=@Name AND (@Cmd='C' OR ID<>@ID))
     THROW 51111,'This Packaging Type already exists for this Order. Edit the existing record instead.',1;
   END;
   IF @Cmd='C'
    INSERT dbo.PackagingType(PackagingOrder,PackagingType,PriceBasis,TareWeight,Status,CreatedBy,ParentTypeID)
    OUTPUT @Row,'OK','Created',inserted.ID,inserted.RowVersion INTO @Result VALUES(@Order,@Name,@Basis,@Tare,@Status,@Actor,@Parent);
   ELSE IF @Cmd='D'
    UPDATE dbo.PackagingType SET Status='Block',UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@Actor
    OUTPUT @Row,'OK','Blocked',inserted.ID,inserted.RowVersion INTO @Result WHERE ID=@ID AND RowVersion=@RV;
   ELSE
    UPDATE dbo.PackagingType SET PackagingOrder=@Order,PackagingType=@Name,PriceBasis=@Basis,TareWeight=@Tare,
     ParentTypeID=@Parent,Status=@Status,UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@Actor
    OUTPUT @Row,'OK','Updated',inserted.ID,inserted.RowVersion INTO @Result WHERE ID=@ID AND RowVersion=@RV;
   IF @Own=1 COMMIT;
  END TRY
  BEGIN CATCH
   IF @Own=1 AND XACT_STATE()<>0 ROLLBACK;
   ELSE IF XACT_STATE()=1 ROLLBACK TRANSACTION PackagingTypeRow;
   ELSE IF XACT_STATE()=-1 THROW;
   DELETE @Result WHERE RowNum=@Row;
   INSERT @Result VALUES(@Row,'ERROR',ERROR_MESSAGE(),@ID,NULL);
  END CATCH;
  FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@RV,@Order,@Name,@Basis,@TareText,@Status,@Parent,@ParentSet;
 END;
 CLOSE c; DEALLOCATE c;
 SELECT * FROM @Result ORDER BY RowNum;
END;
GO
GO
-- END MIGRATION 54_packaging_type_parent.sql

-- BEGIN MIGRATION 55_packaging_type_retire_tare_weight.sql
-- SOURCE SHA256 dfe697aabd85859ccb90193a3a66ea7eb8c3aed5e01ee97ef4b5f5a4b1bee51b
PRINT N'Applying 55_packaging_type_retire_tare_weight.sql';
GO
GO
-- After 54. Retire the input; keep historical TareWeight values unchanged.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingType_Batch
 @Rows NVARCHAR(MAX),@Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT OFF;
 DECLARE @Actor INT;
 EXEC dbo.usp_Packaging_Authorize @Username,'Maintain',@Actor OUTPUT;
 IF ISJSON(@Rows)<>1 OR LEFT(LTRIM(@Rows),1)<>'[' THROW 51105,'A JSON array of rows is required.',1;
 DECLARE @Input TABLE(RowNum INT,Command VARCHAR(10),ID INT,RowVersion VARBINARY(8),
  PackagingOrder NVARCHAR(4000),PackagingType NVARCHAR(4000),PriceBasis NVARCHAR(4000),Status VARCHAR(20),ParentTypeID INT,ParentTypeSet BIT);
 INSERT @Input SELECT RowNum,Command,ID,TRY_CONVERT(VARBINARY(8),RowVersionHex,1),PackagingOrder,PackagingType,PriceBasis,Status,ParentTypeID,
  CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(r.value) WHERE [key]='ParentTypeID') THEN 1 ELSE 0 END
 FROM OPENJSON(@Rows) r CROSS APPLY OPENJSON(r.value) WITH(RowNum INT,Command VARCHAR(10),ID INT,RowVersionHex VARCHAR(100),
  PackagingOrder NVARCHAR(4000),PackagingType NVARCHAR(4000),PriceBasis NVARCHAR(4000),Status VARCHAR(20),ParentTypeID INT);
 IF (SELECT COUNT(*) FROM @Input) NOT BETWEEN 1 AND 500 THROW 51105,'Use 1 to 500 rows per batch.',1;
 IF EXISTS(SELECT RowNum FROM @Input GROUP BY RowNum HAVING COUNT(*)>1)
  OR EXISTS(SELECT ID FROM @Input WHERE ID IS NOT NULL GROUP BY ID HAVING COUNT(*)>1)
  THROW 51106,'Duplicate row numbers or record IDs.',1;
 DECLARE @Result TABLE(RowNum INT,Status VARCHAR(10),Message NVARCHAR(2048),NewID INT,NewRowVersion VARBINARY(8));
 DECLARE @Row INT,@Cmd VARCHAR(10),@ID INT,@RV VARBINARY(8),@Order NVARCHAR(4000),@Name NVARCHAR(4000),
  @Basis NVARCHAR(4000),@Status VARCHAR(20),@Own BIT,@Parent INT,@ParentSet BIT,@Ancestor INT,@Lock INT;
 DECLARE @Visited TABLE(ID INT PRIMARY KEY);
 DECLARE c CURSOR LOCAL FAST_FORWARD FOR
  SELECT RowNum,Command,ID,RowVersion,PackagingOrder,PackagingType,PriceBasis,Status,ParentTypeID,ParentTypeSet FROM @Input ORDER BY RowNum;
 OPEN c; FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@RV,@Order,@Name,@Basis,@Status,@Parent,@ParentSet;
 WHILE @@FETCH_STATUS=0
 BEGIN
  SET @Own=0;
  BEGIN TRY
   IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION; SET @Own=1; END ELSE SAVE TRANSACTION PackagingTypeRow;
   EXEC @Lock=sys.sp_getapplock @Resource=N'PackagingTypeHierarchy',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
   IF @Lock<0 THROW 51108,'Packaging Type hierarchy is busy. Try again.',1;
   IF @Row IS NULL OR @Row<1 OR @Cmd IS NULL OR @Cmd NOT IN('C','U','D') THROW 51107,'Use a positive row number and C, U or D.',1;
   IF @Cmd='C' AND (@ID IS NOT NULL OR @RV IS NOT NULL) THROW 51107,'Create cannot have an ID or RowVersion.',1;
   IF @Cmd IN('U','D') AND NOT EXISTS(SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@RV)
    THROW 51108,'Concurrency conflict or row not found. Refresh first.',1;
   IF @Cmd<>'D'
   BEGIN
    IF @Cmd='U' AND COALESCE(@ParentSet,0)=0
     SELECT @Parent=ParentTypeID FROM dbo.PackagingType WHERE ID=@ID;
    IF @Parent IS NOT NULL
    BEGIN
     IF NOT EXISTS(SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK) WHERE ID=@Parent
      AND (Status='Active' OR (@Cmd='U' AND EXISTS(SELECT 1 FROM dbo.PackagingType WHERE ID=@ID AND ParentTypeID=@Parent))))
      THROW 51111,'Choose an active Parent Type from Packaging Type Master.',1;
     DELETE @Visited;
     SET @Ancestor=@Parent;
     WHILE @Ancestor IS NOT NULL
     BEGIN
      IF @Ancestor=@ID OR EXISTS(SELECT 1 FROM @Visited WHERE ID=@Ancestor)
       THROW 51111,'Parent Type cannot be this type or one of its descendants.',1;
      INSERT @Visited VALUES(@Ancestor);
      SELECT @Ancestor=ParentTypeID FROM dbo.PackagingType WHERE ID=@Ancestor;
     END;
    END;

    SET @Name=NULLIF(LTRIM(RTRIM(@Name)),N'');
    IF @Order IS NULL OR @Order COLLATE Latin1_General_100_BIN2 NOT IN(N'Primary',N'Secondary')
     THROW 51111,'Choose Primary or Secondary for Order.',1;
    IF @Basis IS NULL OR @Basis COLLATE Latin1_General_100_BIN2 NOT IN(N'Count',N'Square meter',N'Volume')
     THROW 51111,'Choose Count, Square meter or Volume for Price Basis.',1;
    IF @Name IS NULL OR LEN(@Name)>100 THROW 51111,'Packaging Type is required (maximum 100 characters).',1;
    IF @Cmd='U' AND @Status IS NULL SELECT @Status=Status FROM dbo.PackagingType WHERE ID=@ID;
    SET @Status=COALESCE(@Status,'Active');
    IF @Status NOT IN('Active','Block') THROW 51109,'Status must be Active or Block.',1;
    IF EXISTS(SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK)
     WHERE PackagingOrder=@Order AND PackagingType=@Name AND (@Cmd='C' OR ID<>@ID))
     THROW 51111,'This Packaging Type already exists for this Order. Edit the existing record instead.',1;
   END;
   IF @Cmd='C'
    INSERT dbo.PackagingType(PackagingOrder,PackagingType,PriceBasis,TareWeight,Status,CreatedBy,ParentTypeID)
    OUTPUT @Row,'OK','Created',inserted.ID,inserted.RowVersion INTO @Result VALUES(@Order,@Name,@Basis,0,@Status,@Actor,@Parent);
   ELSE IF @Cmd='D'
    UPDATE dbo.PackagingType SET Status='Block',UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@Actor
    OUTPUT @Row,'OK','Blocked',inserted.ID,inserted.RowVersion INTO @Result WHERE ID=@ID AND RowVersion=@RV;
   ELSE
    UPDATE dbo.PackagingType SET PackagingOrder=@Order,PackagingType=@Name,PriceBasis=@Basis,
     ParentTypeID=@Parent,Status=@Status,UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@Actor
    OUTPUT @Row,'OK','Updated',inserted.ID,inserted.RowVersion INTO @Result WHERE ID=@ID AND RowVersion=@RV;
   IF @Own=1 COMMIT;
  END TRY
  BEGIN CATCH
   IF @Own=1 AND XACT_STATE()<>0 ROLLBACK;
   ELSE IF XACT_STATE()=1 ROLLBACK TRANSACTION PackagingTypeRow;
   ELSE IF XACT_STATE()=-1 THROW;
   DELETE @Result WHERE RowNum=@Row;
   INSERT @Result VALUES(@Row,'ERROR',ERROR_MESSAGE(),@ID,NULL);
  END CATCH;
  FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@RV,@Order,@Name,@Basis,@Status,@Parent,@ParentSet;
 END;
 CLOSE c; DEALLOCATE c;
 SELECT * FROM @Result ORDER BY RowNum;
END;
GO
GO
-- END MIGRATION 55_packaging_type_retire_tare_weight.sql

-- BEGIN MIGRATION 56_web_packaging_requirement_sections.sql
-- SOURCE SHA256 f069a157913a84f749e13bd0cc61c2f439196e65e48bf9cd9e477e9e303d9a48
PRINT N'Applying 56_web_packaging_requirement_sections.sql';
GO
GO
-- After 55. Web-only requirement sections. Existing Excel/Layout contracts remain.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
GO
IF COL_LENGTH('dbo.OpportunityItem','PrimaryTypeID') IS NULL
 ALTER TABLE dbo.OpportunityItem ADD PrimaryTypeID INT NULL,SecondaryTypeID INT NULL,
 SecondaryTransparency NVARCHAR(100) NULL,NumberOfPrimary INT NULL;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','PrimaryTypeID') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD PrimaryTypeID INT NULL,PrimaryTypeName NVARCHAR(100) NULL,
 SecondaryTypeID INT NULL,SecondaryTypeName NVARCHAR(100) NULL,SecondaryTransparency NVARCHAR(100) NULL,NumberOfPrimary INT NULL;
GO
IF OBJECT_ID('dbo.FK_OpportunityItem_PrimaryType','F') IS NULL
 ALTER TABLE dbo.OpportunityItem WITH CHECK ADD CONSTRAINT FK_OpportunityItem_PrimaryType FOREIGN KEY(PrimaryTypeID) REFERENCES dbo.PackagingType(ID);
IF OBJECT_ID('dbo.FK_OpportunityItem_SecondaryType','F') IS NULL
 ALTER TABLE dbo.OpportunityItem WITH CHECK ADD CONSTRAINT FK_OpportunityItem_SecondaryType FOREIGN KEY(SecondaryTypeID) REFERENCES dbo.PackagingType(ID);
IF OBJECT_ID('dbo.CK_OpportunityItem_NumberOfPrimary','C') IS NULL
 ALTER TABLE dbo.OpportunityItem WITH CHECK ADD CONSTRAINT CK_OpportunityItem_NumberOfPrimary CHECK(NumberOfPrimary>=1);
IF OBJECT_ID('dbo.CK_OpportunityItem_SecondaryTransparency','C') IS NULL
 ALTER TABLE dbo.OpportunityItem WITH CHECK ADD CONSTRAINT CK_OpportunityItem_SecondaryTransparency CHECK(SecondaryTransparency IN(N'Transparent',N'Opaque',N'NA'));
IF OBJECT_ID('dbo.CK_PackagingRequestItem_NumberOfPrimary','C') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem WITH CHECK ADD CONSTRAINT CK_PackagingRequestItem_NumberOfPrimary CHECK(NumberOfPrimary>=1);
GO
CREATE OR ALTER PROCEDURE dbo.usp_OpportunityPackagingTypeLookup_Read @Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
  WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope IN(N'Admin',N'Opportunity'))
  THROW 51042,'Opportunity access is required for this action.',1;
 SELECT ID,PackagingOrder,PackagingType,ParentTypeID,Status FROM dbo.PackagingType
 WHERE ParentTypeID IS NULL AND Status='Active' ORDER BY PackagingOrder,PackagingType,ID;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_OpportunityItem_Fields_Save
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
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] NOT IN('PalletSize','PalletStacking','MaxPalletHeightM','ContainerRequest','ConfigurationRequest','PackagingType','RecyclableRequirement','RecycledContent','Transparency','MetalizedAluminum','SpecialComments','PrimaryTypeID','SecondaryTypeID','SecondaryTransparency','NumberOfPrimary','WebPackagingRequirements'))
  THROW 52957,'Unknown additional field.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.OpportunityItem WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@ExpectedRowVersion)
  THROW 52958,'Concurrency conflict. Refresh before saving.',1;
 IF EXISTS(SELECT 1 FROM dbo.OpportunityItem i JOIN dbo.Opportunity o ON o.ID=i.OpportunityID WHERE i.ID=@ID AND (i.Stage<>'Draft' OR o.Stage<>'Draft'))
  THROW 52960,'Only Draft Opportunity items can be edited.',1;
 -- Parent-only logistics: preserve the established mix-child restriction.
 IF EXISTS(SELECT 1 FROM dbo.OpportunityItem WHERE ID=@ID AND ParentItemID IS NOT NULL)
  AND EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] IN('PalletSize','PalletStacking','MaxPalletHeightM','ContainerRequest'))
  THROW 52960,'Pallet and Container requirements belong to the parent item only.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] IN('PrimaryTypeID','SecondaryTypeID','NumberOfPrimary') AND [type]<>0
  AND ([type] NOT IN(1,2) OR [value] LIKE '%[^0-9]%' OR TRY_CONVERT(INT,[value]) IS NULL OR TRY_CONVERT(INT,[value])<1))
  THROW 52957,'Type IDs and Number of Primary must be positive whole numbers.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='SecondaryTransparency' AND [type]<>0
  AND ([type]<>1 OR [value] COLLATE Latin1_General_100_BIN2 NOT IN(N'Transparent',N'Opaque',N'NA')))
  THROW 52957,'Choose Transparent, Opaque or NA for Secondary transparency.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] IN('PrimaryTypeID','SecondaryTypeID') AND [type]<>0
  AND NOT EXISTS(SELECT 1 FROM dbo.PackagingType p WITH(UPDLOCK,HOLDLOCK) WHERE p.ID=TRY_CONVERT(INT,[value])
   AND ((p.Status='Active' AND p.ParentTypeID IS NULL AND p.PackagingOrder=CASE WHEN [key]='PrimaryTypeID' THEN 'Primary' ELSE 'Secondary' END)
    OR EXISTS(SELECT 1 FROM dbo.OpportunityItem i WHERE i.ID=@ID AND CASE WHEN [key]='PrimaryTypeID' THEN i.PrimaryTypeID ELSE i.SecondaryTypeID END=p.ID))))
  THROW 52957,'Choose an active top-level Packaging Type with the matching Order.',1;
 DECLARE @Web BIT=CASE WHEN JSON_VALUE(@Fields,'$.WebPackagingRequirements')='true' THEN 1 ELSE 0 END,@Configuration NVARCHAR(500);
 SELECT @Configuration=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='ConfigurationRequest')
  THEN NULLIF(LTRIM(RTRIM(JSON_VALUE(@Fields,'$.ConfigurationRequest'))),N'') ELSE ConfigurationRequest END FROM dbo.OpportunityItem WHERE ID=@ID;
 IF @Web=1
 BEGIN
  IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) j WHERE j.[key] IN('ContainerRequest','ConfigurationRequest','PalletStacking','Transparency')
   AND j.[type]<>0 AND NOT(
    (j.[key]='ContainerRequest' AND j.[value] COLLATE Latin1_General_100_BIN2 IN(N'Dry',N'Reefer')) OR
    (j.[key]='ConfigurationRequest' AND j.[value] COLLATE Latin1_General_100_BIN2 IN(N'Pallet load',N'Floor load',N'Both')) OR
    (j.[key]='PalletStacking' AND j.[value] COLLATE Latin1_General_100_BIN2 IN(N'Single',N'Double')) OR
    (j.[key]='Transparency' AND j.[value] COLLATE Latin1_General_100_BIN2 IN(N'Transparent',N'Opaque',N'NA')) OR
    EXISTS(SELECT 1 FROM dbo.OpportunityItem i WHERE i.ID=@ID AND
     CONVERT(VARBINARY(MAX),j.[value])=CONVERT(VARBINARY(MAX),CASE j.[key] WHEN 'ContainerRequest' THEN i.ContainerRequest WHEN 'ConfigurationRequest' THEN i.ConfigurationRequest WHEN 'PalletStacking' THEN i.PalletStacking ELSE i.Transparency END))))
   THROW 52957,'Choose valid Container, Configuration, Pallet stacking and Primary transparency options.',1;
  IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) j WHERE j.[key]='PalletSize' AND j.[type]<>0
   AND NOT EXISTS(SELECT 1 FROM dbo.v_PalletMaster p JOIN dbo.UoM u ON u.ID=p.UoMID WHERE p.PalletSize=j.[value] AND p.Status='Active' AND u.Status='Active')
   AND NOT EXISTS(SELECT 1 FROM dbo.OpportunityItem i WHERE i.ID=@ID AND i.PalletSize=j.[value]))
   THROW 52957,'Choose an active pallet size from Pallet Master.',1;
 END;
 DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeUser'),@OldSource SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeSource');
 BEGIN TRY
  EXEC sys.sp_set_session_context N'OpportunityChangeUser',@Username;
  EXEC sys.sp_set_session_context N'OpportunityChangeSource',N'User';
  IF EXISTS(SELECT 1 FROM OPENJSON(@Fields))
  UPDATE t SET
   PalletSize=CASE WHEN @Web=1 AND @Configuration='Floor load' THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='PalletSize') THEN NULLIF(LTRIM(RTRIM(j.PalletSize)),N'') ELSE t.PalletSize END,
   PalletStacking=CASE WHEN @Web=1 AND @Configuration='Floor load' THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='PalletStacking') THEN NULLIF(LTRIM(RTRIM(j.PalletStacking)),N'') ELSE t.PalletStacking END,
   MaxPalletHeightM=CASE WHEN @Web=1 AND @Configuration='Floor load' THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='MaxPalletHeightM') THEN j.MaxPalletHeightM ELSE t.MaxPalletHeightM END,
   ContainerRequest=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='ContainerRequest') THEN NULLIF(LTRIM(RTRIM(j.ContainerRequest)),N'') ELSE t.ContainerRequest END,
   ConfigurationRequest=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='ConfigurationRequest') THEN NULLIF(LTRIM(RTRIM(j.ConfigurationRequest)),N'') ELSE t.ConfigurationRequest END,
   PackagingType=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='PackagingType') THEN NULLIF(LTRIM(RTRIM(j.PackagingType)),N'') ELSE t.PackagingType END,
   RecyclableRequirement=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='RecyclableRequirement') THEN NULLIF(LTRIM(RTRIM(j.RecyclableRequirement)),N'') ELSE t.RecyclableRequirement END,
   RecycledContent=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='RecycledContent') THEN NULLIF(LTRIM(RTRIM(j.RecycledContent)),N'') ELSE t.RecycledContent END,
   Transparency=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='Transparency') THEN NULLIF(LTRIM(RTRIM(j.Transparency)),N'') ELSE t.Transparency END,
   MetalizedAluminum=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='MetalizedAluminum') THEN NULLIF(LTRIM(RTRIM(j.MetalizedAluminum)),N'') ELSE t.MetalizedAluminum END,
   SpecialComments=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='SpecialComments') THEN NULLIF(LTRIM(RTRIM(j.SpecialComments)),N'') ELSE t.SpecialComments END,
   PrimaryTypeID=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='PrimaryTypeID') THEN j.PrimaryTypeID ELSE t.PrimaryTypeID END,
   SecondaryTypeID=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='SecondaryTypeID') THEN j.SecondaryTypeID ELSE t.SecondaryTypeID END,
   SecondaryTransparency=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='SecondaryTransparency') THEN j.SecondaryTransparency ELSE t.SecondaryTransparency END,
   NumberOfPrimary=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='NumberOfPrimary') THEN j.NumberOfPrimary ELSE t.NumberOfPrimary END,
   UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()
  FROM dbo.OpportunityItem t CROSS APPLY OPENJSON(@Fields) WITH(
   PalletSize NVARCHAR(100),PalletStacking NVARCHAR(100),MaxPalletHeightM DECIMAL(9,3),ContainerRequest NVARCHAR(200),
   ConfigurationRequest NVARCHAR(500),PackagingType NVARCHAR(100),RecyclableRequirement NVARCHAR(200),RecycledContent NVARCHAR(200),
   Transparency NVARCHAR(100),MetalizedAluminum NVARCHAR(100),SpecialComments NVARCHAR(1000),
   PrimaryTypeID INT,SecondaryTypeID INT,SecondaryTransparency NVARCHAR(100),NumberOfPrimary INT) j
  WHERE t.ID=@ID AND t.RowVersion=@ExpectedRowVersion;
  EXEC sys.sp_set_session_context N'OpportunityChangeUser',@OldUser;
  EXEC sys.sp_set_session_context N'OpportunityChangeSource',@OldSource;
 END TRY
 BEGIN CATCH
  EXEC sys.sp_set_session_context N'OpportunityChangeUser',@OldUser;
  EXEC sys.sp_set_session_context N'OpportunityChangeSource',@OldSource;
  THROW;
 END CATCH;
 SELECT RowVersion FROM dbo.OpportunityItem WHERE ID=@ID;
END;
GO
-- Extend processing locks without weakening their established comparisons.
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.tr_OpportunityItem_ProcessingLock'));
IF @D IS NULL THROW 52957,'Processing lock trigger is missing.',1;
IF CHARINDEX(N'i.PrimaryTypeID',@D)=0
BEGIN
 IF CHARINDEX(N'CONVERT(VARBINARY(MAX),i.SpecialComments)',@D)=0 THROW 52957,'Unexpected processing lock trigger.',1;
 SET @D=REPLACE(@D,N'CONVERT(VARBINARY(MAX),i.SpecialComments)',N'CONVERT(VARBINARY(MAX),i.SpecialComments),i.PrimaryTypeID,i.SecondaryTypeID,CONVERT(VARBINARY(MAX),i.SecondaryTransparency),i.NumberOfPrimary');
 SET @D=REPLACE(@D,N'CONVERT(VARBINARY(MAX),d.SpecialComments)',N'CONVERT(VARBINARY(MAX),d.SpecialComments),d.PrimaryTypeID,d.SecondaryTypeID,CONVERT(VARBINARY(MAX),d.SecondaryTransparency),d.NumberOfPrimary');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER TRIGGER',N'ALTER TRIGGER'),N'CREATE   TRIGGER',N'ALTER TRIGGER'),N'CREATE TRIGGER',N'ALTER TRIGGER');
 EXEC sys.sp_executesql @D;
END;
GO
-- Record new requirement fields with the existing actor/event audit contexts.
DECLARE @Name SYSNAME,@D NVARCHAR(MAX),@Rows NVARCHAR(MAX),@Field SYSNAME;
DECLARE triggers CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM sys.triggers
 WHERE name IN(N'tr_OpportunityItem_ChangeLog',N'tr_PackagingConfigurationRequestItem_ChangeLog');
OPEN triggers;FETCH NEXT FROM triggers INTO @Name;
WHILE @@FETCH_STATUS=0
BEGIN
 SET @D=OBJECT_DEFINITION(OBJECT_ID(N'dbo.'+@Name));SET @Rows=N'';
 IF CHARINDEX(N'''PrimaryTypeID''',@D)=0
 BEGIN
  DECLARE fields CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM sys.columns
   WHERE object_id=OBJECT_ID(CASE WHEN @Name=N'tr_OpportunityItem_ChangeLog' THEN N'dbo.OpportunityItem' ELSE N'dbo.PackagingConfigurationRequestItem' END)
    AND name IN(N'PrimaryTypeID',N'SecondaryTypeID',N'SecondaryTransparency',N'NumberOfPrimary',N'PrimaryTypeName',N'SecondaryTypeName');
  OPEN fields;FETCH NEXT FROM fields INTO @Field;
  WHILE @@FETCH_STATUS=0
  BEGIN
   SET @Rows+=N'('+QUOTENAME(@Field,'''')+N',CONVERT(NVARCHAR(MAX),d.'+QUOTENAME(@Field)+N'),CONVERT(NVARCHAR(MAX),i.'+QUOTENAME(@Field)+N')'+CASE WHEN @Name=N'tr_OpportunityItem_ChangeLog' THEN N'' ELSE N',0' END+N'),';
   FETCH NEXT FROM fields INTO @Field;
  END;
  CLOSE fields;DEALLOCATE fields;
  IF CHARINDEX(N'CROSS APPLY(VALUES',@D)=0 THROW 52957,'Unexpected change log trigger.',1;
  SET @D=REPLACE(@D,N'CROSS APPLY(VALUES',N'CROSS APPLY(VALUES'+@Rows);
  SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER TRIGGER',N'ALTER TRIGGER'),N'CREATE   TRIGGER',N'ALTER TRIGGER'),N'CREATE TRIGGER',N'ALTER TRIGGER');
  EXEC sys.sp_executesql @D;
 END;
 FETCH NEXT FROM triggers INTO @Name;
END;
CLOSE triggers;DEALLOCATE triggers;
GO
-- New requests snapshot the requested types independently from response types.
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingRequest_Create_AuditImplementation'));
IF @D IS NULL THROW 52957,'Request snapshot implementation is missing.',1;
IF CHARINDEX(N'PrimaryTypeName',@D)=0
BEGIN
 IF CHARINDEX(N'SourceProductRowVersion,SnapshotCapturedAt,SnapshotOrigin)',@D)=0 THROW 52957,'Unexpected request snapshot implementation.',1;
 SET @D=REPLACE(@D,N'WHERE NULLIF(LTRIM(RTRIM(i.PackagingType)),N'''') IS NULL',N'WHERE NULLIF(LTRIM(RTRIM(i.PackagingType)),N'''') IS NULL AND i.PrimaryTypeID IS NULL');
 SET @D=REPLACE(@D,N'Packaging type is required for every selected item before creating a request.',N'Primary Type is required for every selected item before creating a request.');
 SET @D=REPLACE(@D,N'SourceProductRowVersion,SnapshotCapturedAt,SnapshotOrigin)',N'SourceProductRowVersion,SnapshotCapturedAt,SnapshotOrigin,PrimaryTypeID,PrimaryTypeName,SecondaryTypeID,SecondaryTypeName,SecondaryTransparency,NumberOfPrimary)');
 SET @D=REPLACE(@D,N'p.RowVersion,@SnapshotAt,''Request''',N'p.RowVersion,@SnapshotAt,''Request'',i.PrimaryTypeID,(SELECT PackagingType FROM dbo.PackagingType WHERE ID=i.PrimaryTypeID),i.SecondaryTypeID,(SELECT PackagingType FROM dbo.PackagingType WHERE ID=i.SecondaryTypeID),i.SecondaryTransparency,i.NumberOfPrimary');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
COMMIT;
GO
GO
-- END MIGRATION 56_web_packaging_requirement_sections.sql

-- BEGIN MIGRATION 57_packaging_response_sections.sql
-- SOURCE SHA256 be8049d29b64f137f60808f8e3b371883a00cfc5fcccc92c793ba1d6626059b6
PRINT N'Applying 57_packaging_response_sections.sql';
GO
GO
-- Run after 56. Description is optional; keep its column and legacy input contract.
-- Update only the business implementation, preserving the public audit wrapper.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID(N'dbo.usp_PackagingRequestItem_Transition_AuditImplementation',N'P') IS NULL
 THROW 52970,'Required Packaging transition audit implementation is missing. Run SQL 24 first.',1;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingRequestItem_Transition_AuditImplementation
    @Username NVARCHAR(100), @ID INT, @ExpectedRowVersion VARBINARY(8),
    @TargetStage VARCHAR(20), @Comment NVARCHAR(1000)=NULL
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    DECLARE @ActorID INT,@Action VARCHAR(20),@Stage VARCHAR(20),@PIC INT;
    IF @TargetStage IS NULL OR @TargetStage NOT IN('Working','Pending Review','Approved','Returned','Canceled')
        THROW 51129,'Unsupported target stage.',1;
    SET @Action=CASE WHEN @TargetStage IN('Working','Pending Review') THEN 'Maintain' ELSE 'Review' END;
    EXEC dbo.usp_Packaging_Authorize @Username,@Action,@ActorID OUTPUT;
    DECLARE @IsAdmin BIT=0;
    IF EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@ActorID AND Scope=N'Admin') SET @IsAdmin=1;
    BEGIN TRY
        BEGIN TRANSACTION;
        SELECT @Stage=Stage,@PIC=PICUserID FROM dbo.PackagingConfigurationRequestItem WITH(UPDLOCK,HOLDLOCK)
        WHERE ID=@ID AND RowVersion=@ExpectedRowVersion;
        IF @Stage IS NULL THROW 51108,'Concurrency conflict or row not found. Refresh first.',1;
        IF @IsAdmin=0 AND @Action='Maintain' AND (@PIC IS NULL OR @PIC<>@ActorID)
            THROW 51130,'Only the assigned PIC can submit this response.',1;
        IF NOT ((@TargetStage='Working' AND @Stage IN('Assigned','Returned'))
            OR (@TargetStage='Pending Review' AND @Stage IN('Assigned','Working','Returned'))
            OR (@TargetStage IN('Approved','Returned') AND @Stage='Pending Review')
            OR (@TargetStage='Canceled' AND @Stage IN('Assigned','Working','Returned','Pending Review')))
            THROW 51131,'Invalid Packaging stage transition.',1;
        IF @TargetStage IN('Returned','Canceled') AND NULLIF(LTRIM(RTRIM(@Comment)),N'') IS NULL
            THROW 51132,'A reason is required for return or cancellation.',1;
        IF @IsAdmin=0 AND @TargetStage='Approved' AND @PIC=@ActorID
            THROW 51133,'The assigned PIC cannot approve their own response.',1;
        IF @TargetStage IN('Pending Review','Approved') AND EXISTS(
          SELECT 1 FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ID AND (
           NULLIF(LTRIM(RTRIM(FirstPMType)),N'') IS NULL OR NULLIF(LTRIM(RTRIM(SecondPMType)),N'') IS NULL
           OR UnitsPerCarton IS NULL
           OR FirstPMMOQ IS NULL OR SecondPMMOQ IS NULL))
          THROW 52963,'PM types, Unit/CTN and both PM MOQs are required for review.',1;
        UPDATE dbo.PackagingConfigurationRequestItem
        SET Stage=@TargetStage,IsOpen=CASE WHEN @TargetStage IN('Approved','Canceled') THEN 0 ELSE 1 END,
            SubmittedAt=CASE WHEN @TargetStage='Pending Review' THEN SYSUTCDATETIME() ELSE SubmittedAt END,
            SubmittedBy=CASE WHEN @TargetStage='Pending Review' THEN @ActorID ELSE SubmittedBy END,
            ReviewedAt=CASE WHEN @Action='Review' THEN SYSUTCDATETIME()
                            WHEN @TargetStage='Pending Review' THEN NULL ELSE ReviewedAt END,
            ReviewedBy=CASE WHEN @Action='Review' THEN @ActorID
                            WHEN @TargetStage='Pending Review' THEN NULL ELSE ReviewedBy END,
            ManagerComment=CASE WHEN @Action='Review' THEN @Comment
                                WHEN @TargetStage='Pending Review' THEN NULL ELSE ManagerComment END,
            UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@ActorID
        WHERE ID=@ID AND RowVersion=@ExpectedRowVersion;
        COMMIT;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK;
        THROW;
    END CATCH;
    SELECT ID,Stage,RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ID;
END;
GO
GO
-- END MIGRATION 57_packaging_response_sections.sql

-- BEGIN MIGRATION 58_packaging_response_nut_density.sql
-- SOURCE SHA256 2a6439c0e2177b3ac2284e52b2055032e6274726ecbac337564a4c64e4c0a8f0
PRINT N'Applying 58_packaging_response_nut_density.sql';
GO
GO
-- Run after 57. New web response fields; no legacy TVP/Layout/Excel changes.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
GO
IF COL_LENGTH(N'dbo.PackagingConfigurationRequestItem',N'NutDensity') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD NutDensity DECIMAL(18,6) NULL;
GO
IF OBJECT_ID(N'dbo.CK_PackagingRequestItem_NutDensity',N'C') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem WITH CHECK
 ADD CONSTRAINT CK_PackagingRequestItem_NutDensity CHECK(NutDensity IS NULL OR NutDensity>0);
GO
IF COL_LENGTH(N'dbo.PackagingConfigurationRequestItem',N'UsedVolumeML') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem
 ADD UsedVolumeML AS CONVERT(DECIMAL(28,6),WeightGrams / NULLIF(NutDensity,0));
GO

CREATE OR ALTER PROCEDURE dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation
 @Username NVARCHAR(100),@ID INT,@ExpectedRowVersion VARBINARY(8),@Fields NVARCHAR(MAX),@IsCreate BIT=0
AS
BEGIN
 SET NOCOUNT ON;
 IF @@TRANCOUNT=0 THROW 52956,'Additional fields must be saved inside the document transaction.',1;
 DECLARE @Actor INT,@Admin BIT=0;
 SELECT @Actor=u.ID FROM dbo.Users u WHERE u.UserName=@Username AND u.IsActive=1;
 IF @Actor IS NULL THROW 52953,'Username is incorrect.',1;
 IF EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope='Admin') SET @Admin=1;
 IF @Admin=0 AND NOT EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope='Packaging')
 THROW 52954,'Packaging access is required for this action.',1;
 IF ISJSON(@Fields)<>1 THROW 52957,'Invalid additional fields.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] NOT IN('FirstPMType','SecondPMType','UnitsPerCarton','PackagingDescription','FirstPMMOQ','SecondPMMOQ','CartonsPerLayer','LayersPerPallet','PacksPerPallet','CartonsPerContainer','NutDensity'))
 THROW 52957,'Unknown additional field.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@ExpectedRowVersion)
 THROW 52958,'Concurrency conflict. Refresh before saving.',1;
 
 
 
 IF NOT EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ID AND Stage IN('Assigned','Working','Returned') AND (@Admin=1 OR PICUserID=@Actor))
 THROW 52960,'Only the assigned PIC or Admin can edit an unlocked response.',1;

 -- New selections must be active types in the matching order. Unchanged legacy
 -- selections remain valid so unrelated edits do not rewrite historical data.
 IF EXISTS(
  SELECT 1 FROM OPENJSON(@Fields) j
  JOIN dbo.PackagingConfigurationRequestItem i ON i.ID=@ID
  CROSS APPLY(SELECT NULLIF(LTRIM(RTRIM(j.value)),N'') NewType,
   CASE j.[key] WHEN 'FirstPMType' THEN i.FirstPMType ELSE i.SecondPMType END OldType,
   CASE j.[key] WHEN 'FirstPMType' THEN N'Primary' ELSE N'Secondary' END PackagingOrder) v
  WHERE j.[key] IN('FirstPMType','SecondPMType') AND v.NewType IS NOT NULL
  AND (v.OldType IS NULL OR v.NewType COLLATE Latin1_General_100_BIN2<>v.OldType COLLATE Latin1_General_100_BIN2)
  AND NOT EXISTS(SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK)
   WHERE PackagingOrder=v.PackagingOrder AND PackagingType COLLATE Latin1_General_100_BIN2=v.NewType COLLATE Latin1_General_100_BIN2 AND Status='Active'))
  THROW 52961,'Choose an active Primary Type or Secondary Type in the matching Packaging Type Master order.',1;

 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) j WHERE j.[key]='NutDensity' AND j.[type]<>0 AND
  (TRY_CONVERT(DECIMAL(18,6),j.value) IS NULL OR TRY_CONVERT(DECIMAL(18,6),j.value)<=0
   OR TRY_CONVERT(DECIMAL(38,18),j.value)<>TRY_CONVERT(DECIMAL(18,6),j.value)))
  THROW 52961,'Nut Density must be positive with at most 6 decimal places.',1;


 DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeUser'),@OldSource SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeSource');
 BEGIN TRY
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@Username;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',N'User';
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields))
 UPDATE t SET
 NutDensity=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='NutDensity') THEN j.NutDensity ELSE t.NutDensity END,
 FirstPMType=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='FirstPMType') THEN NULLIF(LTRIM(RTRIM(j.FirstPMType)),N'') ELSE t.FirstPMType END,
 SecondPMType=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='SecondPMType') THEN NULLIF(LTRIM(RTRIM(j.SecondPMType)),N'') ELSE t.SecondPMType END,
 UnitsPerCarton=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='UnitsPerCarton') THEN j.UnitsPerCarton ELSE t.UnitsPerCarton END,
 PackagingDescription=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='PackagingDescription') THEN NULLIF(LTRIM(RTRIM(j.PackagingDescription)),N'') ELSE t.PackagingDescription END,
 FirstPMMOQ=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='FirstPMMOQ') THEN j.FirstPMMOQ ELSE t.FirstPMMOQ END,
 SecondPMMOQ=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='SecondPMMOQ') THEN j.SecondPMMOQ ELSE t.SecondPMMOQ END,
 CartonsPerLayer=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='CartonsPerLayer') THEN j.CartonsPerLayer ELSE t.CartonsPerLayer END,
 LayersPerPallet=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='LayersPerPallet') THEN j.LayersPerPallet ELSE t.LayersPerPallet END,
 PacksPerPallet=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='PacksPerPallet') THEN j.PacksPerPallet ELSE t.PacksPerPallet END,
 CartonsPerContainer=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='CartonsPerContainer') THEN j.CartonsPerContainer ELSE t.CartonsPerContainer END,
 UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()
 FROM dbo.PackagingConfigurationRequestItem t CROSS APPLY OPENJSON(@Fields) WITH(FirstPMType NVARCHAR(100),SecondPMType NVARCHAR(100),UnitsPerCarton INT,PackagingDescription NVARCHAR(500),FirstPMMOQ DECIMAL(18,4),SecondPMMOQ DECIMAL(18,4),CartonsPerLayer INT,LayersPerPallet INT,PacksPerPallet INT,CartonsPerContainer INT,NutDensity DECIMAL(18,6)) j
 WHERE t.ID=@ID AND t.RowVersion=@ExpectedRowVersion;
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',@OldSource;
 END TRY
 BEGIN CATCH
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',@OldSource;
 THROW;
 END CATCH;
SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ID;
END;
GO
CREATE OR ALTER TRIGGER dbo.tr_PackagingRequestItem_Volume_ChangeLog
ON dbo.PackagingConfigurationRequestItem AFTER INSERT,UPDATE,DELETE AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @Event UNIQUEIDENTIFIER=COALESCE(TRY_CONVERT(UNIQUEIDENTIFIER,SESSION_CONTEXT(N'PackagingChangeEvent')),NEWID()),
 @Actor NVARCHAR(128)=CONVERT(NVARCHAR(128),SESSION_CONTEXT(N'PackagingChangeUser')),
 @Source VARCHAR(20)=CONVERT(VARCHAR(20),SESSION_CONTEXT(N'PackagingChangeSource'));
 SET @Source=CASE WHEN TRIGGER_NESTLEVEL()>1 THEN 'System' WHEN @Source IN('User','System') THEN @Source ELSE 'Database' END;
 INSERT dbo.PackagingRequestChangeLog(EventID,RequestID,EntityLevel,ItemID,ItemLabel,Action,FieldName,OldValue,NewValue,ChangedBy,Source,Reason,IsResponse)
 SELECT @Event,COALESCE(i.RequestID,d.RequestID),'Item',COALESCE(i.ID,d.ID),COALESCE(i.ProductCode,d.ProductCode),
 CASE WHEN d.ID IS NULL THEN 'Create' WHEN i.ID IS NULL THEN 'Delete' ELSE 'Update' END,
 v.FieldName,v.OldValue,v.NewValue,COALESCE(@Actor,ORIGINAL_LOGIN()),@Source,
 CONVERT(NVARCHAR(1000),SESSION_CONTEXT(N'PackagingChangeReason')),1
 FROM inserted i FULL JOIN deleted d ON i.ID=d.ID
 CROSS APPLY(VALUES
  ('NutDensity',CONVERT(NVARCHAR(MAX),d.NutDensity),CONVERT(NVARCHAR(MAX),i.NutDensity)),
  ('UsedVolumeML',CONVERT(NVARCHAR(MAX),d.UsedVolumeML),CONVERT(NVARCHAR(MAX),i.UsedVolumeML))
 ) v(FieldName,OldValue,NewValue)
 WHERE (v.OldValue IS NULL AND v.NewValue IS NOT NULL)
 OR (v.OldValue IS NOT NULL AND v.NewValue IS NULL)
 OR CONVERT(VARBINARY(MAX),v.OldValue)<>CONVERT(VARBINARY(MAX),v.NewValue);
END;
GO
COMMIT;
GO
GO
-- END MIGRATION 58_packaging_response_nut_density.sql

-- BEGIN MIGRATION 59_packaging_dimension_master.sql
-- SOURCE SHA256 86d393f267f7a372a6d3d8c3c88351e32fe38bdf82095b32e948a3233aa44409
PRINT N'Applying 59_packaging_dimension_master.sql';
GO
GO
-- After 58. Web-only master; no Layout or Excel Local Update changes.
-- Area is calculated safely in the API, using current general conversions to M.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
IF OBJECT_ID('dbo.PackagingDimension','U') IS NULL
BEGIN
 CREATE TABLE dbo.PackagingDimension(
  ID INT IDENTITY PRIMARY KEY,
  PackagingTypeID INT NOT NULL REFERENCES dbo.PackagingType(ID),
  D1 DECIMAL(18,6) NOT NULL,
  D2 DECIMAL(18,6) NOT NULL,
  D3 DECIMAL(18,6) NOT NULL,
  D1UoMID INT NOT NULL REFERENCES dbo.UoM(ID),
  D2UoMID INT NOT NULL REFERENCES dbo.UoM(ID),
  D3UoMID INT NOT NULL REFERENCES dbo.UoM(ID),
  SquareMeterFormula NVARCHAR(200) NOT NULL,
  Status VARCHAR(10) NOT NULL DEFAULT('Active'),
  CreatedAt DATETIME2(7) NOT NULL DEFAULT(SYSUTCDATETIME()),
  CreatedBy INT NOT NULL REFERENCES dbo.Users(ID),
  UpdatedAt DATETIME2(7) NULL,
  UpdatedBy INT NULL REFERENCES dbo.Users(ID),
  RowVersion ROWVERSION NOT NULL,
  CONSTRAINT CK_PackagingDimension_Values CHECK(D1>0 AND D2>0 AND D3>0 AND LEN(LTRIM(RTRIM(SquareMeterFormula)))>0),
  CONSTRAINT CK_PackagingDimension_Status CHECK(Status IN('Active','Block'))
 );
 CREATE INDEX IX_PackagingDimension_Type ON dbo.PackagingDimension(PackagingTypeID,Status,ID);
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingDimension_Save
 @Username NVARCHAR(100),@ID INT=NULL,@RowVersion VARBINARY(8)=NULL,
 @PackagingTypeID INT=NULL,@D1 DECIMAL(18,6)=NULL,@D2 DECIMAL(18,6)=NULL,@D3 DECIMAL(18,6)=NULL,
 @D1UoMID INT=NULL,@D2UoMID INT=NULL,@D3UoMID INT=NULL,
 @SquareMeterFormula NVARCHAR(200)=NULL,@Status VARCHAR(10)='Active'
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 DECLARE @Actor INT,@OldType INT,@Old1 INT,@Old2 INT,@Old3 INT,@Own BIT=0;
 EXEC dbo.usp_Packaging_Authorize @Username,'Maintain',@Actor OUTPUT;
 BEGIN TRY
 IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION;SET @Own=1;END ELSE SAVE TRANSACTION DimensionRow;
 IF @ID IS NULL AND @RowVersion IS NOT NULL THROW 51111,'Create cannot have a RowVersion.',1;
 IF @ID IS NOT NULL
 BEGIN
  SELECT @OldType=PackagingTypeID,@Old1=D1UoMID,@Old2=D2UoMID,@Old3=D3UoMID
  FROM dbo.PackagingDimension WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@RowVersion;
  IF @OldType IS NULL THROW 51108,'Concurrency conflict or row not found. Refresh first.',1;
 END;
 IF @D1 IS NULL OR @D1<=0 OR @D2 IS NULL OR @D2<=0 OR @D3 IS NULL OR @D3<=0
  OR @Status IS NULL OR @Status NOT IN('Active','Block') OR NULLIF(LTRIM(RTRIM(@SquareMeterFormula)),N'') IS NULL
  THROW 51111,'Positive dimensions, a formula and valid status are required.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK)
  WHERE ID=@PackagingTypeID AND ParentTypeID IS NULL AND (Status='Active' OR (@Status='Block' AND ID=@OldType)))
  THROW 51111,'Choose an active parent Packaging Type.',1;
 IF @D1UoMID IS NULL OR @D2UoMID IS NULL OR @D3UoMID IS NULL
  THROW 51111,'Choose a unit for each dimension.',1;
 IF EXISTS(SELECT 1 FROM (VALUES(@D1UoMID,@Old1),(@D2UoMID,@Old2),(@D3UoMID,@Old3)) chosen(ID,OldID)
  WHERE NOT EXISTS(SELECT 1 FROM dbo.UoM u WITH(UPDLOCK,HOLDLOCK)
   WHERE u.ID=chosen.ID AND (u.Status='Active' OR (@Status='Block' AND u.ID=chosen.OldID))))
  THROW 51111,'Choose active units for the dimensions.',1;
 IF @Status='Active'
 BEGIN
  -- Hold the target unit and conversion rows during the save.
  DECLARE @M INT,@Locked BIGINT;
  SELECT @M=ID FROM dbo.UoM WITH(UPDLOCK,HOLDLOCK) WHERE UoMCode='M' AND Status='Active';
  SELECT @Locked=COUNT_BIG(*) FROM dbo.UnitConversion WITH(UPDLOCK,HOLDLOCK)
   WHERE FromUoMID IN(@D1UoMID,@D2UoMID,@D3UoMID) AND ToUoMID=@M
    AND PackagingMaterialID IS NULL AND RawMaterialID IS NULL AND VendorID IS NULL;
  IF @M IS NULL OR EXISTS(SELECT 1 FROM (VALUES(@D1UoMID),(@D2UoMID),(@D3UoMID)) chosen(ID)
   WHERE chosen.ID<>@M AND NOT EXISTS(SELECT 1 FROM dbo.UnitConversion
    WHERE FromUoMID=chosen.ID AND ToUoMID=@M AND Status='Active'
     AND PackagingMaterialID IS NULL AND RawMaterialID IS NULL AND VendorID IS NULL))
   THROW 51111,'Admin must maintain active general conversions from each dimension UoM to M (metres).',1;
 END;
 IF @ID IS NULL
 BEGIN
  INSERT dbo.PackagingDimension(PackagingTypeID,D1,D2,D3,D1UoMID,D2UoMID,D3UoMID,SquareMeterFormula,Status,CreatedBy)
  VALUES(@PackagingTypeID,@D1,@D2,@D3,@D1UoMID,@D2UoMID,@D3UoMID,LTRIM(RTRIM(@SquareMeterFormula)),@Status,@Actor);
  SET @ID=SCOPE_IDENTITY();
 END
 ELSE UPDATE dbo.PackagingDimension SET PackagingTypeID=@PackagingTypeID,D1=@D1,D2=@D2,D3=@D3,
  D1UoMID=@D1UoMID,D2UoMID=@D2UoMID,D3UoMID=@D3UoMID,SquareMeterFormula=LTRIM(RTRIM(@SquareMeterFormula)),
  Status=@Status,UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@Actor WHERE ID=@ID;
 IF @Own=1 COMMIT;
 SELECT ID,RowVersion FROM dbo.PackagingDimension WHERE ID=@ID;
 END TRY
 BEGIN CATCH
 IF @Own=1 AND XACT_STATE()<>0 ROLLBACK;
 ELSE IF XACT_STATE()=1 ROLLBACK TRANSACTION DimensionRow;
 THROW;
 END CATCH;
END;
GO
-- Referenced parent types must remain parents, even when maintained outside the web.
CREATE OR ALTER TRIGGER dbo.tr_PackagingType_DimensionParent
ON dbo.PackagingType AFTER UPDATE
AS
BEGIN
 SET NOCOUNT ON;
 IF UPDATE(ParentTypeID) AND EXISTS(SELECT 1 FROM inserted p JOIN dbo.PackagingDimension d ON d.PackagingTypeID=p.ID WHERE p.ParentTypeID IS NOT NULL)
  THROW 51111,'Packaging Type referenced by Dimension Master must remain a parent.',1;
END;
GO
GO
-- END MIGRATION 59_packaging_dimension_master.sql

-- BEGIN MIGRATION 60_packaging_dimension_definitions.sql
-- SOURCE SHA256 f8cc4c9b8210492c8da8d40882461540076f9af28710245aa6dafeb192cfc715
PRINT N'Applying 60_packaging_dimension_definitions.sql';
GO
GO
-- After 59. D1-D3 define names, not sample measurements.
-- Preserve old numeric values/formulas; require review before switching old rows.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.PackagingDimension','D1Name') IS NULL
 ALTER TABLE dbo.PackagingDimension ADD D1Name NVARCHAR(100) NULL,D2Name NVARCHAR(100) NULL,D3Name NVARCHAR(100) NULL,
  LegacySquareMeterFormula NVARCHAR(200) NULL,LegacyD1Unit NVARCHAR(40) NULL,LegacyD2Unit NVARCHAR(40) NULL,LegacyD3Unit NVARCHAR(40) NULL,
  FormulaNeedsReview BIT NOT NULL CONSTRAINT DF_PackagingDimension_Review DEFAULT(0);
GO
UPDATE d SET D1Name=N'Dimension 1',D2Name=N'Dimension 2',D3Name=N'Dimension 3',
 LegacySquareMeterFormula=SquareMeterFormula,LegacyD1Unit=u1.UoMCode,LegacyD2Unit=u2.UoMCode,LegacyD3Unit=u3.UoMCode,FormulaNeedsReview=1
 FROM dbo.PackagingDimension d JOIN dbo.UoM u1 ON u1.ID=d.D1UoMID
 LEFT JOIN dbo.UoM u2 ON u2.ID=d.D2UoMID LEFT JOIN dbo.UoM u3 ON u3.ID=d.D3UoMID WHERE D1Name IS NULL;
IF OBJECT_ID('dbo.CK_PackagingDimension_Values','C') IS NOT NULL
 ALTER TABLE dbo.PackagingDimension DROP CONSTRAINT CK_PackagingDimension_Values;
ALTER TABLE dbo.PackagingDimension ALTER COLUMN D1 DECIMAL(18,6) NULL;
ALTER TABLE dbo.PackagingDimension ALTER COLUMN D2 DECIMAL(18,6) NULL;
ALTER TABLE dbo.PackagingDimension ALTER COLUMN D3 DECIMAL(18,6) NULL;
ALTER TABLE dbo.PackagingDimension ALTER COLUMN D2UoMID INT NULL;
ALTER TABLE dbo.PackagingDimension ALTER COLUMN D3UoMID INT NULL;
ALTER TABLE dbo.PackagingDimension ALTER COLUMN D1Name NVARCHAR(100) NOT NULL;
ALTER TABLE dbo.PackagingDimension WITH CHECK ADD CONSTRAINT CK_PackagingDimension_Values
 CHECK((D1 IS NULL OR D1>0) AND (D2 IS NULL OR D2>0) AND (D3 IS NULL OR D3>0)
  AND LEN(LTRIM(RTRIM(SquareMeterFormula)))>0);
IF OBJECT_ID('dbo.CK_PackagingDimension_Names','C') IS NULL
 ALTER TABLE dbo.PackagingDimension WITH CHECK ADD CONSTRAINT CK_PackagingDimension_Names
 CHECK(LEN(LTRIM(RTRIM(D1Name)))>0
  AND ((D2Name IS NULL AND D2UoMID IS NULL) OR (D2Name IS NOT NULL AND LEN(LTRIM(RTRIM(D2Name)))>0 AND D2UoMID IS NOT NULL))
  AND ((D3Name IS NULL AND D3UoMID IS NULL) OR (D3Name IS NOT NULL AND LEN(LTRIM(RTRIM(D3Name)))>0 AND D3UoMID IS NOT NULL)));
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingDimension_Save
 @Username NVARCHAR(100),@ID INT=NULL,@RowVersion VARBINARY(8)=NULL,
 @PackagingTypeID INT=NULL,@D1 NVARCHAR(100)=NULL,@D2 NVARCHAR(100)=NULL,@D3 NVARCHAR(100)=NULL,
 @D1UoMID INT=NULL,@D2UoMID INT=NULL,@D3UoMID INT=NULL,
 @SquareMeterFormula NVARCHAR(200)=NULL,@Status VARCHAR(10)='Active',@FormulaReviewed BIT=0
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 DECLARE @Actor INT,@OldType INT,@Old1 INT,@Old2 INT,@Old3 INT,@NeedsReview BIT=0,@Own BIT=0;
 EXEC dbo.usp_Packaging_Authorize @Username,'Maintain',@Actor OUTPUT;
 BEGIN TRY
 IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION;SET @Own=1;END ELSE SAVE TRANSACTION DimensionRow;
 IF @ID IS NULL AND @RowVersion IS NOT NULL THROW 51111,'Create cannot have a RowVersion.',1;
 IF @ID IS NOT NULL
 BEGIN
  SELECT @OldType=PackagingTypeID,@Old1=D1UoMID,@Old2=D2UoMID,@Old3=D3UoMID,@NeedsReview=FormulaNeedsReview
  FROM dbo.PackagingDimension WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@RowVersion;
  IF @OldType IS NULL THROW 51108,'Concurrency conflict or row not found. Refresh first.',1;
 END;
 SET @D1=NULLIF(LTRIM(RTRIM(@D1)),N'');SET @D2=NULLIF(LTRIM(RTRIM(@D2)),N'');SET @D3=NULLIF(LTRIM(RTRIM(@D3)),N'');
 SET @SquareMeterFormula=NULLIF(LTRIM(RTRIM(@SquareMeterFormula)),N'');
 IF @D1 IS NULL OR @D1UoMID IS NULL OR @SquareMeterFormula IS NULL OR @Status IS NULL OR @Status NOT IN('Active','Block')
  THROW 51111,'D1 name and unit, a formula and valid status are required.',1;
 IF (@D2 IS NULL AND @D2UoMID IS NOT NULL) OR (@D2 IS NOT NULL AND @D2UoMID IS NULL)
  OR (@D3 IS NULL AND @D3UoMID IS NOT NULL) OR (@D3 IS NOT NULL AND @D3UoMID IS NULL)
  THROW 51111,'Each dimension needs both a name and unit, or both must be blank.',1;
 IF (CHARINDEX(N'D2',@SquareMeterFormula)>0 AND @D2 IS NULL) OR (CHARINDEX(N'D3',@SquareMeterFormula)>0 AND @D3 IS NULL)
  THROW 51111,'Define names and units for dimensions used in the formula.',1;
 IF @NeedsReview=1 AND COALESCE(@FormulaReviewed,0)<>1 AND @Status='Active'
  THROW 51111,'Review the legacy formula using selected input units before saving.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK)
  WHERE ID=@PackagingTypeID AND ParentTypeID IS NULL AND (Status='Active' OR (@Status='Block' AND ID=@OldType)))
  THROW 51111,'Choose an active parent Packaging Type.',1;
 IF EXISTS(SELECT 1 FROM (VALUES(@D1UoMID,@Old1),(@D2UoMID,@Old2),(@D3UoMID,@Old3)) chosen(ID,OldID)
  WHERE chosen.ID IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.UoM u WITH(UPDLOCK,HOLDLOCK)
   WHERE u.ID=chosen.ID AND (u.Status='Active' OR (@Status='Block' AND u.ID=chosen.OldID))))
  THROW 51111,'Choose active units for the dimensions.',1;
 IF @ID IS NULL
 BEGIN
  INSERT dbo.PackagingDimension(PackagingTypeID,D1Name,D2Name,D3Name,D1UoMID,D2UoMID,D3UoMID,SquareMeterFormula,Status,CreatedBy)
  VALUES(@PackagingTypeID,@D1,@D2,@D3,@D1UoMID,@D2UoMID,@D3UoMID,@SquareMeterFormula,@Status,@Actor);
  SET @ID=SCOPE_IDENTITY();
 END
 ELSE UPDATE dbo.PackagingDimension SET PackagingTypeID=@PackagingTypeID,D1Name=@D1,D2Name=@D2,D3Name=@D3,
  D1UoMID=@D1UoMID,D2UoMID=@D2UoMID,D3UoMID=@D3UoMID,SquareMeterFormula=@SquareMeterFormula,
  FormulaNeedsReview=CASE WHEN @FormulaReviewed=1 THEN 0 ELSE FormulaNeedsReview END,
  Status=@Status,UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@Actor WHERE ID=@ID;
 IF @Own=1 COMMIT;
 SELECT ID,RowVersion FROM dbo.PackagingDimension WHERE ID=@ID;
 END TRY
 BEGIN CATCH
 IF @Own=1 AND XACT_STATE()<>0 ROLLBACK;
 ELSE IF XACT_STATE()=1 ROLLBACK TRANSACTION DimensionRow;
 THROW;
 END CATCH;
END;
GO
COMMIT;
GO
GO
-- END MIGRATION 60_packaging_dimension_definitions.sql

-- BEGIN MIGRATION 61_packaging_dimension_square_meter_types.sql
-- SOURCE SHA256 dc70217b7a1dcce1848eff4f901453c03da95f280d886aa130db674ce79fa206
PRINT N'Applying 61_packaging_dimension_square_meter_types.sql';
GO
GO
-- After 60. Dimension definitions apply to Square meter types at any hierarchy level.
-- Preserve existing assignments; only blocking permits retaining an ineligible type.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF OBJECT_ID('dbo.tr_PackagingType_DimensionParent','TR') IS NOT NULL
 DROP TRIGGER dbo.tr_PackagingType_DimensionParent;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingDimension_Save
 @Username NVARCHAR(100),@ID INT=NULL,@RowVersion VARBINARY(8)=NULL,
 @PackagingTypeID INT=NULL,@D1 NVARCHAR(100)=NULL,@D2 NVARCHAR(100)=NULL,@D3 NVARCHAR(100)=NULL,
 @D1UoMID INT=NULL,@D2UoMID INT=NULL,@D3UoMID INT=NULL,
 @SquareMeterFormula NVARCHAR(200)=NULL,@Status VARCHAR(10)='Active',@FormulaReviewed BIT=0
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 DECLARE @Actor INT,@OldType INT,@Old1 INT,@Old2 INT,@Old3 INT,@NeedsReview BIT=0,@Own BIT=0;
 EXEC dbo.usp_Packaging_Authorize @Username,'Maintain',@Actor OUTPUT;
 BEGIN TRY
 IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION;SET @Own=1;END ELSE SAVE TRANSACTION DimensionRow;
 IF @ID IS NULL AND @RowVersion IS NOT NULL THROW 51111,'Create cannot have a RowVersion.',1;
 IF @ID IS NOT NULL
 BEGIN
  SELECT @OldType=PackagingTypeID,@Old1=D1UoMID,@Old2=D2UoMID,@Old3=D3UoMID,@NeedsReview=FormulaNeedsReview
  FROM dbo.PackagingDimension WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@RowVersion;
  IF @OldType IS NULL THROW 51108,'Concurrency conflict or row not found. Refresh first.',1;
 END;
 SET @D1=NULLIF(LTRIM(RTRIM(@D1)),N'');SET @D2=NULLIF(LTRIM(RTRIM(@D2)),N'');SET @D3=NULLIF(LTRIM(RTRIM(@D3)),N'');
 SET @SquareMeterFormula=NULLIF(LTRIM(RTRIM(@SquareMeterFormula)),N'');
 IF @D1 IS NULL OR @D1UoMID IS NULL OR @SquareMeterFormula IS NULL OR @Status IS NULL OR @Status NOT IN('Active','Block')
  THROW 51111,'D1 name and unit, a formula and valid status are required.',1;
 IF (@D2 IS NULL AND @D2UoMID IS NOT NULL) OR (@D2 IS NOT NULL AND @D2UoMID IS NULL)
  OR (@D3 IS NULL AND @D3UoMID IS NOT NULL) OR (@D3 IS NOT NULL AND @D3UoMID IS NULL)
  THROW 51111,'Each dimension needs both a name and unit, or both must be blank.',1;
 IF (CHARINDEX(N'D2',@SquareMeterFormula)>0 AND @D2 IS NULL) OR (CHARINDEX(N'D3',@SquareMeterFormula)>0 AND @D3 IS NULL)
  THROW 51111,'Define names and units for dimensions used in the formula.',1;
 IF @NeedsReview=1 AND COALESCE(@FormulaReviewed,0)<>1 AND @Status='Active'
  THROW 51111,'Review the legacy formula using selected input units before saving.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK)
  WHERE ID=@PackagingTypeID AND ((PriceBasis=N'Square meter' AND Status='Active') OR (@Status='Block' AND ID=@OldType)))
  THROW 51111,'Choose an active Packaging Type with Price Basis = Square meter.',1;
 IF EXISTS(SELECT 1 FROM (VALUES(@D1UoMID,@Old1),(@D2UoMID,@Old2),(@D3UoMID,@Old3)) chosen(ID,OldID)
  WHERE chosen.ID IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.UoM u WITH(UPDLOCK,HOLDLOCK)
   WHERE u.ID=chosen.ID AND (u.Status='Active' OR (@Status='Block' AND u.ID=chosen.OldID))))
  THROW 51111,'Choose active units for the dimensions.',1;
 IF @ID IS NULL
 BEGIN
  INSERT dbo.PackagingDimension(PackagingTypeID,D1Name,D2Name,D3Name,D1UoMID,D2UoMID,D3UoMID,SquareMeterFormula,Status,CreatedBy)
  VALUES(@PackagingTypeID,@D1,@D2,@D3,@D1UoMID,@D2UoMID,@D3UoMID,@SquareMeterFormula,@Status,@Actor);
  SET @ID=SCOPE_IDENTITY();
 END
 ELSE UPDATE dbo.PackagingDimension SET PackagingTypeID=@PackagingTypeID,D1Name=@D1,D2Name=@D2,D3Name=@D3,
  D1UoMID=@D1UoMID,D2UoMID=@D2UoMID,D3UoMID=@D3UoMID,SquareMeterFormula=@SquareMeterFormula,
  FormulaNeedsReview=CASE WHEN @FormulaReviewed=1 THEN 0 ELSE FormulaNeedsReview END,
  Status=@Status,UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@Actor WHERE ID=@ID;
 IF @Own=1 COMMIT;
 SELECT ID,RowVersion FROM dbo.PackagingDimension WHERE ID=@ID;
 END TRY
 BEGIN CATCH
 IF @Own=1 AND XACT_STATE()<>0 ROLLBACK;
 ELSE IF XACT_STATE()=1 ROLLBACK TRANSACTION DimensionRow;
 THROW;
 END CATCH;
END;
GO
COMMIT;
GO
GO
-- END MIGRATION 61_packaging_dimension_square_meter_types.sql

-- BEGIN MIGRATION 62_packaging_dimension_all_types.sql
-- SOURCE SHA256 f17b8a7e463ab48b88a60293b4a384d30d754bd1bba37c2d99d93f2c9b3a6870
PRINT N'Applying 62_packaging_dimension_all_types.sql';
GO
GO
-- After 61. All active Packaging Types are eligible; only Square meter needs a formula.
-- Existing formulas, numeric archives and review flags are preserved for other bases.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF OBJECT_ID('dbo.tr_PackagingType_DimensionParent','TR') IS NOT NULL
 DROP TRIGGER dbo.tr_PackagingType_DimensionParent;
IF OBJECT_ID('dbo.CK_PackagingDimension_Values','C') IS NOT NULL
 ALTER TABLE dbo.PackagingDimension DROP CONSTRAINT CK_PackagingDimension_Values;
ALTER TABLE dbo.PackagingDimension ALTER COLUMN SquareMeterFormula NVARCHAR(200) NULL;
ALTER TABLE dbo.PackagingDimension WITH CHECK ADD CONSTRAINT CK_PackagingDimension_Values
 CHECK((D1 IS NULL OR D1>0) AND (D2 IS NULL OR D2>0) AND (D3 IS NULL OR D3>0)
  AND (SquareMeterFormula IS NULL OR LEN(LTRIM(RTRIM(SquareMeterFormula)))>0));
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingDimension_Save
 @Username NVARCHAR(100),@ID INT=NULL,@RowVersion VARBINARY(8)=NULL,
 @PackagingTypeID INT=NULL,@D1 NVARCHAR(100)=NULL,@D2 NVARCHAR(100)=NULL,@D3 NVARCHAR(100)=NULL,
 @D1UoMID INT=NULL,@D2UoMID INT=NULL,@D3UoMID INT=NULL,
 @SquareMeterFormula NVARCHAR(200)=NULL,@Status VARCHAR(10)='Active',@FormulaReviewed BIT=0
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 DECLARE @Actor INT,@OldType INT,@Old1 INT,@Old2 INT,@Old3 INT,@NeedsReview BIT=0,@Own BIT=0,@PriceBasis NVARCHAR(20),@OldFormula NVARCHAR(200);
 EXEC dbo.usp_Packaging_Authorize @Username,'Maintain',@Actor OUTPUT;
 BEGIN TRY
 IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION;SET @Own=1;END ELSE SAVE TRANSACTION DimensionRow;
 IF @ID IS NULL AND @RowVersion IS NOT NULL THROW 51111,'Create cannot have a RowVersion.',1;
 IF @ID IS NOT NULL
 BEGIN
  SELECT @OldType=PackagingTypeID,@Old1=D1UoMID,@Old2=D2UoMID,@Old3=D3UoMID,@NeedsReview=FormulaNeedsReview,@OldFormula=SquareMeterFormula
  FROM dbo.PackagingDimension WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@RowVersion;
  IF @OldType IS NULL THROW 51108,'Concurrency conflict or row not found. Refresh first.',1;
 END;
 SET @D1=NULLIF(LTRIM(RTRIM(@D1)),N'');SET @D2=NULLIF(LTRIM(RTRIM(@D2)),N'');SET @D3=NULLIF(LTRIM(RTRIM(@D3)),N'');
 SET @SquareMeterFormula=NULLIF(LTRIM(RTRIM(@SquareMeterFormula)),N'');
 SELECT @PriceBasis=PriceBasis FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK)
  WHERE ID=@PackagingTypeID AND (Status='Active' OR (@Status='Block' AND ID=@OldType));
 IF @PriceBasis IS NULL THROW 51111,'Choose an active Packaging Type.',1;
 IF @PriceBasis=N'Square meter' AND @SquareMeterFormula IS NULL
  THROW 51111,'Square meter types require a Square meter formula.',1;
 -- Non-area types retain prior formulas for preservation, but never use a hidden input.
 IF @PriceBasis<>N'Square meter' SET @SquareMeterFormula=@OldFormula;
 IF @D1 IS NULL OR @D1UoMID IS NULL OR @Status IS NULL OR @Status NOT IN('Active','Block')
  THROW 51111,'D1 name and unit and valid status are required.',1;
 IF (@D2 IS NULL AND @D2UoMID IS NOT NULL) OR (@D2 IS NOT NULL AND @D2UoMID IS NULL)
  OR (@D3 IS NULL AND @D3UoMID IS NOT NULL) OR (@D3 IS NOT NULL AND @D3UoMID IS NULL)
  THROW 51111,'Each dimension needs both a name and unit, or both must be blank.',1;
 IF @PriceBasis=N'Square meter' AND ((CHARINDEX(N'D2',@SquareMeterFormula)>0 AND @D2 IS NULL) OR (CHARINDEX(N'D3',@SquareMeterFormula)>0 AND @D3 IS NULL))
  THROW 51111,'Define names and units for dimensions used in the formula.',1;
 IF @PriceBasis=N'Square meter' AND @NeedsReview=1 AND COALESCE(@FormulaReviewed,0)<>1 AND @Status='Active'
  THROW 51111,'Review the legacy formula using selected input units before saving.',1;
 IF EXISTS(SELECT 1 FROM (VALUES(@D1UoMID,@Old1),(@D2UoMID,@Old2),(@D3UoMID,@Old3)) chosen(ID,OldID)
  WHERE chosen.ID IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.UoM u WITH(UPDLOCK,HOLDLOCK)
   WHERE u.ID=chosen.ID AND (u.Status='Active' OR (@Status='Block' AND u.ID=chosen.OldID))))
  THROW 51111,'Choose active units for the dimensions.',1;
 IF @ID IS NULL
 BEGIN
  INSERT dbo.PackagingDimension(PackagingTypeID,D1Name,D2Name,D3Name,D1UoMID,D2UoMID,D3UoMID,SquareMeterFormula,Status,CreatedBy)
  VALUES(@PackagingTypeID,@D1,@D2,@D3,@D1UoMID,@D2UoMID,@D3UoMID,@SquareMeterFormula,@Status,@Actor);
  SET @ID=SCOPE_IDENTITY();
 END
 ELSE UPDATE dbo.PackagingDimension SET PackagingTypeID=@PackagingTypeID,D1Name=@D1,D2Name=@D2,D3Name=@D3,
  D1UoMID=@D1UoMID,D2UoMID=@D2UoMID,D3UoMID=@D3UoMID,SquareMeterFormula=@SquareMeterFormula,
  FormulaNeedsReview=CASE WHEN @PriceBasis=N'Square meter' AND @FormulaReviewed=1 THEN 0 ELSE FormulaNeedsReview END,
  Status=@Status,UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@Actor WHERE ID=@ID;
 IF @Own=1 COMMIT;
 SELECT ID,RowVersion FROM dbo.PackagingDimension WHERE ID=@ID;
 END TRY
 BEGIN CATCH
 IF @Own=1 AND XACT_STATE()<>0 ROLLBACK;
 ELSE IF XACT_STATE()=1 ROLLBACK TRANSACTION DimensionRow;
 THROW;
 END CATCH;
END;
GO
COMMIT;
GO
GO
-- END MIGRATION 62_packaging_dimension_all_types.sql

-- BEGIN MIGRATION 63_pkg_pricing_master.sql
-- SOURCE SHA256 fbf8d0cee848d4b15033d8476c8f54ad00df4fea0356e1506a9261c8f553f37a
PRINT N'Applying 63_pkg_pricing_master.sql';
GO
GO
-- After 62. Web calculator snapshots; existing prices, Layout and Excel are unchanged.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF OBJECT_ID('dbo.PkgPricingMaster','U') IS NULL
BEGIN
 CREATE TABLE dbo.PkgPricingMaster(
  ID INT IDENTITY PRIMARY KEY,
  RequestItemID INT NOT NULL REFERENCES dbo.PackagingConfigurationRequestItem(ID),
  PackagingOrder VARCHAR(10) NOT NULL CHECK(PackagingOrder IN('Primary','Secondary')),
  PackagingTypeID INT NOT NULL REFERENCES dbo.PackagingType(ID),
  PackagingTypeName NVARCHAR(100) NOT NULL,
  AsOfDate DATE NOT NULL,
  FinalMOQ DECIMAL(18,0) NOT NULL CHECK(FinalMOQ>=0),
  UnitPrice DECIMAL(28,9) NOT NULL CHECK(UnitPrice>=0),
  CurrencyID INT NOT NULL REFERENCES dbo.Currency(ID),
  CurrencyCode NVARCHAR(20) NOT NULL,
  UnitUSDPrice DECIMAL(28,9) NULL CHECK(UnitUSDPrice>=0),
  Fingerprint CHAR(64) NOT NULL,
  InputJSON NVARCHAR(MAX) NOT NULL CHECK(ISJSON(InputJSON)=1),
  IsCurrent BIT NOT NULL DEFAULT(1),
  CreatedAt DATETIME2(7) NOT NULL DEFAULT(SYSUTCDATETIME()),
  CreatedBy INT NOT NULL REFERENCES dbo.Users(ID),
  RowVersion ROWVERSION NOT NULL
 );
 CREATE UNIQUE INDEX UX_PkgPricingMaster_Current ON dbo.PkgPricingMaster(RequestItemID,PackagingOrder) WHERE IsCurrent=1;
 CREATE INDEX IX_PkgPricingMaster_History ON dbo.PkgPricingMaster(RequestItemID,PackagingOrder,ID DESC);
END;
IF OBJECT_ID('dbo.PkgPricingComponent','U') IS NULL
BEGIN
 CREATE TABLE dbo.PkgPricingComponent(
  ID INT IDENTITY PRIMARY KEY,
  PricingMasterID INT NOT NULL REFERENCES dbo.PkgPricingMaster(ID),
  LineNumber INT NOT NULL,
  MaterialID INT NOT NULL REFERENCES dbo.PackagingMaterial(ID),
  PackagingPriceID INT NOT NULL REFERENCES dbo.PackagingPrice(ID),
  DimensionID INT NULL REFERENCES dbo.PackagingDimension(ID),
  QuantityPerProduct DECIMAL(18,6) NOT NULL CHECK(QuantityPerProduct>0),
  AreaPerMaterial DECIMAL(28,9) NULL CHECK(AreaPerMaterial>0),
  BaseUnitsPerPriceUnit DECIMAL(24,9) NOT NULL CHECK(BaseUnitsPerPriceUnit>0),
  PriceUnitsPerProduct DECIMAL(28,12) NOT NULL CHECK(PriceUnitsPerProduct>0),
  VendorMOQ DECIMAL(18,4) NOT NULL CHECK(VendorMOQ>=0),
  ProductMOQ DECIMAL(18,0) NOT NULL CHECK(ProductMOQ>=0),
  ProductUnitPrice DECIMAL(28,9) NOT NULL CHECK(ProductUnitPrice>=0),
  CurrencyID INT NOT NULL REFERENCES dbo.Currency(ID),
  ProductUnitUSDPrice DECIMAL(28,9) NULL CHECK(ProductUnitUSDPrice>=0),
  SnapshotJSON NVARCHAR(MAX) NOT NULL CHECK(ISJSON(SnapshotJSON)=1),
  CONSTRAINT UQ_PkgPricingComponent_Line UNIQUE(PricingMasterID,LineNumber)
 );
END;
COMMIT;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PkgPricing_ItemAuthorize
 @Username NVARCHAR(100),@ItemID INT,@Write BIT=0,@ExpectedRowVersion VARBINARY(8)=NULL
AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @Actor INT,@Admin BIT=0;
 EXEC dbo.usp_Packaging_Authorize @Username,'MasterRead',@Actor OUTPUT;
 IF NOT EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ItemID)
  THROW 51111,'Packaging request item was not found.',1;
 IF @Write=1
 BEGIN
  IF @@TRANCOUNT=0 THROW 51111,'Pricing saves require a document transaction.',1;
  EXEC dbo.usp_Packaging_Authorize @Username,'Maintain',@Actor OUTPUT;
  IF EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope='Admin') SET @Admin=1;
  IF NOT EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ItemID AND RowVersion=@ExpectedRowVersion)
   THROW 51108,'Request item changed. Refresh before saving pricing.',1;
  IF NOT EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ItemID AND Stage IN('Assigned','Working','Returned') AND (@Admin=1 OR PICUserID=@Actor))
   THROW 51102,'Only the assigned PIC or Admin can save pricing on an unlocked item.',1;
 END;
 SELECT ID,Stage,PICUserID,FirstPMType,SecondPMType,RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ItemID;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PkgPricing_Save
 @Username NVARCHAR(100),@ItemID INT,@ExpectedRowVersion VARBINARY(8),@Snapshot NVARCHAR(MAX)
AS
BEGIN
 SET NOCOUNT ON;
 -- Called by the API ONLY after server-side recalculation, in the response transaction.
 DECLARE @Actor INT,@Order VARCHAR(10)=JSON_VALUE(@Snapshot,'$.PackagingOrder'),
  @TypeID INT=TRY_CONVERT(INT,JSON_VALUE(@Snapshot,'$.PackagingTypeID')),
  @TypeName NVARCHAR(100)=JSON_VALUE(@Snapshot,'$.PackagingTypeName'),@ID INT;
 EXEC dbo.usp_PkgPricing_ItemAuthorize @Username,@ItemID,1,@ExpectedRowVersion;
 SELECT @Actor=ID FROM dbo.Users WHERE UserName=@Username AND IsActive=1;
 IF ISJSON(@Snapshot)<>1 OR @Order NOT IN('Primary','Secondary') OR @TypeID IS NULL
  THROW 51111,'Invalid pricing snapshot.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.PackagingType WHERE ID=@TypeID AND Status='Active' AND PackagingOrder=@Order AND PackagingType=@TypeName)
  THROW 51111,'Choose an active Packaging Type in the matching order.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ItemID AND
  CASE @Order WHEN 'Primary' THEN FirstPMType ELSE SecondPMType END=@TypeName)
  THROW 51111,'Calculator type must match the saved response type.',1;
 IF NOT EXISTS(SELECT 1 FROM OPENJSON(@Snapshot,'$.components'))
  THROW 51111,'Select at least one component.',1;
 UPDATE dbo.PkgPricingMaster SET IsCurrent=0 WHERE RequestItemID=@ItemID AND PackagingOrder=@Order AND IsCurrent=1;
 INSERT dbo.PkgPricingMaster(RequestItemID,PackagingOrder,PackagingTypeID,PackagingTypeName,AsOfDate,FinalMOQ,UnitPrice,CurrencyID,CurrencyCode,UnitUSDPrice,Fingerprint,InputJSON,CreatedBy)
 SELECT @ItemID,@Order,@TypeID,@TypeName,AsOfDate,FinalMOQ,UnitPrice,CurrencyID,CurrencyCode,UnitUSDPrice,Fingerprint,InputJSON,@Actor
 FROM OPENJSON(@Snapshot) WITH(AsOfDate DATE,FinalMOQ DECIMAL(18,0),UnitPrice DECIMAL(28,9),CurrencyID INT,CurrencyCode NVARCHAR(20),UnitUSDPrice DECIMAL(28,9),Fingerprint CHAR(64),InputJSON NVARCHAR(MAX) AS JSON);
 SET @ID=SCOPE_IDENTITY();
 INSERT dbo.PkgPricingComponent(PricingMasterID,LineNumber,MaterialID,PackagingPriceID,DimensionID,QuantityPerProduct,AreaPerMaterial,BaseUnitsPerPriceUnit,PriceUnitsPerProduct,VendorMOQ,ProductMOQ,ProductUnitPrice,CurrencyID,ProductUnitUSDPrice,SnapshotJSON)
 SELECT @ID,CONVERT(INT,j.[key])+1,c.MaterialID,c.PriceID,c.DimensionID,c.Quantity,c.Area,c.Factor,c.Consumption,c.VendorMOQ,c.ProductMOQ,c.ProductUnitPrice,c.CurrencyID,c.ProductUnitUSDPrice,j.value
 FROM OPENJSON(@Snapshot,'$.components') j CROSS APPLY OPENJSON(j.value) WITH(MaterialID INT,PriceID INT,DimensionID INT,Quantity DECIMAL(18,6),Area DECIMAL(28,9),Factor DECIMAL(24,9),Consumption DECIMAL(28,12),VendorMOQ DECIMAL(18,4),ProductMOQ DECIMAL(18,0),ProductUnitPrice DECIMAL(28,9),CurrencyID INT,ProductUnitUSDPrice DECIMAL(28,9)) c;
 -- Keep a lightweight reference in the request's normal change log.
 INSERT dbo.PackagingRequestChangeLog(EventID,RequestID,EntityLevel,ItemID,ItemLabel,Action,FieldName,OldValue,NewValue,ChangedBy,Source,IsResponse)
 SELECT NEWID(),RequestID,'Item',ID,ProductCode,'Update',@Order+'Pricing',NULL,
  CONCAT('Pricing #',@ID,': MOQ ',JSON_VALUE(@Snapshot,'$.FinalMOQ'),', unit price ',JSON_VALUE(@Snapshot,'$.UnitPrice'),' ',JSON_VALUE(@Snapshot,'$.CurrencyCode')),@Username,'User',1
 FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ItemID;
END;
GO
GO
-- END MIGRATION 63_pkg_pricing_master.sql

-- BEGIN MIGRATION 64_unit_conversion_bidirectional.sql
-- SOURCE SHA256 500453d2c4fbee7d45121ae2998aaf723d7ad1fb559421b0d63c7079f3358b0c
PRINT N'Applying 64_unit_conversion_bidirectional.sql';
GO
GO
-- After 63 (and 40). One maintained conversion creates a linked reciprocal.
-- Existing factors are preserved; conflicting independent pairs are not overwritten.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT OFF;
GO
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.UnitConversion','ReverseConversionID') IS NULL
 ALTER TABLE dbo.UnitConversion ADD ReverseConversionID INT NULL;
IF COL_LENGTH('dbo.UnitConversion','IsAutoGenerated') IS NULL
 ALTER TABLE dbo.UnitConversion ADD IsAutoGenerated BIT NOT NULL
  CONSTRAINT DF_UnitConversion_IsAutoGenerated DEFAULT(0) WITH VALUES;
COMMIT;
GO
IF OBJECT_ID('dbo.FK_UnitConversion_Reverse','F') IS NULL
 ALTER TABLE dbo.UnitConversion ADD CONSTRAINT FK_UnitConversion_Reverse
 FOREIGN KEY(ReverseConversionID) REFERENCES dbo.UnitConversion(ID);
IF OBJECT_ID('dbo.CK_UnitConversion_Reverse','C') IS NULL
 ALTER TABLE dbo.UnitConversion ADD CONSTRAINT CK_UnitConversion_Reverse
 CHECK(ReverseConversionID IS NULL OR ReverseConversionID<>ID);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.UnitConversion') AND name='UX_UnitConversion_Reverse')
 CREATE UNIQUE INDEX UX_UnitConversion_Reverse ON dbo.UnitConversion(ReverseConversionID)
 WHERE ReverseConversionID IS NOT NULL;
GO
-- Rerunnable backfill. Link matching independent pairs or create missing reverses.
-- Blocked, conflicting and unrepresentable legacy records remain unchanged.
DECLARE @Own BIT=0,@ID INT,@From INT,@To INT,@Pkg INT,@Raw INT,@Vendor INT,
 @Factor DECIMAL(24,9),@Inverse DECIMAL(24,9),@Actor INT,@Reverse INT,
 @ExistingFactor DECIMAL(24,9),@Skipped INT=0;
BEGIN TRY
 IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION;SET @Own=1;END
 ELSE SAVE TRANSACTION ConversionBackfill;
 DECLARE @Sources TABLE(ID INT PRIMARY KEY);
 INSERT @Sources SELECT ID FROM dbo.UnitConversion WITH(TABLOCKX,HOLDLOCK)
 WHERE Status='Active' AND ReverseConversionID IS NULL;
 DECLARE sources CURSOR LOCAL FAST_FORWARD FOR SELECT ID FROM @Sources ORDER BY ID;
 OPEN sources;FETCH NEXT FROM sources INTO @ID;
 WHILE @@FETCH_STATUS=0
 BEGIN
  IF EXISTS(SELECT 1 FROM dbo.UnitConversion WHERE ID=@ID AND ReverseConversionID IS NULL)
  BEGIN
   SELECT @From=FromUoMID,@To=ToUoMID,@Pkg=PackagingMaterialID,@Raw=RawMaterialID,
    @Vendor=VendorID,@Factor=Factor,@Actor=CreatedBy FROM dbo.UnitConversion WHERE ID=@ID;
   SET @Inverse=TRY_CONVERT(DECIMAL(24,9),CONVERT(DECIMAL(19,9),1)/@Factor);
   SET @Reverse=NULL;SET @ExistingFactor=NULL;
   SELECT @Reverse=ID,@ExistingFactor=Factor FROM dbo.UnitConversion
   WHERE FromUoMID=@To AND ToUoMID=@From AND Status='Active'
    AND ISNULL(PackagingMaterialID,0)=ISNULL(@Pkg,0)
    AND ISNULL(RawMaterialID,0)=ISNULL(@Raw,0) AND ISNULL(VendorID,0)=ISNULL(@Vendor,0);
   IF @Inverse IS NULL OR @Inverse<=0 OR (@Reverse IS NOT NULL AND
    (@ExistingFactor<>@Inverse OR EXISTS(SELECT 1 FROM dbo.UnitConversion WHERE ID=@Reverse AND ReverseConversionID IS NOT NULL)))
    SET @Skipped+=1;
   ELSE
   BEGIN
    IF @Reverse IS NULL
    BEGIN
     INSERT dbo.UnitConversion(FromUoMID,ToUoMID,Factor,PackagingMaterialID,RawMaterialID,VendorID,Status,CreatedBy,ReverseConversionID,IsAutoGenerated)
     VALUES(@To,@From,@Inverse,@Pkg,@Raw,@Vendor,'Active',@Actor,@ID,1);
     SET @Reverse=SCOPE_IDENTITY();
    END
    ELSE UPDATE dbo.UnitConversion SET ReverseConversionID=@ID WHERE ID=@Reverse;
    UPDATE dbo.UnitConversion SET ReverseConversionID=@Reverse WHERE ID=@ID;
   END;
  END;
  FETCH NEXT FROM sources INTO @ID;
 END;
 CLOSE sources;DEALLOCATE sources;
 IF @Own=1 COMMIT;
 IF @Skipped>0 PRINT 'Reverse conversion backfill: skipped '+CONVERT(VARCHAR(20),@Skipped)+' conflicting or unrepresentable legacy directions. Existing factors were preserved.';
END TRY
BEGIN CATCH
 IF @Own=1 AND XACT_STATE()<>0 ROLLBACK;
 ELSE IF XACT_STATE()=1 ROLLBACK TRANSACTION ConversionBackfill;
 THROW;
END CATCH;
GO
CREATE OR ALTER PROCEDURE dbo.usp_UnitConversion_Save
 @Username NVARCHAR(100),@ID INT=NULL,@RowVersion VARBINARY(8)=NULL,
 @FromUoMID INT=NULL,@ToUoMID INT=NULL,@Factor DECIMAL(24,9)=NULL,
 @PackagingMaterialID INT=NULL,@RawMaterialID INT=NULL,@VendorID INT=NULL,@Status VARCHAR(10)='Active'
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT OFF;
 DECLARE @Actor INT,@Admin BIT=0,@Packaging BIT=0,@Raw BIT=0,@Own BIT=0,
  @OldFrom INT,@OldTo INT,@OldPkg INT,@OldRaw INT,@OldVendor INT,@Reverse INT,
  @Inverse DECIMAL(24,9),@ExistingFactor DECIMAL(24,9),@StoredFactor DECIMAL(24,9),
  @NewKey NVARCHAR(255),@OldKey NVARCHAR(255),@Lock1 NVARCHAR(255),@Lock2 NVARCHAR(255),@LockResult INT;
 SELECT @Actor=ID FROM dbo.Users WHERE UserName=@Username AND IsActive=1;
 IF @Actor IS NULL THROW 51101,'Username is incorrect.',1;
 SELECT @Admin=MAX(CASE WHEN Scope='Admin' THEN 1 ELSE 0 END),
  @Packaging=MAX(CASE WHEN Scope='Packaging' THEN 1 ELSE 0 END),
  @Raw=MAX(CASE WHEN Scope='RawMaterial' THEN 1 ELSE 0 END)
 FROM dbo.UserAccess WHERE UserID=@Actor;
 IF COALESCE(@Admin,0)=0 AND NOT(
  (@PackagingMaterialID IS NOT NULL AND COALESCE(@Packaging,0)=1) OR (@RawMaterialID IS NOT NULL AND COALESCE(@Raw,0)=1))
  THROW 51102,'Conversion maintenance access is required.',1;
 IF @FromUoMID IS NULL OR @ToUoMID IS NULL OR @FromUoMID=@ToUoMID OR @Factor IS NULL OR @Factor<=0
  OR @Status IS NULL OR @Status NOT IN('Active','Block')
  OR (@PackagingMaterialID IS NOT NULL AND @RawMaterialID IS NOT NULL)
  OR (@VendorID IS NOT NULL AND @PackagingMaterialID IS NULL AND @RawMaterialID IS NULL)
  THROW 51111,'Use different units, a positive factor, valid status and one material scope.',1;
 SET @Inverse=TRY_CONVERT(DECIMAL(24,9),CONVERT(DECIMAL(19,9),1)/@Factor);
 IF @Inverse IS NULL OR @Inverse<=0
  THROW 51111,'The reverse factor cannot be represented with nine decimal places. Use different units or a smaller factor.',1;
 BEGIN TRY
  IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION;SET @Own=1;END
  ELSE SAVE TRANSACTION ConversionPair;
  IF @ID IS NOT NULL
  BEGIN
   SELECT @OldFrom=FromUoMID,@OldTo=ToUoMID,@OldPkg=PackagingMaterialID,@OldRaw=RawMaterialID,@OldVendor=VendorID
   FROM dbo.UnitConversion WHERE ID=@ID;
   IF @OldFrom IS NULL THROW 51108,'Concurrency conflict. Refresh first.',1;
   SET @OldKey=CONCAT('UnitConversion:',CASE WHEN @OldFrom<@OldTo THEN @OldFrom ELSE @OldTo END,':',
    CASE WHEN @OldFrom<@OldTo THEN @OldTo ELSE @OldFrom END,':P',ISNULL(@OldPkg,0),':R',ISNULL(@OldRaw,0),':V',ISNULL(@OldVendor,0));
  END;
  SET @NewKey=CONCAT('UnitConversion:',CASE WHEN @FromUoMID<@ToUoMID THEN @FromUoMID ELSE @ToUoMID END,':',
   CASE WHEN @FromUoMID<@ToUoMID THEN @ToUoMID ELSE @FromUoMID END,':P',ISNULL(@PackagingMaterialID,0),':R',ISNULL(@RawMaterialID,0),':V',ISNULL(@VendorID,0));
  -- Opposite-direction writes take the same lock. Moving a pair locks old/new keys in a stable order.
  SET @Lock1=CASE WHEN @OldKey IS NOT NULL AND @OldKey<@NewKey THEN @OldKey ELSE @NewKey END;
  SET @Lock2=CASE WHEN @OldKey IS NOT NULL AND @OldKey<>@NewKey THEN
   CASE WHEN @OldKey<@NewKey THEN @NewKey ELSE @OldKey END END;
  EXEC @LockResult=sys.sp_getapplock @Resource=@Lock1,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
  IF @LockResult<0 THROW 51108,'Conversion is being updated. Refresh and retry.',1;
  IF @Lock2 IS NOT NULL
  BEGIN
   EXEC @LockResult=sys.sp_getapplock @Resource=@Lock2,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
   IF @LockResult<0 THROW 51108,'Conversion is being updated. Refresh and retry.',1;
  END;
  IF @ID IS NOT NULL
  BEGIN
   IF NOT EXISTS(SELECT 1 FROM dbo.UnitConversion WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@RowVersion)
    THROW 51108,'Concurrency conflict. Refresh first.',1;
   SELECT @Reverse=ReverseConversionID,@StoredFactor=Factor FROM dbo.UnitConversion WHERE ID=@ID;
   IF COALESCE(@Admin,0)=0 AND NOT(
    (@OldPkg IS NOT NULL AND COALESCE(@Packaging,0)=1) OR (@OldRaw IS NOT NULL AND COALESCE(@Raw,0)=1))
    THROW 51102,'Conversion maintenance access is required.',1;
   IF @Reverse IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.UnitConversion WITH(UPDLOCK,HOLDLOCK)
    WHERE ID=@Reverse AND ReverseConversionID=@ID AND FromUoMID=@OldTo AND ToUoMID=@OldFrom
     AND ISNULL(PackagingMaterialID,0)=ISNULL(@OldPkg,0) AND ISNULL(RawMaterialID,0)=ISNULL(@OldRaw,0)
     AND ISNULL(VendorID,0)=ISNULL(@OldVendor,0))
    THROW 51111,'Conversion pair is inconsistent. Contact an administrator.',1;
   -- A status/scope/unit edit must not invert the rounded reverse again and drift the original factor.
   IF @Reverse IS NOT NULL AND @Factor=@StoredFactor
    SELECT @Inverse=Factor FROM dbo.UnitConversion WHERE ID=@Reverse;
  END;
  IF @Status='Active'
  BEGIN
   IF (SELECT COUNT(*) FROM dbo.UoM WITH(UPDLOCK,HOLDLOCK) WHERE ID IN(@FromUoMID,@ToUoMID) AND Status='Active')<>2
    THROW 51111,'Choose two active units.',1;
   IF @PackagingMaterialID IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.PackagingMaterial WITH(HOLDLOCK) WHERE ID=@PackagingMaterialID AND Status='Active')
    THROW 51111,'Choose an active Packaging Material.',1;
   IF @RawMaterialID IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.RawMaterial WITH(HOLDLOCK) WHERE ID=@RawMaterialID AND Status='Active')
    THROW 51111,'Choose an active Raw Material.',1;
   IF @VendorID IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.Vendor WITH(HOLDLOCK) WHERE ID=@VendorID AND Status='Active')
    THROW 51111,'Choose an active Vendor.',1;
   IF @Reverse IS NULL
   BEGIN
    SELECT @Reverse=ID,@ExistingFactor=Factor FROM dbo.UnitConversion WITH(UPDLOCK,HOLDLOCK)
    WHERE FromUoMID=@ToUoMID AND ToUoMID=@FromUoMID AND Status='Active'
     AND ISNULL(PackagingMaterialID,0)=ISNULL(@PackagingMaterialID,0)
     AND ISNULL(RawMaterialID,0)=ISNULL(@RawMaterialID,0) AND ISNULL(VendorID,0)=ISNULL(@VendorID,0);
    IF @Reverse IS NOT NULL AND (@ExistingFactor<>@Inverse OR
     EXISTS(SELECT 1 FROM dbo.UnitConversion WHERE ID=@Reverse AND ReverseConversionID IS NOT NULL))
     THROW 51111,'An independent reverse conversion already exists with a different factor or pair. Edit or block it before saving.',1;
   END;
   IF EXISTS(SELECT 1 FROM dbo.UnitConversion WITH(UPDLOCK,HOLDLOCK)
    WHERE Status='Active' AND (@ID IS NULL OR ID<>@ID) AND (@Reverse IS NULL OR ID<>@Reverse)
     AND ((FromUoMID=@FromUoMID AND ToUoMID=@ToUoMID) OR (FromUoMID=@ToUoMID AND ToUoMID=@FromUoMID))
     AND ISNULL(PackagingMaterialID,0)=ISNULL(@PackagingMaterialID,0)
     AND ISNULL(RawMaterialID,0)=ISNULL(@RawMaterialID,0) AND ISNULL(VendorID,0)=ISNULL(@VendorID,0))
    THROW 51111,'An active conversion already exists for this pair and scope. Edit it instead.',1;
  END;
  -- Release the pair's filtered unique keys inside the transaction, so units can be swapped safely.
  IF @Reverse IS NOT NULL UPDATE dbo.UnitConversion SET Status='Block' WHERE ID IN(@ID,@Reverse);
  IF @ID IS NULL
  BEGIN
   INSERT dbo.UnitConversion(FromUoMID,ToUoMID,Factor,PackagingMaterialID,RawMaterialID,VendorID,Status,CreatedBy,ReverseConversionID)
   VALUES(@FromUoMID,@ToUoMID,@Factor,@PackagingMaterialID,@RawMaterialID,@VendorID,@Status,@Actor,@Reverse);
   SET @ID=SCOPE_IDENTITY();
  END
  ELSE UPDATE dbo.UnitConversion SET FromUoMID=@FromUoMID,ToUoMID=@ToUoMID,Factor=@Factor,
   PackagingMaterialID=@PackagingMaterialID,RawMaterialID=@RawMaterialID,VendorID=@VendorID,Status=@Status,
   ReverseConversionID=@Reverse,IsAutoGenerated=0,UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@Actor WHERE ID=@ID;
  IF @Reverse IS NULL
  BEGIN
   INSERT dbo.UnitConversion(FromUoMID,ToUoMID,Factor,PackagingMaterialID,RawMaterialID,VendorID,Status,CreatedBy,ReverseConversionID,IsAutoGenerated)
   VALUES(@ToUoMID,@FromUoMID,@Inverse,@PackagingMaterialID,@RawMaterialID,@VendorID,@Status,@Actor,@ID,1);
   SET @Reverse=SCOPE_IDENTITY();
   UPDATE dbo.UnitConversion SET ReverseConversionID=@Reverse WHERE ID=@ID;
  END
  ELSE UPDATE dbo.UnitConversion SET FromUoMID=@ToUoMID,ToUoMID=@FromUoMID,Factor=@Inverse,
   PackagingMaterialID=@PackagingMaterialID,RawMaterialID=@RawMaterialID,VendorID=@VendorID,Status=@Status,
   ReverseConversionID=@ID,IsAutoGenerated=1,UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@Actor WHERE ID=@Reverse;
  IF @Own=1 COMMIT;
  SELECT ID,RowVersion,ReverseConversionID FROM dbo.UnitConversion WHERE ID=@ID;
 END TRY
 BEGIN CATCH
  IF @Own=1 AND XACT_STATE()<>0 ROLLBACK;
  ELSE IF XACT_STATE()=1 ROLLBACK TRANSACTION ConversionPair;
  THROW;
 END CATCH;
END;
GO
GO
-- END MIGRATION 64_unit_conversion_bidirectional.sql

-- BEGIN MIGRATION 65_pkg_pricing_references.sql
-- SOURCE SHA256 98037dd5a7e77b5d0e1c6311bd68d552af5d6b0cf9e477f67a3bf82fb8d7e0b1
PRINT N'Applying 65_pkg_pricing_references.sql';
GO
GO
-- After 64. Preserve prior snapshots, add quote context and reusable-reference lineage.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.PkgPricingMaster','OpportunityItemID') IS NULL
 ALTER TABLE dbo.PkgPricingMaster ADD OpportunityItemID INT NULL REFERENCES dbo.OpportunityItem(ID);
IF COL_LENGTH('dbo.PkgPricingMaster','OpportunityID') IS NULL
 ALTER TABLE dbo.PkgPricingMaster ADD OpportunityID INT NULL REFERENCES dbo.Opportunity(ID);
IF COL_LENGTH('dbo.PkgPricingMaster','ProductID') IS NULL
 ALTER TABLE dbo.PkgPricingMaster ADD ProductID INT NULL REFERENCES dbo.Product(ID);
IF COL_LENGTH('dbo.PkgPricingMaster','ProductGradeVersionID') IS NULL
 ALTER TABLE dbo.PkgPricingMaster ADD ProductGradeVersionID INT NULL REFERENCES dbo.ProductGradeVersion(ID);
IF COL_LENGTH('dbo.PkgPricingMaster','ProductMixVersionID') IS NULL
 ALTER TABLE dbo.PkgPricingMaster ADD ProductMixVersionID INT NULL REFERENCES dbo.ProductMixVersion(ID);
IF COL_LENGTH('dbo.PkgPricingMaster','ProductRowVersion') IS NULL
 ALTER TABLE dbo.PkgPricingMaster ADD ProductRowVersion VARBINARY(8) NULL;
IF COL_LENGTH('dbo.PkgPricingMaster','SourcePricingMasterID') IS NULL
 ALTER TABLE dbo.PkgPricingMaster ADD SourcePricingMasterID INT NULL REFERENCES dbo.PkgPricingMaster(ID);
IF COL_LENGTH('dbo.PkgPricingMaster','ContextSnapshotJSON') IS NULL
 ALTER TABLE dbo.PkgPricingMaster ADD ContextSnapshotJSON NVARCHAR(MAX) NULL CHECK(ContextSnapshotJSON IS NULL OR ISJSON(ContextSnapshotJSON)=1);
IF COL_LENGTH('dbo.PkgPricingMaster','SnapshotJSON') IS NULL
 ALTER TABLE dbo.PkgPricingMaster ADD SnapshotJSON NVARCHAR(MAX) NULL CHECK(SnapshotJSON IS NULL OR ISJSON(SnapshotJSON)=1);
COMMIT;
GO
-- Only known historical links are backfilled. Do not invent historical product versions.
UPDATE p SET OpportunityItemID=i.OpportunityItemID,OpportunityID=h.OpportunityID,ProductID=i.ProductID
FROM dbo.PkgPricingMaster p JOIN dbo.PackagingConfigurationRequestItem i ON i.ID=p.RequestItemID
JOIN dbo.PackagingConfigurationRequest h ON h.ID=i.RequestID
WHERE p.OpportunityItemID IS NULL;
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.PkgPricingMaster') AND name='IX_PkgPricingMaster_References')
 CREATE INDEX IX_PkgPricingMaster_References ON dbo.PkgPricingMaster(PackagingOrder,PackagingTypeID,CreatedAt DESC)
 INCLUDE(RequestItemID,ProductID,SourcePricingMasterID);
GO

CREATE OR ALTER PROCEDURE dbo.usp_PkgPricing_Save
 @Username NVARCHAR(100),@ItemID INT,@ExpectedRowVersion VARBINARY(8),@Snapshot NVARCHAR(MAX)
AS
BEGIN
 SET NOCOUNT ON;
 -- Called by the API ONLY after server-side recalculation, in the response transaction.
 DECLARE @Actor INT,@Order VARCHAR(10)=JSON_VALUE(@Snapshot,'$.PackagingOrder'),
  @TypeID INT=TRY_CONVERT(INT,JSON_VALUE(@Snapshot,'$.PackagingTypeID')),
  @OpportunityItem INT,@Opportunity INT,@Product INT,@ProductRV VARBINARY(8),@GradeVersion INT,@MixVersion INT,@Reference INT,
  @TypeName NVARCHAR(100)=JSON_VALUE(@Snapshot,'$.PackagingTypeName'),@ID INT;
 EXEC dbo.usp_PkgPricing_ItemAuthorize @Username,@ItemID,1,@ExpectedRowVersion;
 SELECT @Actor=ID FROM dbo.Users WHERE UserName=@Username AND IsActive=1;
 IF ISJSON(@Snapshot)<>1 OR @Order NOT IN('Primary','Secondary') OR @TypeID IS NULL
  THROW 51111,'Invalid pricing snapshot.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.PackagingType WHERE ID=@TypeID AND Status='Active' AND PackagingOrder=@Order AND PackagingType=@TypeName)
  THROW 51111,'Choose an active Packaging Type in the matching order.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ItemID AND
  CASE @Order WHEN 'Primary' THEN FirstPMType ELSE SecondPMType END=@TypeName)
  THROW 51111,'Calculator type must match the saved response type.',1;
 SELECT @OpportunityItem=i.OpportunityItemID,@Opportunity=h.OpportunityID,@Product=i.ProductID,@ProductRV=product.RowVersion
 FROM dbo.PackagingConfigurationRequestItem i JOIN dbo.PackagingConfigurationRequest h ON h.ID=i.RequestID
 JOIN dbo.Product product ON product.ID=i.ProductID WHERE i.ID=@ItemID;
 SET @GradeVersion=TRY_CONVERT(INT,JSON_VALUE(@Snapshot,'$.Context.ProductGradeVersion.ID'));
 SET @MixVersion=TRY_CONVERT(INT,JSON_VALUE(@Snapshot,'$.Context.ProductMixVersion.ID'));
 SET @Reference=TRY_CONVERT(INT,JSON_VALUE(@Snapshot,'$.InputJSON.ReferencePricingMasterID'));
 IF @Reference IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.PkgPricingMaster WHERE ID=@Reference AND PackagingOrder=@Order)
  THROW 51111,'Invalid pricing reference.',1;
 IF NOT EXISTS(SELECT 1 FROM OPENJSON(@Snapshot,'$.components'))
  THROW 51111,'Select at least one component.',1;
 UPDATE dbo.PkgPricingMaster SET IsCurrent=0 WHERE RequestItemID=@ItemID AND PackagingOrder=@Order AND IsCurrent=1;
 INSERT dbo.PkgPricingMaster(RequestItemID,PackagingOrder,PackagingTypeID,PackagingTypeName,AsOfDate,FinalMOQ,UnitPrice,CurrencyID,CurrencyCode,UnitUSDPrice,Fingerprint,InputJSON,CreatedBy,OpportunityItemID,OpportunityID,ProductID,ProductRowVersion,ProductGradeVersionID,ProductMixVersionID,SourcePricingMasterID,ContextSnapshotJSON,SnapshotJSON)
 SELECT @ItemID,@Order,@TypeID,@TypeName,AsOfDate,FinalMOQ,UnitPrice,CurrencyID,CurrencyCode,UnitUSDPrice,Fingerprint,InputJSON,@Actor,@OpportunityItem,@Opportunity,@Product,@ProductRV,@GradeVersion,@MixVersion,@Reference,JSON_QUERY(@Snapshot,'$.Context'),@Snapshot
 FROM OPENJSON(@Snapshot) WITH(AsOfDate DATE,FinalMOQ DECIMAL(18,0),UnitPrice DECIMAL(28,9),CurrencyID INT,CurrencyCode NVARCHAR(20),UnitUSDPrice DECIMAL(28,9),Fingerprint CHAR(64),InputJSON NVARCHAR(MAX) AS JSON);
 SET @ID=SCOPE_IDENTITY();
 INSERT dbo.PkgPricingComponent(PricingMasterID,LineNumber,MaterialID,PackagingPriceID,DimensionID,QuantityPerProduct,AreaPerMaterial,BaseUnitsPerPriceUnit,PriceUnitsPerProduct,VendorMOQ,ProductMOQ,ProductUnitPrice,CurrencyID,ProductUnitUSDPrice,SnapshotJSON)
 SELECT @ID,CONVERT(INT,j.[key])+1,c.MaterialID,c.PriceID,c.DimensionID,c.Quantity,c.Area,c.Factor,c.Consumption,c.VendorMOQ,c.ProductMOQ,c.ProductUnitPrice,c.CurrencyID,c.ProductUnitUSDPrice,j.value
 FROM OPENJSON(@Snapshot,'$.components') j CROSS APPLY OPENJSON(j.value) WITH(MaterialID INT,PriceID INT,DimensionID INT,Quantity DECIMAL(18,6),Area DECIMAL(28,9),Factor DECIMAL(24,9),Consumption DECIMAL(28,12),VendorMOQ DECIMAL(18,4),ProductMOQ DECIMAL(18,0),ProductUnitPrice DECIMAL(28,9),CurrencyID INT,ProductUnitUSDPrice DECIMAL(28,9)) c;
 -- Keep a lightweight reference in the request's normal change log.
 INSERT dbo.PackagingRequestChangeLog(EventID,RequestID,EntityLevel,ItemID,ItemLabel,Action,FieldName,OldValue,NewValue,ChangedBy,Source,IsResponse)
 SELECT NEWID(),RequestID,'Item',ID,ProductCode,'Update',@Order+'Pricing',NULL,
  CONCAT('Pricing #',@ID,': MOQ ',JSON_VALUE(@Snapshot,'$.FinalMOQ'),', unit price ',JSON_VALUE(@Snapshot,'$.UnitPrice'),' ',JSON_VALUE(@Snapshot,'$.CurrencyCode')),@Username,'User',1
 FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ItemID;
END;
GO
GO
-- END MIGRATION 65_pkg_pricing_references.sql

-- BEGIN MIGRATION 66_packaging_type_orders.sql
-- SOURCE SHA256 22eb7d03943e2c7c5b36bd5ab018d1e3b8d63bd687bdf815745e9341b81a3b96
PRINT N'Applying 66_packaging_type_orders.sql';
GO
GO
-- After 65. One type may serve Primary, Secondary and/or Tertiary.
-- Retain the legacy single Order and existing IDs; do not merge historical types.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF OBJECT_ID('dbo.CK_PackagingType_Order','C') IS NOT NULL
 ALTER TABLE dbo.PackagingType DROP CONSTRAINT CK_PackagingType_Order;
ALTER TABLE dbo.PackagingType WITH CHECK ADD CONSTRAINT CK_PackagingType_Order
 CHECK(PackagingOrder COLLATE Latin1_General_100_BIN2 IN(N'Primary',N'Secondary',N'Tertiary'));
IF OBJECT_ID('dbo.PackagingTypeOrder','U') IS NULL
 CREATE TABLE dbo.PackagingTypeOrder(
  PackagingTypeID INT NOT NULL REFERENCES dbo.PackagingType(ID),
  PackagingOrder NVARCHAR(9) NOT NULL,
  CONSTRAINT PK_PackagingTypeOrder PRIMARY KEY(PackagingTypeID,PackagingOrder),
  CONSTRAINT CK_PackagingTypeOrder_Order CHECK(PackagingOrder COLLATE Latin1_General_100_BIN2 IN(N'Primary',N'Secondary',N'Tertiary'))
 );
INSERT dbo.PackagingTypeOrder(PackagingTypeID,PackagingOrder)
 SELECT ID,PackagingOrder FROM dbo.PackagingType p
 WHERE NOT EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder o WHERE o.PackagingTypeID=p.ID);
COMMIT;
GO
CREATE OR ALTER TRIGGER dbo.tr_PackagingType_DefaultOrder
ON dbo.PackagingType AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 -- Preserve old SQL/Excel inserts. The batch below owns explicit multi-order changes.
 INSERT dbo.PackagingTypeOrder(PackagingTypeID,PackagingOrder)
 SELECT i.ID,i.PackagingOrder FROM inserted i
 WHERE NOT EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder o WHERE o.PackagingTypeID=i.ID AND o.PackagingOrder=i.PackagingOrder);
END;
GO
CREATE OR ALTER VIEW dbo.v_PackagingTypeWeb AS
 SELECT p.*,o.PackagingOrdersJSON,
  CONVERT(BIT,CASE WHEN EXISTS(SELECT 1 FROM dbo.PackagingType c WHERE c.ParentTypeID=p.ID) THEN 1 ELSE 0 END) HasChildren
 FROM dbo.PackagingType p CROSS APPLY(
  SELECT N'["'+STRING_AGG(CONVERT(NVARCHAR(MAX),PackagingOrder),N'","') WITHIN GROUP(
   ORDER BY CASE PackagingOrder WHEN 'Primary' THEN 1 WHEN 'Secondary' THEN 2 ELSE 3 END)+N'"]' PackagingOrdersJSON
  FROM dbo.PackagingTypeOrder WHERE PackagingTypeID=p.ID) o;
GO

CREATE OR ALTER PROCEDURE dbo.usp_PackagingType_Batch
 @Rows NVARCHAR(MAX),@Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT OFF;
 DECLARE @Actor INT;
 EXEC dbo.usp_Packaging_Authorize @Username,'Maintain',@Actor OUTPUT;
 IF ISJSON(@Rows)<>1 OR LEFT(LTRIM(@Rows),1)<>'[' THROW 51105,'A JSON array of rows is required.',1;
 DECLARE @Input TABLE(RowNum INT,Command VARCHAR(10),ID INT,RowVersion VARBINARY(8),
  PackagingOrder NVARCHAR(4000),PackagingType NVARCHAR(4000),PriceBasis NVARCHAR(4000),Status VARCHAR(20),ParentTypeID INT,ParentTypeSet BIT,PackagingOrders NVARCHAR(MAX),OrdersSet BIT);
 INSERT @Input SELECT RowNum,Command,ID,TRY_CONVERT(VARBINARY(8),RowVersionHex,1),PackagingOrder,PackagingType,PriceBasis,Status,ParentTypeID,
  CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(r.value) WHERE [key]='ParentTypeID') THEN 1 ELSE 0 END,PackagingOrders,CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(r.value) WHERE [key]='PackagingOrders') THEN 1 ELSE 0 END
 FROM OPENJSON(@Rows) r CROSS APPLY OPENJSON(r.value) WITH(RowNum INT,Command VARCHAR(10),ID INT,RowVersionHex VARCHAR(100),
  PackagingOrder NVARCHAR(4000),PackagingType NVARCHAR(4000),PriceBasis NVARCHAR(4000),Status VARCHAR(20),ParentTypeID INT,PackagingOrders NVARCHAR(MAX) AS JSON);
 IF (SELECT COUNT(*) FROM @Input) NOT BETWEEN 1 AND 500 THROW 51105,'Use 1 to 500 rows per batch.',1;
 IF EXISTS(SELECT RowNum FROM @Input GROUP BY RowNum HAVING COUNT(*)>1)
  OR EXISTS(SELECT ID FROM @Input WHERE ID IS NOT NULL GROUP BY ID HAVING COUNT(*)>1)
  THROW 51106,'Duplicate row numbers or record IDs.',1;
 DECLARE @Result TABLE(RowNum INT,Status VARCHAR(10),Message NVARCHAR(2048),NewID INT,NewRowVersion VARBINARY(8));
 DECLARE @Row INT,@Cmd VARCHAR(10),@ID INT,@RV VARBINARY(8),@Order NVARCHAR(4000),@Name NVARCHAR(4000),
  @Basis NVARCHAR(4000),@Status VARCHAR(20),@Own BIT,@Parent INT,@ParentSet BIT,@Ancestor INT,@Lock INT,@Orders NVARCHAR(MAX),@OrdersSet BIT;
 DECLARE @ChosenOrders TABLE(PackagingOrder NVARCHAR(9) PRIMARY KEY);
 DECLARE @Visited TABLE(ID INT PRIMARY KEY);
 DECLARE c CURSOR LOCAL FAST_FORWARD FOR
  SELECT RowNum,Command,ID,RowVersion,PackagingOrder,PackagingType,PriceBasis,Status,ParentTypeID,ParentTypeSet,PackagingOrders,OrdersSet FROM @Input ORDER BY RowNum;
 OPEN c; FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@RV,@Order,@Name,@Basis,@Status,@Parent,@ParentSet,@Orders,@OrdersSet;
 WHILE @@FETCH_STATUS=0
 BEGIN
  SET @Own=0;
  BEGIN TRY
   IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION; SET @Own=1; END ELSE SAVE TRANSACTION PackagingTypeRow;
   EXEC @Lock=sys.sp_getapplock @Resource=N'PackagingTypeHierarchy',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
   IF @Lock<0 THROW 51108,'Packaging Type hierarchy is busy. Try again.',1;
   IF @Row IS NULL OR @Row<1 OR @Cmd IS NULL OR @Cmd NOT IN('C','U','D') THROW 51107,'Use a positive row number and C, U or D.',1;
   IF @Cmd='C' AND (@ID IS NOT NULL OR @RV IS NOT NULL) THROW 51107,'Create cannot have an ID or RowVersion.',1;
   IF @Cmd IN('U','D') AND NOT EXISTS(SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@RV)
    THROW 51108,'Concurrency conflict or row not found. Refresh first.',1;
   IF @Cmd<>'D'
   BEGIN
    IF @Cmd='U' AND COALESCE(@ParentSet,0)=0
     SELECT @Parent=ParentTypeID FROM dbo.PackagingType WHERE ID=@ID;
    IF @Parent IS NOT NULL
    BEGIN
     IF NOT EXISTS(SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK) WHERE ID=@Parent
      AND (Status='Active' OR (@Cmd='U' AND EXISTS(SELECT 1 FROM dbo.PackagingType WHERE ID=@ID AND ParentTypeID=@Parent))))
      THROW 51111,'Choose an active Parent Type from Packaging Type Master.',1;
     DELETE @Visited;
     SET @Ancestor=@Parent;
     WHILE @Ancestor IS NOT NULL
     BEGIN
      IF @Ancestor=@ID OR EXISTS(SELECT 1 FROM @Visited WHERE ID=@Ancestor)
       THROW 51111,'Parent Type cannot be this type or one of its descendants.',1;
      INSERT @Visited VALUES(@Ancestor);
      SELECT @Ancestor=ParentTypeID FROM dbo.PackagingType WHERE ID=@Ancestor;
     END;
    END;

    SET @Name=NULLIF(LTRIM(RTRIM(@Name)),N'');
    DELETE @ChosenOrders;
    IF @OrdersSet=1
    BEGIN
     IF ISJSON(@Orders)<>1 OR LEFT(LTRIM(@Orders),1)<>'[' OR (SELECT COUNT(*) FROM OPENJSON(@Orders)) NOT BETWEEN 1 AND 3
      THROW 51111,'Select one to three packaging orders.',1;
     IF EXISTS(SELECT 1 FROM OPENJSON(@Orders) WHERE [type]<>1 OR [value] COLLATE Latin1_General_100_BIN2 NOT IN(N'Primary',N'Secondary',N'Tertiary'))
      OR EXISTS(SELECT [value] FROM OPENJSON(@Orders) GROUP BY [value] HAVING COUNT(*)>1)
      THROW 51111,'Choose distinct Primary, Secondary or Tertiary orders.',1;
     INSERT @ChosenOrders SELECT [value] FROM OPENJSON(@Orders);
     SELECT TOP(1) @Order=PackagingOrder FROM @ChosenOrders ORDER BY CASE PackagingOrder WHEN 'Primary' THEN 1 WHEN 'Secondary' THEN 2 ELSE 3 END;
    END
    ELSE
    BEGIN
     IF @Order IS NULL OR @Order COLLATE Latin1_General_100_BIN2 NOT IN(N'Primary',N'Secondary',N'Tertiary')
      THROW 51111,'Choose Primary, Secondary or Tertiary for Order.',1;
     IF @Cmd='U' AND EXISTS(SELECT 1 FROM dbo.PackagingType WHERE ID=@ID AND PackagingOrder=@Order)
      INSERT @ChosenOrders SELECT PackagingOrder FROM dbo.PackagingTypeOrder WHERE PackagingTypeID=@ID;
     IF NOT EXISTS(SELECT 1 FROM @ChosenOrders) INSERT @ChosenOrders VALUES(@Order);
    END;
    IF @Basis IS NULL OR @Basis COLLATE Latin1_General_100_BIN2 NOT IN(N'Count',N'Square meter',N'Volume')
     THROW 51111,'Choose Count, Square meter or Volume for Price Basis.',1;
    IF @Name IS NULL OR LEN(@Name)>100 THROW 51111,'Packaging Type is required (maximum 100 characters).',1;
    IF @Cmd='U' AND @Status IS NULL SELECT @Status=Status FROM dbo.PackagingType WHERE ID=@ID;
    SET @Status=COALESCE(@Status,'Active');
    IF @Status NOT IN('Active','Block') THROW 51109,'Status must be Active or Block.',1;
    IF EXISTS(SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK)
     WHERE PackagingType=@Name AND EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder o JOIN @ChosenOrders c ON c.PackagingOrder=o.PackagingOrder WHERE o.PackagingTypeID=dbo.PackagingType.ID) AND (@Cmd='C' OR ID<>@ID))
     THROW 51111,'This Packaging Type already exists for this Order. Edit the existing record instead.',1;
   END;
   IF @Cmd='C'
    INSERT dbo.PackagingType(PackagingOrder,PackagingType,PriceBasis,TareWeight,Status,CreatedBy,ParentTypeID)
    OUTPUT @Row,'OK','Created',inserted.ID,inserted.RowVersion INTO @Result VALUES(@Order,@Name,@Basis,0,@Status,@Actor,@Parent);
   ELSE IF @Cmd='D'
    UPDATE dbo.PackagingType SET Status='Block',UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@Actor
    OUTPUT @Row,'OK','Blocked',inserted.ID,inserted.RowVersion INTO @Result WHERE ID=@ID AND RowVersion=@RV;
   ELSE
    UPDATE dbo.PackagingType SET PackagingOrder=@Order,PackagingType=@Name,PriceBasis=@Basis,
     ParentTypeID=@Parent,Status=@Status,UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@Actor
    OUTPUT @Row,'OK','Updated',inserted.ID,inserted.RowVersion INTO @Result WHERE ID=@ID AND RowVersion=@RV;
   IF @Cmd<>'D'
   BEGIN
    SELECT @ID=NewID FROM @Result WHERE RowNum=@Row;
    DELETE dbo.PackagingTypeOrder WHERE PackagingTypeID=@ID;
    INSERT dbo.PackagingTypeOrder SELECT @ID,PackagingOrder FROM @ChosenOrders;
   END;
   IF @Own=1 COMMIT;
  END TRY
  BEGIN CATCH
   IF @Own=1 AND XACT_STATE()<>0 ROLLBACK;
   ELSE IF XACT_STATE()=1 ROLLBACK TRANSACTION PackagingTypeRow;
   ELSE IF XACT_STATE()=-1 THROW;
   DELETE @Result WHERE RowNum=@Row;
   INSERT @Result VALUES(@Row,'ERROR',ERROR_MESSAGE(),@ID,NULL);
  END CATCH;
  FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@RV,@Order,@Name,@Basis,@Status,@Parent,@ParentSet,@Orders,@OrdersSet;
 END;
 CLOSE c; DEALLOCATE c;
 SELECT * FROM @Result ORDER BY RowNum;
END;
GO

GO
-- Serialize new material assignments with hierarchy maintenance; allow unchanged
-- historical parent assignments on unrelated edits, never offer new ones.
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingMaterial_BatchV2'));
IF @D IS NULL THROW 52970,'Run material type migration 53 first.',1;
IF CHARINDEX(N'non-parent Packaging Type',@D)=0
BEGIN
 SET @D=REPLACE(@D,N'IF @Command NOT IN',N'DECLARE @HierarchyLock INT;
 EXEC @HierarchyLock=sys.sp_getapplock @Resource=N''PackagingTypeHierarchy'',@LockMode=''Exclusive'',@LockOwner=''Transaction'',@LockTimeout=10000;
 IF @HierarchyLock<0 THROW 51108,''Packaging Type hierarchy is busy. Try again.'',1;
 IF @Command NOT IN');
 SET @D=REPLACE(@D,N'IF @Command=''U'' AND @Status IS NULL',N'IF @TypeID IS NOT NULL AND EXISTS(SELECT 1 FROM dbo.PackagingType WHERE ParentTypeID=@TypeID)
 AND NOT(@Command=''U'' AND EXISTS(SELECT 1 FROM dbo.PackagingMaterial WHERE ID=@ID AND PackagingTypeID=@TypeID))
 THROW 51111,''Choose an active non-parent Packaging Type.'',1;
 IF @Command=''U'' AND @Status IS NULL');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
GO
-- END MIGRATION 66_packaging_type_orders.sql

-- BEGIN MIGRATION 67_packaging_layers.sql
-- SOURCE SHA256 339569a9bfce2e1bf30867301a858d2a497a4ff4cb63e81dc010158d3127e802
PRINT N'Applying 67_packaging_layers.sql';
GO
GO
-- After 66. Cumulative 1..3 packaging layers, frozen requests, independent responses.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.OpportunityItem','PackagingLayerCount') IS NULL
 ALTER TABLE dbo.OpportunityItem ADD PackagingLayerCount INT NOT NULL CONSTRAINT DF_OpportunityItem_PackagingLayers DEFAULT(2) WITH VALUES,
 TertiaryTypeID INT NULL REFERENCES dbo.PackagingType(ID),TertiaryTransparency NVARCHAR(100) NULL,NumberOfSecondary INT NULL;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','RequestedLayerCount') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD RequestedLayerCount INT NOT NULL CONSTRAINT DF_PackagingRequestItem_Layers DEFAULT(2) WITH VALUES,
 ResponseLayerCount INT NULL,TertiaryTypeID INT NULL,TertiaryTypeName NVARCHAR(100) NULL,TertiaryTransparency NVARCHAR(100) NULL,NumberOfSecondary INT NULL,
 ThirdPMType NVARCHAR(100) NULL,ThirdPMMOQ DECIMAL(18,4) NULL,UnitsPerTertiary INT NULL;
GO
IF OBJECT_ID('dbo.CK_OpportunityItem_PackagingLayers','C') IS NULL
 ALTER TABLE dbo.OpportunityItem ADD CONSTRAINT CK_OpportunityItem_PackagingLayers CHECK(PackagingLayerCount BETWEEN 1 AND 3),
 CONSTRAINT CK_OpportunityItem_TertiaryTransparency CHECK(TertiaryTransparency IN(N'Transparent',N'Opaque',N'NA')),
 CONSTRAINT CK_OpportunityItem_NumberOfSecondary CHECK(NumberOfSecondary>=1);
IF OBJECT_ID('dbo.CK_PackagingRequestItem_Layers','C') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD CONSTRAINT CK_PackagingRequestItem_Layers CHECK(RequestedLayerCount BETWEEN 1 AND 3 AND (ResponseLayerCount IS NULL OR ResponseLayerCount BETWEEN 1 AND 3)),
 CONSTRAINT CK_PackagingRequestItem_ThirdMOQ CHECK(ThirdPMMOQ>=0),
 CONSTRAINT CK_PackagingRequestItem_TertiaryUnits CHECK(UnitsPerTertiary>=1),
 CONSTRAINT CK_PackagingRequestItem_NumberOfSecondary CHECK(NumberOfSecondary>=1),
 CONSTRAINT CK_PackagingRequestItem_TertiaryTransparency CHECK(TertiaryTransparency IN(N'Transparent',N'Opaque',N'NA'));
DECLARE @Name SYSNAME,@DDL NVARCHAR(MAX);
DECLARE checks_cursor CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM sys.check_constraints
 WHERE parent_object_id=OBJECT_ID('dbo.PkgPricingMaster') AND definition LIKE '%PackagingOrder%';
OPEN checks_cursor;FETCH NEXT FROM checks_cursor INTO @Name;
WHILE @@FETCH_STATUS=0 BEGIN
 SET @DDL=N'ALTER TABLE dbo.PkgPricingMaster DROP CONSTRAINT '+QUOTENAME(@Name);EXEC sys.sp_executesql @DDL;
 FETCH NEXT FROM checks_cursor INTO @Name;
END;
CLOSE checks_cursor;DEALLOCATE checks_cursor;
ALTER TABLE dbo.PkgPricingMaster WITH CHECK ADD CONSTRAINT CK_PkgPricingMaster_Order CHECK(PackagingOrder IN('Primary','Secondary','Tertiary'));
COMMIT;
GO
CREATE OR ALTER PROCEDURE dbo.usp_OpportunityPackagingTypeLookup_Read @Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
  WHERE u.UserName=@Username AND u.IsActive=1 AND a.Scope IN(N'Admin',N'Opportunity'))
  THROW 51042,'Opportunity access is required for this action.',1;
 SELECT ID,PackagingOrder,PackagingOrdersJSON,PackagingType,ParentTypeID,Status FROM dbo.v_PackagingTypeWeb
 WHERE ParentTypeID IS NULL AND Status='Active' ORDER BY PackagingOrder,PackagingType,ID;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingResponseTypeLookup_Read @Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON;DECLARE @Actor INT;
 EXEC dbo.usp_Packaging_Authorize @Username,'MasterRead',@Actor OUTPUT;
 SELECT ID,PackagingOrder,PackagingOrdersJSON,PackagingType,ParentTypeID FROM dbo.v_PackagingTypeWeb
 WHERE Status='Active' ORDER BY PackagingOrder,PackagingType,ID;
END;
GO

CREATE OR ALTER PROCEDURE dbo.usp_OpportunityItem_Fields_Save
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
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] NOT IN('PalletSize','PalletStacking','MaxPalletHeightM','ContainerRequest','ConfigurationRequest','PackagingType','RecyclableRequirement','RecycledContent','Transparency','MetalizedAluminum','SpecialComments','PrimaryTypeID','SecondaryTypeID','SecondaryTransparency','NumberOfPrimary','WebPackagingRequirements','PackagingLayerCount','TertiaryTypeID','TertiaryTransparency','NumberOfSecondary'))
  THROW 52957,'Unknown additional field.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.OpportunityItem WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@ExpectedRowVersion)
  THROW 52958,'Concurrency conflict. Refresh before saving.',1;
 IF EXISTS(SELECT 1 FROM dbo.OpportunityItem i JOIN dbo.Opportunity o ON o.ID=i.OpportunityID WHERE i.ID=@ID AND (i.Stage<>'Draft' OR o.Stage<>'Draft'))
  THROW 52960,'Only Draft Opportunity items can be edited.',1;
 -- Parent-only logistics: preserve the established mix-child restriction.
 IF EXISTS(SELECT 1 FROM dbo.OpportunityItem WHERE ID=@ID AND ParentItemID IS NOT NULL)
  AND EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] IN('PalletSize','PalletStacking','MaxPalletHeightM','ContainerRequest'))
  THROW 52960,'Pallet and Container requirements belong to the parent item only.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] IN('PrimaryTypeID','SecondaryTypeID','TertiaryTypeID','NumberOfPrimary','NumberOfSecondary') AND [type]<>0
  AND ([type] NOT IN(1,2) OR [value] LIKE '%[^0-9]%' OR TRY_CONVERT(INT,[value]) IS NULL OR TRY_CONVERT(INT,[value])<1))
  THROW 52957,'Type IDs and Number of Primary must be positive whole numbers.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='SecondaryTransparency' AND [type]<>0
  AND ([type]<>1 OR [value] COLLATE Latin1_General_100_BIN2 NOT IN(N'Transparent',N'Opaque',N'NA')))
  THROW 52957,'Choose Transparent, Opaque or NA for Secondary transparency.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] IN('PrimaryTypeID','SecondaryTypeID','TertiaryTypeID') AND [type]<>0
  AND NOT EXISTS(SELECT 1 FROM dbo.PackagingType p WITH(UPDLOCK,HOLDLOCK) WHERE p.ID=TRY_CONVERT(INT,[value])
   AND ((p.Status='Active' AND p.ParentTypeID IS NULL AND EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder o WHERE o.PackagingTypeID=p.ID AND o.PackagingOrder=CASE [key] WHEN 'PrimaryTypeID' THEN 'Primary' WHEN 'SecondaryTypeID' THEN 'Secondary' ELSE 'Tertiary' END))
    OR EXISTS(SELECT 1 FROM dbo.OpportunityItem i WHERE i.ID=@ID AND CASE [key] WHEN 'PrimaryTypeID' THEN i.PrimaryTypeID WHEN 'SecondaryTypeID' THEN i.SecondaryTypeID ELSE i.TertiaryTypeID END=p.ID))))
  THROW 52957,'Choose an active top-level Packaging Type with the matching Order.',1;
 DECLARE @Layers INT;
 SELECT @Layers=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='PackagingLayerCount')
  THEN TRY_CONVERT(INT,JSON_VALUE(@Fields,'$.PackagingLayerCount')) ELSE PackagingLayerCount END FROM dbo.OpportunityItem WHERE ID=@ID;
 IF @Layers IS NULL OR @Layers NOT BETWEEN 1 AND 3 OR EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='PackagingLayerCount'
  AND ([type] NOT IN(1,2) OR [value] LIKE '%[^0-9]%'))
  THROW 52957,'Packaging layers must be 1, 2 or 3.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) j WHERE j.[key]='TertiaryTransparency' AND j.[type]<>0
  AND (j.[type]<>1 OR j.[value] COLLATE Latin1_General_100_BIN2 NOT IN(N'Transparent',N'Opaque',N'NA')))
  THROW 52957,'Choose Transparent, Opaque or NA for Tertiary transparency.',1;

 DECLARE @Web BIT=CASE WHEN JSON_VALUE(@Fields,'$.WebPackagingRequirements')='true' THEN 1 ELSE 0 END,@Configuration NVARCHAR(500);
 SELECT @Configuration=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='ConfigurationRequest')
  THEN NULLIF(LTRIM(RTRIM(JSON_VALUE(@Fields,'$.ConfigurationRequest'))),N'') ELSE ConfigurationRequest END FROM dbo.OpportunityItem WHERE ID=@ID;
 IF @Web=1
 BEGIN
  IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) j WHERE j.[key] IN('ContainerRequest','ConfigurationRequest','PalletStacking','Transparency')
   AND j.[type]<>0 AND NOT(
    (j.[key]='ContainerRequest' AND j.[value] COLLATE Latin1_General_100_BIN2 IN(N'Dry',N'Reefer')) OR
    (j.[key]='ConfigurationRequest' AND j.[value] COLLATE Latin1_General_100_BIN2 IN(N'Pallet load',N'Floor load',N'Both')) OR
    (j.[key]='PalletStacking' AND j.[value] COLLATE Latin1_General_100_BIN2 IN(N'Single',N'Double')) OR
    (j.[key]='Transparency' AND j.[value] COLLATE Latin1_General_100_BIN2 IN(N'Transparent',N'Opaque',N'NA')) OR
    EXISTS(SELECT 1 FROM dbo.OpportunityItem i WHERE i.ID=@ID AND
     CONVERT(VARBINARY(MAX),j.[value])=CONVERT(VARBINARY(MAX),CASE j.[key] WHEN 'ContainerRequest' THEN i.ContainerRequest WHEN 'ConfigurationRequest' THEN i.ConfigurationRequest WHEN 'PalletStacking' THEN i.PalletStacking ELSE i.Transparency END))))
   THROW 52957,'Choose valid Container, Configuration, Pallet stacking and Primary transparency options.',1;
  IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) j WHERE j.[key]='PalletSize' AND j.[type]<>0
   AND NOT EXISTS(SELECT 1 FROM dbo.v_PalletMaster p JOIN dbo.UoM u ON u.ID=p.UoMID WHERE p.PalletSize=j.[value] AND p.Status='Active' AND u.Status='Active')
   AND NOT EXISTS(SELECT 1 FROM dbo.OpportunityItem i WHERE i.ID=@ID AND i.PalletSize=j.[value]))
   THROW 52957,'Choose an active pallet size from Pallet Master.',1;
 END;
 DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeUser'),@OldSource SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeSource');
 BEGIN TRY
  EXEC sys.sp_set_session_context N'OpportunityChangeUser',@Username;
  EXEC sys.sp_set_session_context N'OpportunityChangeSource',N'User';
  IF EXISTS(SELECT 1 FROM OPENJSON(@Fields))
  UPDATE t SET
   PalletSize=CASE WHEN @Web=1 AND @Configuration='Floor load' THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='PalletSize') THEN NULLIF(LTRIM(RTRIM(j.PalletSize)),N'') ELSE t.PalletSize END,
   PalletStacking=CASE WHEN @Web=1 AND @Configuration='Floor load' THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='PalletStacking') THEN NULLIF(LTRIM(RTRIM(j.PalletStacking)),N'') ELSE t.PalletStacking END,
   MaxPalletHeightM=CASE WHEN @Web=1 AND @Configuration='Floor load' THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='MaxPalletHeightM') THEN j.MaxPalletHeightM ELSE t.MaxPalletHeightM END,
   ContainerRequest=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='ContainerRequest') THEN NULLIF(LTRIM(RTRIM(j.ContainerRequest)),N'') ELSE t.ContainerRequest END,
   ConfigurationRequest=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='ConfigurationRequest') THEN NULLIF(LTRIM(RTRIM(j.ConfigurationRequest)),N'') ELSE t.ConfigurationRequest END,
   PackagingType=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='PackagingType') THEN NULLIF(LTRIM(RTRIM(j.PackagingType)),N'') ELSE t.PackagingType END,
   RecyclableRequirement=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='RecyclableRequirement') THEN NULLIF(LTRIM(RTRIM(j.RecyclableRequirement)),N'') ELSE t.RecyclableRequirement END,
   RecycledContent=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='RecycledContent') THEN NULLIF(LTRIM(RTRIM(j.RecycledContent)),N'') ELSE t.RecycledContent END,
   Transparency=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='Transparency') THEN NULLIF(LTRIM(RTRIM(j.Transparency)),N'') ELSE t.Transparency END,
   MetalizedAluminum=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='MetalizedAluminum') THEN NULLIF(LTRIM(RTRIM(j.MetalizedAluminum)),N'') ELSE t.MetalizedAluminum END,
   SpecialComments=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='SpecialComments') THEN NULLIF(LTRIM(RTRIM(j.SpecialComments)),N'') ELSE t.SpecialComments END,
   PackagingLayerCount=@Layers,
   TertiaryTypeID=CASE WHEN @Layers<3 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='TertiaryTypeID') THEN j.TertiaryTypeID ELSE t.TertiaryTypeID END,
   TertiaryTransparency=CASE WHEN @Layers<3 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='TertiaryTransparency') THEN j.TertiaryTransparency ELSE t.TertiaryTransparency END,
   NumberOfSecondary=CASE WHEN @Layers<3 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='NumberOfSecondary') THEN j.NumberOfSecondary ELSE t.NumberOfSecondary END,
   PrimaryTypeID=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='PrimaryTypeID') THEN j.PrimaryTypeID ELSE t.PrimaryTypeID END,
   SecondaryTypeID=CASE WHEN @Layers<2 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='SecondaryTypeID') THEN j.SecondaryTypeID ELSE t.SecondaryTypeID END,
   SecondaryTransparency=CASE WHEN @Layers<2 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='SecondaryTransparency') THEN j.SecondaryTransparency ELSE t.SecondaryTransparency END,
   NumberOfPrimary=CASE WHEN @Layers<2 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='NumberOfPrimary') THEN j.NumberOfPrimary ELSE t.NumberOfPrimary END,
   UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()
  FROM dbo.OpportunityItem t CROSS APPLY OPENJSON(@Fields) WITH(
   PalletSize NVARCHAR(100),PalletStacking NVARCHAR(100),MaxPalletHeightM DECIMAL(9,3),ContainerRequest NVARCHAR(200),
   ConfigurationRequest NVARCHAR(500),PackagingType NVARCHAR(100),RecyclableRequirement NVARCHAR(200),RecycledContent NVARCHAR(200),
   Transparency NVARCHAR(100),MetalizedAluminum NVARCHAR(100),SpecialComments NVARCHAR(1000),
   PrimaryTypeID INT,SecondaryTypeID INT,SecondaryTransparency NVARCHAR(100),NumberOfPrimary INT,TertiaryTypeID INT,TertiaryTransparency NVARCHAR(100),NumberOfSecondary INT) j
  WHERE t.ID=@ID AND t.RowVersion=@ExpectedRowVersion;
  EXEC sys.sp_set_session_context N'OpportunityChangeUser',@OldUser;
  EXEC sys.sp_set_session_context N'OpportunityChangeSource',@OldSource;
 END TRY
 BEGIN CATCH
  EXEC sys.sp_set_session_context N'OpportunityChangeUser',@OldUser;
  EXEC sys.sp_set_session_context N'OpportunityChangeSource',@OldSource;
  THROW;
 END CATCH;
 SELECT RowVersion FROM dbo.OpportunityItem WHERE ID=@ID;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation
 @Username NVARCHAR(100),@ID INT,@ExpectedRowVersion VARBINARY(8),@Fields NVARCHAR(MAX),@IsCreate BIT=0
AS
BEGIN
 SET NOCOUNT ON;
 IF @@TRANCOUNT=0 THROW 52956,'Additional fields must be saved inside the document transaction.',1;
 DECLARE @Actor INT,@Admin BIT=0;
 SELECT @Actor=u.ID FROM dbo.Users u WHERE u.UserName=@Username AND u.IsActive=1;
 IF @Actor IS NULL THROW 52953,'Username is incorrect.',1;
 IF EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope='Admin') SET @Admin=1;
 IF @Admin=0 AND NOT EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope='Packaging')
 THROW 52954,'Packaging access is required for this action.',1;
 IF ISJSON(@Fields)<>1 THROW 52957,'Invalid additional fields.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] NOT IN('FirstPMType','SecondPMType','ThirdPMType','UnitsPerCarton','PackagingDescription','FirstPMMOQ','SecondPMMOQ','CartonsPerLayer','LayersPerPallet','PacksPerPallet','CartonsPerContainer','NutDensity','ResponseLayerCount','ThirdPMType','ThirdPMMOQ','UnitsPerTertiary'))
 THROW 52957,'Unknown additional field.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@ExpectedRowVersion)
 THROW 52958,'Concurrency conflict. Refresh before saving.',1;
 
 
 
 IF NOT EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ID AND Stage IN('Assigned','Working','Returned') AND (@Admin=1 OR PICUserID=@Actor))
 THROW 52960,'Only the assigned PIC or Admin can edit an unlocked response.',1;

 -- New selections must be active types in the matching order. Unchanged legacy
 -- selections remain valid so unrelated edits do not rewrite historical data.
 IF EXISTS(
  SELECT 1 FROM OPENJSON(@Fields) j
  JOIN dbo.PackagingConfigurationRequestItem i ON i.ID=@ID
  CROSS APPLY(SELECT NULLIF(LTRIM(RTRIM(j.value)),N'') NewType,
   CASE j.[key] WHEN 'FirstPMType' THEN i.FirstPMType WHEN 'SecondPMType' THEN i.SecondPMType ELSE i.ThirdPMType END OldType,
   CASE j.[key] WHEN 'FirstPMType' THEN N'Primary' WHEN 'SecondPMType' THEN N'Secondary' ELSE N'Tertiary' END PackagingOrder) v
  WHERE j.[key] IN('FirstPMType','SecondPMType','ThirdPMType') AND v.NewType IS NOT NULL
  AND (v.OldType IS NULL OR v.NewType COLLATE Latin1_General_100_BIN2<>v.OldType COLLATE Latin1_General_100_BIN2)
  AND NOT EXISTS(SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK)
   WHERE EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder o WHERE o.PackagingTypeID=dbo.PackagingType.ID AND o.PackagingOrder=v.PackagingOrder) AND PackagingType COLLATE Latin1_General_100_BIN2=v.NewType COLLATE Latin1_General_100_BIN2 AND Status='Active'))
  THROW 52961,'Choose an active Primary, Secondary or Tertiary Type in the matching Packaging Type Master order.',1;

 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) j WHERE j.[key]='NutDensity' AND j.[type]<>0 AND
  (TRY_CONVERT(DECIMAL(18,6),j.value) IS NULL OR TRY_CONVERT(DECIMAL(18,6),j.value)<=0
   OR TRY_CONVERT(DECIMAL(38,18),j.value)<>TRY_CONVERT(DECIMAL(18,6),j.value)))
  THROW 52961,'Nut Density must be positive with at most 6 decimal places.',1;


 DECLARE @Layers INT;
 SELECT @Layers=COALESCE(CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='ResponseLayerCount')
  THEN TRY_CONVERT(INT,JSON_VALUE(@Fields,'$.ResponseLayerCount')) ELSE ResponseLayerCount END,RequestedLayerCount)
 FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ID;
 IF @Layers NOT BETWEEN 1 AND 3 OR EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='ResponseLayerCount' AND [type]<>0
  AND ([type] NOT IN(1,2) OR [value] LIKE '%[^0-9]%' OR TRY_CONVERT(INT,[value]) NOT BETWEEN 1 AND 3))
  THROW 52961,'Confirmed packaging layers must be 1, 2 or 3.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='UnitsPerTertiary' AND [type]<>0
  AND ([value] LIKE '%[^0-9]%' OR TRY_CONVERT(INT,[value]) IS NULL OR TRY_CONVERT(INT,[value])<1))
  THROW 52961,'Secondary units per Tertiary must be a positive whole number.',1;

 DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeUser'),@OldSource SQL_VARIANT=SESSION_CONTEXT(N'OpportunityChangeSource');
 BEGIN TRY
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@Username;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',N'User';
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields))
 UPDATE t SET
 ResponseLayerCount=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='ResponseLayerCount') THEN j.ResponseLayerCount ELSE t.ResponseLayerCount END,
 ThirdPMType=CASE WHEN @Layers<3 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='ThirdPMType') THEN NULLIF(LTRIM(RTRIM(j.ThirdPMType)),N'') ELSE t.ThirdPMType END,
 ThirdPMMOQ=CASE WHEN @Layers<3 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='ThirdPMMOQ') THEN j.ThirdPMMOQ ELSE t.ThirdPMMOQ END,
 UnitsPerTertiary=CASE WHEN @Layers<3 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='UnitsPerTertiary') THEN j.UnitsPerTertiary ELSE t.UnitsPerTertiary END,
 NutDensity=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='NutDensity') THEN j.NutDensity ELSE t.NutDensity END,
 FirstPMType=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='FirstPMType') THEN NULLIF(LTRIM(RTRIM(j.FirstPMType)),N'') ELSE t.FirstPMType END,
 SecondPMType=CASE WHEN @Layers<2 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='SecondPMType') THEN NULLIF(LTRIM(RTRIM(j.SecondPMType)),N'') ELSE t.SecondPMType END,
 UnitsPerCarton=CASE WHEN @Layers<2 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='UnitsPerCarton') THEN j.UnitsPerCarton ELSE t.UnitsPerCarton END,
 PackagingDescription=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='PackagingDescription') THEN NULLIF(LTRIM(RTRIM(j.PackagingDescription)),N'') ELSE t.PackagingDescription END,
 FirstPMMOQ=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='FirstPMMOQ') THEN j.FirstPMMOQ ELSE t.FirstPMMOQ END,
 SecondPMMOQ=CASE WHEN @Layers<2 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='SecondPMMOQ') THEN j.SecondPMMOQ ELSE t.SecondPMMOQ END,
 CartonsPerLayer=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='CartonsPerLayer') THEN j.CartonsPerLayer ELSE t.CartonsPerLayer END,
 LayersPerPallet=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='LayersPerPallet') THEN j.LayersPerPallet ELSE t.LayersPerPallet END,
 PacksPerPallet=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='PacksPerPallet') THEN j.PacksPerPallet ELSE t.PacksPerPallet END,
 CartonsPerContainer=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]='CartonsPerContainer') THEN j.CartonsPerContainer ELSE t.CartonsPerContainer END,
 UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()
 FROM dbo.PackagingConfigurationRequestItem t CROSS APPLY OPENJSON(@Fields) WITH(FirstPMType NVARCHAR(100),SecondPMType NVARCHAR(100),UnitsPerCarton INT,PackagingDescription NVARCHAR(500),FirstPMMOQ DECIMAL(18,4),SecondPMMOQ DECIMAL(18,4),CartonsPerLayer INT,LayersPerPallet INT,PacksPerPallet INT,CartonsPerContainer INT,NutDensity DECIMAL(18,6),ResponseLayerCount INT,ThirdPMType NVARCHAR(100),ThirdPMMOQ DECIMAL(18,4),UnitsPerTertiary INT) j
 WHERE t.ID=@ID AND t.RowVersion=@ExpectedRowVersion;
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',@OldSource;
 END TRY
 BEGIN CATCH
 EXEC sys.sp_set_session_context N'OpportunityChangeUser',@OldUser;
 EXEC sys.sp_set_session_context N'OpportunityChangeSource',@OldSource;
 THROW;
 END CATCH;
SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ID;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingRequestItem_Transition_AuditImplementation
    @Username NVARCHAR(100), @ID INT, @ExpectedRowVersion VARBINARY(8),
    @TargetStage VARCHAR(20), @Comment NVARCHAR(1000)=NULL
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    DECLARE @ActorID INT,@Action VARCHAR(20),@Stage VARCHAR(20),@PIC INT;
    IF @TargetStage IS NULL OR @TargetStage NOT IN('Working','Pending Review','Approved','Returned','Canceled')
        THROW 51129,'Unsupported target stage.',1;
    SET @Action=CASE WHEN @TargetStage IN('Working','Pending Review') THEN 'Maintain' ELSE 'Review' END;
    EXEC dbo.usp_Packaging_Authorize @Username,@Action,@ActorID OUTPUT;
    DECLARE @IsAdmin BIT=0;
    IF EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@ActorID AND Scope=N'Admin') SET @IsAdmin=1;
    BEGIN TRY
        BEGIN TRANSACTION;
        SELECT @Stage=Stage,@PIC=PICUserID FROM dbo.PackagingConfigurationRequestItem WITH(UPDLOCK,HOLDLOCK)
        WHERE ID=@ID AND RowVersion=@ExpectedRowVersion;
        IF @Stage IS NULL THROW 51108,'Concurrency conflict or row not found. Refresh first.',1;
        IF @IsAdmin=0 AND @Action='Maintain' AND (@PIC IS NULL OR @PIC<>@ActorID)
            THROW 51130,'Only the assigned PIC can submit this response.',1;
        IF NOT ((@TargetStage='Working' AND @Stage IN('Assigned','Returned'))
            OR (@TargetStage='Pending Review' AND @Stage IN('Assigned','Working','Returned'))
            OR (@TargetStage IN('Approved','Returned') AND @Stage='Pending Review')
            OR (@TargetStage='Canceled' AND @Stage IN('Assigned','Working','Returned','Pending Review')))
            THROW 51131,'Invalid Packaging stage transition.',1;
        IF @TargetStage IN('Returned','Canceled') AND NULLIF(LTRIM(RTRIM(@Comment)),N'') IS NULL
            THROW 51132,'A reason is required for return or cancellation.',1;
        IF @IsAdmin=0 AND @TargetStage='Approved' AND @PIC=@ActorID
            THROW 51133,'The assigned PIC cannot approve their own response.',1;
        IF @TargetStage IN('Pending Review','Approved') AND EXISTS(
          SELECT 1 FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ID AND (
           NULLIF(LTRIM(RTRIM(FirstPMType)),N'') IS NULL OR FirstPMMOQ IS NULL
           OR (COALESCE(ResponseLayerCount,RequestedLayerCount)>=2 AND (NULLIF(LTRIM(RTRIM(SecondPMType)),N'') IS NULL OR UnitsPerCarton IS NULL OR SecondPMMOQ IS NULL))
           OR (COALESCE(ResponseLayerCount,RequestedLayerCount)>=3 AND (NULLIF(LTRIM(RTRIM(ThirdPMType)),N'') IS NULL OR UnitsPerTertiary IS NULL OR ThirdPMMOQ IS NULL))))
          THROW 52963,'Type, units in the next layer and calculated MOQ are required for each confirmed packaging layer.',1;
        UPDATE dbo.PackagingConfigurationRequestItem
        SET Stage=@TargetStage,IsOpen=CASE WHEN @TargetStage IN('Approved','Canceled') THEN 0 ELSE 1 END,
            SubmittedAt=CASE WHEN @TargetStage='Pending Review' THEN SYSUTCDATETIME() ELSE SubmittedAt END,
            SubmittedBy=CASE WHEN @TargetStage='Pending Review' THEN @ActorID ELSE SubmittedBy END,
            ReviewedAt=CASE WHEN @Action='Review' THEN SYSUTCDATETIME()
                            WHEN @TargetStage='Pending Review' THEN NULL ELSE ReviewedAt END,
            ReviewedBy=CASE WHEN @Action='Review' THEN @ActorID
                            WHEN @TargetStage='Pending Review' THEN NULL ELSE ReviewedBy END,
            ManagerComment=CASE WHEN @Action='Review' THEN @Comment
                                WHEN @TargetStage='Pending Review' THEN NULL ELSE ManagerComment END,
            UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@ActorID
        WHERE ID=@ID AND RowVersion=@ExpectedRowVersion;
        COMMIT;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK;
        THROW;
    END CATCH;
    SELECT ID,Stage,RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ID;
END;
GO

CREATE OR ALTER PROCEDURE dbo.usp_PkgPricing_Save
 @Username NVARCHAR(100),@ItemID INT,@ExpectedRowVersion VARBINARY(8),@Snapshot NVARCHAR(MAX)
AS
BEGIN
 SET NOCOUNT ON;
 -- Called by the API ONLY after server-side recalculation, in the response transaction.
 DECLARE @Actor INT,@Order VARCHAR(10)=JSON_VALUE(@Snapshot,'$.PackagingOrder'),
  @TypeID INT=TRY_CONVERT(INT,JSON_VALUE(@Snapshot,'$.PackagingTypeID')),
  @OpportunityItem INT,@Opportunity INT,@Product INT,@ProductRV VARBINARY(8),@GradeVersion INT,@MixVersion INT,@Reference INT,
  @TypeName NVARCHAR(100)=JSON_VALUE(@Snapshot,'$.PackagingTypeName'),@ID INT;
 EXEC dbo.usp_PkgPricing_ItemAuthorize @Username,@ItemID,1,@ExpectedRowVersion;
 SELECT @Actor=ID FROM dbo.Users WHERE UserName=@Username AND IsActive=1;
 IF ISJSON(@Snapshot)<>1 OR @Order IS NULL OR @Order NOT IN('Primary','Secondary','Tertiary') OR @TypeID IS NULL
  THROW 51111,'Invalid pricing snapshot.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.PackagingType WHERE ID=@TypeID AND Status='Active' AND EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder o WHERE o.PackagingTypeID=dbo.PackagingType.ID AND o.PackagingOrder=@Order) AND PackagingType=@TypeName)
  THROW 51111,'Choose an active Packaging Type in the matching order.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ItemID AND
  CASE @Order WHEN 'Primary' THEN FirstPMType WHEN 'Secondary' THEN SecondPMType ELSE ThirdPMType END=@TypeName AND CASE @Order WHEN 'Primary' THEN 1 WHEN 'Secondary' THEN 2 ELSE 3 END<=COALESCE(ResponseLayerCount,RequestedLayerCount))
  THROW 51111,'Calculator type must match the saved response type.',1;
 SELECT @OpportunityItem=i.OpportunityItemID,@Opportunity=h.OpportunityID,@Product=i.ProductID,@ProductRV=product.RowVersion
 FROM dbo.PackagingConfigurationRequestItem i JOIN dbo.PackagingConfigurationRequest h ON h.ID=i.RequestID
 JOIN dbo.Product product ON product.ID=i.ProductID WHERE i.ID=@ItemID;
 SET @GradeVersion=TRY_CONVERT(INT,JSON_VALUE(@Snapshot,'$.Context.ProductGradeVersion.ID'));
 SET @MixVersion=TRY_CONVERT(INT,JSON_VALUE(@Snapshot,'$.Context.ProductMixVersion.ID'));
 SET @Reference=TRY_CONVERT(INT,JSON_VALUE(@Snapshot,'$.InputJSON.ReferencePricingMasterID'));
 IF @Reference IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.PkgPricingMaster WHERE ID=@Reference AND PackagingOrder=@Order)
  THROW 51111,'Invalid pricing reference.',1;
 IF NOT EXISTS(SELECT 1 FROM OPENJSON(@Snapshot,'$.components'))
  THROW 51111,'Select at least one component.',1;
 UPDATE dbo.PkgPricingMaster SET IsCurrent=0 WHERE RequestItemID=@ItemID AND PackagingOrder=@Order AND IsCurrent=1;
 INSERT dbo.PkgPricingMaster(RequestItemID,PackagingOrder,PackagingTypeID,PackagingTypeName,AsOfDate,FinalMOQ,UnitPrice,CurrencyID,CurrencyCode,UnitUSDPrice,Fingerprint,InputJSON,CreatedBy,OpportunityItemID,OpportunityID,ProductID,ProductRowVersion,ProductGradeVersionID,ProductMixVersionID,SourcePricingMasterID,ContextSnapshotJSON,SnapshotJSON)
 SELECT @ItemID,@Order,@TypeID,@TypeName,AsOfDate,FinalMOQ,UnitPrice,CurrencyID,CurrencyCode,UnitUSDPrice,Fingerprint,InputJSON,@Actor,@OpportunityItem,@Opportunity,@Product,@ProductRV,@GradeVersion,@MixVersion,@Reference,JSON_QUERY(@Snapshot,'$.Context'),@Snapshot
 FROM OPENJSON(@Snapshot) WITH(AsOfDate DATE,FinalMOQ DECIMAL(18,0),UnitPrice DECIMAL(28,9),CurrencyID INT,CurrencyCode NVARCHAR(20),UnitUSDPrice DECIMAL(28,9),Fingerprint CHAR(64),InputJSON NVARCHAR(MAX) AS JSON);
 SET @ID=SCOPE_IDENTITY();
 INSERT dbo.PkgPricingComponent(PricingMasterID,LineNumber,MaterialID,PackagingPriceID,DimensionID,QuantityPerProduct,AreaPerMaterial,BaseUnitsPerPriceUnit,PriceUnitsPerProduct,VendorMOQ,ProductMOQ,ProductUnitPrice,CurrencyID,ProductUnitUSDPrice,SnapshotJSON)
 SELECT @ID,CONVERT(INT,j.[key])+1,c.MaterialID,c.PriceID,c.DimensionID,c.Quantity,c.Area,c.Factor,c.Consumption,c.VendorMOQ,c.ProductMOQ,c.ProductUnitPrice,c.CurrencyID,c.ProductUnitUSDPrice,j.value
 FROM OPENJSON(@Snapshot,'$.components') j CROSS APPLY OPENJSON(j.value) WITH(MaterialID INT,PriceID INT,DimensionID INT,Quantity DECIMAL(18,6),Area DECIMAL(28,9),Factor DECIMAL(24,9),Consumption DECIMAL(28,12),VendorMOQ DECIMAL(18,4),ProductMOQ DECIMAL(18,0),ProductUnitPrice DECIMAL(28,9),CurrencyID INT,ProductUnitUSDPrice DECIMAL(28,9)) c;
 -- Keep a lightweight reference in the request's normal change log.
 INSERT dbo.PackagingRequestChangeLog(EventID,RequestID,EntityLevel,ItemID,ItemLabel,Action,FieldName,OldValue,NewValue,ChangedBy,Source,IsResponse)
 SELECT NEWID(),RequestID,'Item',ID,ProductCode,'Update',@Order+'Pricing',NULL,
  CONCAT('Pricing #',@ID,': MOQ ',JSON_VALUE(@Snapshot,'$.FinalMOQ'),', unit price ',JSON_VALUE(@Snapshot,'$.UnitPrice'),' ',JSON_VALUE(@Snapshot,'$.CurrencyCode')),@Username,'User',1
 FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ItemID;
END;
GO

-- Extend creation at INSERT time: never refresh a saved request from live source data.
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingRequest_Create_AuditImplementation'));
IF @D IS NULL THROW 52970,'Request creation implementation is missing.',1;
IF CHARINDEX(N'RequestedLayerCount',@D)=0
BEGIN
 IF CHARINDEX(N'SecondaryTransparency,NumberOfPrimary)',@D)=0 THROW 52970,'Unexpected request creation signature.',1;
 SET @D=REPLACE(@D,N'SecondaryTransparency,NumberOfPrimary)',N'SecondaryTransparency,NumberOfPrimary,RequestedLayerCount,TertiaryTypeID,TertiaryTypeName,TertiaryTransparency,NumberOfSecondary)');
 SET @D=REPLACE(@D,N'i.SecondaryTransparency,i.NumberOfPrimary',N'i.SecondaryTransparency,i.NumberOfPrimary,i.PackagingLayerCount,i.TertiaryTypeID,(SELECT PackagingType FROM dbo.PackagingType WHERE ID=i.TertiaryTypeID),i.TertiaryTransparency,i.NumberOfSecondary');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.tr_OpportunityItem_ProcessingLock'));
IF @D IS NULL THROW 52970,'Opportunity processing lock is missing.',1;
IF CHARINDEX(N'i.PackagingLayerCount',@D)=0
BEGIN
 IF CHARINDEX(N'i.NumberOfPrimary',@D)=0 THROW 52970,'Unexpected Opportunity processing lock.',1;
 SET @D=REPLACE(@D,N'i.NumberOfPrimary',N'i.NumberOfPrimary,i.PackagingLayerCount,i.TertiaryTypeID,CONVERT(VARBINARY(MAX),i.TertiaryTransparency),i.NumberOfSecondary');
 SET @D=REPLACE(@D,N'd.NumberOfPrimary',N'd.NumberOfPrimary,d.PackagingLayerCount,d.TertiaryTypeID,CONVERT(VARBINARY(MAX),d.TertiaryTransparency),d.NumberOfSecondary');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER TRIGGER',N'ALTER TRIGGER'),N'CREATE   TRIGGER',N'ALTER TRIGGER'),N'CREATE TRIGGER',N'ALTER TRIGGER');
 EXEC sys.sp_executesql @D;
END;
GO
CREATE OR ALTER TRIGGER dbo.tr_PackagingRequestItem_LayerSnapshotImmutable
ON dbo.PackagingConfigurationRequestItem AFTER UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON d.ID=i.ID WHERE EXISTS(
 SELECT i.RequestedLayerCount,i.PrimaryTypeID,CONVERT(VARBINARY(MAX),i.PrimaryTypeName),i.SecondaryTypeID,CONVERT(VARBINARY(MAX),i.SecondaryTypeName),
 CONVERT(VARBINARY(MAX),i.SecondaryTransparency),i.NumberOfPrimary,i.TertiaryTypeID,CONVERT(VARBINARY(MAX),i.TertiaryTypeName),CONVERT(VARBINARY(MAX),i.TertiaryTransparency),i.NumberOfSecondary
 EXCEPT
 SELECT d.RequestedLayerCount,d.PrimaryTypeID,CONVERT(VARBINARY(MAX),d.PrimaryTypeName),d.SecondaryTypeID,CONVERT(VARBINARY(MAX),d.SecondaryTypeName),
 CONVERT(VARBINARY(MAX),d.SecondaryTransparency),d.NumberOfPrimary,d.TertiaryTypeID,CONVERT(VARBINARY(MAX),d.TertiaryTypeName),CONVERT(VARBINARY(MAX),d.TertiaryTransparency),d.NumberOfSecondary))
  THROW 52981,'Request layers and specifications are immutable. Create a revised request instead.',1;
END;
GO
-- Use established actor/event contexts for both requested and confirmed layers.
DECLARE @Name SYSNAME,@D NVARCHAR(MAX),@Rows NVARCHAR(MAX),@Field SYSNAME,@Response BIT;
DECLARE triggers CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM sys.triggers
 WHERE name IN(N'tr_OpportunityItem_ChangeLog',N'tr_PackagingConfigurationRequestItem_ChangeLog');
OPEN triggers;FETCH NEXT FROM triggers INTO @Name;
WHILE @@FETCH_STATUS=0
BEGIN
 SET @D=OBJECT_DEFINITION(OBJECT_ID(N'dbo.'+@Name));SET @Rows=N'';
 DECLARE fields CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM sys.columns
 WHERE object_id=OBJECT_ID(CASE WHEN @Name=N'tr_OpportunityItem_ChangeLog' THEN N'dbo.OpportunityItem' ELSE N'dbo.PackagingConfigurationRequestItem' END)
 AND name IN(N'PackagingLayerCount',N'RequestedLayerCount',N'ResponseLayerCount',N'TertiaryTypeID',N'TertiaryTypeName',N'TertiaryTransparency',N'NumberOfSecondary',N'ThirdPMType',N'ThirdPMMOQ',N'UnitsPerTertiary');
 OPEN fields;FETCH NEXT FROM fields INTO @Field;
 WHILE @@FETCH_STATUS=0
 BEGIN
  SET @Response=CASE WHEN @Field IN(N'ResponseLayerCount',N'ThirdPMType',N'ThirdPMMOQ',N'UnitsPerTertiary') THEN 1 ELSE 0 END;
  IF CHARINDEX(QUOTENAME(@Field,'''')+N',',@D)=0
   SET @Rows+=N'('+QUOTENAME(@Field,'''')+N',CONVERT(NVARCHAR(MAX),d.'+QUOTENAME(@Field)+N'),CONVERT(NVARCHAR(MAX),i.'+QUOTENAME(@Field)+N')'+CASE WHEN @Name=N'tr_OpportunityItem_ChangeLog' THEN N'' ELSE N','+CONVERT(NVARCHAR(1),@Response) END+N'),';
  FETCH NEXT FROM fields INTO @Field;
 END;
 CLOSE fields;DEALLOCATE fields;
 IF @Rows<>N''
 BEGIN
  IF CHARINDEX(N'CROSS APPLY(VALUES',@D)=0 THROW 52970,'Unexpected change log trigger.',1;
  SET @D=REPLACE(@D,N'CROSS APPLY(VALUES',N'CROSS APPLY(VALUES'+@Rows);
  SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER TRIGGER',N'ALTER TRIGGER'),N'CREATE   TRIGGER',N'ALTER TRIGGER'),N'CREATE TRIGGER',N'ALTER TRIGGER');
  EXEC sys.sp_executesql @D;
 END;
 FETCH NEXT FROM triggers INTO @Name;
END;
CLOSE triggers;DEALLOCATE triggers;
GO
GO
-- END MIGRATION 67_packaging_layers.sql

-- BEGIN MIGRATION 68_packaging_child_components.sql
-- SOURCE SHA256 8d0e4f4dc9450b19060273e8994e4bd6ee2d7bd002b776c8506e943b8f76fa36
PRINT N'Applying 68_packaging_child_components.sql';
GO
GO
-- After 67. Orders belong to root types, never to child components.
-- Preserve IDs, historical compatibility Orders/memberships and all saved snapshots.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF OBJECT_ID('dbo.UQ_PackagingType_Order_Name','UQ') IS NOT NULL
 ALTER TABLE dbo.PackagingType DROP CONSTRAINT UQ_PackagingType_Order_Name;
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.PackagingType') AND name='UX_PackagingType_RootOrder_Name')
 CREATE UNIQUE INDEX UX_PackagingType_RootOrder_Name ON dbo.PackagingType(PackagingOrder,PackagingType) WHERE ParentTypeID IS NULL;
GO
CREATE OR ALTER TRIGGER dbo.tr_PackagingType_DefaultOrder
ON dbo.PackagingType AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 -- Old inserts still get a root membership; children have no independently maintained Order.
 INSERT dbo.PackagingTypeOrder(PackagingTypeID,PackagingOrder)
 SELECT i.ID,i.PackagingOrder FROM inserted i
 WHERE i.ParentTypeID IS NULL
 AND NOT EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder o WHERE o.PackagingTypeID=i.ID AND o.PackagingOrder=i.PackagingOrder);
END;
GO
CREATE OR ALTER VIEW dbo.v_PackagingTypeWeb AS
 SELECT p.*,CASE WHEN p.ParentTypeID IS NULL THEN o.PackagingOrdersJSON ELSE N'[]' END PackagingOrdersJSON,
  CONVERT(BIT,CASE WHEN EXISTS(SELECT 1 FROM dbo.PackagingType c WHERE c.ParentTypeID=p.ID) THEN 1 ELSE 0 END) HasChildren
 FROM dbo.PackagingType p CROSS APPLY(
  SELECT N'["'+STRING_AGG(CONVERT(NVARCHAR(MAX),PackagingOrder),N'","') WITHIN GROUP(
   ORDER BY CASE PackagingOrder WHEN 'Primary' THEN 1 WHEN 'Secondary' THEN 2 ELSE 3 END)+N'"]' PackagingOrdersJSON
  FROM dbo.PackagingTypeOrder WHERE PackagingTypeID=p.ID) o;
GO

CREATE OR ALTER PROCEDURE dbo.usp_PackagingType_Batch
 @Rows NVARCHAR(MAX),@Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT OFF;
 DECLARE @Actor INT;
 EXEC dbo.usp_Packaging_Authorize @Username,'Maintain',@Actor OUTPUT;
 IF ISJSON(@Rows)<>1 OR LEFT(LTRIM(@Rows),1)<>'[' THROW 51105,'A JSON array of rows is required.',1;
 DECLARE @Input TABLE(RowNum INT,Command VARCHAR(10),ID INT,RowVersion VARBINARY(8),
  PackagingOrder NVARCHAR(4000),PackagingType NVARCHAR(4000),PriceBasis NVARCHAR(4000),Status VARCHAR(20),ParentTypeID INT,ParentTypeSet BIT,PackagingOrders NVARCHAR(MAX),OrdersSet BIT);
 INSERT @Input SELECT RowNum,Command,ID,TRY_CONVERT(VARBINARY(8),RowVersionHex,1),PackagingOrder,PackagingType,PriceBasis,Status,ParentTypeID,
  CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(r.value) WHERE [key]='ParentTypeID') THEN 1 ELSE 0 END,PackagingOrders,CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(r.value) WHERE [key]='PackagingOrders') THEN 1 ELSE 0 END
 FROM OPENJSON(@Rows) r CROSS APPLY OPENJSON(r.value) WITH(RowNum INT,Command VARCHAR(10),ID INT,RowVersionHex VARCHAR(100),
  PackagingOrder NVARCHAR(4000),PackagingType NVARCHAR(4000),PriceBasis NVARCHAR(4000),Status VARCHAR(20),ParentTypeID INT,PackagingOrders NVARCHAR(MAX) AS JSON);
 IF (SELECT COUNT(*) FROM @Input) NOT BETWEEN 1 AND 500 THROW 51105,'Use 1 to 500 rows per batch.',1;
 IF EXISTS(SELECT RowNum FROM @Input GROUP BY RowNum HAVING COUNT(*)>1)
  OR EXISTS(SELECT ID FROM @Input WHERE ID IS NOT NULL GROUP BY ID HAVING COUNT(*)>1)
  THROW 51106,'Duplicate row numbers or record IDs.',1;
 DECLARE @Result TABLE(RowNum INT,Status VARCHAR(10),Message NVARCHAR(2048),NewID INT,NewRowVersion VARBINARY(8));
 DECLARE @Row INT,@Cmd VARCHAR(10),@ID INT,@RV VARBINARY(8),@Order NVARCHAR(4000),@Name NVARCHAR(4000),
  @Basis NVARCHAR(4000),@Status VARCHAR(20),@Own BIT,@Parent INT,@ParentSet BIT,@Ancestor INT,@Lock INT,@Orders NVARCHAR(MAX),@OrdersSet BIT;
 DECLARE @ChosenOrders TABLE(PackagingOrder NVARCHAR(9) PRIMARY KEY);
 DECLARE @Visited TABLE(ID INT PRIMARY KEY);
 DECLARE c CURSOR LOCAL FAST_FORWARD FOR
  SELECT RowNum,Command,ID,RowVersion,PackagingOrder,PackagingType,PriceBasis,Status,ParentTypeID,ParentTypeSet,PackagingOrders,OrdersSet FROM @Input ORDER BY RowNum;
 OPEN c; FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@RV,@Order,@Name,@Basis,@Status,@Parent,@ParentSet,@Orders,@OrdersSet;
 WHILE @@FETCH_STATUS=0
 BEGIN
  SET @Own=0;
  BEGIN TRY
   IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION; SET @Own=1; END ELSE SAVE TRANSACTION PackagingTypeRow;
   EXEC @Lock=sys.sp_getapplock @Resource=N'PackagingTypeHierarchy',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
   IF @Lock<0 THROW 51108,'Packaging Type hierarchy is busy. Try again.',1;
   IF @Row IS NULL OR @Row<1 OR @Cmd IS NULL OR @Cmd NOT IN('C','U','D') THROW 51107,'Use a positive row number and C, U or D.',1;
   IF @Cmd='C' AND (@ID IS NOT NULL OR @RV IS NOT NULL) THROW 51107,'Create cannot have an ID or RowVersion.',1;
   IF @Cmd IN('U','D') AND NOT EXISTS(SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@RV)
    THROW 51108,'Concurrency conflict or row not found. Refresh first.',1;
   IF @Cmd<>'D'
   BEGIN
    IF @Cmd='U' AND COALESCE(@ParentSet,0)=0
     SELECT @Parent=ParentTypeID FROM dbo.PackagingType WHERE ID=@ID;
    IF @Parent IS NOT NULL
    BEGIN
     IF NOT EXISTS(SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK) WHERE ID=@Parent
      AND (Status='Active' OR (@Cmd='U' AND EXISTS(SELECT 1 FROM dbo.PackagingType WHERE ID=@ID AND ParentTypeID=@Parent))))
      THROW 51111,'Choose an active Parent Type from Packaging Type Master.',1;
     DELETE @Visited;
     SET @Ancestor=@Parent;
     WHILE @Ancestor IS NOT NULL
     BEGIN
      IF @Ancestor=@ID OR EXISTS(SELECT 1 FROM @Visited WHERE ID=@Ancestor)
       THROW 51111,'Parent Type cannot be this type or one of its descendants.',1;
      INSERT @Visited VALUES(@Ancestor);
      SELECT @Ancestor=ParentTypeID FROM dbo.PackagingType WHERE ID=@Ancestor;
     END;
    END;

    SET @Name=NULLIF(LTRIM(RTRIM(@Name)),N'');
    DELETE @ChosenOrders;
    -- Only root types have layer memberships. Keep the compatibility Order for children.
    IF @Parent IS NOT NULL
    BEGIN
     IF @Cmd='U' SELECT @Order=PackagingOrder FROM dbo.PackagingType WHERE ID=@ID;
     ELSE SELECT @Order=PackagingOrder FROM dbo.PackagingType WHERE ID=@Parent;
    END
    ELSE IF @OrdersSet=1
    BEGIN
     IF ISJSON(@Orders)<>1 OR LEFT(LTRIM(@Orders),1)<>'[' OR (SELECT COUNT(*) FROM OPENJSON(@Orders)) NOT BETWEEN 1 AND 3
      THROW 51111,'Select one to three packaging orders.',1;
     IF EXISTS(SELECT 1 FROM OPENJSON(@Orders) WHERE [type]<>1 OR [value] COLLATE Latin1_General_100_BIN2 NOT IN(N'Primary',N'Secondary',N'Tertiary'))
      OR EXISTS(SELECT [value] FROM OPENJSON(@Orders) GROUP BY [value] HAVING COUNT(*)>1)
      THROW 51111,'Choose distinct Primary, Secondary or Tertiary orders.',1;
     INSERT @ChosenOrders SELECT [value] FROM OPENJSON(@Orders);
     SELECT TOP(1) @Order=PackagingOrder FROM @ChosenOrders ORDER BY CASE PackagingOrder WHEN 'Primary' THEN 1 WHEN 'Secondary' THEN 2 ELSE 3 END;
    END
    ELSE
    BEGIN
     IF @Cmd='U' AND @Order IS NULL
      SELECT @Order=PackagingOrder FROM dbo.PackagingType WHERE ID=@ID;
     IF @Order IS NULL OR @Order COLLATE Latin1_General_100_BIN2 NOT IN(N'Primary',N'Secondary',N'Tertiary')
      THROW 51111,'Choose Primary, Secondary or Tertiary for Order.',1;
     IF @Cmd='U' AND EXISTS(SELECT 1 FROM dbo.PackagingType WHERE ID=@ID AND PackagingOrder=@Order)
      INSERT @ChosenOrders SELECT PackagingOrder FROM dbo.PackagingTypeOrder WHERE PackagingTypeID=@ID;
     IF NOT EXISTS(SELECT 1 FROM @ChosenOrders) INSERT @ChosenOrders VALUES(@Order);
    END;
    IF @Basis IS NULL OR @Basis COLLATE Latin1_General_100_BIN2 NOT IN(N'Count',N'Square meter',N'Volume')
     THROW 51111,'Choose Count, Square meter or Volume for Price Basis.',1;
    IF @Name IS NULL OR LEN(@Name)>100 THROW 51111,'Packaging Type is required (maximum 100 characters).',1;
    IF @Cmd='U' AND @Status IS NULL SELECT @Status=Status FROM dbo.PackagingType WHERE ID=@ID;
    SET @Status=COALESCE(@Status,'Active');
    IF @Status NOT IN('Active','Block') THROW 51109,'Status must be Active or Block.',1;
    IF EXISTS(SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK)
     WHERE @Parent IS NULL AND ParentTypeID IS NULL AND PackagingType=@Name AND EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder o JOIN @ChosenOrders c ON c.PackagingOrder=o.PackagingOrder WHERE o.PackagingTypeID=dbo.PackagingType.ID) AND (@Cmd='C' OR ID<>@ID))
     THROW 51111,'This Packaging Type already exists for this Order. Edit the existing record instead.',1;
    -- Preserve historical duplicates on unrelated edits; never add a new duplicate under a parent.
    IF @Parent IS NOT NULL AND EXISTS(SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK)
     WHERE ParentTypeID=@Parent AND PackagingType=@Name AND (@Cmd='C' OR ID<>@ID))
     AND (@Cmd='C' OR NOT EXISTS(SELECT 1 FROM dbo.PackagingType
      WHERE ID=@ID AND ParentTypeID=@Parent AND PackagingType=@Name))
     THROW 51111,'This component already exists under this Parent Type. Edit the existing record instead.',1;
   END;
   IF @Cmd='C'
    INSERT dbo.PackagingType(PackagingOrder,PackagingType,PriceBasis,TareWeight,Status,CreatedBy,ParentTypeID)
    OUTPUT @Row,'OK','Created',inserted.ID,inserted.RowVersion INTO @Result VALUES(@Order,@Name,@Basis,0,@Status,@Actor,@Parent);
   ELSE IF @Cmd='D'
    UPDATE dbo.PackagingType SET Status='Block',UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@Actor
    OUTPUT @Row,'OK','Blocked',inserted.ID,inserted.RowVersion INTO @Result WHERE ID=@ID AND RowVersion=@RV;
   ELSE
    UPDATE dbo.PackagingType SET PackagingOrder=@Order,PackagingType=@Name,PriceBasis=@Basis,
     ParentTypeID=@Parent,Status=@Status,UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@Actor
    OUTPUT @Row,'OK','Updated',inserted.ID,inserted.RowVersion INTO @Result WHERE ID=@ID AND RowVersion=@RV;
   IF @Cmd<>'D' AND @Parent IS NULL
   BEGIN
    SELECT @ID=NewID FROM @Result WHERE RowNum=@Row;
    DELETE dbo.PackagingTypeOrder WHERE PackagingTypeID=@ID;
    INSERT dbo.PackagingTypeOrder SELECT @ID,PackagingOrder FROM @ChosenOrders;
   END;
   IF @Own=1 COMMIT;
  END TRY
  BEGIN CATCH
   IF @Own=1 AND XACT_STATE()<>0 ROLLBACK;
   ELSE IF XACT_STATE()=1 ROLLBACK TRANSACTION PackagingTypeRow;
   ELSE IF XACT_STATE()=-1 THROW;
   DELETE @Result WHERE RowNum=@Row;
   INSERT @Result VALUES(@Row,'ERROR',ERROR_MESSAGE(),@ID,NULL);
  END CATCH;
  FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@RV,@Order,@Name,@Basis,@Status,@Parent,@ParentSet,@Orders,@OrdersSet;
 END;
 CLOSE c; DEALLOCATE c;
 SELECT * FROM @Result ORDER BY RowNum;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingResponseTypeLookup_Read @Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON;DECLARE @Actor INT;
 EXEC dbo.usp_Packaging_Authorize @Username,'MasterRead',@Actor OUTPUT;
 SELECT ID,PackagingOrder,PackagingOrdersJSON,PackagingType,ParentTypeID FROM dbo.v_PackagingTypeWeb
 WHERE ParentTypeID IS NULL AND Status='Active' ORDER BY PackagingOrder,PackagingType,ID;
END;
GO
-- New response choices must be roots. Unchanged historical names stay grandfathered.
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation'));
IF @D IS NULL THROW 52970,'Run layer migration 67 first.',1;
IF CHARINDEX(N'-- Root-only response type choices.',@D)=0
BEGIN
 DECLARE @Old NVARCHAR(MAX)=N'WHERE EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder o WHERE o.PackagingTypeID=dbo.PackagingType.ID AND o.PackagingOrder=v.PackagingOrder)';
 IF CHARINDEX(@Old,@D)=0 THROW 52970,'Unexpected response type validation signature.',1;
 SET @D=REPLACE(@D,@Old,N'-- Root-only response type choices.
   WHERE ParentTypeID IS NULL AND EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder o WHERE o.PackagingTypeID=dbo.PackagingType.ID AND o.PackagingOrder=v.PackagingOrder)');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
-- Components are discovered via the root hierarchy by the server-side calculator.
-- A child cannot independently be selected as a layer calculator's type.
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PkgPricing_Save'));
IF @D IS NULL THROW 52970,'Run layer migration 67 first.',1;
IF CHARINDEX(N'-- Root-only pricing type.',@D)=0
BEGIN
 DECLARE @Old NVARCHAR(MAX)=N'IF NOT EXISTS(SELECT 1 FROM dbo.PackagingType WHERE ID=@TypeID AND Status=''Active'' AND EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder';
 IF CHARINDEX(@Old,@D)=0 THROW 52970,'Unexpected pricing type validation signature.',1;
 SET @D=REPLACE(@D,@Old,N'-- Root-only pricing type.
 IF NOT EXISTS(SELECT 1 FROM dbo.PackagingType WHERE ID=@TypeID AND ParentTypeID IS NULL AND Status=''Active'' AND EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
COMMIT;
GO
GO
-- END MIGRATION 68_packaging_child_components.sql

-- BEGIN MIGRATION 69_packing_way.sql
-- SOURCE SHA256 a5a85c99b0e3f29b6ac3ed418b9211635f831b0239895ed5e3f9b2a8749e3695
PRINT N'Applying 69_packing_way.sql';
GO
GO
-- After 68. Packing Way reuses UnitsPerCarton (Primary per Secondary) and
-- UnitsPerTertiary (Secondary per Tertiary). The final-layer count is always 1.
-- No duplicate columns or data rewrite: snapshot WeightGrams + stored counts
-- are the authoritative inputs for server-calculated layer and pallet weights.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation'));
IF @D IS NULL THROW 52970,'Run packaging layer migrations first.',1;
IF CHARINDEX(N'-- Packing Way whole-count validation.',@D)=0
BEGIN
 DECLARE @Old NVARCHAR(MAX)=N'DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT';
 IF CHARINDEX(@Old,@D)=0 OR CHARINDEX(N'UnitsPerTertiary',@D)=0
  THROW 52970,'Unexpected packaging response fields signature.',1;
 SET @D=REPLACE(@D,@Old,N'-- Packing Way whole-count validation.
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] IN(''UnitsPerCarton'',''UnitsPerTertiary'',''CartonsPerLayer'',''LayersPerPallet'') AND [type]<>0
  AND ([type] NOT IN(1,2) OR [value] LIKE ''%[^0-9]%'' OR TRY_CONVERT(INT,[value]) IS NULL OR TRY_CONVERT(INT,[value])<1))
  THROW 52961,''Packing Way units, Cartons / layer and Layers / pallet must be positive whole numbers up to 2,147,483,647.'',1;
 DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
COMMIT;
GO
GO
-- END MIGRATION 69_packing_way.sql

-- BEGIN MIGRATION 70_packaging_container_load.sql
-- SOURCE SHA256 c07018501c7cc010ea39a982d4c285fc2f57047f6651a29e2911fa255d47f4ea
PRINT N'Applying 70_packaging_container_load.sql';
GO
GO
-- After 69. Web-only container loading counts; calculated totals remain read-only.
-- Preserve legacy CartonsPerContainer entries and all immutable request snapshots.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','LayersPerContainer') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD LayersPerContainer INT NULL
  CONSTRAINT CK_PCRItem_LayersPerContainer CHECK(LayersPerContainer>=1);
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','PalletsPerContainer') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD PalletsPerContainer INT NULL
  CONSTRAINT CK_PCRItem_PalletsPerContainer CHECK(PalletsPerContainer>=1);
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','CartonsPerContainerFloor') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD CartonsPerContainerFloor INT NULL
  CONSTRAINT CK_PCRItem_CartonsPerContainerFloor CHECK(CartonsPerContainerFloor>=1);

DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation'));
IF @D IS NULL OR CHARINDEX(N'-- Packing Way whole-count validation.',@D)=0
 THROW 52970,'Run migrations through 69 first.',1;
IF CHARINDEX(N'-- Container loading count validation.',@D)=0
BEGIN
 IF CHARINDEX(N'''CartonsPerContainer'',''NutDensity''',@D)=0
  OR CHARINDEX(N'UnitsPerTertiary INT) j',@D)=0
  OR CHARINDEX(N' NutDensity=CASE',@D)=0
  OR CHARINDEX(N'DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT',@D)=0
  THROW 52970,'Unexpected response fields procedure signature.',1;
 SET @D=REPLACE(@D,N'''CartonsPerContainer'',''NutDensity''',
  N'''CartonsPerContainer'',''LayersPerContainer'',''PalletsPerContainer'',''CartonsPerContainerFloor'',''NutDensity''');
 SET @D=REPLACE(@D,N'UnitsPerTertiary INT) j',N'UnitsPerTertiary INT,LayersPerContainer INT,PalletsPerContainer INT,CartonsPerContainerFloor INT) j');
 SET @D=REPLACE(@D,N' NutDensity=CASE',N' LayersPerContainer=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''LayersPerContainer'') THEN j.LayersPerContainer ELSE t.LayersPerContainer END,
 PalletsPerContainer=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''PalletsPerContainer'') THEN j.PalletsPerContainer ELSE t.PalletsPerContainer END,
 CartonsPerContainerFloor=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''CartonsPerContainerFloor'') THEN j.CartonsPerContainerFloor ELSE t.CartonsPerContainerFloor END,
 NutDensity=CASE');
 SET @D=REPLACE(@D,N'DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT',N'-- Container loading count validation.
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] IN(''LayersPerContainer'',''PalletsPerContainer'',''CartonsPerContainerFloor'') AND [type]<>0
  AND ([type] NOT IN(1,2) OR [value] LIKE ''%[^0-9]%'' OR TRY_CONVERT(INT,[value]) IS NULL OR TRY_CONVERT(INT,[value])<1))
  THROW 52961,''Container counts must be positive whole numbers up to 2,147,483,647.'',1;
 DECLARE @LoadConfiguration NVARCHAR(500);
 SELECT @LoadConfiguration=COALESCE(LTRIM(RTRIM(ConfigurationRequest)),N'''') FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ID;
 IF (@LoadConfiguration=N''Floor load'' AND EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key] IN(''LayersPerContainer'',''PalletsPerContainer'') AND [type]<>0))
  OR (@LoadConfiguration NOT IN(N''Floor load'',N''Both'') AND EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''CartonsPerContainerFloor'' AND [type]<>0))
  THROW 52961,''Use only the container fields matching the request configuration snapshot.'',1;
 DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;

-- Add response count changes to the existing actor/event audit stream.
SET @D=OBJECT_DEFINITION(OBJECT_ID('dbo.tr_PackagingConfigurationRequestItem_ChangeLog'));
IF @D IS NULL OR CHARINDEX(N'CROSS APPLY(VALUES',@D)=0
 THROW 52970,'Unexpected request item audit trigger.',1;
DECLARE @Rows NVARCHAR(MAX)=N'',@Field SYSNAME;
DECLARE fields CURSOR LOCAL FAST_FORWARD FOR
 SELECT name FROM sys.columns WHERE object_id=OBJECT_ID('dbo.PackagingConfigurationRequestItem')
 AND name IN(N'LayersPerContainer',N'PalletsPerContainer',N'CartonsPerContainerFloor');
OPEN fields;FETCH NEXT FROM fields INTO @Field;
WHILE @@FETCH_STATUS=0
BEGIN
 IF CHARINDEX(QUOTENAME(@Field,'''')+N',',@D)=0
  SET @Rows+=N'('+QUOTENAME(@Field,'''')+N',CONVERT(NVARCHAR(MAX),d.'+QUOTENAME(@Field)+N'),CONVERT(NVARCHAR(MAX),i.'+QUOTENAME(@Field)+N'),1),';
 FETCH NEXT FROM fields INTO @Field;
END;
CLOSE fields;DEALLOCATE fields;
IF @Rows<>N''
BEGIN
 SET @D=REPLACE(@D,N'CROSS APPLY(VALUES',N'CROSS APPLY(VALUES'+@Rows);
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER TRIGGER',N'ALTER TRIGGER'),N'CREATE   TRIGGER',N'ALTER TRIGGER'),N'CREATE TRIGGER',N'ALTER TRIGGER');
 EXEC sys.sp_executesql @D;
END;
COMMIT;
GO
GO
-- END MIGRATION 70_packaging_container_load.sql

-- BEGIN MIGRATION 71_packaging_request_layer_details.sql
-- SOURCE SHA256 0076a9eb299e57d944588743287643774f6d42da5fe781343ae883a1742a473d
PRINT N'Applying 71_packaging_request_layer_details.sql';
GO
GO
-- After 70. Additive fields; meters and legacy Primary columns stay compatible.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
DECLARE @Table SYSNAME,@Field SYSNAME,@Type NVARCHAR(40),@DDL NVARCHAR(MAX);
DECLARE columns_to_add CURSOR LOCAL FAST_FORWARD FOR
SELECT t.name,f.name,f.type FROM (VALUES(N'OpportunityItem'),(N'PackagingConfigurationRequestItem')) t(name)
CROSS JOIN (VALUES (N'MaxPalletHeightMM',N'INT'),(N'ProductGradeSnapshot',N'NVARCHAR(MAX)'),(N'SecondaryRecyclableRequirement',N'NVARCHAR(200)'),(N'SecondaryRecycledContent',N'NVARCHAR(200)'),(N'SecondaryMetalizedAluminum',N'NVARCHAR(100)'),(N'SecondarySpecialComments',N'NVARCHAR(1000)'),(N'TertiaryRecyclableRequirement',N'NVARCHAR(200)'),(N'TertiaryRecycledContent',N'NVARCHAR(200)'),(N'TertiaryMetalizedAluminum',N'NVARCHAR(100)'),(N'TertiarySpecialComments',N'NVARCHAR(1000)')) f(name,type);
OPEN columns_to_add; FETCH NEXT FROM columns_to_add INTO @Table,@Field,@Type;
WHILE @@FETCH_STATUS=0 BEGIN
 IF COL_LENGTH(N'dbo.'+@Table,@Field) IS NULL BEGIN
  SET @DDL=N'ALTER TABLE dbo.'+QUOTENAME(@Table)+N' ADD '+QUOTENAME(@Field)+N' '+@Type+N' NULL';EXEC sys.sp_executesql @DDL;
 END;
 FETCH NEXT FROM columns_to_add INTO @Table,@Field,@Type;
END;
CLOSE columns_to_add; DEALLOCATE columns_to_add;
GO
-- Copy shared values to every existing active layer, without replacing per-layer data.
-- Only new columns are changed; previously captured request values stay unchanged.
IF NOT EXISTS(SELECT 1 FROM sys.extended_properties WHERE class=0 AND name=N'PythonBridge.RequestLayerDetailsBackfill')
BEGIN
UPDATE dbo.OpportunityItem SET
 SecondaryRecyclableRequirement=COALESCE(SecondaryRecyclableRequirement,CASE WHEN PackagingLayerCount>=2 THEN RecyclableRequirement END),
 SecondaryRecycledContent=COALESCE(SecondaryRecycledContent,CASE WHEN PackagingLayerCount>=2 THEN RecycledContent END),
 SecondaryMetalizedAluminum=COALESCE(SecondaryMetalizedAluminum,CASE WHEN PackagingLayerCount>=2 THEN MetalizedAluminum END),
 SecondarySpecialComments=COALESCE(SecondarySpecialComments,CASE WHEN PackagingLayerCount>=2 THEN SpecialComments END),
 TertiaryRecyclableRequirement=COALESCE(TertiaryRecyclableRequirement,CASE WHEN PackagingLayerCount>=3 THEN RecyclableRequirement END),
 TertiaryRecycledContent=COALESCE(TertiaryRecycledContent,CASE WHEN PackagingLayerCount>=3 THEN RecycledContent END),
 TertiaryMetalizedAluminum=COALESCE(TertiaryMetalizedAluminum,CASE WHEN PackagingLayerCount>=3 THEN MetalizedAluminum END),
 TertiarySpecialComments=COALESCE(TertiarySpecialComments,CASE WHEN PackagingLayerCount>=3 THEN SpecialComments END),
 MaxPalletHeightMM=COALESCE(MaxPalletHeightMM,CONVERT(INT,MaxPalletHeightM*1000))
WHERE SecondaryRecyclableRequirement IS NULL OR SecondaryRecycledContent IS NULL OR SecondaryMetalizedAluminum IS NULL OR SecondarySpecialComments IS NULL OR TertiaryRecyclableRequirement IS NULL OR TertiaryRecycledContent IS NULL OR TertiaryMetalizedAluminum IS NULL OR TertiarySpecialComments IS NULL OR MaxPalletHeightMM IS NULL;
UPDATE dbo.PackagingConfigurationRequestItem SET
 SecondaryRecyclableRequirement=COALESCE(SecondaryRecyclableRequirement,CASE WHEN RequestedLayerCount>=2 THEN RecyclableRequirement END),
 SecondaryRecycledContent=COALESCE(SecondaryRecycledContent,CASE WHEN RequestedLayerCount>=2 THEN RecycledContent END),
 SecondaryMetalizedAluminum=COALESCE(SecondaryMetalizedAluminum,CASE WHEN RequestedLayerCount>=2 THEN MetalizedAluminum END),
 SecondarySpecialComments=COALESCE(SecondarySpecialComments,CASE WHEN RequestedLayerCount>=2 THEN SpecialComments END),
 TertiaryRecyclableRequirement=COALESCE(TertiaryRecyclableRequirement,CASE WHEN RequestedLayerCount>=3 THEN RecyclableRequirement END),
 TertiaryRecycledContent=COALESCE(TertiaryRecycledContent,CASE WHEN RequestedLayerCount>=3 THEN RecycledContent END),
 TertiaryMetalizedAluminum=COALESCE(TertiaryMetalizedAluminum,CASE WHEN RequestedLayerCount>=3 THEN MetalizedAluminum END),
 TertiarySpecialComments=COALESCE(TertiarySpecialComments,CASE WHEN RequestedLayerCount>=3 THEN SpecialComments END),
 MaxPalletHeightMM=COALESCE(MaxPalletHeightMM,CONVERT(INT,MaxPalletHeightM*1000))
WHERE SecondaryRecyclableRequirement IS NULL OR SecondaryRecycledContent IS NULL OR SecondaryMetalizedAluminum IS NULL OR SecondarySpecialComments IS NULL OR TertiaryRecyclableRequirement IS NULL OR TertiaryRecycledContent IS NULL OR TertiaryMetalizedAluminum IS NULL OR TertiarySpecialComments IS NULL OR MaxPalletHeightMM IS NULL;
 EXEC sys.sp_addextendedproperty @name=N'PythonBridge.RequestLayerDetailsBackfill',@value=N'71';
END;
COMMIT;
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityItem_Fields_Save'));
IF @D IS NULL THROW 52970,'Opportunity fields procedure is missing.',1;
IF CHARINDEX(N'ProductGradeSnapshot',@D)=0 BEGIN
 IF CHARINDEX(N'''NumberOfSecondary''))',@D)=0 OR CHARINDEX(N'UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()',@D)=0
  THROW 52970,'Unexpected Opportunity save signature.',1;
 SET @D=REPLACE(@D,N'''NumberOfSecondary''))',N'''NumberOfSecondary'',''MaxPalletHeightMM'',''ProductGradeSnapshot'',''SecondaryRecyclableRequirement'',''SecondaryRecycledContent'',''SecondaryMetalizedAluminum'',''SecondarySpecialComments'',''TertiaryRecyclableRequirement'',''TertiaryRecycledContent'',''TertiaryMetalizedAluminum'',''TertiarySpecialComments''))');
 SET @D=REPLACE(@D,N'''MaxPalletHeightM'',''ContainerRequest''',N'''MaxPalletHeightM'',''MaxPalletHeightMM'',''ContainerRequest''');
 SET @D=REPLACE(@D,N'DECLARE @OldUser SQL_VARIANT',N'
 -- Normalize mm into the retained meter column, so legacy clients see the same height.
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''MaxPalletHeightMM'')
 BEGIN
  DECLARE @MM INT=TRY_CONVERT(INT,JSON_VALUE(@Fields,''$.MaxPalletHeightMM''));
  IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''MaxPalletHeightMM'' AND [type]<>0)
   AND (@MM IS NULL OR @MM<1 OR @MM>999999999 OR TRY_CONVERT(DECIMAL(18,6),JSON_VALUE(@Fields,''$.MaxPalletHeightMM''))<>@MM)
   THROW 52957,''Max pallet height must be a positive whole number of millimeters.'',1;
  SET @Fields=JSON_MODIFY(@Fields,''$.MaxPalletHeightM'',CONVERT(DECIMAL(9,3),COALESCE(@MM,0)/1000.0));
  IF @MM IS NULL SET @Fields=JSON_MODIFY(@Fields,''strict $.MaxPalletHeightM'',NULL);
 END;
 DECLARE @Grade NVARCHAR(MAX)=JSON_QUERY(@Fields,''$.ProductGradeSnapshot'');
 IF @Grade IS NULL AND NOT EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''ProductGradeSnapshot'')
  SELECT @Grade=ProductGradeSnapshot FROM dbo.OpportunityItem WHERE ID=@ID;
 IF @Grade IS NULL
 SELECT @Grade=(SELECT JSON_QUERY(COALESCE((SELECT g.ParentID,g.ID,g.RawGradeID,g.RawMaterialID,g.Grade,g.RatioPct,m.MaterialCode RawMaterialCode,m.MaterialName RawMaterialName
  FROM dbo.ProductGradeItem g JOIN dbo.ProductGradeVersion v ON v.ID=g.VersionID
  LEFT JOIN dbo.RawMaterial m ON m.ID=g.RawMaterialID
  JOIN dbo.OpportunityItem oi ON oi.ProductID=v.ProductID AND oi.ID=@ID
  WHERE v.Status=''Active'' ORDER BY g.ParentID,g.ID FOR JSON PATH),N''[]'')) items FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 -- SQL callers receive the same structural safeguards as HTTP callers.
 IF @Grade IS NOT NULL AND (ISJSON(@Grade)<>1 OR JSON_QUERY(@Grade,''$.items'') IS NULL)
  THROW 52957,''Invalid product grade snapshot.'',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Grade,''$.items'') j
  WHERE TRY_CONVERT(DECIMAL(5,2),JSON_VALUE(j.value,''$.RatioPct'')) IS NULL
   OR TRY_CONVERT(DECIMAL(5,2),JSON_VALUE(j.value,''$.RatioPct''))<=0)
  THROW 52957,''Invalid grade ratio.'',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Grade,''$.items'') WITH(ParentID NVARCHAR(60),RatioPct DECIMAL(5,2))
  GROUP BY ParentID HAVING SUM(RatioPct)<>100)
  THROW 52957,''Grade ratios must total 100 per parent.'',1;
 -- Dropdown validation permits unchanged historical free text.
 IF @Web=1 AND EXISTS(SELECT 1 FROM OPENJSON(@Fields) j JOIN dbo.OpportunityItem i ON i.ID=@ID
  WHERE j.[key] IN(''RecyclableRequirement'',''RecycledContent'',''MetalizedAluminum'',''SecondaryRecyclableRequirement'',''SecondaryRecycledContent'',''SecondaryMetalizedAluminum'',''TertiaryRecyclableRequirement'',''TertiaryRecycledContent'',''TertiaryMetalizedAluminum'') AND j.[type]<>0
  AND NOT(j.[type]=1 AND ((j.[key] LIKE ''%MetalizedAluminum'' AND j.[value] COLLATE Latin1_General_100_BIN2 IN(N''Metalized'',N''Aluminum'',N''NA''))
   OR (j.[key] NOT LIKE ''%MetalizedAluminum'' AND j.[value] COLLATE Latin1_General_100_BIN2 IN(N''Yes'',N''No'',N''NA''))))
  AND NOT EXISTS(SELECT 1 WHERE CONVERT(VARBINARY(MAX),j.[value])=CONVERT(VARBINARY(MAX),CASE j.[key] WHEN ''RecyclableRequirement'' THEN i.RecyclableRequirement WHEN ''RecycledContent'' THEN i.RecycledContent WHEN ''MetalizedAluminum'' THEN i.MetalizedAluminum WHEN ''SecondaryRecyclableRequirement'' THEN i.SecondaryRecyclableRequirement WHEN ''SecondaryRecycledContent'' THEN i.SecondaryRecycledContent WHEN ''SecondaryMetalizedAluminum'' THEN i.SecondaryMetalizedAluminum WHEN ''TertiaryRecyclableRequirement'' THEN i.TertiaryRecyclableRequirement WHEN ''TertiaryRecycledContent'' THEN i.TertiaryRecycledContent WHEN ''TertiaryMetalizedAluminum'' THEN i.TertiaryMetalizedAluminum END)))
  THROW 52957,''Choose valid recyclable, recycled content and metalized / aluminum options.'',1;
 DECLARE @OldUser SQL_VARIANT');
 SET @D=REPLACE(@D,N'UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()',N'   SecondaryRecyclableRequirement=CASE WHEN @Layers<2 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''SecondaryRecyclableRequirement'') THEN NULLIF(LTRIM(RTRIM(j.SecondaryRecyclableRequirement)),N'''') ELSE t.SecondaryRecyclableRequirement END,
   SecondaryRecycledContent=CASE WHEN @Layers<2 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''SecondaryRecycledContent'') THEN NULLIF(LTRIM(RTRIM(j.SecondaryRecycledContent)),N'''') ELSE t.SecondaryRecycledContent END,
   SecondaryMetalizedAluminum=CASE WHEN @Layers<2 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''SecondaryMetalizedAluminum'') THEN NULLIF(LTRIM(RTRIM(j.SecondaryMetalizedAluminum)),N'''') ELSE t.SecondaryMetalizedAluminum END,
   SecondarySpecialComments=CASE WHEN @Layers<2 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''SecondarySpecialComments'') THEN NULLIF(LTRIM(RTRIM(j.SecondarySpecialComments)),N'''') ELSE t.SecondarySpecialComments END,
   TertiaryRecyclableRequirement=CASE WHEN @Layers<3 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''TertiaryRecyclableRequirement'') THEN NULLIF(LTRIM(RTRIM(j.TertiaryRecyclableRequirement)),N'''') ELSE t.TertiaryRecyclableRequirement END,
   TertiaryRecycledContent=CASE WHEN @Layers<3 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''TertiaryRecycledContent'') THEN NULLIF(LTRIM(RTRIM(j.TertiaryRecycledContent)),N'''') ELSE t.TertiaryRecycledContent END,
   TertiaryMetalizedAluminum=CASE WHEN @Layers<3 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''TertiaryMetalizedAluminum'') THEN NULLIF(LTRIM(RTRIM(j.TertiaryMetalizedAluminum)),N'''') ELSE t.TertiaryMetalizedAluminum END,
   TertiarySpecialComments=CASE WHEN @Layers<3 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''TertiarySpecialComments'') THEN NULLIF(LTRIM(RTRIM(j.TertiarySpecialComments)),N'''') ELSE t.TertiarySpecialComments END,
   MaxPalletHeightMM=CASE WHEN @Web=1 AND @Configuration=''Floor load'' THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''MaxPalletHeightM'') THEN CONVERT(INT,j.MaxPalletHeightM*1000) ELSE t.MaxPalletHeightMM END,
   ProductGradeSnapshot=@Grade,
   UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()');
 SET @D=REPLACE(@D,N'NumberOfSecondary INT) j',N'NumberOfSecondary INT,SecondaryRecyclableRequirement NVARCHAR(200),SecondaryRecycledContent NVARCHAR(200),SecondaryMetalizedAluminum NVARCHAR(100),SecondarySpecialComments NVARCHAR(1000),TertiaryRecyclableRequirement NVARCHAR(200),TertiaryRecycledContent NVARCHAR(200),TertiaryMetalizedAluminum NVARCHAR(100),TertiarySpecialComments NVARCHAR(1000)) j');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
-- Freeze the additional fields at request INSERT time, never from live Product afterward.
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingRequest_Create_AuditImplementation'));
IF @D IS NULL THROW 52970,'Request creation implementation is missing.',1;
IF CHARINDEX(N'ProductGradeSnapshot',@D)=0 BEGIN
 IF CHARINDEX(N'TertiaryTransparency,NumberOfSecondary)',@D)=0 THROW 52970,'Unexpected request INSERT.',1;
 SET @D=REPLACE(@D,N'TertiaryTransparency,NumberOfSecondary)',N'TertiaryTransparency,NumberOfSecondary,MaxPalletHeightMM,ProductGradeSnapshot,SecondaryRecyclableRequirement,SecondaryRecycledContent,SecondaryMetalizedAluminum,SecondarySpecialComments,TertiaryRecyclableRequirement,TertiaryRecycledContent,TertiaryMetalizedAluminum,TertiarySpecialComments)');
 SET @D=REPLACE(@D,N'i.TertiaryTransparency,i.NumberOfSecondary',N'i.TertiaryTransparency,i.NumberOfSecondary,i.MaxPalletHeightMM,COALESCE(i.ProductGradeSnapshot,(SELECT JSON_QUERY(COALESCE((SELECT g.ParentID,g.ID,g.RawGradeID,g.RawMaterialID,g.Grade,g.RatioPct,m.MaterialCode RawMaterialCode,m.MaterialName RawMaterialName FROM dbo.ProductGradeItem g JOIN dbo.ProductGradeVersion v ON v.ID=g.VersionID LEFT JOIN dbo.RawMaterial m ON m.ID=g.RawMaterialID WHERE v.ProductID=i.ProductID AND v.Status=''Active'' ORDER BY g.ParentID,g.ID FOR JSON PATH),N''[]'')) items FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)),i.SecondaryRecyclableRequirement,i.SecondaryRecycledContent,i.SecondaryMetalizedAluminum,i.SecondarySpecialComments,i.TertiaryRecyclableRequirement,i.TertiaryRecycledContent,i.TertiaryMetalizedAluminum,i.TertiarySpecialComments');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
-- Extend processing locks and immutable snapshots to all new fields.
DECLARE @Name SYSNAME,@D NVARCHAR(MAX),@Prefix CHAR(1),@Extra NVARCHAR(MAX);
DECLARE guards CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM sys.triggers
 WHERE name IN('tr_OpportunityItem_ProcessingLock','tr_PackagingRequestItem_LayerSnapshotImmutable');
OPEN guards;FETCH NEXT FROM guards INTO @Name;
WHILE @@FETCH_STATUS=0 BEGIN
 SET @D=OBJECT_DEFINITION(OBJECT_ID('dbo.'+@Name));
 IF CHARINDEX(N'i.ProductGradeSnapshot',@D)=0 BEGIN
  SET @D=REPLACE(@D,N'i.NumberOfSecondary',N'i.NumberOfSecondary,i.MaxPalletHeightMM,CONVERT(VARBINARY(MAX),i.ProductGradeSnapshot),CONVERT(VARBINARY(MAX),i.SecondaryRecyclableRequirement),CONVERT(VARBINARY(MAX),i.SecondaryRecycledContent),CONVERT(VARBINARY(MAX),i.SecondaryMetalizedAluminum),CONVERT(VARBINARY(MAX),i.SecondarySpecialComments),CONVERT(VARBINARY(MAX),i.TertiaryRecyclableRequirement),CONVERT(VARBINARY(MAX),i.TertiaryRecycledContent),CONVERT(VARBINARY(MAX),i.TertiaryMetalizedAluminum),CONVERT(VARBINARY(MAX),i.TertiarySpecialComments)');
  SET @D=REPLACE(@D,N'd.NumberOfSecondary',N'd.NumberOfSecondary,d.MaxPalletHeightMM,CONVERT(VARBINARY(MAX),d.ProductGradeSnapshot),CONVERT(VARBINARY(MAX),d.SecondaryRecyclableRequirement),CONVERT(VARBINARY(MAX),d.SecondaryRecycledContent),CONVERT(VARBINARY(MAX),d.SecondaryMetalizedAluminum),CONVERT(VARBINARY(MAX),d.SecondarySpecialComments),CONVERT(VARBINARY(MAX),d.TertiaryRecyclableRequirement),CONVERT(VARBINARY(MAX),d.TertiaryRecycledContent),CONVERT(VARBINARY(MAX),d.TertiaryMetalizedAluminum),CONVERT(VARBINARY(MAX),d.TertiarySpecialComments)');
  SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER TRIGGER',N'ALTER TRIGGER'),N'CREATE   TRIGGER',N'ALTER TRIGGER'),N'CREATE TRIGGER',N'ALTER TRIGGER');
  EXEC sys.sp_executesql @D;
 END;
 FETCH NEXT FROM guards INTO @Name;
END;
CLOSE guards;DEALLOCATE guards;
GO
-- Audit through the established per-field history, with request fields marked non-response.
DECLARE @Name SYSNAME,@D NVARCHAR(MAX),@Rows NVARCHAR(MAX),@Field SYSNAME;
DECLARE audits CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM sys.triggers
 WHERE name IN('tr_OpportunityItem_ChangeLog','tr_PackagingConfigurationRequestItem_ChangeLog');
OPEN audits;FETCH NEXT FROM audits INTO @Name;
WHILE @@FETCH_STATUS=0 BEGIN
 SET @D=OBJECT_DEFINITION(OBJECT_ID(N'dbo.'+@Name));SET @Rows=N'';
 DECLARE fields CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM sys.columns
 WHERE object_id=OBJECT_ID(CASE WHEN @Name='tr_OpportunityItem_ChangeLog' THEN 'dbo.OpportunityItem' ELSE 'dbo.PackagingConfigurationRequestItem' END)
 AND name IN('MaxPalletHeightMM','ProductGradeSnapshot','SecondaryRecyclableRequirement','SecondaryRecycledContent','SecondaryMetalizedAluminum','SecondarySpecialComments','TertiaryRecyclableRequirement','TertiaryRecycledContent','TertiaryMetalizedAluminum','TertiarySpecialComments');
 OPEN fields;FETCH NEXT FROM fields INTO @Field;
 WHILE @@FETCH_STATUS=0 BEGIN
  IF CHARINDEX(QUOTENAME(@Field,'''')+N',',@D)=0
   SET @Rows+=N'('+QUOTENAME(@Field,'''')+N',CONVERT(NVARCHAR(MAX),d.'+QUOTENAME(@Field)+N'),CONVERT(NVARCHAR(MAX),i.'+QUOTENAME(@Field)+N')'+CASE WHEN @Name='tr_OpportunityItem_ChangeLog' THEN N'' ELSE N',0' END+N'),';
  FETCH NEXT FROM fields INTO @Field;
 END;
 CLOSE fields;DEALLOCATE fields;
 IF @Rows<>N'' BEGIN
  IF CHARINDEX(N'CROSS APPLY(VALUES',@D)=0 THROW 52970,'Unexpected audit trigger.',1;
  SET @D=REPLACE(@D,N'CROSS APPLY(VALUES',N'CROSS APPLY(VALUES'+@Rows);
  SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER TRIGGER',N'ALTER TRIGGER'),N'CREATE   TRIGGER',N'ALTER TRIGGER'),N'CREATE TRIGGER',N'ALTER TRIGGER');
  EXEC sys.sp_executesql @D;
 END;
 FETCH NEXT FROM audits INTO @Name;
END;
CLOSE audits;DEALLOCATE audits;
GO
GO
-- END MIGRATION 71_packaging_request_layer_details.sql

-- BEGIN MIGRATION 72_packaging_response_pallet_defaults.sql
-- SOURCE SHA256 fd1b267609a1a2e0e326d9937dc6d6d7dad78afd7bec1be86b4bf2602b6997dd
PRINT N'Applying 72_packaging_response_pallet_defaults.sql';
GO
GO
-- After 71. Separate editable response pallet specifications from frozen requests.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','ResponsePalletSize') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD ResponsePalletSize NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','ResponsePalletStacking') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD ResponsePalletStacking NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','ResponseMaxPalletHeightMM') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD ResponseMaxPalletHeightMM INT NULL
  CONSTRAINT CK_PCRItem_ResponseMaxPalletHeightMM CHECK(ResponseMaxPalletHeightMM BETWEEN 1 AND 999999999);
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','ResponseDefaultsInitialized') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD ResponseDefaultsInitialized BIT NOT NULL
  CONSTRAINT DF_PCRItem_ResponseDefaultsInitialized DEFAULT(0) WITH VALUES;
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation'));
IF @D IS NULL OR CHARINDEX(N'-- Container loading count validation.',@D)=0
 THROW 52970,'Run migrations through 71 first.',1;
IF CHARINDEX(N'ResponsePalletSize',@D)=0
BEGIN
 IF CHARINDEX(N'''CartonsPerContainerFloor'',''NutDensity''',@D)=0
  OR CHARINDEX(N'CartonsPerContainerFloor INT) j',@D)=0
  OR CHARINDEX(N' NutDensity=CASE',@D)=0
  OR CHARINDEX(N'DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT',@D)=0
  THROW 52970,'Unexpected response pallet procedure signature.',1;
 SET @D=REPLACE(@D,N'''CartonsPerContainerFloor'',''NutDensity''',
  N'''CartonsPerContainerFloor'',''ResponsePalletSize'',''ResponsePalletStacking'',''ResponseMaxPalletHeightMM'',''NutDensity''');
 SET @D=REPLACE(@D,N'CartonsPerContainerFloor INT) j',
  N'CartonsPerContainerFloor INT,ResponsePalletSize NVARCHAR(100),ResponsePalletStacking NVARCHAR(100),ResponseMaxPalletHeightMM INT) j');
 SET @D=REPLACE(@D,N' NutDensity=CASE',N' ResponsePalletSize=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''ResponsePalletSize'') THEN NULLIF(LTRIM(RTRIM(j.ResponsePalletSize)),N'''') ELSE t.ResponsePalletSize END,
 ResponsePalletStacking=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''ResponsePalletStacking'') THEN NULLIF(LTRIM(RTRIM(j.ResponsePalletStacking)),N'''') ELSE t.ResponsePalletStacking END,
 ResponseMaxPalletHeightMM=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''ResponseMaxPalletHeightMM'') THEN j.ResponseMaxPalletHeightMM ELSE t.ResponseMaxPalletHeightMM END,
 ResponseDefaultsInitialized=1,
 NutDensity=CASE');
 SET @D=REPLACE(@D,N'DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT',N'-- Response pallet specifications are independent of request configuration.
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''ResponseMaxPalletHeightMM'' AND [type]<>0
  AND ([type] NOT IN(1,2) OR [value] LIKE ''%[^0-9]%'' OR TRY_CONVERT(INT,[value]) IS NULL OR TRY_CONVERT(INT,[value]) NOT BETWEEN 1 AND 999999999))
  THROW 52961,''Max pallet height must be a positive whole number of millimeters up to 999,999,999.'',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) j JOIN dbo.PackagingConfigurationRequestItem i ON i.ID=@ID
  WHERE j.[key]=''ResponsePalletStacking'' AND j.[type]<>0 AND NULLIF(LTRIM(RTRIM(j.[value])),N'''') IS NOT NULL
  AND (j.[type]<>1 OR j.[value] COLLATE Latin1_General_100_BIN2 NOT IN(N''Single'',N''Double''))
  AND NOT EXISTS(SELECT 1 WHERE CONVERT(VARBINARY(MAX),j.[value])=CONVERT(VARBINARY(MAX),i.ResponsePalletStacking)
   OR CONVERT(VARBINARY(MAX),j.[value])=CONVERT(VARBINARY(MAX),i.PalletStacking)))
  THROW 52961,''Choose Single or Double for pallet stacking.'',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) j JOIN dbo.PackagingConfigurationRequestItem i ON i.ID=@ID
  WHERE j.[key]=''ResponsePalletSize'' AND j.[type]<>0 AND NULLIF(LTRIM(RTRIM(j.[value])),N'''') IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM dbo.v_PalletMaster p JOIN dbo.UoM u ON u.ID=p.UoMID
   WHERE p.PalletSize=j.[value] AND p.Status=''Active'' AND u.Status=''Active'')
  AND NOT EXISTS(SELECT 1 WHERE CONVERT(VARBINARY(MAX),j.[value])=CONVERT(VARBINARY(MAX),i.ResponsePalletSize)
   OR CONVERT(VARBINARY(MAX),j.[value])=CONVERT(VARBINARY(MAX),i.PalletSize)))
  THROW 52961,''Choose an active pallet size from Pallet Master.'',1;
 DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
-- New requests capture defaults at INSERT time. Never rewrite existing responses.
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingRequest_Create_AuditImplementation'));
IF @D IS NULL OR CHARINDEX(N'TertiarySpecialComments',@D)=0
 THROW 52970,'Run request snapshot migration 71 first.',1;
IF CHARINDEX(N'ResponseDefaultsInitialized',@D)=0
BEGIN
 IF CHARINDEX(N'TertiarySpecialComments)',@D)=0 OR CHARINDEX(N'i.TertiarySpecialComments',@D)=0
  THROW 52970,'Unexpected request default INSERT signature.',1;
 SET @D=REPLACE(@D,N'TertiarySpecialComments)',N'TertiarySpecialComments,ResponseLayerCount,FirstPMType,SecondPMType,ThirdPMType,UnitsPerCarton,UnitsPerTertiary,ResponsePalletSize,ResponsePalletStacking,ResponseMaxPalletHeightMM,ResponseDefaultsInitialized)');
 SET @D=REPLACE(@D,N'i.TertiarySpecialComments',N'i.TertiarySpecialComments,i.PackagingLayerCount,
  (SELECT PackagingType FROM dbo.PackagingType WHERE ID=i.PrimaryTypeID),
  CASE WHEN i.PackagingLayerCount>=2 THEN (SELECT PackagingType FROM dbo.PackagingType WHERE ID=i.SecondaryTypeID) END,
  CASE WHEN i.PackagingLayerCount>=3 THEN (SELECT PackagingType FROM dbo.PackagingType WHERE ID=i.TertiaryTypeID) END,
  CASE WHEN i.PackagingLayerCount>=2 THEN i.NumberOfPrimary END,
  CASE WHEN i.PackagingLayerCount>=3 THEN i.NumberOfSecondary END,
  CASE WHEN i.ParentItemID IS NULL THEN i.PalletSize END,
  CASE WHEN i.ParentItemID IS NULL THEN i.PalletStacking END,
  CASE WHEN i.ParentItemID IS NULL THEN i.MaxPalletHeightMM END,1');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.tr_PackagingConfigurationRequestItem_ChangeLog'));
IF @D IS NULL OR CHARINDEX(N'CROSS APPLY(VALUES',@D)=0
 THROW 52970,'Unexpected request item audit trigger.',1;
DECLARE @Rows NVARCHAR(MAX)=N'',@Field SYSNAME;
DECLARE fields CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM sys.columns
 WHERE object_id=OBJECT_ID('dbo.PackagingConfigurationRequestItem')
 AND name IN(N'ResponsePalletSize',N'ResponsePalletStacking',N'ResponseMaxPalletHeightMM');
OPEN fields;FETCH NEXT FROM fields INTO @Field;
WHILE @@FETCH_STATUS=0 BEGIN
 IF CHARINDEX(QUOTENAME(@Field,'''')+N',',@D)=0
  SET @Rows+=N'('+QUOTENAME(@Field,'''')+N',CONVERT(NVARCHAR(MAX),d.'+QUOTENAME(@Field)+N'),CONVERT(NVARCHAR(MAX),i.'+QUOTENAME(@Field)+N'),1),';
 FETCH NEXT FROM fields INTO @Field;
END;
CLOSE fields;DEALLOCATE fields;
IF @Rows<>N'' BEGIN
 SET @D=REPLACE(@D,N'CROSS APPLY(VALUES',N'CROSS APPLY(VALUES'+@Rows);
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER TRIGGER',N'ALTER TRIGGER'),N'CREATE   TRIGGER',N'ALTER TRIGGER'),N'CREATE TRIGGER',N'ALTER TRIGGER');
 EXEC sys.sp_executesql @D;
END;
COMMIT;
GO
GO
-- END MIGRATION 72_packaging_response_pallet_defaults.sql

-- BEGIN MIGRATION 73_packaging_type_shipping.sql
-- SOURCE SHA256 cecf02b6275e78f537e7d1fc0a6b73aa3b4286b093f1d08786076688deb047d3
PRINT N'Applying 73_packaging_type_shipping.sql';
GO
GO
-- After 72. Shipping is root-only; existing types remain explicitly non-shipping.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.PackagingType','Shipping') IS NULL
 ALTER TABLE dbo.PackagingType ADD Shipping BIT NOT NULL
  CONSTRAINT DF_PackagingType_Shipping DEFAULT(0) WITH VALUES;
GO
IF OBJECT_ID('dbo.CK_PackagingType_ShippingRoot','C') IS NULL
 ALTER TABLE dbo.PackagingType WITH CHECK ADD CONSTRAINT CK_PackagingType_ShippingRoot
  CHECK(Shipping=0 OR ParentTypeID IS NULL);
GO
EXEC sys.sp_refreshview N'dbo.v_PackagingTypeWeb';
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingType_Batch'));
IF @D IS NULL OR CHARINDEX(N'DECLARE @ChosenOrders TABLE',@D)=0
 THROW 52970,'Run Packaging Type order migration 66 first.',1;
IF CHARINDEX(N'-- Shipping root flag.',@D)=0 BEGIN
 SET @D=REPLACE(@D,N'DECLARE @ChosenOrders TABLE',N'DECLARE @Shipping BIT,@ShippingSet BIT;
 DECLARE @ChosenOrders TABLE');
 SET @D=REPLACE(@D,N'SET @Name=NULLIF',N'-- Shipping root flag.
    SET @ShippingSet=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Rows) r CROSS APPLY OPENJSON(r.value) j
     WHERE TRY_CONVERT(INT,JSON_VALUE(r.value,''$.RowNum''))=@Row AND j.[key]=''Shipping'') THEN 1 ELSE 0 END;
    SET @Shipping=0;
    IF @ShippingSet=1 BEGIN
     IF EXISTS(SELECT 1 FROM OPENJSON(@Rows) r CROSS APPLY OPENJSON(r.value) j
      WHERE TRY_CONVERT(INT,JSON_VALUE(r.value,''$.RowNum''))=@Row AND j.[key]=''Shipping'' AND j.[type]<>3)
      THROW 51111,''Shipping must be True or False.'',1;
     SELECT @Shipping=CASE JSON_VALUE(r.value,''$.Shipping'') WHEN ''true'' THEN 1 ELSE 0 END
      FROM OPENJSON(@Rows) r WHERE TRY_CONVERT(INT,JSON_VALUE(r.value,''$.RowNum''))=@Row;
    END ELSE IF @Cmd=''U'' SELECT @Shipping=Shipping FROM dbo.PackagingType WHERE ID=@ID;
    IF @Parent IS NOT NULL BEGIN
     IF @ShippingSet=1 AND @Shipping=1 THROW 51111,''Shipping applies only to root Packaging Types.'',1;
     SET @Shipping=0;
    END;
    SET @Name=NULLIF');
 SET @D=REPLACE(@D,N'TareWeight,Status,CreatedBy,ParentTypeID)',N'TareWeight,Status,CreatedBy,ParentTypeID,Shipping)');
 SET @D=REPLACE(@D,N'@Basis,0,@Status,@Actor,@Parent)',N'@Basis,0,@Status,@Actor,@Parent,@Shipping)');
 SET @D=REPLACE(@D,N'ParentTypeID=@Parent,Status=@Status',N'ParentTypeID=@Parent,Shipping=@Shipping,Status=@Status');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingType_Batch'));
IF CHARINDEX(N'-- Shipping existing dimensions.',@D)=0 BEGIN
 SET @D=REPLACE(@D,N'SET @Name=NULLIF',N'-- Shipping existing dimensions.
    IF @Shipping=1 AND EXISTS(SELECT 1 FROM dbo.PackagingDimension WHERE PackagingTypeID=@ID AND Status=''Active''
     AND (NULLIF(LTRIM(RTRIM(D1Name)),N'''') IS NULL OR NULLIF(LTRIM(RTRIM(D2Name)),N'''') IS NULL
      OR NULLIF(LTRIM(RTRIM(D3Name)),N'''') IS NULL OR D1UoMID IS NULL OR D2UoMID IS NULL OR D3UoMID IS NULL))
     THROW 51111,''Complete all three active dimension names and units before enabling Shipping.'',1;
    SET @Name=NULLIF');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
DECLARE @Name SYSNAME,@D NVARCHAR(MAX);
DECLARE lookups CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM sys.procedures
 WHERE name IN('usp_OpportunityPackagingTypeLookup_Read','usp_PackagingResponseTypeLookup_Read');
OPEN lookups; FETCH NEXT FROM lookups INTO @Name;
WHILE @@FETCH_STATUS=0 BEGIN
 SET @D=OBJECT_DEFINITION(OBJECT_ID('dbo.'+@Name));
 IF CHARINDEX(N'PackagingType,Shipping,ParentTypeID',@D)=0 BEGIN
  IF CHARINDEX(N'PackagingType,ParentTypeID',@D)=0 THROW 52970,'Unexpected type lookup signature.',1;
  SET @D=REPLACE(@D,N'PackagingType,ParentTypeID',N'PackagingType,Shipping,ParentTypeID');
  SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
  EXEC sys.sp_executesql @D;
 END;
 FETCH NEXT FROM lookups INTO @Name;
END;
CLOSE lookups; DEALLOCATE lookups;
GO
-- Required dimension definitions, independent of Count/Volume/Square meter basis.
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingDimension_Save'));
IF @D IS NULL OR CHARINDEX(N'@PriceBasis NVARCHAR(20)',@D)=0
 THROW 52970,'Run dimension migration 62 first.',1;
IF CHARINDEX(N'-- Shipping dimensions.',@D)=0 BEGIN
 SET @D=REPLACE(@D,N'@PriceBasis NVARCHAR(20)',N'@Shipping BIT,@PriceBasis NVARCHAR(20)');
 SET @D=REPLACE(@D,N'SELECT @PriceBasis=PriceBasis',N'SELECT @Shipping=Shipping,@PriceBasis=PriceBasis');
 SET @D=REPLACE(@D,N'IF @PriceBasis<>N''Square meter'' SET',N'IF @PriceBasis<>N''Square meter'' AND @Shipping=0 SET');
 SET @D=REPLACE(@D,N'IF @D1 IS NULL OR',N'-- Shipping dimensions.
 IF @Shipping=1 AND (@D1 IS NULL OR @D2 IS NULL OR @D3 IS NULL OR @D1UoMID IS NULL OR @D2UoMID IS NULL OR @D3UoMID IS NULL)
  THROW 51111,''Shipping types require D1, D2 and D3 names and units.'',1;
 IF @D1 IS NULL OR');
 SET @D=REPLACE(@D,N'IF @PriceBasis=N''Square meter'' AND ((',N'IF (@PriceBasis=N''Square meter'' OR @Shipping=1) AND ((');
 SET @D=REPLACE(@D,N'IF @PriceBasis=N''Square meter'' AND @NeedsReview=1',N'IF (@PriceBasis=N''Square meter'' OR @Shipping=1) AND @NeedsReview=1');
 SET @D=REPLACE(@D,N'CASE WHEN @PriceBasis=N''Square meter'' AND @FormulaReviewed=1',N'CASE WHEN (@PriceBasis=N''Square meter'' OR @Shipping=1) AND @FormulaReviewed=1');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
CREATE OR ALTER TRIGGER dbo.tr_PackagingDimension_ShippingRequired
ON dbo.PackagingDimension AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM inserted d JOIN dbo.PackagingType t ON t.ID=d.PackagingTypeID
  WHERE t.Shipping=1 AND (NULLIF(LTRIM(RTRIM(d.D1Name)),N'') IS NULL
   OR NULLIF(LTRIM(RTRIM(d.D2Name)),N'') IS NULL OR NULLIF(LTRIM(RTRIM(d.D3Name)),N'') IS NULL
   OR d.D1UoMID IS NULL OR d.D2UoMID IS NULL OR d.D3UoMID IS NULL))
  THROW 51111,'Shipping types require D1, D2 and D3 names and units.',1;
END;
GO
CREATE OR ALTER TRIGGER dbo.tr_PackagingType_ShippingDimensions
ON dbo.PackagingType AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM inserted t JOIN dbo.PackagingDimension d ON d.PackagingTypeID=t.ID
  WHERE t.Shipping=1 AND d.Status='Active' AND (NULLIF(LTRIM(RTRIM(d.D1Name)),N'') IS NULL
   OR NULLIF(LTRIM(RTRIM(d.D2Name)),N'') IS NULL OR NULLIF(LTRIM(RTRIM(d.D3Name)),N'') IS NULL
   OR d.D1UoMID IS NULL OR d.D2UoMID IS NULL OR d.D3UoMID IS NULL))
  THROW 51111,'Complete all three active dimension names and units before enabling Shipping.',1;
END;
GO
-- Grandfather unchanged historical choices, but reject new non-shipping final types.
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityItem_Fields_Save'));
IF @D IS NULL OR CHARINDEX(N'ProductGradeSnapshot',@D)=0 THROW 52970,'Run migration 71 first.',1;
IF CHARINDEX(N'-- Shipping final request.',@D)=0 BEGIN
 SET @D=REPLACE(@D,N'DECLARE @OldUser SQL_VARIANT',N'-- Shipping final request.
 IF @Web=1 AND @Layers>=2 AND EXISTS(SELECT 1 FROM dbo.OpportunityItem i
  CROSS APPLY(SELECT CASE WHEN @Layers=2 THEN
   CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''SecondaryTypeID'') THEN TRY_CONVERT(INT,JSON_VALUE(@Fields,''$.SecondaryTypeID'')) ELSE i.SecondaryTypeID END
   ELSE CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''TertiaryTypeID'') THEN TRY_CONVERT(INT,JSON_VALUE(@Fields,''$.TertiaryTypeID'')) ELSE i.TertiaryTypeID END END TypeID) v
  WHERE i.ID=@ID AND v.TypeID IS NOT NULL
   AND NOT(i.PackagingLayerCount=@Layers AND v.TypeID=COALESCE(CASE WHEN @Layers=2 THEN i.SecondaryTypeID ELSE i.TertiaryTypeID END,-1))
   AND NOT EXISTS(SELECT 1 FROM dbo.PackagingType t WHERE t.ID=v.TypeID AND t.Shipping=1 AND t.ParentTypeID IS NULL
    AND EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder o WHERE o.PackagingTypeID=t.ID AND o.PackagingOrder=CASE WHEN @Layers=2 THEN ''Secondary'' ELSE ''Tertiary'' END)))
  THROW 52957,''The final packaging layer requires a Shipping type in the matching order.'',1;
 DECLARE @OldUser SQL_VARIANT');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation'));
IF @D IS NULL OR CHARINDEX(N'ResponsePalletSize',@D)=0 THROW 52970,'Run migration 72 first.',1;
IF CHARINDEX(N'-- Shipping final response.',@D)=0 BEGIN
 SET @D=REPLACE(@D,N'DECLARE @OldUser SQL_VARIANT',N'-- Shipping final response.
 IF @Layers>=2 AND EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem i
  CROSS APPLY(SELECT CASE WHEN @Layers=2 THEN
   CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''SecondPMType'') THEN NULLIF(LTRIM(RTRIM(JSON_VALUE(@Fields,''$.SecondPMType''))),N'''') ELSE i.SecondPMType END
   ELSE CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''ThirdPMType'') THEN NULLIF(LTRIM(RTRIM(JSON_VALUE(@Fields,''$.ThirdPMType''))),N'''') ELSE i.ThirdPMType END END TypeName) v
  WHERE i.ID=@ID AND v.TypeName IS NOT NULL
   AND NOT(COALESCE(i.ResponseLayerCount,i.RequestedLayerCount)=@Layers AND v.TypeName=COALESCE(CASE WHEN @Layers=2 THEN i.SecondPMType ELSE i.ThirdPMType END,N''''))
   AND NOT EXISTS(SELECT 1 FROM dbo.PackagingType t WHERE t.PackagingType=v.TypeName AND t.Shipping=1 AND t.ParentTypeID IS NULL
    AND EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder o WHERE o.PackagingTypeID=t.ID AND o.PackagingOrder=CASE WHEN @Layers=2 THEN ''Secondary'' ELSE ''Tertiary'' END)))
  THROW 52961,''The final packaging layer requires a Shipping type in the matching order.'',1;
 DECLARE @OldUser SQL_VARIANT');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
COMMIT;
GO
GO
-- END MIGRATION 73_packaging_type_shipping.sql

-- BEGIN MIGRATION 74_packaging_dimension_volume_formula.sql
-- SOURCE SHA256 6811bd3eaddb5da80b0cd7498d3066178e096be3c7cb20081afe6b5d6651eccf
PRINT N'Applying 74_packaging_dimension_volume_formula.sql';
GO
GO
-- After 73. Shipping-only volume definitions; never store temporary measurements.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.PackagingType','Shipping') IS NULL
 THROW 52974,'Apply Shipping migration 73 first.',1;
IF COL_LENGTH('dbo.PackagingDimension','VolumeFormula') IS NULL
 ALTER TABLE dbo.PackagingDimension ADD VolumeFormula NVARCHAR(200) NULL;
GO
IF OBJECT_ID('dbo.CK_PackagingDimension_VolumeFormula','C') IS NULL
 ALTER TABLE dbo.PackagingDimension WITH CHECK ADD CONSTRAINT CK_PackagingDimension_VolumeFormula
 CHECK(VolumeFormula IS NULL OR LEN(LTRIM(RTRIM(VolumeFormula)))>0);
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingDimension_Save'));
IF @D IS NULL OR CHARINDEX(N'-- Shipping dimensions.',@D)=0
 THROW 52974,'Apply Shipping dimension procedure migration 73 first.',1;
IF CHARINDEX(N'-- Shipping volume formula.',@D)=0 BEGIN
 IF CHARINDEX(N'@FormulaReviewed BIT=0',@D)=0 OR CHARINDEX(N'@OldFormula=SquareMeterFormula',@D)=0
  OR CHARINDEX(N'SquareMeterFormula,Status,CreatedBy)',@D)=0
  THROW 52974,'Unexpected dimension save signature.',1;
 SET @D=REPLACE(@D,N'@FormulaReviewed BIT=0',N'@FormulaReviewed BIT=0,@VolumeFormula NVARCHAR(200)=NULL,@VolumeFormulaProvided BIT=0');
 SET @D=REPLACE(@D,N'DECLARE @Actor INT',N'DECLARE @OldVolumeFormula NVARCHAR(200); DECLARE @Actor INT');
 SET @D=REPLACE(@D,N'@OldFormula=SquareMeterFormula',N'@OldFormula=SquareMeterFormula,@OldVolumeFormula=VolumeFormula');
 SET @D=REPLACE(@D,N'IF @PriceBasis IS NULL THROW',N'-- Shipping volume formula.
 SET @VolumeFormula=NULLIF(LTRIM(RTRIM(@VolumeFormula)),N'''');
 IF @Shipping=0 AND @VolumeFormulaProvided=1 AND @VolumeFormula IS NOT NULL
  AND (@OldVolumeFormula IS NULL OR @VolumeFormula<>@OldVolumeFormula)
  THROW 51111,''Volume formula applies only to Shipping types.'',1;
 -- Older clients omit the new parameter; non-shipping rows retain hidden history.
 IF @VolumeFormulaProvided=0 OR @Shipping=0 SET @VolumeFormula=@OldVolumeFormula;
 IF @Shipping=1 AND ((CHARINDEX(N''D2'',@VolumeFormula)>0 AND @D2 IS NULL)
  OR (CHARINDEX(N''D3'',@VolumeFormula)>0 AND @D3 IS NULL))
  THROW 51111,''Define names and units for dimensions used in the volume formula.'',1;
 IF @PriceBasis IS NULL THROW');
 SET @D=REPLACE(@D,N'SquareMeterFormula,Status,CreatedBy)',N'SquareMeterFormula,Status,CreatedBy,VolumeFormula)');
 SET @D=REPLACE(@D,N'@SquareMeterFormula,@Status,@Actor)',N'@SquareMeterFormula,@Status,@Actor,@VolumeFormula)');
 SET @D=REPLACE(@D,N'SquareMeterFormula=@SquareMeterFormula,',N'SquareMeterFormula=@SquareMeterFormula,VolumeFormula=@VolumeFormula,');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
CREATE OR ALTER TRIGGER dbo.tr_PackagingDimension_VolumeShipping
ON dbo.PackagingDimension AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM inserted i JOIN dbo.PackagingType t ON t.ID=i.PackagingTypeID
  LEFT JOIN deleted d ON d.ID=i.ID
  WHERE t.Shipping=0 AND i.VolumeFormula IS NOT NULL
   AND (d.ID IS NULL OR d.VolumeFormula IS NULL OR d.VolumeFormula<>i.VolumeFormula))
  THROW 51111,'Volume formula applies only to Shipping types.',1;
END;
GO
COMMIT;
GO
GO
-- END MIGRATION 74_packaging_dimension_volume_formula.sql

-- BEGIN MIGRATION 75_packaging_material_child_types.sql
-- SOURCE SHA256 35418abac485892ad9fef27b3cd71d9987903eaa6921b6e887f2f2a10a976146
PRINT N'Applying 75_packaging_material_child_types.sql';
GO
GO
-- Packaging Material: child leaf assignments only, retain retired Description data.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingMaterial_BatchV2'));
IF @D IS NULL OR CHARINDEX(N'@TypeSet',@D)=0
 THROW 52975,'Apply Packaging Material migration 53 first.',1;
IF CHARINDEX(N'-- Material child-only assignments.',@D)=0 BEGIN
 IF CHARINDEX(N'IF @TypeID IS NOT NULL AND NOT EXISTS(',@D)=0
  THROW 52975,'Unexpected Packaging Material procedure signature.',1;
 SET @D=REPLACE(@D,N'IF @TypeID IS NOT NULL AND NOT EXISTS(',N'-- Material child-only assignments.
                IF @TypeID IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.PackagingType t
                 WHERE t.ID=@TypeID AND t.ParentTypeID IS NOT NULL
                  AND NOT EXISTS(SELECT 1 FROM dbo.PackagingType child WHERE child.ParentTypeID=t.ID))
                 AND NOT(@Command=''U'' AND EXISTS(SELECT 1 FROM dbo.PackagingMaterial WHERE ID=@ID AND PackagingTypeID=@TypeID))
                 THROW 51111,''Choose an active child Packaging Type with no children.'',1;
                -- Description is retired from entry; preserve it on updates.
                IF @Command=''U'' SELECT @Description=Description FROM dbo.PackagingMaterial WHERE ID=@ID;
                ELSE SET @Description=NULL;
                IF @TypeID IS NOT NULL AND NOT EXISTS(');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
COMMIT;
GO
GO
-- END MIGRATION 75_packaging_material_child_types.sql

-- BEGIN MIGRATION 76_packaging_pallet_layers.sql
-- SOURCE SHA256 6aa807de2660767067177b02230895b23e1de0c7331a4ce2ba4da3e62cf41dc2
PRINT N'Applying 76_packaging_pallet_layers.sql';
GO
GO
-- After 72/73. Geometry is entered in millimeters; derived counts are audited atomically.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','ResponseMaxPalletHeightMM') IS NULL
 THROW 52961,'Apply response pallet migration 72 first.',1;
GO
-- Zero means no complete packaging layer fits. Other entry counts remain positive.
DECLARE @Check NVARCHAR(MAX)=(SELECT definition FROM sys.check_constraints WHERE name='CK_PCRI_ResponseNumbers');
IF @Check IS NULL THROW 52961,'Missing response numeric constraint.',1;
IF CHARINDEX(N'[LayersPerPallet]>(0)',@Check)>0 BEGIN
 SET @Check=REPLACE(@Check,N'[LayersPerPallet]>(0)',N'[LayersPerPallet]>=(0)');
 ALTER TABLE dbo.PackagingConfigurationRequestItem DROP CONSTRAINT CK_PCRI_ResponseNumbers;
 EXEC(N'ALTER TABLE dbo.PackagingConfigurationRequestItem WITH CHECK ADD CONSTRAINT CK_PCRI_ResponseNumbers CHECK '+@Check);
END;
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation'));
IF @D IS NULL OR CHARINDEX(N'ResponseMaxPalletHeightMM INT) j',@D)=0 AND CHARINDEX(N'-- Calculated pallet layers.',@D)=0
 THROW 52961,'Unexpected pallet response save procedure.',1;
IF CHARINDEX(N'-- Calculated pallet layers.',@D)=0 BEGIN
 IF CHARINDEX(N'LayersPerPallet=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''LayersPerPallet'') THEN j.LayersPerPallet ELSE t.LayersPerPallet END,',@D)=0
  OR CHARINDEX(N'DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT',@D)=0
  THROW 52961,'Unexpected layer calculation anchors.',1;
 SET @D=REPLACE(@D,N'''ResponseMaxPalletHeightMM'',''NutDensity''',N'''ResponseMaxPalletHeightMM'',''HeightMM'',''NutDensity''');
 SET @D=REPLACE(@D,N'ResponseMaxPalletHeightMM INT) j',N'ResponseMaxPalletHeightMM INT,HeightMM DECIMAL(12,2)) j');
 SET @D=REPLACE(@D,N'DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT',N'-- Calculated pallet layers.
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''HeightMM'' AND [type]<>0
  AND ([type] NOT IN(1,2) OR TRY_CONVERT(DECIMAL(12,2),[value]) IS NULL OR TRY_CONVERT(DECIMAL(12,2),[value])<=0
   OR [value] LIKE ''%[^0-9.]%'' OR LEN([value])-CHARINDEX(''.'',[value])>2 AND CHARINDEX(''.'',[value])>0))
  THROW 52961,''Height must be positive with up to 2 decimal places (mm).'',1;
 DECLARE @Height DECIMAL(12,2),@OldHeight DECIMAL(12,2),@MaxHeight INT,@GeometryChanged BIT=0,@PalletLayers INT,@RawLayers DECIMAL(28,0),@AvailableScaled DECIMAL(28,0),@HeightScaled DECIMAL(28,0);
 SELECT @OldHeight=i.HeightMM,
  @Height=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''HeightMM'') THEN TRY_CONVERT(DECIMAL(12,2),JSON_VALUE(@Fields,''$.HeightMM'')) ELSE i.HeightMM END,
  @MaxHeight=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''ResponseMaxPalletHeightMM'') THEN TRY_CONVERT(INT,JSON_VALUE(@Fields,''$.ResponseMaxPalletHeightMM'')) ELSE i.ResponseMaxPalletHeightMM END,
  @PalletLayers=i.LayersPerPallet,
  @GeometryChanged=CASE WHEN @Layers<>COALESCE(i.ResponseLayerCount,i.RequestedLayerCount,2)
   OR EXISTS(SELECT 1 FROM OPENJSON(@Fields) j WHERE j.[key]=CASE @Layers WHEN 1 THEN ''FirstPMType'' WHEN 2 THEN ''SecondPMType'' ELSE ''ThirdPMType'' END
    AND COALESCE(NULLIF(LTRIM(RTRIM(j.[value])),N''''),N'''')<>COALESCE(CASE @Layers WHEN 1 THEN i.FirstPMType WHEN 2 THEN i.SecondPMType ELSE i.ThirdPMType END,N'''')) THEN 1 ELSE 0 END
 FROM dbo.PackagingConfigurationRequestItem i WHERE i.ID=@ID;
 IF @GeometryChanged=1 AND NOT EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''HeightMM'') SET @Height=NULL;
 IF @Height IS NOT NULL BEGIN
  -- Use scaled integer remainder, not rounded SQL decimal division at boundaries.
  SET @AvailableScaled=CASE WHEN @MaxHeight IS NULL THEN NULL WHEN @MaxHeight<=150 THEN 0 ELSE (CONVERT(DECIMAL(28,0),@MaxHeight)-150)*100 END;
  SET @HeightScaled=@Height*100;
  SET @RawLayers=(@AvailableScaled-(@AvailableScaled%@HeightScaled))/@HeightScaled;
  IF @RawLayers>2147483647 THROW 52961,''Calculated Layers / pallet exceeds 2,147,483,647. Check layer height.'',1;
  SET @PalletLayers=CONVERT(INT,@RawLayers);
 END ELSE IF @OldHeight IS NOT NULL OR @GeometryChanged=1 OR EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''HeightMM'') SET @PalletLayers=NULL;
 ELSE IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''LayersPerPallet'') SET @PalletLayers=TRY_CONVERT(INT,JSON_VALUE(@Fields,''$.LayersPerPallet''));
 DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT');
 SET @D=REPLACE(@D,N'LayersPerPallet=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''LayersPerPallet'') THEN j.LayersPerPallet ELSE t.LayersPerPallet END,',N'HeightMM=@Height,LayersPerPallet=@PalletLayers,');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.tr_PackagingConfigurationRequestItem_ChangeLog'));
IF @D IS NULL OR CHARINDEX(N'CROSS APPLY(VALUES',@D)=0 THROW 52961,'Unexpected response audit trigger.',1;
IF CHARINDEX(N'''HeightMM'',',@D)=0 BEGIN
 SET @D=REPLACE(@D,N'CROSS APPLY(VALUES',N'CROSS APPLY(VALUES(''HeightMM'',CONVERT(NVARCHAR(MAX),d.HeightMM),CONVERT(NVARCHAR(MAX),i.HeightMM),1),');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER TRIGGER',N'ALTER TRIGGER'),N'CREATE   TRIGGER',N'ALTER TRIGGER'),N'CREATE TRIGGER',N'ALTER TRIGGER');
 EXEC sys.sp_executesql @D;
END;
COMMIT;
GO
GO
-- END MIGRATION 76_packaging_pallet_layers.sql

-- BEGIN MIGRATION 77_packaging_parent_dimensions.sql
-- SOURCE SHA256 352ea6df2feb7213975177c8e1f377f21d25f86e02dab7d6f2ea53af2871ffb1
PRINT N'Applying 77_packaging_parent_dimensions.sql';
GO
GO
-- After 76. Parent geometry, child formula overrides. Historical pricing JSON is immutable.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.PackagingDimension','VolumeFormula') IS NULL
 THROW 52977,'Apply migration 74 first.',1;
IF COL_LENGTH('dbo.PackagingDimension','ParentDimensionID') IS NULL
 ALTER TABLE dbo.PackagingDimension ADD ParentDimensionID INT NULL
  CONSTRAINT FK_PackagingDimension_Parent REFERENCES dbo.PackagingDimension(ID);
IF OBJECT_ID('dbo.PackagingDimensionInheritanceLog') IS NULL
 CREATE TABLE dbo.PackagingDimensionInheritanceLog(
  DimensionID INT PRIMARY KEY, BeforeJSON NVARCHAR(MAX) NOT NULL,
  CapturedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());
GO
CREATE OR ALTER VIEW dbo.v_PackagingTypeDimensionContext AS
WITH tree AS (
 SELECT ID,ParentTypeID,ID RootTypeID,Shipping RootShipping,Status RootStatus,0 Depth
 FROM dbo.PackagingType WHERE ParentTypeID IS NULL
 UNION ALL
 SELECT t.ID,t.ParentTypeID,p.RootTypeID,p.RootShipping,p.RootStatus,p.Depth+1
 FROM dbo.PackagingType t JOIN tree p ON t.ParentTypeID=p.ID WHERE p.Depth<99
)
SELECT t.*,c.RootTypeID,c.RootShipping,c.RootStatus FROM dbo.PackagingType t JOIN tree c ON c.ID=t.ID;
GO
-- Promote legacy child geometry into a parent definition without discarding any formula.
-- Multiple geometries are kept as separate parent definitions, not silently merged.
DECLARE @ID INT,@Root INT,@Parent INT,@D1 NVARCHAR(100),@D2 NVARCHAR(100),@D3 NVARCHAR(100),
 @U1 INT,@U2 INT,@U3 INT,@Actor INT;
DECLARE legacy CURSOR LOCAL FAST_FORWARD FOR
 SELECT d.ID,t.RootTypeID,d.D1Name,d.D2Name,d.D3Name,d.D1UoMID,d.D2UoMID,d.D3UoMID,d.CreatedBy
 FROM dbo.PackagingDimension d JOIN dbo.v_PackagingTypeDimensionContext t ON t.ID=d.PackagingTypeID
 WHERE t.ParentTypeID IS NOT NULL AND d.ParentDimensionID IS NULL;
OPEN legacy; FETCH NEXT FROM legacy INTO @ID,@Root,@D1,@D2,@D3,@U1,@U2,@U3,@Actor;
WHILE @@FETCH_STATUS=0 BEGIN
 IF NOT EXISTS(SELECT 1 FROM dbo.PackagingDimensionInheritanceLog WHERE DimensionID=@ID)
  INSERT dbo.PackagingDimensionInheritanceLog(DimensionID,BeforeJSON)
  SELECT @ID,(SELECT d.* FROM dbo.PackagingDimension d WHERE d.ID=@ID FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 SET @Parent=NULL;
 SELECT TOP(1) @Parent=ID FROM dbo.PackagingDimension
 WHERE PackagingTypeID=@Root AND ParentDimensionID IS NULL
  AND D1Name=@D1 AND COALESCE(D2Name,N'')=COALESCE(@D2,N'') AND COALESCE(D3Name,N'')=COALESCE(@D3,N'')
  AND D1UoMID=@U1 AND COALESCE(D2UoMID,0)=COALESCE(@U2,0) AND COALESCE(D3UoMID,0)=COALESCE(@U3,0)
 ORDER BY CASE WHEN Status='Active' THEN 0 ELSE 1 END,ID;
 IF @Parent IS NULL BEGIN
  INSERT dbo.PackagingDimension(PackagingTypeID,D1Name,D2Name,D3Name,D1UoMID,D2UoMID,D3UoMID,SquareMeterFormula,VolumeFormula,FormulaNeedsReview,Status,CreatedBy)
  SELECT @Root,D1Name,D2Name,D3Name,D1UoMID,D2UoMID,D3UoMID,SquareMeterFormula,VolumeFormula,FormulaNeedsReview,Status,@Actor
  FROM dbo.PackagingDimension WHERE ID=@ID;
  SET @Parent=SCOPE_IDENTITY();
 END;
 UPDATE dbo.PackagingDimension SET ParentDimensionID=@Parent WHERE ID=@ID;
 FETCH NEXT FROM legacy INTO @ID,@Root,@D1,@D2,@D3,@U1,@U2,@U3,@Actor;
END;
CLOSE legacy; DEALLOCATE legacy;
-- Do not reinterpret an existing Shipping gusset as height.
IF EXISTS(SELECT 1 FROM dbo.PackagingDimension d JOIN dbo.PackagingType t ON t.ID=d.PackagingTypeID
 WHERE t.Shipping=1 AND d.Status='Active' AND d.D3Name<>N'Height')
 THROW 52977,'Review existing Shipping D3 definitions: D3 must be Height before applying 77.',1;
GO
CREATE OR ALTER VIEW dbo.v_PackagingDimensionWeb AS
SELECT d.*,t.ParentTypeID,t.RootTypeID,t.RootShipping AS Shipping,t.PackagingType,t.PriceBasis,
 p.RowVersion AS ParentDimensionRowVersion,
 COALESCE(d.SquareMeterFormula,p.SquareMeterFormula) AS EffectiveSquareMeterFormula,
 COALESCE(d.VolumeFormula,p.VolumeFormula) AS EffectiveVolumeFormula,
 CONVERT(BIT,CASE WHEN d.FormulaNeedsReview=1 OR p.FormulaNeedsReview=1 THEN 1 ELSE 0 END) AS EffectiveNeedsReview
FROM dbo.PackagingDimension d JOIN dbo.v_PackagingTypeDimensionContext t ON t.ID=d.PackagingTypeID
LEFT JOIN dbo.PackagingDimension p ON p.ID=d.ParentDimensionID;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingDimension_Save
 @Username NVARCHAR(100),@ID INT=NULL,@RowVersion VARBINARY(8)=NULL,
 @PackagingTypeID INT=NULL,@D1 NVARCHAR(100)=NULL,@D2 NVARCHAR(100)=NULL,@D3 NVARCHAR(100)=NULL,
 @D1UoMID INT=NULL,@D2UoMID INT=NULL,@D3UoMID INT=NULL,
 @SquareMeterFormula NVARCHAR(200)=NULL,@Status VARCHAR(10)='Active',@FormulaReviewed BIT=0,
 @VolumeFormula NVARCHAR(200)=NULL,@VolumeFormulaProvided BIT=0,
 @ParentDimensionID INT=NULL,@ParentDimensionRowVersion VARBINARY(8)=NULL
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 -- Shipping dimensions.
 -- Shipping volume formula.
 -- Markers retained for older migration reruns.
 DECLARE @Actor INT,@Own BIT=0,@Root INT,@Shipping BIT,@TypeStatus VARCHAR(10),@OldType INT,
  @OldVolume NVARCHAR(200),@OldArea NVARCHAR(200),@PriceBasis NVARCHAR(20),@NeedsReview BIT=0,@Lock INT;
 EXEC dbo.usp_Packaging_Authorize @Username,'Maintain',@Actor OUTPUT;
 BEGIN TRY
 IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION;SET @Own=1;END ELSE SAVE TRANSACTION DimensionRow;
 EXEC @Lock=sys.sp_getapplock @Resource='PackagingTypeHierarchy',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
 IF @Lock<0 THROW 51108,'Packaging type hierarchy is busy. Retry.',1;
 IF @ID IS NULL AND @RowVersion IS NOT NULL THROW 51111,'Create cannot have a RowVersion.',1;
 IF @ID IS NOT NULL BEGIN
  SELECT @OldType=PackagingTypeID,@OldVolume=VolumeFormula,@OldArea=SquareMeterFormula,@NeedsReview=FormulaNeedsReview
  FROM dbo.PackagingDimension WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@RowVersion;
  IF @OldType IS NULL THROW 51108,'Concurrency conflict. Refresh first.',1;
 END;
 SELECT @Root=RootTypeID,@Shipping=RootShipping,@TypeStatus=Status,@PriceBasis=PriceBasis
 FROM dbo.v_PackagingTypeDimensionContext WHERE ID=@PackagingTypeID;
 IF @Root IS NULL OR (@TypeStatus<>'Active' AND NOT(@Status='Block' AND @OldType=@PackagingTypeID))
  THROW 51111,'Choose an active Packaging Type.',1;
 IF @Status IS NULL OR @Status NOT IN('Active','Block') THROW 51111,'Invalid status.',1;
 IF @Root<>@PackagingTypeID BEGIN
  IF NOT EXISTS(SELECT 1 FROM dbo.PackagingDimension WITH(UPDLOCK,HOLDLOCK)
   WHERE ID=@ParentDimensionID AND PackagingTypeID=@Root AND ParentDimensionID IS NULL
    AND (Status='Active' OR @Status='Block') AND RowVersion=@ParentDimensionRowVersion)
   THROW 51108,'Choose a current parent dimension definition. Refresh first.',1;
  SELECT @D1=D1Name,@D2=D2Name,@D3=D3Name,@D1UoMID=D1UoMID,@D2UoMID=D2UoMID,@D3UoMID=D3UoMID
  FROM dbo.PackagingDimension WHERE ID=@ParentDimensionID;
 END ELSE IF @ParentDimensionID IS NOT NULL THROW 51111,'Parent types own their dimensions.',1;
 SET @D1=NULLIF(LTRIM(RTRIM(@D1)),N''); SET @D2=NULLIF(LTRIM(RTRIM(@D2)),N''); SET @D3=NULLIF(LTRIM(RTRIM(@D3)),N'');
 SET @SquareMeterFormula=NULLIF(LTRIM(RTRIM(@SquareMeterFormula)),N'');
 IF @Root=@PackagingTypeID AND @PriceBasis<>'Square meter' AND @Shipping=0
  SET @SquareMeterFormula=@OldArea;
 IF @Root=@PackagingTypeID AND @PriceBasis='Square meter' AND @SquareMeterFormula IS NULL
  THROW 51111,'Square meter types require a Square meter formula.',1;
 SET @VolumeFormula=CASE WHEN @VolumeFormulaProvided=0 THEN @OldVolume ELSE NULLIF(LTRIM(RTRIM(@VolumeFormula)),N'') END;
 IF @D1 IS NULL OR @D1UoMID IS NULL THROW 51111,'D1 name and unit are required.',1;
 IF (@D2 IS NULL AND @D2UoMID IS NOT NULL) OR (@D2 IS NOT NULL AND @D2UoMID IS NULL)
  OR (@D3 IS NULL AND @D3UoMID IS NOT NULL) OR (@D3 IS NOT NULL AND @D3UoMID IS NULL)
  THROW 51111,'Each dimension needs a name and unit.',1;
 IF @Shipping=1 AND (@D2 IS NULL OR @D3<>N'Height' OR @D3 IS NULL OR @D2UoMID IS NULL OR @D3UoMID IS NULL)
  THROW 51111,'Shipping types require three dimensions; D3 is fixed as Height.',1;
 IF @VolumeFormula IS NOT NULL AND @Shipping=0 AND (@OldVolume IS NULL OR @VolumeFormula<>@OldVolume)
  THROW 51111,'Volume formula applies only to Shipping types and their child components.',1;
 IF EXISTS(SELECT 1 FROM (VALUES(@D1UoMID),(@D2UoMID),(@D3UoMID)) x(ID)
  WHERE ID IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.UoM WITH(HOLDLOCK) WHERE UoM.ID=x.ID AND Status='Active'))
  AND @Status='Active' THROW 51111,'Choose active dimension units.',1;
 IF CHARINDEX(N'D2',COALESCE(@SquareMeterFormula,N'')+COALESCE(@VolumeFormula,N''))>0 AND @D2 IS NULL
  OR CHARINDEX(N'D3',COALESCE(@SquareMeterFormula,N'')+COALESCE(@VolumeFormula,N''))>0 AND @D3 IS NULL
  THROW 51111,'Define dimensions used in the formulas.',1;
 IF (@PriceBasis='Square meter' OR @Shipping=1 OR @Root<>@PackagingTypeID) AND @NeedsReview=1 AND @FormulaReviewed<>1 AND @Status='Active'
  THROW 51111,'Review the legacy formula using selected input units before saving.',1;
 IF @ID IS NULL BEGIN
  INSERT dbo.PackagingDimension(PackagingTypeID,ParentDimensionID,D1Name,D2Name,D3Name,D1UoMID,D2UoMID,D3UoMID,SquareMeterFormula,VolumeFormula,Status,CreatedBy)
  VALUES(@PackagingTypeID,@ParentDimensionID,@D1,@D2,@D3,@D1UoMID,@D2UoMID,@D3UoMID,@SquareMeterFormula,@VolumeFormula,@Status,@Actor);
  SET @ID=SCOPE_IDENTITY();
 END ELSE UPDATE dbo.PackagingDimension SET PackagingTypeID=@PackagingTypeID,ParentDimensionID=@ParentDimensionID,
  D1Name=@D1,D2Name=@D2,D3Name=@D3,D1UoMID=@D1UoMID,D2UoMID=@D2UoMID,D3UoMID=@D3UoMID,
  SquareMeterFormula=@SquareMeterFormula,VolumeFormula=@VolumeFormula,
  FormulaNeedsReview=CASE WHEN @FormulaReviewed=1 THEN 0 ELSE FormulaNeedsReview END,
  Status=@Status,UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@Actor WHERE ID=@ID;
 IF @Own=1 COMMIT;
 SELECT ID,RowVersion FROM dbo.PackagingDimension WHERE ID=@ID;
 END TRY
 BEGIN CATCH
 IF @Own=1 AND XACT_STATE()<>0 ROLLBACK;
 ELSE IF XACT_STATE()=1 ROLLBACK TRANSACTION DimensionRow;
 THROW;
 END CATCH;
END;
GO
CREATE OR ALTER TRIGGER dbo.tr_PackagingDimension_ParentGeometry
ON dbo.PackagingDimension AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 -- Parent changes propagate copied geometry, never overwrite child formulas.
 UPDATE c SET D1Name=p.D1Name,D2Name=p.D2Name,D3Name=p.D3Name,
  D1UoMID=p.D1UoMID,D2UoMID=p.D2UoMID,D3UoMID=p.D3UoMID,UpdatedAt=SYSUTCDATETIME(),UpdatedBy=p.UpdatedBy
 FROM dbo.PackagingDimension c JOIN inserted p ON c.ParentDimensionID=p.ID
 WHERE p.ParentDimensionID IS NULL;
 IF EXISTS(SELECT 1 FROM inserted d JOIN dbo.v_PackagingTypeDimensionContext t ON t.ID=d.PackagingTypeID
  LEFT JOIN dbo.PackagingDimension p ON p.ID=d.ParentDimensionID
  WHERE (t.ParentTypeID IS NULL AND d.ParentDimensionID IS NOT NULL)
   OR (t.ParentTypeID IS NOT NULL AND (p.ID IS NULL OR p.ParentDimensionID IS NOT NULL OR p.PackagingTypeID<>t.RootTypeID
    OR d.D1Name<>p.D1Name OR COALESCE(d.D2Name,N'')<>COALESCE(p.D2Name,N'') OR COALESCE(d.D3Name,N'')<>COALESCE(p.D3Name,N'')
    OR d.D1UoMID<>p.D1UoMID OR COALESCE(d.D2UoMID,0)<>COALESCE(p.D2UoMID,0) OR COALESCE(d.D3UoMID,0)<>COALESCE(p.D3UoMID,0))))
  THROW 51111,'Child dimensions must copy their parent definition; only formulas can differ.',1;
 IF EXISTS(SELECT 1 FROM inserted d JOIN dbo.v_PackagingTypeDimensionContext t ON t.ID=d.PackagingTypeID
  WHERE t.RootShipping=1 AND d.Status='Active' AND (d.D3Name<>N'Height' OR d.D3Name IS NULL))
  THROW 51111,'Shipping D3 is fixed as Height.',1;
 IF EXISTS(SELECT 1 FROM dbo.PackagingDimension c JOIN inserted p ON c.ParentDimensionID=p.ID
  JOIN dbo.v_PackagingTypeDimensionContext t ON t.ID=c.PackagingTypeID
  WHERE p.PackagingTypeID<>t.RootTypeID OR p.ParentDimensionID IS NOT NULL)
  THROW 51111,'Parent geometry cannot be moved away from its linked child types.',1;
END;
GO
CREATE OR ALTER TRIGGER dbo.tr_PackagingDimension_VolumeShipping
ON dbo.PackagingDimension AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM inserted i JOIN dbo.v_PackagingTypeDimensionContext t ON t.ID=i.PackagingTypeID
  LEFT JOIN deleted d ON d.ID=i.ID WHERE t.RootShipping=0 AND i.VolumeFormula IS NOT NULL
   AND (d.ID IS NULL OR d.VolumeFormula IS NULL OR d.VolumeFormula<>i.VolumeFormula))
  THROW 51111,'Volume formula applies only to Shipping types and their child components.',1;
END;
GO
CREATE OR ALTER TRIGGER dbo.tr_PackagingType_ShippingDimensions
ON dbo.PackagingType AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM inserted t JOIN dbo.PackagingDimension d ON d.PackagingTypeID=t.ID
  WHERE t.Shipping=1 AND d.Status='Active' AND (d.D1Name IS NULL OR d.D2Name IS NULL OR d.D3Name<>N'Height'
   OR d.D3Name IS NULL OR d.D1UoMID IS NULL OR d.D2UoMID IS NULL OR d.D3UoMID IS NULL))
  THROW 51111,'Shipping dimensions require D1, D2 and D3 fixed as Height.',1;
 -- Reparenting a type with linked geometry needs an explicit remapping first.
 IF EXISTS(SELECT 1 FROM dbo.PackagingDimension d JOIN dbo.v_PackagingTypeDimensionContext t ON t.ID=d.PackagingTypeID
  LEFT JOIN dbo.PackagingDimension p ON p.ID=d.ParentDimensionID
  WHERE p.PackagingTypeID<>t.RootTypeID OR t.ParentTypeID IS NOT NULL AND d.ParentDimensionID IS NULL
   OR t.ParentTypeID IS NULL AND d.ParentDimensionID IS NOT NULL)
  THROW 51111,'Remap child dimension definitions before changing the type hierarchy.',1;
END;
GO
COMMIT;
GO
GO
-- END MIGRATION 77_packaging_parent_dimensions.sql

-- BEGIN MIGRATION 78_pallet_container_capacities.sql
-- SOURCE SHA256 d6bbed80e5956351a3f55023a429825fda8a295d92cb03930315428dde99edbc
PRINT N'Applying 78_pallet_container_capacities.sql';
GO
GO
-- After 77. Optional pallet/container capacities; existing records remain NULL.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
IF OBJECT_ID('dbo.Pallet','U') IS NULL
 THROW 51111,'Apply 49_pallet_master.sql before this migration.',1;
IF COL_LENGTH('dbo.Pallet','PalletsPer20DC') IS NULL ALTER TABLE dbo.Pallet ADD PalletsPer20DC INT NULL;
IF COL_LENGTH('dbo.Pallet','PalletsPer40DC') IS NULL ALTER TABLE dbo.Pallet ADD PalletsPer40DC INT NULL;
IF COL_LENGTH('dbo.Pallet','PalletsPer40HC') IS NULL ALTER TABLE dbo.Pallet ADD PalletsPer40HC INT NULL;
IF COL_LENGTH('dbo.Pallet','PalletsPer20RC') IS NULL ALTER TABLE dbo.Pallet ADD PalletsPer20RC INT NULL;
IF COL_LENGTH('dbo.Pallet','PalletsPer40RHC') IS NULL ALTER TABLE dbo.Pallet ADD PalletsPer40RHC INT NULL;
GO
IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.Pallet') AND name='CK_Pallet_PalletsPer20DC')
 ALTER TABLE dbo.Pallet WITH CHECK ADD CONSTRAINT CK_Pallet_PalletsPer20DC CHECK(PalletsPer20DC IS NULL OR PalletsPer20DC>=0);
IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.Pallet') AND name='CK_Pallet_PalletsPer40DC')
 ALTER TABLE dbo.Pallet WITH CHECK ADD CONSTRAINT CK_Pallet_PalletsPer40DC CHECK(PalletsPer40DC IS NULL OR PalletsPer40DC>=0);
IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.Pallet') AND name='CK_Pallet_PalletsPer40HC')
 ALTER TABLE dbo.Pallet WITH CHECK ADD CONSTRAINT CK_Pallet_PalletsPer40HC CHECK(PalletsPer40HC IS NULL OR PalletsPer40HC>=0);
IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.Pallet') AND name='CK_Pallet_PalletsPer20RC')
 ALTER TABLE dbo.Pallet WITH CHECK ADD CONSTRAINT CK_Pallet_PalletsPer20RC CHECK(PalletsPer20RC IS NULL OR PalletsPer20RC>=0);
IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.Pallet') AND name='CK_Pallet_PalletsPer40RHC')
 ALTER TABLE dbo.Pallet WITH CHECK ADD CONSTRAINT CK_Pallet_PalletsPer40RHC CHECK(PalletsPer40RHC IS NULL OR PalletsPer40RHC>=0);
GO
-- Refresh SELECT p.* metadata so new columns are returned without changing calculations.
EXEC sys.sp_refreshview N'dbo.v_PalletMaster';
GO
CREATE OR ALTER PROCEDURE dbo.usp_Pallet_Batch
 @Rows NVARCHAR(MAX),@Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT OFF;
 DECLARE @Actor INT;
 EXEC dbo.usp_Packaging_Authorize @Username,'Maintain',@Actor OUTPUT;
 IF ISJSON(@Rows)<>1 OR LEFT(LTRIM(@Rows),1)<>'['
  THROW 51105,'A JSON array of rows is required.',1;
 DECLARE @Input TABLE(RowNum INT,Command VARCHAR(10),ID INT,RowVersion VARBINARY(8),
  UnitOfMeasure NVARCHAR(4000),WidthText NVARCHAR(100),LengthText NVARCHAR(100),Status VARCHAR(20),
  PalletsPer20DCText NVARCHAR(100),PalletsPer20DCSet BIT,
  PalletsPer40DCText NVARCHAR(100),PalletsPer40DCSet BIT,
  PalletsPer40HCText NVARCHAR(100),PalletsPer40HCSet BIT,
  PalletsPer20RCText NVARCHAR(100),PalletsPer20RCSet BIT,
  PalletsPer40RHCText NVARCHAR(100),PalletsPer40RHCSet BIT);
 INSERT @Input SELECT RowNum,Command,ID,TRY_CONVERT(VARBINARY(8),RowVersionHex,1),
  UnitOfMeasure,Width,Length,Status,
  r.PalletsPer20DC,CONVERT(BIT,CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(j.value) WHERE [key]='PalletsPer20DC') THEN 1 ELSE 0 END),
  r.PalletsPer40DC,CONVERT(BIT,CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(j.value) WHERE [key]='PalletsPer40DC') THEN 1 ELSE 0 END),
  r.PalletsPer40HC,CONVERT(BIT,CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(j.value) WHERE [key]='PalletsPer40HC') THEN 1 ELSE 0 END),
  r.PalletsPer20RC,CONVERT(BIT,CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(j.value) WHERE [key]='PalletsPer20RC') THEN 1 ELSE 0 END),
  r.PalletsPer40RHC,CONVERT(BIT,CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(j.value) WHERE [key]='PalletsPer40RHC') THEN 1 ELSE 0 END)
 FROM OPENJSON(@Rows) j CROSS APPLY OPENJSON(j.value) WITH(RowNum INT,Command VARCHAR(10),ID INT,
  RowVersionHex VARCHAR(100),UnitOfMeasure NVARCHAR(4000),Width NVARCHAR(100),Length NVARCHAR(100),Status VARCHAR(20),
  PalletsPer20DC NVARCHAR(100),PalletsPer40DC NVARCHAR(100),PalletsPer40HC NVARCHAR(100),PalletsPer20RC NVARCHAR(100),PalletsPer40RHC NVARCHAR(100)) r;
 IF (SELECT COUNT(*) FROM @Input) NOT BETWEEN 1 AND 500 THROW 51105,'Use 1 to 500 rows per batch.',1;
 IF EXISTS(SELECT RowNum FROM @Input GROUP BY RowNum HAVING COUNT(*)>1)
  OR EXISTS(SELECT ID FROM @Input WHERE ID IS NOT NULL GROUP BY ID HAVING COUNT(*)>1)
  THROW 51106,'Duplicate row numbers or record IDs.',1;
 DECLARE @Result TABLE(RowNum INT,Status VARCHAR(10),Message NVARCHAR(2048),NewID INT,NewRowVersion VARBINARY(8));
 DECLARE @Row INT,@Cmd VARCHAR(10),@ID INT,@RV VARBINARY(8),@Unit NVARCHAR(4000),
  @WText NVARCHAR(100),@LText NVARCHAR(100),@Status VARCHAR(20),@Own BIT,
  @UnitID INT,@W DECIMAL(12,4),@L DECIMAL(12,4),@Factor DECIMAL(24,9),@Area DECIMAL(38,8),
  @C0Text NVARCHAR(100),@C0Set BIT,@C0 INT,
  @C1Text NVARCHAR(100),@C1Set BIT,@C1 INT,
  @C2Text NVARCHAR(100),@C2Set BIT,@C2 INT,
  @C3Text NVARCHAR(100),@C3Set BIT,@C3 INT,
  @C4Text NVARCHAR(100),@C4Set BIT,@C4 INT;
 DECLARE c CURSOR LOCAL FAST_FORWARD FOR
  SELECT RowNum,Command,ID,RowVersion,UnitOfMeasure,WidthText,LengthText,Status,PalletsPer20DCText,PalletsPer20DCSet,PalletsPer40DCText,PalletsPer40DCSet,PalletsPer40HCText,PalletsPer40HCSet,PalletsPer20RCText,PalletsPer20RCSet,PalletsPer40RHCText,PalletsPer40RHCSet FROM @Input ORDER BY RowNum;
 OPEN c; FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@RV,@Unit,@WText,@LText,@Status,@C0Text,@C0Set,@C1Text,@C1Set,@C2Text,@C2Set,@C3Text,@C3Set,@C4Text,@C4Set;
 WHILE @@FETCH_STATUS=0
 BEGIN
  SET @Own=0;
  BEGIN TRY
   IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION; SET @Own=1; END
   ELSE SAVE TRANSACTION PalletRow;
   IF @Row IS NULL OR @Row<1 OR @Cmd IS NULL OR @Cmd NOT IN('C','U','D')
    THROW 51107,'Use a positive row number and C, U or D.',1;
   IF @Cmd='C' AND (@ID IS NOT NULL OR @RV IS NOT NULL)
    THROW 51107,'Create cannot have an ID or RowVersion.',1;
   IF @Cmd IN('U','D') AND NOT EXISTS(SELECT 1 FROM dbo.Pallet WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@RV)
    THROW 51108,'Concurrency conflict or row not found. Refresh first.',1;
   IF @Cmd<>'D'
   BEGIN
    SET @C0=TRY_CONVERT(INT,@C0Text);
    IF @C0Text IS NOT NULL AND (@C0 IS NULL OR @C0<0 OR LTRIM(RTRIM(@C0Text))='' OR @C0Text LIKE '%[^0-9]%')
     THROW 51111,'Pallet/container counts must be whole numbers from 0 to 2,147,483,647 or blank.',1;
    IF @Cmd='U' AND @C0Set=0 SELECT @C0=PalletsPer20DC FROM dbo.Pallet WHERE ID=@ID;
    SET @C1=TRY_CONVERT(INT,@C1Text);
    IF @C1Text IS NOT NULL AND (@C1 IS NULL OR @C1<0 OR LTRIM(RTRIM(@C1Text))='' OR @C1Text LIKE '%[^0-9]%')
     THROW 51111,'Pallet/container counts must be whole numbers from 0 to 2,147,483,647 or blank.',1;
    IF @Cmd='U' AND @C1Set=0 SELECT @C1=PalletsPer40DC FROM dbo.Pallet WHERE ID=@ID;
    SET @C2=TRY_CONVERT(INT,@C2Text);
    IF @C2Text IS NOT NULL AND (@C2 IS NULL OR @C2<0 OR LTRIM(RTRIM(@C2Text))='' OR @C2Text LIKE '%[^0-9]%')
     THROW 51111,'Pallet/container counts must be whole numbers from 0 to 2,147,483,647 or blank.',1;
    IF @Cmd='U' AND @C2Set=0 SELECT @C2=PalletsPer40HC FROM dbo.Pallet WHERE ID=@ID;
    SET @C3=TRY_CONVERT(INT,@C3Text);
    IF @C3Text IS NOT NULL AND (@C3 IS NULL OR @C3<0 OR LTRIM(RTRIM(@C3Text))='' OR @C3Text LIKE '%[^0-9]%')
     THROW 51111,'Pallet/container counts must be whole numbers from 0 to 2,147,483,647 or blank.',1;
    IF @Cmd='U' AND @C3Set=0 SELECT @C3=PalletsPer20RC FROM dbo.Pallet WHERE ID=@ID;
    SET @C4=TRY_CONVERT(INT,@C4Text);
    IF @C4Text IS NOT NULL AND (@C4 IS NULL OR @C4<0 OR LTRIM(RTRIM(@C4Text))='' OR @C4Text LIKE '%[^0-9]%')
     THROW 51111,'Pallet/container counts must be whole numbers from 0 to 2,147,483,647 or blank.',1;
    IF @Cmd='U' AND @C4Set=0 SELECT @C4=PalletsPer40RHC FROM dbo.Pallet WHERE ID=@ID;
    SET @UnitID=NULL; SET @Factor=NULL; SET @Area=NULL;
    SET @W=TRY_CONVERT(DECIMAL(12,4),@WText); SET @L=TRY_CONVERT(DECIMAL(12,4),@LText);
    IF @W IS NULL OR @L IS NULL OR @W<=0 OR @L<=0
     OR TRY_CONVERT(DECIMAL(38,18),@WText)<>@W OR TRY_CONVERT(DECIMAL(38,18),@LText)<>@L
     THROW 51111,'Width and Length must be positive, with at most 8 whole digits and 4 decimals.',1;
    IF @Status IS NULL AND @Cmd='U' SELECT @Status=Status FROM dbo.Pallet WHERE ID=@ID;
    SET @Status=COALESCE(@Status,'Active');
    IF @Status NOT IN('Active','Block') THROW 51109,'Status must be Active or Block.',1;
    SELECT @UnitID=ID FROM dbo.UoM WITH(UPDLOCK,HOLDLOCK) WHERE UoMCode=LTRIM(RTRIM(@Unit))
     AND (Status='Active' OR (@Status='Block' AND @Cmd='U' AND EXISTS(SELECT 1 FROM dbo.Pallet WHERE ID=@ID AND UoMID=dbo.UoM.ID)));
    IF @UnitID IS NULL THROW 51111,'Choose an active UoM from UoM Master.',1;
    IF @Status='Active'
    BEGIN
     -- Lock the reference rows until this record is saved.
     SELECT @Factor=CASE WHEN u.UoMCode=N'MM' THEN CONVERT(DECIMAL(24,9),1) ELSE cv.Factor END
     FROM dbo.UoM u WITH(UPDLOCK,HOLDLOCK)
     LEFT JOIN dbo.UoM mm WITH(UPDLOCK,HOLDLOCK) ON mm.UoMCode=N'MM' AND mm.Status='Active'
     LEFT JOIN dbo.UnitConversion cv WITH(UPDLOCK,HOLDLOCK)
      ON cv.FromUoMID=u.ID AND cv.ToUoMID=mm.ID AND cv.Status='Active'
      AND cv.PackagingMaterialID IS NULL AND cv.RawMaterialID IS NULL AND cv.VendorID IS NULL
     WHERE u.ID=@UnitID AND u.Status='Active';
     IF @Factor IS NULL THROW 51111,'Admin must maintain an active general conversion from this UoM to MM.',1;
     SELECT @Area=PalletAreaMM2 FROM dbo.fn_PalletArea(@W,@L,@Factor);
     IF @Area IS NULL OR @Area<=0 THROW 51111,'Converted dimensions or area are out of range.',1;
    END;
    IF EXISTS(SELECT 1 FROM dbo.Pallet WITH(UPDLOCK,HOLDLOCK) WHERE UoMID=@UnitID AND Width=@W AND Length=@L AND (@Cmd='C' OR ID<>@ID))
     THROW 51111,'This pallet size already exists. Edit the existing record instead.',1;
   END;
   IF @Cmd='C'
    INSERT dbo.Pallet(UoMID,Width,Length,Status,CreatedBy,PalletsPer20DC,PalletsPer40DC,PalletsPer40HC,PalletsPer20RC,PalletsPer40RHC)
    OUTPUT @Row,'OK','Created',inserted.ID,inserted.RowVersion INTO @Result
    VALUES(@UnitID,@W,@L,@Status,@Actor,@C0,@C1,@C2,@C3,@C4);
   ELSE IF @Cmd='D'
    UPDATE dbo.Pallet SET Status='Block',UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@Actor
    OUTPUT @Row,'OK','Blocked',inserted.ID,inserted.RowVersion INTO @Result WHERE ID=@ID AND RowVersion=@RV;
   ELSE
    UPDATE dbo.Pallet SET UoMID=@UnitID,Width=@W,Length=@L,Status=@Status,PalletsPer20DC=@C0,PalletsPer40DC=@C1,PalletsPer40HC=@C2,PalletsPer20RC=@C3,PalletsPer40RHC=@C4,UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@Actor
    OUTPUT @Row,'OK','Updated',inserted.ID,inserted.RowVersion INTO @Result WHERE ID=@ID AND RowVersion=@RV;
   IF @Own=1 COMMIT;
  END TRY
  BEGIN CATCH
   IF @Own=1 AND XACT_STATE()<>0 ROLLBACK;
   ELSE IF XACT_STATE()=1 ROLLBACK TRANSACTION PalletRow;
   ELSE IF XACT_STATE()=-1 THROW;
   DELETE @Result WHERE RowNum=@Row;
   INSERT @Result VALUES(@Row,'ERROR',ERROR_MESSAGE(),@ID,NULL);
  END CATCH;
  FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@RV,@Unit,@WText,@LText,@Status,@C0Text,@C0Set,@C1Text,@C1Set,@C2Text,@C2Set,@C3Text,@C3Set,@C4Text,@C4Set;
 END;
 CLOSE c; DEALLOCATE c;
 SELECT * FROM @Result ORDER BY RowNum;
END;
GO
GO
-- END MIGRATION 78_pallet_container_capacities.sql

-- BEGIN MIGRATION 79_packaging_supplier_geometry.sql
-- SOURCE SHA256 5a86e0ba25ff4b58c8cb4cdf405539aa3c864786b6004c18a25252794b282838
PRINT N'Applying 79_packaging_supplier_geometry.sql';
GO
GO
-- After 78. Adds supplier geometry per ONE price UoM, without migrating business values.
IF COL_LENGTH('dbo.PackagingPrice','SupplierDimensionID') IS NULL
 ALTER TABLE dbo.PackagingPrice ADD SupplierDimensionID INT NULL REFERENCES dbo.PackagingDimension(ID),
  SupplierDimensionRowVersion VARBINARY(8) NULL,
  SupplierD1 DECIMAL(18,6) NULL CHECK(SupplierD1>0),
  SupplierD2 DECIMAL(18,6) NULL CHECK(SupplierD2>0),
  SupplierD3 DECIMAL(18,6) NULL CHECK(SupplierD3>0),
  SupplierAreaPerPriceUnit DECIMAL(28,9) NULL CHECK(SupplierAreaPerPriceUnit>0);
GO
IF TYPE_ID('dbo.PackagingPriceBatchTypeV4') IS NULL
 EXEC(N'CREATE TYPE dbo.PackagingPriceBatchTypeV4 AS TABLE(RowNum INT NOT NULL PRIMARY KEY,Command CHAR(1),ID INT,MaterialID INT,CurrencyID INT,PriceBasis NVARCHAR(40),QuantityFrom DECIMAL(18,4),QuantityTo DECIMAL(18,4),UnitPrice DECIMAL(18,4),EffectiveFrom DATE,EffectiveTo DATE,Status VARCHAR(10),RowVersionB64 VARBINARY(8),VendorID INT,ExchangeRateToUSD DECIMAL(18,10),SupplierDimensionID INT,SupplierDimensionRowVersion VARBINARY(8),SupplierD1 DECIMAL(18,6),SupplierD2 DECIMAL(18,6),SupplierD3 DECIMAL(18,6),SupplierAreaPerPriceUnit DECIMAL(28,9),SupplierSet BIT)');
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingPrice_BatchV4
    @Rows dbo.PackagingPriceBatchTypeV4 READONLY, @Username NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT OFF;
    DECLARE @ActorID INT;
    EXEC dbo.usp_Packaging_Authorize @Username,'Maintain',@ActorID OUTPUT;
    IF (SELECT COUNT(*) FROM @Rows)>500 THROW 51105,'Maximum 500 rows per batch.',1;
    IF EXISTS(SELECT ID FROM @Rows WHERE ID IS NOT NULL GROUP BY ID HAVING COUNT(*)>1)
        THROW 51106,'Duplicate record IDs in batch.',1;
    DECLARE @Result TABLE(RowNum INT,Status VARCHAR(10),Message NVARCHAR(2048),NewID INT,NewRowVersion VARBINARY(8));
    DECLARE @SupplierDimension INT,@SupplierRV VARBINARY(8),@SupplierD1 DECIMAL(18,6),@SupplierD2 DECIMAL(18,6),@SupplierD3 DECIMAL(18,6),@SupplierArea DECIMAL(28,9),@SupplierSet BIT;
    DECLARE @RowNum INT,@Command CHAR(1),@ID INT,@RV VARBINARY(8),@OwnTran BIT,@Rate DECIMAL(18,10),@Vendor INT,@Material INT,@Currency INT,@Basis NVARCHAR(40),@QFrom DECIMAL(18,4),@QTo DECIMAL(18,4),@Price DECIMAL(18,4),@From DATE,@To DATE,@Status VARCHAR(10);
    DECLARE rows_cursor CURSOR LOCAL FAST_FORWARD FOR
        SELECT RowNum,UPPER(Command),ID,RowVersionB64,MaterialID,CurrencyID,NULLIF(LTRIM(RTRIM(PriceBasis)),N''),QuantityFrom,QuantityTo,UnitPrice,EffectiveFrom,EffectiveTo,Status,VendorID,ExchangeRateToUSD,SupplierDimensionID,SupplierDimensionRowVersion,SupplierD1,SupplierD2,SupplierD3,SupplierAreaPerPriceUnit,SupplierSet FROM @Rows ORDER BY RowNum;
    OPEN rows_cursor;
    FETCH NEXT FROM rows_cursor INTO @RowNum,@Command,@ID,@RV,@Material,@Currency,@Basis,@QFrom,@QTo,@Price,@From,@To,@Status,@Vendor,@Rate,@SupplierDimension,@SupplierRV,@SupplierD1,@SupplierD2,@SupplierD3,@SupplierArea,@SupplierSet;
    WHILE @@FETCH_STATUS=0
    BEGIN
        SET @OwnTran=0;
        BEGIN TRY
            IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION; SET @OwnTran=1; END
            ELSE SAVE TRANSACTION PackagingRow;
            IF @Command NOT IN('C','U','D') THROW 51107,'Use C, U or D.',1;
            IF @Command IN('U','D') AND NOT EXISTS(
                SELECT 1 FROM dbo.PackagingPrice WITH(UPDLOCK,HOLDLOCK)
                WHERE ID=@ID AND RowVersion=@RV)
                THROW 51108,'Concurrency conflict or row not found. Refresh first.',1;
            IF @Command<>'D'
            BEGIN
                IF @Command='U' AND COALESCE(@SupplierSet,0)=0
                 SELECT @SupplierDimension=CASE WHEN MaterialID=@Material AND PriceBasis=@Basis THEN SupplierDimensionID END,
                  @SupplierRV=CASE WHEN MaterialID=@Material AND PriceBasis=@Basis THEN SupplierDimensionRowVersion END,
                  @SupplierD1=CASE WHEN MaterialID=@Material AND PriceBasis=@Basis THEN SupplierD1 END,
                  @SupplierD2=CASE WHEN MaterialID=@Material AND PriceBasis=@Basis THEN SupplierD2 END,
                  @SupplierD3=CASE WHEN MaterialID=@Material AND PriceBasis=@Basis THEN SupplierD3 END,
                  @SupplierArea=CASE WHEN MaterialID=@Material AND PriceBasis=@Basis THEN SupplierAreaPerPriceUnit END
                 FROM dbo.PackagingPrice WHERE ID=@ID;
                IF @SupplierDimension IS NULL AND (@SupplierRV IS NOT NULL OR @SupplierD1 IS NOT NULL OR @SupplierD2 IS NOT NULL OR @SupplierD3 IS NOT NULL OR @SupplierArea IS NOT NULL)
                 THROW 51111,'Supplier measurements need a child dimension definition.',1;
                IF @SupplierDimension IS NOT NULL AND @SupplierSet=1
                BEGIN
                 IF @SupplierArea IS NULL OR @SupplierArea<=0 OR @SupplierD1<=0 OR @SupplierD2<=0 OR @SupplierD3<=0
                  THROW 51111,'Supplier formula area and measurements must be positive.',1;
                 IF NOT EXISTS(SELECT 1 FROM dbo.PackagingDimension d WITH(HOLDLOCK)
                  JOIN dbo.PackagingMaterial m ON m.PackagingTypeID=d.PackagingTypeID
                  JOIN dbo.PackagingType t ON t.ID=d.PackagingTypeID
                  JOIN dbo.PackagingDimension parent ON parent.ID=d.ParentDimensionID
                  WHERE d.ID=@SupplierDimension AND m.ID=@Material AND t.ParentTypeID IS NOT NULL
                   AND d.RowVersion=@SupplierRV AND d.Status='Active' AND t.Status='Active' AND parent.Status='Active'
                   AND d.FormulaNeedsReview=0 AND parent.FormulaNeedsReview=0
                   AND NOT EXISTS(SELECT 1 FROM (VALUES(d.D1UoMID),(d.D2UoMID),(d.D3UoMID)) s(ID)
                    JOIN dbo.UoM u WITH(HOLDLOCK) ON u.ID=s.ID WHERE u.Status<>'Active')
                   AND COALESCE(d.SquareMeterFormula,parent.SquareMeterFormula) IS NOT NULL)
                  THROW 51108,'Supplier child formula changed or is unavailable. Refresh pricing.',1;
                END;
                IF @Vendor IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.Vendor WITH(UPDLOCK,HOLDLOCK) WHERE ID=@Vendor AND (Status='Active' OR (@Command='U' AND EXISTS(SELECT 1 FROM dbo.PackagingPrice WHERE ID=@ID AND VendorID=@Vendor))))
                    THROW 51112,'Choose an active Vendor.',1;
                IF @Status IS NOT NULL AND @Status NOT IN('Active','Block')
                    THROW 51109,'Status must be Active or Block.',1;
                IF @Command='U' AND @Status IS NULL
                    SELECT @Status=Status FROM dbo.PackagingPrice WHERE ID=@ID;
                IF @Currency IS NULL AND @Vendor IS NOT NULL SELECT @Currency=CurrencyID FROM dbo.Vendor WHERE ID=@Vendor;
                IF EXISTS(SELECT 1 FROM dbo.Currency WHERE ID=@Currency AND CurrencyCode='USD') SET @Rate=1;
                IF @Rate IS NOT NULL AND @Rate<=0 THROW 51111,'Exchange rate must be positive.',1;
                IF @Currency IS NULL OR @Basis IS NULL OR @QFrom IS NULL OR @Price IS NULL OR @From IS NULL
                        THROW 51111,'Currency, basis, quantity from, price and effective from are required.',1;
                    IF NOT EXISTS(SELECT 1 FROM dbo.PackagingMaterial WITH(UPDLOCK,HOLDLOCK) WHERE ID=@Material AND Status='Active')
                        THROW 51112,'Active Packaging Material is required.',1;
                    /* Half-open quantity intervals [from,to); inclusive effective dates. */
                    IF COALESCE(@Status,'Active')='Active' AND EXISTS(
                        SELECT 1 FROM dbo.PackagingPrice WITH(UPDLOCK,HOLDLOCK)
                        WHERE MaterialID=@Material AND CurrencyID=@Currency AND PriceBasis=@Basis AND (VendorID=@Vendor OR (VendorID IS NULL AND @Vendor IS NULL))
                          AND Status='Active' AND (@Command='C' OR ID<>@ID)
                          AND (@To IS NULL OR EffectiveFrom<=@To)
                          AND (EffectiveTo IS NULL OR @From<=EffectiveTo)
                          AND (@QTo IS NULL OR QuantityFrom<@QTo)
                          AND (QuantityTo IS NULL OR @QFrom<QuantityTo))
                        THROW 51113,'Active price date and quantity ranges overlap.',1;
            END;
            IF @Command='C'
            BEGIN
                INSERT dbo.PackagingPrice(MaterialID,CurrencyID,PriceBasis,QuantityFrom,QuantityTo,UnitPrice,EffectiveFrom,EffectiveTo,Status,CreatedBy,VendorID,ExchangeRateToUSD,SupplierDimensionID,SupplierDimensionRowVersion,SupplierD1,SupplierD2,SupplierD3,SupplierAreaPerPriceUnit)
                OUTPUT @RowNum,'OK','Created',inserted.ID,inserted.RowVersion INTO @Result
                VALUES(@Material,@Currency,@Basis,@QFrom,@QTo,@Price,@From,@To,COALESCE(@Status,'Active'),@ActorID,@Vendor,@Rate,@SupplierDimension,@SupplierRV,@SupplierD1,@SupplierD2,@SupplierD3,@SupplierArea);
            END
            ELSE IF @Command='D'
                UPDATE dbo.PackagingPrice SET Status='Block',UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@ActorID
                OUTPUT @RowNum,'OK','Blocked',inserted.ID,inserted.RowVersion INTO @Result
                WHERE ID=@ID AND RowVersion=@RV;
            ELSE
                UPDATE dbo.PackagingPrice SET SupplierDimensionID=@SupplierDimension,SupplierDimensionRowVersion=@SupplierRV,SupplierD1=@SupplierD1,SupplierD2=@SupplierD2,SupplierD3=@SupplierD3,SupplierAreaPerPriceUnit=@SupplierArea,ExchangeRateToUSD=@Rate,VendorID=@Vendor,MaterialID=@Material,CurrencyID=@Currency,PriceBasis=@Basis,QuantityFrom=@QFrom,QuantityTo=@QTo,UnitPrice=@Price,EffectiveFrom=@From,EffectiveTo=@To,Status=COALESCE(@Status,Status),UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@ActorID
                OUTPUT @RowNum,'OK','Updated',inserted.ID,inserted.RowVersion INTO @Result
                WHERE ID=@ID AND RowVersion=@RV;
            IF @OwnTran=1 COMMIT;
        END TRY
        BEGIN CATCH
            IF @OwnTran=1 AND XACT_STATE()<>0 ROLLBACK;
            ELSE IF XACT_STATE()=1 ROLLBACK TRANSACTION PackagingRow;
            ELSE IF XACT_STATE()=-1 THROW;
            DELETE @Result WHERE RowNum=@RowNum;
            INSERT @Result VALUES(@RowNum,'ERROR',ERROR_MESSAGE(),@ID,NULL);
        END CATCH;
        FETCH NEXT FROM rows_cursor INTO @RowNum,@Command,@ID,@RV,@Material,@Currency,@Basis,@QFrom,@QTo,@Price,@From,@To,@Status,@Vendor,@Rate,@SupplierDimension,@SupplierRV,@SupplierD1,@SupplierD2,@SupplierD3,@SupplierArea,@SupplierSet;
    END;
    CLOSE rows_cursor; DEALLOCATE rows_cursor;
    SELECT * FROM @Result ORDER BY RowNum;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingDimension_Save
 @Username NVARCHAR(100),@ID INT=NULL,@RowVersion VARBINARY(8)=NULL,
 @PackagingTypeID INT=NULL,@D1 NVARCHAR(100)=NULL,@D2 NVARCHAR(100)=NULL,@D3 NVARCHAR(100)=NULL,
 @D1UoMID INT=NULL,@D2UoMID INT=NULL,@D3UoMID INT=NULL,
 @SquareMeterFormula NVARCHAR(200)=NULL,@Status VARCHAR(10)='Active',@FormulaReviewed BIT=0,
 @VolumeFormula NVARCHAR(200)=NULL,@VolumeFormulaProvided BIT=0,
 @ParentDimensionID INT=NULL,@ParentDimensionRowVersion VARBINARY(8)=NULL
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 -- Shipping dimensions.
 -- Shipping volume formula.
 -- Markers retained for older migration reruns.
 DECLARE @Actor INT,@Own BIT=0,@Root INT,@Shipping BIT,@TypeStatus VARCHAR(10),@OldType INT,
  @OldVolume NVARCHAR(200),@OldArea NVARCHAR(200),@PriceBasis NVARCHAR(20),@NeedsReview BIT=0,@Lock INT;
 EXEC dbo.usp_Packaging_Authorize @Username,'Maintain',@Actor OUTPUT;
 BEGIN TRY
 IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION;SET @Own=1;END ELSE SAVE TRANSACTION DimensionRow;
 EXEC @Lock=sys.sp_getapplock @Resource='PackagingTypeHierarchy',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
 IF @Lock<0 THROW 51108,'Packaging type hierarchy is busy. Retry.',1;
 IF @ID IS NULL AND @RowVersion IS NOT NULL THROW 51111,'Create cannot have a RowVersion.',1;
 IF @ID IS NOT NULL BEGIN
  SELECT @OldType=PackagingTypeID,@OldVolume=VolumeFormula,@OldArea=SquareMeterFormula,@NeedsReview=FormulaNeedsReview
  FROM dbo.PackagingDimension WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@RowVersion;
  IF @OldType IS NULL THROW 51108,'Concurrency conflict. Refresh first.',1;
 END;
 SELECT @Root=RootTypeID,@Shipping=RootShipping,@TypeStatus=Status,@PriceBasis=PriceBasis
 FROM dbo.v_PackagingTypeDimensionContext WHERE ID=@PackagingTypeID;
 IF @Root IS NULL OR (@TypeStatus<>'Active' AND NOT(@Status='Block' AND @OldType=@PackagingTypeID))
  THROW 51111,'Choose an active Packaging Type.',1;
 IF @Status IS NULL OR @Status NOT IN('Active','Block') THROW 51111,'Invalid status.',1;
 IF @Root<>@PackagingTypeID BEGIN
  IF NOT EXISTS(SELECT 1 FROM dbo.PackagingDimension WITH(UPDLOCK,HOLDLOCK)
   WHERE ID=@ParentDimensionID AND PackagingTypeID=@Root AND ParentDimensionID IS NULL
    AND (Status='Active' OR @Status='Block') AND RowVersion=@ParentDimensionRowVersion)
   THROW 51108,'Choose a current parent dimension definition. Refresh first.',1;
  SELECT @D1=D1Name,@D2=D2Name,@D3=D3Name,@D1UoMID=D1UoMID,@D2UoMID=D2UoMID,@D3UoMID=D3UoMID
  FROM dbo.PackagingDimension WHERE ID=@ParentDimensionID;
 END ELSE IF @ParentDimensionID IS NOT NULL THROW 51111,'Parent types own their dimensions.',1;
 SET @D1=NULLIF(LTRIM(RTRIM(@D1)),N''); SET @D2=NULLIF(LTRIM(RTRIM(@D2)),N''); SET @D3=NULLIF(LTRIM(RTRIM(@D3)),N'');
 SET @SquareMeterFormula=NULLIF(LTRIM(RTRIM(@SquareMeterFormula)),N'');
 IF @Root=@PackagingTypeID AND @PriceBasis='Square meter' AND @SquareMeterFormula IS NULL
  THROW 51111,'Square meter types require a Square meter formula.',1;
 SET @VolumeFormula=CASE WHEN @VolumeFormulaProvided=0 THEN @OldVolume ELSE NULLIF(LTRIM(RTRIM(@VolumeFormula)),N'') END;
 IF @D1 IS NULL OR @D1UoMID IS NULL THROW 51111,'D1 name and unit are required.',1;
 IF (@D2 IS NULL AND @D2UoMID IS NOT NULL) OR (@D2 IS NOT NULL AND @D2UoMID IS NULL)
  OR (@D3 IS NULL AND @D3UoMID IS NOT NULL) OR (@D3 IS NOT NULL AND @D3UoMID IS NULL)
  THROW 51111,'Each dimension needs a name and unit.',1;
 IF @Shipping=1 AND (@D2 IS NULL OR @D3<>N'Height' OR @D3 IS NULL OR @D2UoMID IS NULL OR @D3UoMID IS NULL)
  THROW 51111,'Shipping types require three dimensions; D3 is fixed as Height.',1;
 IF @VolumeFormula IS NOT NULL AND @Shipping=0 AND (@OldVolume IS NULL OR @VolumeFormula<>@OldVolume)
  THROW 51111,'Volume formula applies only to Shipping types and their child components.',1;
 IF EXISTS(SELECT 1 FROM (VALUES(@D1UoMID),(@D2UoMID),(@D3UoMID)) x(ID)
  WHERE ID IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.UoM WITH(HOLDLOCK) WHERE UoM.ID=x.ID AND Status='Active'))
  AND @Status='Active' THROW 51111,'Choose active dimension units.',1;
 IF CHARINDEX(N'D2',COALESCE(@SquareMeterFormula,N'')+COALESCE(@VolumeFormula,N''))>0 AND @D2 IS NULL
  OR CHARINDEX(N'D3',COALESCE(@SquareMeterFormula,N'')+COALESCE(@VolumeFormula,N''))>0 AND @D3 IS NULL
  THROW 51111,'Define dimensions used in the formulas.',1;
 IF @NeedsReview=1 AND @FormulaReviewed<>1 AND @Status='Active'
  THROW 51111,'Review the legacy formula using selected input units before saving.',1;
 IF @ID IS NULL BEGIN
  INSERT dbo.PackagingDimension(PackagingTypeID,ParentDimensionID,D1Name,D2Name,D3Name,D1UoMID,D2UoMID,D3UoMID,SquareMeterFormula,VolumeFormula,Status,CreatedBy)
  VALUES(@PackagingTypeID,@ParentDimensionID,@D1,@D2,@D3,@D1UoMID,@D2UoMID,@D3UoMID,@SquareMeterFormula,@VolumeFormula,@Status,@Actor);
  SET @ID=SCOPE_IDENTITY();
 END ELSE UPDATE dbo.PackagingDimension SET PackagingTypeID=@PackagingTypeID,ParentDimensionID=@ParentDimensionID,
  D1Name=@D1,D2Name=@D2,D3Name=@D3,D1UoMID=@D1UoMID,D2UoMID=@D2UoMID,D3UoMID=@D3UoMID,
  SquareMeterFormula=@SquareMeterFormula,VolumeFormula=@VolumeFormula,
  FormulaNeedsReview=CASE WHEN @FormulaReviewed=1 THEN 0 ELSE FormulaNeedsReview END,
  Status=@Status,UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@Actor WHERE ID=@ID;
 IF @Own=1 COMMIT;
 SELECT ID,RowVersion FROM dbo.PackagingDimension WHERE ID=@ID;
 END TRY
 BEGIN CATCH
 IF @Own=1 AND XACT_STATE()<>0 ROLLBACK;
 ELSE IF XACT_STATE()=1 ROLLBACK TRANSACTION DimensionRow;
 THROW;
 END CATCH;
END;
GO
GO
-- END MIGRATION 79_packaging_supplier_geometry.sql

-- BEGIN MIGRATION 80_packaging_formula_roles.sql
-- SOURCE SHA256 b50eb506143092603ed7ce0aa333361a33de6b9427059d7ba0e3fe47a1a30844
PRINT N'Applying 80_packaging_formula_roles.sql';
GO
GO
-- After 79. Split shipping space from material consumption; never delete request history.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.PackagingPrice','SupplierDimensionID') IS NULL
 THROW 52980,'Apply migration 79 first.',1;
IF COL_LENGTH('dbo.PackagingDimension','OccupiedM2Formula') IS NULL
 ALTER TABLE dbo.PackagingDimension ADD
  OccupiedM2Formula NVARCHAR(200) NULL, OccupiedM3Formula NVARCHAR(200) NULL,
  ConvertFromParentFormula NVARCHAR(200) NULL, ConvertFromSupplierFormula NVARCHAR(200) NULL,
  OccupiedFormulaNeedsReview BIT NOT NULL CONSTRAINT DF_PackagingDimension_OccupiedReview DEFAULT(0);
IF OBJECT_ID('dbo.PackagingFormulaRoleMigrationLog') IS NULL
 CREATE TABLE dbo.PackagingFormulaRoleMigrationLog(
  DimensionID INT PRIMARY KEY, BeforeJSON NVARCHAR(MAX) NOT NULL,
  CapturedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());
IF OBJECT_ID('dbo.PackagingFormulaRoleMigrationState') IS NULL
 CREATE TABLE dbo.PackagingFormulaRoleMigrationState(
  ID INT PRIMARY KEY CHECK(ID=1),AppliedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());
GO
IF NOT EXISTS(SELECT 1 FROM dbo.PackagingFormulaRoleMigrationState WHERE ID=1) BEGIN
 INSERT dbo.PackagingFormulaRoleMigrationLog(DimensionID,BeforeJSON)
 SELECT d.ID,(SELECT old.* FROM dbo.PackagingDimension old WHERE old.ID=d.ID FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)
 FROM dbo.PackagingDimension d;
 -- The old parent area is consumption, NOT a footprint. Leave occupied m2 blank for review.
 UPDATE d SET
  OccupiedM3Formula=CASE WHEN t.ParentTypeID IS NULL AND t.RootShipping=1 THEN d.VolumeFormula END,
  OccupiedFormulaNeedsReview=CASE WHEN t.ParentTypeID IS NULL AND t.RootShipping=1
    AND d.SquareMeterFormula IS NOT NULL THEN 1 ELSE 0 END,
  ConvertFromParentFormula=CASE WHEN t.ParentTypeID IS NOT NULL THEN p.SquareMeterFormula END,
  ConvertFromSupplierFormula=CASE WHEN t.ParentTypeID IS NOT NULL THEN COALESCE(d.SquareMeterFormula,p.SquareMeterFormula) END
 FROM dbo.PackagingDimension d JOIN dbo.v_PackagingTypeDimensionContext t ON t.ID=d.PackagingTypeID
 LEFT JOIN dbo.PackagingDimension p ON p.ID=d.ParentDimensionID;
 INSERT dbo.PackagingFormulaRoleMigrationState(ID) VALUES(1);
END;
GO
CREATE OR ALTER VIEW dbo.v_PackagingDimensionWeb AS
SELECT d.*,t.ParentTypeID,t.RootTypeID,t.RootShipping AS Shipping,t.PackagingType,t.PriceBasis,
 p.RowVersion AS ParentDimensionRowVersion,
 -- Legacy aliases are retained only for older readers, not new formula evaluation.
 COALESCE(d.SquareMeterFormula,p.SquareMeterFormula) AS EffectiveSquareMeterFormula,
 COALESCE(d.VolumeFormula,p.VolumeFormula) AS EffectiveVolumeFormula,
 CONVERT(BIT,CASE WHEN d.FormulaNeedsReview=1 OR p.FormulaNeedsReview=1 THEN 1 ELSE 0 END) AS EffectiveNeedsReview
FROM dbo.PackagingDimension d JOIN dbo.v_PackagingTypeDimensionContext t ON t.ID=d.PackagingTypeID
LEFT JOIN dbo.PackagingDimension p ON p.ID=d.ParentDimensionID;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingDimension_SaveV2
 @Username NVARCHAR(100),@ID INT=NULL,@RowVersion VARBINARY(8)=NULL,
 @PackagingTypeID INT=NULL,@D1 NVARCHAR(100)=NULL,@D2 NVARCHAR(100)=NULL,@D3 NVARCHAR(100)=NULL,
 @D1UoMID INT=NULL,@D2UoMID INT=NULL,@D3UoMID INT=NULL,
 @Status VARCHAR(10)='Active',@FormulaReviewed BIT=0,
 @ParentDimensionID INT=NULL,@ParentDimensionRowVersion VARBINARY(8)=NULL,
 @OccupiedM2Formula NVARCHAR(200)=NULL,@OccupiedM3Formula NVARCHAR(200)=NULL,
 @ConvertFromParentFormula NVARCHAR(200)=NULL,@ConvertFromSupplierFormula NVARCHAR(200)=NULL
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 DECLARE @Actor INT,@Own BIT=0,@Root INT,@Shipping BIT,@TypeStatus VARCHAR(10),@OldType INT,
  @PriceBasis NVARCHAR(20),@NeedsReview BIT=0,@OccupiedReview BIT=0,@Lock INT,@AllFormulas NVARCHAR(800);
 EXEC dbo.usp_Packaging_Authorize @Username,'Maintain',@Actor OUTPUT;
 BEGIN TRY
 IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION;SET @Own=1;END ELSE SAVE TRANSACTION DimensionRoleRow;
 EXEC @Lock=sys.sp_getapplock @Resource='PackagingTypeHierarchy',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
 IF @Lock<0 THROW 51108,'Packaging type hierarchy is busy. Retry.',1;
 IF @ID IS NULL AND @RowVersion IS NOT NULL THROW 51111,'Create cannot have a RowVersion.',1;
 IF @ID IS NOT NULL BEGIN
  SELECT @OldType=PackagingTypeID,@NeedsReview=FormulaNeedsReview,@OccupiedReview=OccupiedFormulaNeedsReview
  FROM dbo.PackagingDimension WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@RowVersion;
  IF @OldType IS NULL THROW 51108,'Concurrency conflict. Refresh first.',1;
 END;
 SELECT @Root=RootTypeID,@Shipping=RootShipping,@TypeStatus=Status,@PriceBasis=PriceBasis
 FROM dbo.v_PackagingTypeDimensionContext WHERE ID=@PackagingTypeID;
 IF @Root IS NULL OR (@TypeStatus<>'Active' AND NOT(@Status='Block' AND @OldType=@PackagingTypeID))
  THROW 51111,'Choose an active Packaging Type.',1;
 IF @Status IS NULL OR @Status NOT IN('Active','Block') THROW 51111,'Invalid status.',1;
 IF @Root<>@PackagingTypeID BEGIN
  IF NOT EXISTS(SELECT 1 FROM dbo.PackagingDimension WITH(UPDLOCK,HOLDLOCK)
   WHERE ID=@ParentDimensionID AND PackagingTypeID=@Root AND ParentDimensionID IS NULL
    AND (Status='Active' OR @Status='Block') AND RowVersion=@ParentDimensionRowVersion)
   THROW 51108,'Choose a current parent dimension definition. Refresh first.',1;
  SELECT @D1=D1Name,@D2=D2Name,@D3=D3Name,@D1UoMID=D1UoMID,@D2UoMID=D2UoMID,@D3UoMID=D3UoMID
  FROM dbo.PackagingDimension WHERE ID=@ParentDimensionID;
 END ELSE IF @ParentDimensionID IS NOT NULL THROW 51111,'Parent types own their dimensions.',1;
 SET @D1=NULLIF(LTRIM(RTRIM(@D1)),N''); SET @D2=NULLIF(LTRIM(RTRIM(@D2)),N''); SET @D3=NULLIF(LTRIM(RTRIM(@D3)),N'');
 SET @OccupiedM2Formula=NULLIF(LTRIM(RTRIM(@OccupiedM2Formula)),N'');
 SET @OccupiedM3Formula=NULLIF(LTRIM(RTRIM(@OccupiedM3Formula)),N'');
 SET @ConvertFromParentFormula=NULLIF(LTRIM(RTRIM(@ConvertFromParentFormula)),N'');
 SET @ConvertFromSupplierFormula=NULLIF(LTRIM(RTRIM(@ConvertFromSupplierFormula)),N'');
 IF (@OccupiedM2Formula IS NOT NULL OR @OccupiedM3Formula IS NOT NULL) AND (@Root<>@PackagingTypeID OR @Shipping<>1)
  THROW 51111,'Occupied formulas apply only to Shipping parents.',1;
 IF (@ConvertFromParentFormula IS NOT NULL OR @ConvertFromSupplierFormula IS NOT NULL) AND @Root=@PackagingTypeID
  THROW 51111,'Conversion formulas apply only to child types.',1;
 IF @Root<>@PackagingTypeID AND @PriceBasis='Square meter' AND @Status='Active' AND @ConvertFromParentFormula IS NULL
  THROW 51111,'Square meter children require Convert from parent.',1;
 IF @D1 IS NULL OR @D1UoMID IS NULL THROW 51111,'D1 name and unit are required.',1;
 IF (@D2 IS NULL AND @D2UoMID IS NOT NULL) OR (@D2 IS NOT NULL AND @D2UoMID IS NULL)
  OR (@D3 IS NULL AND @D3UoMID IS NOT NULL) OR (@D3 IS NOT NULL AND @D3UoMID IS NULL)
  THROW 51111,'Each dimension needs a name and unit.',1;
 IF @Shipping=1 AND (@D2 IS NULL OR @D3<>N'Height' OR @D3 IS NULL OR @D2UoMID IS NULL OR @D3UoMID IS NULL)
  THROW 51111,'Shipping types require three dimensions; D3 is fixed as Height.',1;
 IF EXISTS(SELECT 1 FROM (VALUES(@D1UoMID),(@D2UoMID),(@D3UoMID)) x(ID)
  WHERE ID IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.UoM WITH(HOLDLOCK) WHERE UoM.ID=x.ID AND Status='Active'))
  AND @Status='Active' THROW 51111,'Choose active dimension units.',1;
 SET @AllFormulas=COALESCE(@OccupiedM2Formula,N'')+COALESCE(@OccupiedM3Formula,N'')
   +COALESCE(@ConvertFromParentFormula,N'')+COALESCE(@ConvertFromSupplierFormula,N'');
 IF CHARINDEX(N'D2',@AllFormulas)>0 AND @D2 IS NULL OR CHARINDEX(N'D3',@AllFormulas)>0 AND @D3 IS NULL
  THROW 51111,'Define dimensions used in the formulas.',1;
 IF (@NeedsReview=1 OR @OccupiedReview=1) AND @FormulaReviewed<>1 AND @Status='Active'
  THROW 51111,'Review the migrated formulas before saving.',1;
 IF @ID IS NULL BEGIN
  INSERT dbo.PackagingDimension(PackagingTypeID,ParentDimensionID,D1Name,D2Name,D3Name,D1UoMID,D2UoMID,D3UoMID,
   OccupiedM2Formula,OccupiedM3Formula,ConvertFromParentFormula,ConvertFromSupplierFormula,Status,CreatedBy)
  VALUES(@PackagingTypeID,@ParentDimensionID,@D1,@D2,@D3,@D1UoMID,@D2UoMID,@D3UoMID,
   @OccupiedM2Formula,@OccupiedM3Formula,@ConvertFromParentFormula,@ConvertFromSupplierFormula,@Status,@Actor);
  SET @ID=SCOPE_IDENTITY();
 END ELSE UPDATE dbo.PackagingDimension SET PackagingTypeID=@PackagingTypeID,ParentDimensionID=@ParentDimensionID,
  D1Name=@D1,D2Name=@D2,D3Name=@D3,D1UoMID=@D1UoMID,D2UoMID=@D2UoMID,D3UoMID=@D3UoMID,
  OccupiedM2Formula=@OccupiedM2Formula,OccupiedM3Formula=@OccupiedM3Formula,
  ConvertFromParentFormula=@ConvertFromParentFormula,ConvertFromSupplierFormula=@ConvertFromSupplierFormula,
  FormulaNeedsReview=CASE WHEN @FormulaReviewed=1 THEN 0 ELSE FormulaNeedsReview END,
  OccupiedFormulaNeedsReview=CASE WHEN @FormulaReviewed=1 THEN 0 ELSE OccupiedFormulaNeedsReview END,
  Status=@Status,UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@Actor WHERE ID=@ID;
 IF @Own=1 COMMIT;
 SELECT ID,RowVersion FROM dbo.PackagingDimension WHERE ID=@ID;
 END TRY
 BEGIN CATCH
 IF @Own=1 AND XACT_STATE()<>0 ROLLBACK;
 ELSE IF XACT_STATE()=1 ROLLBACK TRANSACTION DimensionRoleRow;
 THROW;
 END CATCH;
END;
GO
CREATE OR ALTER TRIGGER dbo.tr_PackagingDimension_FormulaRoles
ON dbo.PackagingDimension AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM inserted d JOIN dbo.v_PackagingTypeDimensionContext t ON t.ID=d.PackagingTypeID
  WHERE ((d.OccupiedM2Formula IS NOT NULL OR d.OccupiedM3Formula IS NOT NULL) AND (t.ParentTypeID IS NOT NULL OR t.RootShipping<>1))
   OR ((d.ConvertFromParentFormula IS NOT NULL OR d.ConvertFromSupplierFormula IS NOT NULL) AND t.ParentTypeID IS NULL))
  THROW 51111,'Occupied formulas are for Shipping parents; conversion formulas are for children.',1;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingPrice_BatchV5
    @Rows dbo.PackagingPriceBatchTypeV4 READONLY, @Username NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT OFF;
    DECLARE @ActorID INT;
    EXEC dbo.usp_Packaging_Authorize @Username,'Maintain',@ActorID OUTPUT;
    IF (SELECT COUNT(*) FROM @Rows)>500 THROW 51105,'Maximum 500 rows per batch.',1;
    IF EXISTS(SELECT ID FROM @Rows WHERE ID IS NOT NULL GROUP BY ID HAVING COUNT(*)>1)
        THROW 51106,'Duplicate record IDs in batch.',1;
    DECLARE @Result TABLE(RowNum INT,Status VARCHAR(10),Message NVARCHAR(2048),NewID INT,NewRowVersion VARBINARY(8));
    DECLARE @SupplierDimension INT,@SupplierRV VARBINARY(8),@SupplierD1 DECIMAL(18,6),@SupplierD2 DECIMAL(18,6),@SupplierD3 DECIMAL(18,6),@SupplierArea DECIMAL(28,9),@SupplierSet BIT;
    DECLARE @RowNum INT,@Command CHAR(1),@ID INT,@RV VARBINARY(8),@OwnTran BIT,@Rate DECIMAL(18,10),@Vendor INT,@Material INT,@Currency INT,@Basis NVARCHAR(40),@QFrom DECIMAL(18,4),@QTo DECIMAL(18,4),@Price DECIMAL(18,4),@From DATE,@To DATE,@Status VARCHAR(10);
    DECLARE rows_cursor CURSOR LOCAL FAST_FORWARD FOR
        SELECT RowNum,UPPER(Command),ID,RowVersionB64,MaterialID,CurrencyID,NULLIF(LTRIM(RTRIM(PriceBasis)),N''),QuantityFrom,QuantityTo,UnitPrice,EffectiveFrom,EffectiveTo,Status,VendorID,ExchangeRateToUSD,SupplierDimensionID,SupplierDimensionRowVersion,SupplierD1,SupplierD2,SupplierD3,SupplierAreaPerPriceUnit,SupplierSet FROM @Rows ORDER BY RowNum;
    OPEN rows_cursor;
    FETCH NEXT FROM rows_cursor INTO @RowNum,@Command,@ID,@RV,@Material,@Currency,@Basis,@QFrom,@QTo,@Price,@From,@To,@Status,@Vendor,@Rate,@SupplierDimension,@SupplierRV,@SupplierD1,@SupplierD2,@SupplierD3,@SupplierArea,@SupplierSet;
    WHILE @@FETCH_STATUS=0
    BEGIN
        SET @OwnTran=0;
        BEGIN TRY
            IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION; SET @OwnTran=1; END
            ELSE SAVE TRANSACTION PackagingRow;
            IF @Command NOT IN('C','U','D') THROW 51107,'Use C, U or D.',1;
            IF @Command IN('U','D') AND NOT EXISTS(
                SELECT 1 FROM dbo.PackagingPrice WITH(UPDLOCK,HOLDLOCK)
                WHERE ID=@ID AND RowVersion=@RV)
                THROW 51108,'Concurrency conflict or row not found. Refresh first.',1;
            IF @Command<>'D'
            BEGIN
                IF @Command='U' AND COALESCE(@SupplierSet,0)=0
                 SELECT @SupplierDimension=CASE WHEN MaterialID=@Material AND PriceBasis=@Basis THEN SupplierDimensionID END,
                  @SupplierRV=CASE WHEN MaterialID=@Material AND PriceBasis=@Basis THEN SupplierDimensionRowVersion END,
                  @SupplierD1=CASE WHEN MaterialID=@Material AND PriceBasis=@Basis THEN SupplierD1 END,
                  @SupplierD2=CASE WHEN MaterialID=@Material AND PriceBasis=@Basis THEN SupplierD2 END,
                  @SupplierD3=CASE WHEN MaterialID=@Material AND PriceBasis=@Basis THEN SupplierD3 END,
                  @SupplierArea=CASE WHEN MaterialID=@Material AND PriceBasis=@Basis THEN SupplierAreaPerPriceUnit END
                 FROM dbo.PackagingPrice WHERE ID=@ID;
                IF @SupplierDimension IS NULL AND (@SupplierRV IS NOT NULL OR @SupplierD1 IS NOT NULL OR @SupplierD2 IS NOT NULL OR @SupplierD3 IS NOT NULL OR @SupplierArea IS NOT NULL)
                 THROW 51111,'Supplier measurements need a child dimension definition.',1;
                IF @SupplierDimension IS NOT NULL AND @SupplierSet=1
                BEGIN
                 IF @SupplierArea IS NULL OR @SupplierArea<=0 OR @SupplierD1<=0 OR @SupplierD2<=0 OR @SupplierD3<=0
                  THROW 51111,'Supplier formula area and measurements must be positive.',1;
                 IF NOT EXISTS(SELECT 1 FROM dbo.PackagingDimension d WITH(HOLDLOCK)
                  JOIN dbo.PackagingMaterial m ON m.PackagingTypeID=d.PackagingTypeID
                  JOIN dbo.PackagingType t ON t.ID=d.PackagingTypeID
                  JOIN dbo.PackagingDimension parent ON parent.ID=d.ParentDimensionID
                  WHERE d.ID=@SupplierDimension AND m.ID=@Material AND t.ParentTypeID IS NOT NULL
                   AND d.RowVersion=@SupplierRV AND d.Status='Active' AND t.Status='Active' AND parent.Status='Active'
                   AND d.FormulaNeedsReview=0 AND parent.FormulaNeedsReview=0
                   AND NOT EXISTS(SELECT 1 FROM (VALUES(d.D1UoMID),(d.D2UoMID),(d.D3UoMID)) s(ID)
                    JOIN dbo.UoM u WITH(HOLDLOCK) ON u.ID=s.ID WHERE u.Status<>'Active')
                   AND d.ConvertFromSupplierFormula IS NOT NULL)
                  THROW 51108,'Supplier child formula changed or is unavailable. Refresh pricing.',1;
                END;
                IF @Vendor IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.Vendor WITH(UPDLOCK,HOLDLOCK) WHERE ID=@Vendor AND (Status='Active' OR (@Command='U' AND EXISTS(SELECT 1 FROM dbo.PackagingPrice WHERE ID=@ID AND VendorID=@Vendor))))
                    THROW 51112,'Choose an active Vendor.',1;
                IF @Status IS NOT NULL AND @Status NOT IN('Active','Block')
                    THROW 51109,'Status must be Active or Block.',1;
                IF @Command='U' AND @Status IS NULL
                    SELECT @Status=Status FROM dbo.PackagingPrice WHERE ID=@ID;
                IF @Currency IS NULL AND @Vendor IS NOT NULL SELECT @Currency=CurrencyID FROM dbo.Vendor WHERE ID=@Vendor;
                IF EXISTS(SELECT 1 FROM dbo.Currency WHERE ID=@Currency AND CurrencyCode='USD') SET @Rate=1;
                IF @Rate IS NOT NULL AND @Rate<=0 THROW 51111,'Exchange rate must be positive.',1;
                IF @Currency IS NULL OR @Basis IS NULL OR @QFrom IS NULL OR @Price IS NULL OR @From IS NULL
                        THROW 51111,'Currency, basis, quantity from, price and effective from are required.',1;
                    IF NOT EXISTS(SELECT 1 FROM dbo.PackagingMaterial WITH(UPDLOCK,HOLDLOCK) WHERE ID=@Material AND Status='Active')
                        THROW 51112,'Active Packaging Material is required.',1;
                    /* Half-open quantity intervals [from,to); inclusive effective dates. */
                    IF COALESCE(@Status,'Active')='Active' AND EXISTS(
                        SELECT 1 FROM dbo.PackagingPrice WITH(UPDLOCK,HOLDLOCK)
                        WHERE MaterialID=@Material AND CurrencyID=@Currency AND PriceBasis=@Basis AND (VendorID=@Vendor OR (VendorID IS NULL AND @Vendor IS NULL))
                          AND Status='Active' AND (@Command='C' OR ID<>@ID)
                          AND (@To IS NULL OR EffectiveFrom<=@To)
                          AND (EffectiveTo IS NULL OR @From<=EffectiveTo)
                          AND (@QTo IS NULL OR QuantityFrom<@QTo)
                          AND (QuantityTo IS NULL OR @QFrom<QuantityTo))
                        THROW 51113,'Active price date and quantity ranges overlap.',1;
            END;
            IF @Command='C'
            BEGIN
                INSERT dbo.PackagingPrice(MaterialID,CurrencyID,PriceBasis,QuantityFrom,QuantityTo,UnitPrice,EffectiveFrom,EffectiveTo,Status,CreatedBy,VendorID,ExchangeRateToUSD,SupplierDimensionID,SupplierDimensionRowVersion,SupplierD1,SupplierD2,SupplierD3,SupplierAreaPerPriceUnit)
                OUTPUT @RowNum,'OK','Created',inserted.ID,inserted.RowVersion INTO @Result
                VALUES(@Material,@Currency,@Basis,@QFrom,@QTo,@Price,@From,@To,COALESCE(@Status,'Active'),@ActorID,@Vendor,@Rate,@SupplierDimension,@SupplierRV,@SupplierD1,@SupplierD2,@SupplierD3,@SupplierArea);
            END
            ELSE IF @Command='D'
                UPDATE dbo.PackagingPrice SET Status='Block',UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@ActorID
                OUTPUT @RowNum,'OK','Blocked',inserted.ID,inserted.RowVersion INTO @Result
                WHERE ID=@ID AND RowVersion=@RV;
            ELSE
                UPDATE dbo.PackagingPrice SET SupplierDimensionID=@SupplierDimension,SupplierDimensionRowVersion=@SupplierRV,SupplierD1=@SupplierD1,SupplierD2=@SupplierD2,SupplierD3=@SupplierD3,SupplierAreaPerPriceUnit=@SupplierArea,ExchangeRateToUSD=@Rate,VendorID=@Vendor,MaterialID=@Material,CurrencyID=@Currency,PriceBasis=@Basis,QuantityFrom=@QFrom,QuantityTo=@QTo,UnitPrice=@Price,EffectiveFrom=@From,EffectiveTo=@To,Status=COALESCE(@Status,Status),UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@ActorID
                OUTPUT @RowNum,'OK','Updated',inserted.ID,inserted.RowVersion INTO @Result
                WHERE ID=@ID AND RowVersion=@RV;
            IF @OwnTran=1 COMMIT;
        END TRY
        BEGIN CATCH
            IF @OwnTran=1 AND XACT_STATE()<>0 ROLLBACK;
            ELSE IF XACT_STATE()=1 ROLLBACK TRANSACTION PackagingRow;
            ELSE IF XACT_STATE()=-1 THROW;
            DELETE @Result WHERE RowNum=@RowNum;
            INSERT @Result VALUES(@RowNum,'ERROR',ERROR_MESSAGE(),@ID,NULL);
        END CATCH;
        FETCH NEXT FROM rows_cursor INTO @RowNum,@Command,@ID,@RV,@Material,@Currency,@Basis,@QFrom,@QTo,@Price,@From,@To,@Status,@Vendor,@Rate,@SupplierDimension,@SupplierRV,@SupplierD1,@SupplierD2,@SupplierD3,@SupplierArea,@SupplierSet;
    END;
    CLOSE rows_cursor; DEALLOCATE rows_cursor;
    SELECT * FROM @Result ORDER BY RowNum;
END;
GO
CREATE OR ALTER TRIGGER dbo.tr_PackagingType_FormulaRoleScope
ON dbo.PackagingType AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM dbo.PackagingDimension d JOIN dbo.v_PackagingTypeDimensionContext t ON t.ID=d.PackagingTypeID
  WHERE (d.OccupiedM2Formula IS NOT NULL OR d.OccupiedM3Formula IS NOT NULL)
   AND (t.ParentTypeID IS NOT NULL OR t.RootShipping<>1))
  THROW 51111,'Clear occupied formulas before removing Shipping from their parent type.',1;
END;
GO
COMMIT TRANSACTION;
GO
GO
-- END MIGRATION 80_packaging_formula_roles.sql

-- BEGIN MIGRATION 81_packaging_child_dimensions.sql
-- SOURCE SHA256 beac901a9c4f2b557fc89200cdb2d6804b82f524ee6688a145d0d1cc9118ddde
PRINT N'Applying 81_packaging_child_dimensions.sql';
GO
GO
-- After 80. Children own supplier dimension names/units; parent consumption is separate.
-- Only procedures/triggers change. No dimensions, quotes or request history are rewritten.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
IF COL_LENGTH('dbo.PackagingDimension','ConvertFromSupplierFormula') IS NULL
 THROW 52981,'Apply migration 80 first.',1;
GO
BEGIN TRANSACTION;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingDimension_SaveV2
 @Username NVARCHAR(100),@ID INT=NULL,@RowVersion VARBINARY(8)=NULL,
 @PackagingTypeID INT=NULL,@D1 NVARCHAR(100)=NULL,@D2 NVARCHAR(100)=NULL,@D3 NVARCHAR(100)=NULL,
 @D1UoMID INT=NULL,@D2UoMID INT=NULL,@D3UoMID INT=NULL,
 @Status VARCHAR(10)='Active',@FormulaReviewed BIT=0,
 @ParentDimensionID INT=NULL,@ParentDimensionRowVersion VARBINARY(8)=NULL,
 @OccupiedM2Formula NVARCHAR(200)=NULL,@OccupiedM3Formula NVARCHAR(200)=NULL,
 @ConvertFromParentFormula NVARCHAR(200)=NULL,@ConvertFromSupplierFormula NVARCHAR(200)=NULL
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 DECLARE @Actor INT,@Own BIT=0,@Root INT,@Shipping BIT,@TypeStatus VARCHAR(10),@OldType INT,
  @PriceBasis NVARCHAR(20),@NeedsReview BIT=0,@OccupiedReview BIT=0,@Lock INT,@AllFormulas NVARCHAR(800);
 EXEC dbo.usp_Packaging_Authorize @Username,'Maintain',@Actor OUTPUT;
 BEGIN TRY
 IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION;SET @Own=1;END ELSE SAVE TRANSACTION DimensionRoleRow;
 EXEC @Lock=sys.sp_getapplock @Resource='PackagingTypeHierarchy',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
 IF @Lock<0 THROW 51108,'Packaging type hierarchy is busy. Retry.',1;
 IF @ID IS NULL AND @RowVersion IS NOT NULL THROW 51111,'Create cannot have a RowVersion.',1;
 IF @ID IS NOT NULL BEGIN
  SELECT @OldType=PackagingTypeID,@NeedsReview=FormulaNeedsReview,@OccupiedReview=OccupiedFormulaNeedsReview
  FROM dbo.PackagingDimension WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@RowVersion;
  IF @OldType IS NULL THROW 51108,'Concurrency conflict. Refresh first.',1;
 END;
 SELECT @Root=RootTypeID,@Shipping=RootShipping,@TypeStatus=Status,@PriceBasis=PriceBasis
 FROM dbo.v_PackagingTypeDimensionContext WHERE ID=@PackagingTypeID;
 IF @Root IS NULL OR (@TypeStatus<>'Active' AND NOT(@Status='Block' AND @OldType=@PackagingTypeID))
  THROW 51111,'Choose an active Packaging Type.',1;
 IF @Status IS NULL OR @Status NOT IN('Active','Block') THROW 51111,'Invalid status.',1;
 IF @Root<>@PackagingTypeID BEGIN
  IF NOT EXISTS(SELECT 1 FROM dbo.PackagingDimension WITH(UPDLOCK,HOLDLOCK)
   WHERE ID=@ParentDimensionID AND PackagingTypeID=@Root AND ParentDimensionID IS NULL
    AND (Status='Active' OR @Status='Block') AND RowVersion=@ParentDimensionRowVersion)
   THROW 51108,'Choose a current parent dimension definition. Refresh first.',1;
 END ELSE IF @ParentDimensionID IS NOT NULL THROW 51111,'Parent types own their dimensions.',1;
 SET @D1=NULLIF(LTRIM(RTRIM(@D1)),N''); SET @D2=NULLIF(LTRIM(RTRIM(@D2)),N''); SET @D3=NULLIF(LTRIM(RTRIM(@D3)),N'');
 SET @OccupiedM2Formula=NULLIF(LTRIM(RTRIM(@OccupiedM2Formula)),N'');
 SET @OccupiedM3Formula=NULLIF(LTRIM(RTRIM(@OccupiedM3Formula)),N'');
 SET @ConvertFromParentFormula=NULLIF(LTRIM(RTRIM(@ConvertFromParentFormula)),N'');
 SET @ConvertFromSupplierFormula=NULLIF(LTRIM(RTRIM(@ConvertFromSupplierFormula)),N'');
 IF (@OccupiedM2Formula IS NOT NULL OR @OccupiedM3Formula IS NOT NULL) AND (@Root<>@PackagingTypeID OR @Shipping<>1)
  THROW 51111,'Occupied formulas apply only to Shipping parents.',1;
 IF (@ConvertFromParentFormula IS NOT NULL OR @ConvertFromSupplierFormula IS NOT NULL) AND @Root=@PackagingTypeID
  THROW 51111,'Conversion formulas apply only to child types.',1;
 IF @Root<>@PackagingTypeID AND @PriceBasis='Square meter' AND @Status='Active' AND @ConvertFromParentFormula IS NULL
  THROW 51111,'Square meter children require Convert from parent.',1;
 IF @D1 IS NULL OR @D1UoMID IS NULL THROW 51111,'D1 name and unit are required.',1;
 IF (@D2 IS NULL AND @D2UoMID IS NOT NULL) OR (@D2 IS NOT NULL AND @D2UoMID IS NULL)
  OR (@D3 IS NULL AND @D3UoMID IS NOT NULL) OR (@D3 IS NOT NULL AND @D3UoMID IS NULL)
  THROW 51111,'Each dimension needs a name and unit.',1;
 IF @Root=@PackagingTypeID AND @Shipping=1 AND (@D2 IS NULL OR @D3<>N'Height' OR @D3 IS NULL OR @D2UoMID IS NULL OR @D3UoMID IS NULL)
  THROW 51111,'Shipping types require three dimensions; D3 is fixed as Height.',1;
 IF EXISTS(SELECT 1 FROM (VALUES(@D1UoMID),(@D2UoMID),(@D3UoMID)) x(ID)
  WHERE ID IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.UoM WITH(HOLDLOCK) WHERE UoM.ID=x.ID AND Status='Active'))
  AND @Status='Active' THROW 51111,'Choose active dimension units.',1;
 SET @AllFormulas=COALESCE(@OccupiedM2Formula,N'')+COALESCE(@OccupiedM3Formula,N'')
   +COALESCE(@ConvertFromSupplierFormula,N'');
 IF CHARINDEX(N'D2',@AllFormulas)>0 AND @D2 IS NULL OR CHARINDEX(N'D3',@AllFormulas)>0 AND @D3 IS NULL
  THROW 51111,'Define dimensions used in the formulas.',1;
 IF @Root<>@PackagingTypeID AND @ConvertFromParentFormula IS NOT NULL AND EXISTS(
  SELECT 1 FROM dbo.PackagingDimension p WHERE p.ID=@ParentDimensionID
   AND ((CHARINDEX(N'D1',@ConvertFromParentFormula)>0 AND p.D1Name IS NULL)
    OR (CHARINDEX(N'D2',@ConvertFromParentFormula)>0 AND p.D2Name IS NULL)
    OR (CHARINDEX(N'D3',@ConvertFromParentFormula)>0 AND p.D3Name IS NULL)))
  THROW 51111,'Convert from parent must use dimensions defined on the selected parent.',1;
 IF (@NeedsReview=1 OR @OccupiedReview=1) AND @FormulaReviewed<>1 AND @Status='Active'
  THROW 51111,'Review the migrated formulas before saving.',1;
 IF @ID IS NULL BEGIN
  INSERT dbo.PackagingDimension(PackagingTypeID,ParentDimensionID,D1Name,D2Name,D3Name,D1UoMID,D2UoMID,D3UoMID,
   OccupiedM2Formula,OccupiedM3Formula,ConvertFromParentFormula,ConvertFromSupplierFormula,Status,CreatedBy)
  VALUES(@PackagingTypeID,@ParentDimensionID,@D1,@D2,@D3,@D1UoMID,@D2UoMID,@D3UoMID,
   @OccupiedM2Formula,@OccupiedM3Formula,@ConvertFromParentFormula,@ConvertFromSupplierFormula,@Status,@Actor);
  SET @ID=SCOPE_IDENTITY();
 END ELSE UPDATE dbo.PackagingDimension SET PackagingTypeID=@PackagingTypeID,ParentDimensionID=@ParentDimensionID,
  D1Name=@D1,D2Name=@D2,D3Name=@D3,D1UoMID=@D1UoMID,D2UoMID=@D2UoMID,D3UoMID=@D3UoMID,
  OccupiedM2Formula=@OccupiedM2Formula,OccupiedM3Formula=@OccupiedM3Formula,
  ConvertFromParentFormula=@ConvertFromParentFormula,ConvertFromSupplierFormula=@ConvertFromSupplierFormula,
  FormulaNeedsReview=CASE WHEN @FormulaReviewed=1 THEN 0 ELSE FormulaNeedsReview END,
  OccupiedFormulaNeedsReview=CASE WHEN @FormulaReviewed=1 THEN 0 ELSE OccupiedFormulaNeedsReview END,
  Status=@Status,UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@Actor WHERE ID=@ID;
 IF @Own=1 COMMIT;
 SELECT ID,RowVersion FROM dbo.PackagingDimension WHERE ID=@ID;
 END TRY
 BEGIN CATCH
 IF @Own=1 AND XACT_STATE()<>0 ROLLBACK;
 ELSE IF XACT_STATE()=1 ROLLBACK TRANSACTION DimensionRoleRow;
 THROW;
 END CATCH;
END;
GO

CREATE OR ALTER TRIGGER dbo.tr_PackagingDimension_ParentGeometry
ON dbo.PackagingDimension AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 -- No propagation: child supplier metadata belongs to the child, not its parent.
 IF EXISTS(SELECT 1 FROM dbo.PackagingDimension d
  JOIN dbo.v_PackagingTypeDimensionContext t ON t.ID=d.PackagingTypeID
  LEFT JOIN dbo.PackagingDimension p ON p.ID=d.ParentDimensionID
  WHERE (t.ParentTypeID IS NULL AND d.ParentDimensionID IS NOT NULL)
   OR (t.ParentTypeID IS NOT NULL AND (p.ID IS NULL OR p.ParentDimensionID IS NOT NULL OR p.PackagingTypeID<>t.RootTypeID)))
  THROW 51111,'Child conversion definitions must link to geometry on their root parent type.',1;
 IF EXISTS(SELECT 1 FROM inserted d JOIN dbo.v_PackagingTypeDimensionContext t ON t.ID=d.PackagingTypeID
  WHERE t.ParentTypeID IS NULL AND t.RootShipping=1 AND d.Status='Active'
   AND (d.D1Name IS NULL OR d.D2Name IS NULL OR d.D3Name IS NULL OR d.D3Name<>N'Height'
    OR d.D1UoMID IS NULL OR d.D2UoMID IS NULL OR d.D3UoMID IS NULL))
  THROW 51111,'Shipping parent dimensions require D1, D2 and D3 fixed as Height.',1;
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingPrice_BatchV5
    @Rows dbo.PackagingPriceBatchTypeV4 READONLY, @Username NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT OFF;
    DECLARE @ActorID INT;
    EXEC dbo.usp_Packaging_Authorize @Username,'Maintain',@ActorID OUTPUT;
    IF (SELECT COUNT(*) FROM @Rows)>500 THROW 51105,'Maximum 500 rows per batch.',1;
    IF EXISTS(SELECT ID FROM @Rows WHERE ID IS NOT NULL GROUP BY ID HAVING COUNT(*)>1)
        THROW 51106,'Duplicate record IDs in batch.',1;
    DECLARE @Result TABLE(RowNum INT,Status VARCHAR(10),Message NVARCHAR(2048),NewID INT,NewRowVersion VARBINARY(8));
    DECLARE @SupplierDimension INT,@SupplierRV VARBINARY(8),@SupplierD1 DECIMAL(18,6),@SupplierD2 DECIMAL(18,6),@SupplierD3 DECIMAL(18,6),@SupplierArea DECIMAL(28,9),@SupplierSet BIT;
    DECLARE @RowNum INT,@Command CHAR(1),@ID INT,@RV VARBINARY(8),@OwnTran BIT,@Rate DECIMAL(18,10),@Vendor INT,@Material INT,@Currency INT,@Basis NVARCHAR(40),@QFrom DECIMAL(18,4),@QTo DECIMAL(18,4),@Price DECIMAL(18,4),@From DATE,@To DATE,@Status VARCHAR(10);
    DECLARE rows_cursor CURSOR LOCAL FAST_FORWARD FOR
        SELECT RowNum,UPPER(Command),ID,RowVersionB64,MaterialID,CurrencyID,NULLIF(LTRIM(RTRIM(PriceBasis)),N''),QuantityFrom,QuantityTo,UnitPrice,EffectiveFrom,EffectiveTo,Status,VendorID,ExchangeRateToUSD,SupplierDimensionID,SupplierDimensionRowVersion,SupplierD1,SupplierD2,SupplierD3,SupplierAreaPerPriceUnit,SupplierSet FROM @Rows ORDER BY RowNum;
    OPEN rows_cursor;
    FETCH NEXT FROM rows_cursor INTO @RowNum,@Command,@ID,@RV,@Material,@Currency,@Basis,@QFrom,@QTo,@Price,@From,@To,@Status,@Vendor,@Rate,@SupplierDimension,@SupplierRV,@SupplierD1,@SupplierD2,@SupplierD3,@SupplierArea,@SupplierSet;
    WHILE @@FETCH_STATUS=0
    BEGIN
        SET @OwnTran=0;
        BEGIN TRY
            IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION; SET @OwnTran=1; END
            ELSE SAVE TRANSACTION PackagingRow;
            IF @Command NOT IN('C','U','D') THROW 51107,'Use C, U or D.',1;
            IF @Command IN('U','D') AND NOT EXISTS(
                SELECT 1 FROM dbo.PackagingPrice WITH(UPDLOCK,HOLDLOCK)
                WHERE ID=@ID AND RowVersion=@RV)
                THROW 51108,'Concurrency conflict or row not found. Refresh first.',1;
            IF @Command<>'D'
            BEGIN
                IF @Command='U' AND COALESCE(@SupplierSet,0)=0
                 SELECT @SupplierDimension=CASE WHEN MaterialID=@Material AND PriceBasis=@Basis THEN SupplierDimensionID END,
                  @SupplierRV=CASE WHEN MaterialID=@Material AND PriceBasis=@Basis THEN SupplierDimensionRowVersion END,
                  @SupplierD1=CASE WHEN MaterialID=@Material AND PriceBasis=@Basis THEN SupplierD1 END,
                  @SupplierD2=CASE WHEN MaterialID=@Material AND PriceBasis=@Basis THEN SupplierD2 END,
                  @SupplierD3=CASE WHEN MaterialID=@Material AND PriceBasis=@Basis THEN SupplierD3 END,
                  @SupplierArea=CASE WHEN MaterialID=@Material AND PriceBasis=@Basis THEN SupplierAreaPerPriceUnit END
                 FROM dbo.PackagingPrice WHERE ID=@ID;
                IF @SupplierDimension IS NULL AND (@SupplierRV IS NOT NULL OR @SupplierD1 IS NOT NULL OR @SupplierD2 IS NOT NULL OR @SupplierD3 IS NOT NULL OR @SupplierArea IS NOT NULL)
                 THROW 51111,'Supplier measurements need a child dimension definition.',1;
                IF @SupplierDimension IS NOT NULL AND @SupplierSet=1
                BEGIN
                 IF @SupplierArea IS NULL OR @SupplierArea<=0 OR @SupplierD1<=0 OR @SupplierD2<=0 OR @SupplierD3<=0
                  THROW 51111,'Supplier formula area and measurements must be positive.',1;
                 IF NOT EXISTS(SELECT 1 FROM dbo.PackagingDimension d WITH(HOLDLOCK)
                  JOIN dbo.PackagingMaterial m ON m.PackagingTypeID=d.PackagingTypeID
                  JOIN dbo.PackagingType t ON t.ID=d.PackagingTypeID
                  JOIN dbo.PackagingDimension parent ON parent.ID=d.ParentDimensionID
                  WHERE d.ID=@SupplierDimension AND m.ID=@Material AND t.ParentTypeID IS NOT NULL
                   AND d.RowVersion=@SupplierRV AND d.Status='Active' AND t.Status='Active' AND parent.Status='Active'
                   AND d.FormulaNeedsReview=0
                   AND NOT EXISTS(SELECT 1 FROM (VALUES(d.D1UoMID),(d.D2UoMID),(d.D3UoMID)) s(ID)
                    JOIN dbo.UoM u WITH(HOLDLOCK) ON u.ID=s.ID WHERE u.Status<>'Active')
                   AND d.ConvertFromSupplierFormula IS NOT NULL)
                  THROW 51108,'Supplier child formula changed or is unavailable. Refresh pricing.',1;
                END;
                IF @Vendor IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.Vendor WITH(UPDLOCK,HOLDLOCK) WHERE ID=@Vendor AND (Status='Active' OR (@Command='U' AND EXISTS(SELECT 1 FROM dbo.PackagingPrice WHERE ID=@ID AND VendorID=@Vendor))))
                    THROW 51112,'Choose an active Vendor.',1;
                IF @Status IS NOT NULL AND @Status NOT IN('Active','Block')
                    THROW 51109,'Status must be Active or Block.',1;
                IF @Command='U' AND @Status IS NULL
                    SELECT @Status=Status FROM dbo.PackagingPrice WHERE ID=@ID;
                IF @Currency IS NULL AND @Vendor IS NOT NULL SELECT @Currency=CurrencyID FROM dbo.Vendor WHERE ID=@Vendor;
                IF EXISTS(SELECT 1 FROM dbo.Currency WHERE ID=@Currency AND CurrencyCode='USD') SET @Rate=1;
                IF @Rate IS NOT NULL AND @Rate<=0 THROW 51111,'Exchange rate must be positive.',1;
                IF @Currency IS NULL OR @Basis IS NULL OR @QFrom IS NULL OR @Price IS NULL OR @From IS NULL
                        THROW 51111,'Currency, basis, quantity from, price and effective from are required.',1;
                    IF NOT EXISTS(SELECT 1 FROM dbo.PackagingMaterial WITH(UPDLOCK,HOLDLOCK) WHERE ID=@Material AND Status='Active')
                        THROW 51112,'Active Packaging Material is required.',1;
                    /* Half-open quantity intervals [from,to); inclusive effective dates. */
                    IF COALESCE(@Status,'Active')='Active' AND EXISTS(
                        SELECT 1 FROM dbo.PackagingPrice WITH(UPDLOCK,HOLDLOCK)
                        WHERE MaterialID=@Material AND CurrencyID=@Currency AND PriceBasis=@Basis AND (VendorID=@Vendor OR (VendorID IS NULL AND @Vendor IS NULL))
                          AND Status='Active' AND (@Command='C' OR ID<>@ID)
                          AND (@To IS NULL OR EffectiveFrom<=@To)
                          AND (EffectiveTo IS NULL OR @From<=EffectiveTo)
                          AND (@QTo IS NULL OR QuantityFrom<@QTo)
                          AND (QuantityTo IS NULL OR @QFrom<QuantityTo))
                        THROW 51113,'Active price date and quantity ranges overlap.',1;
            END;
            IF @Command='C'
            BEGIN
                INSERT dbo.PackagingPrice(MaterialID,CurrencyID,PriceBasis,QuantityFrom,QuantityTo,UnitPrice,EffectiveFrom,EffectiveTo,Status,CreatedBy,VendorID,ExchangeRateToUSD,SupplierDimensionID,SupplierDimensionRowVersion,SupplierD1,SupplierD2,SupplierD3,SupplierAreaPerPriceUnit)
                OUTPUT @RowNum,'OK','Created',inserted.ID,inserted.RowVersion INTO @Result
                VALUES(@Material,@Currency,@Basis,@QFrom,@QTo,@Price,@From,@To,COALESCE(@Status,'Active'),@ActorID,@Vendor,@Rate,@SupplierDimension,@SupplierRV,@SupplierD1,@SupplierD2,@SupplierD3,@SupplierArea);
            END
            ELSE IF @Command='D'
                UPDATE dbo.PackagingPrice SET Status='Block',UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@ActorID
                OUTPUT @RowNum,'OK','Blocked',inserted.ID,inserted.RowVersion INTO @Result
                WHERE ID=@ID AND RowVersion=@RV;
            ELSE
                UPDATE dbo.PackagingPrice SET SupplierDimensionID=@SupplierDimension,SupplierDimensionRowVersion=@SupplierRV,SupplierD1=@SupplierD1,SupplierD2=@SupplierD2,SupplierD3=@SupplierD3,SupplierAreaPerPriceUnit=@SupplierArea,ExchangeRateToUSD=@Rate,VendorID=@Vendor,MaterialID=@Material,CurrencyID=@Currency,PriceBasis=@Basis,QuantityFrom=@QFrom,QuantityTo=@QTo,UnitPrice=@Price,EffectiveFrom=@From,EffectiveTo=@To,Status=COALESCE(@Status,Status),UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@ActorID
                OUTPUT @RowNum,'OK','Updated',inserted.ID,inserted.RowVersion INTO @Result
                WHERE ID=@ID AND RowVersion=@RV;
            IF @OwnTran=1 COMMIT;
        END TRY
        BEGIN CATCH
            IF @OwnTran=1 AND XACT_STATE()<>0 ROLLBACK;
            ELSE IF XACT_STATE()=1 ROLLBACK TRANSACTION PackagingRow;
            ELSE IF XACT_STATE()=-1 THROW;
            DELETE @Result WHERE RowNum=@RowNum;
            INSERT @Result VALUES(@RowNum,'ERROR',ERROR_MESSAGE(),@ID,NULL);
        END CATCH;
        FETCH NEXT FROM rows_cursor INTO @RowNum,@Command,@ID,@RV,@Material,@Currency,@Basis,@QFrom,@QTo,@Price,@From,@To,@Status,@Vendor,@Rate,@SupplierDimension,@SupplierRV,@SupplierD1,@SupplierD2,@SupplierD3,@SupplierArea,@SupplierSet;
    END;
    CLOSE rows_cursor; DEALLOCATE rows_cursor;
    SELECT * FROM @Result ORDER BY RowNum;
END;
GO

COMMIT;
GO
GO
-- END MIGRATION 81_packaging_child_dimensions.sql

-- BEGIN MIGRATION 82_opportunity_product_weight_snapshot.sql
-- SOURCE SHA256 de5944f4711d3aacbe533ea6b98139499010ac69145e8bb57f1fafae19d19b1f
PRINT N'Applying 82_opportunity_product_weight_snapshot.sql';
GO
GO
-- After 81. Opportunity product weight is a read-only snapshot, not live master data.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.OpportunityItem','ProductNetWeightGrams') IS NULL
 ALTER TABLE dbo.OpportunityItem ADD ProductNetWeightGrams DECIMAL(10,2) NULL,
  ProductWeightSnapshotCapturedAt DATETIME2(7) NULL;
GO
-- Legacy items use their latest matching captured request weight when available;
-- otherwise capture today's Product Master weight once. Never rewrite requests.
UPDATE i SET ProductNetWeightGrams=COALESCE(r.WeightGrams,p.WeightGrams),
 ProductWeightSnapshotCapturedAt=COALESCE(r.SnapshotCapturedAt,SYSUTCDATETIME())
FROM dbo.OpportunityItem i JOIN dbo.Product p ON p.ID=i.ProductID
OUTER APPLY(SELECT TOP(1) ri.WeightGrams,ri.SnapshotCapturedAt
 FROM dbo.PackagingConfigurationRequestItem ri
 WHERE ri.OpportunityItemID=i.ID AND ri.ProductID=i.ProductID AND ri.WeightGrams IS NOT NULL
 ORDER BY ri.ID DESC) r
WHERE i.ProductWeightSnapshotCapturedAt IS NULL;
GO
CREATE OR ALTER TRIGGER dbo.tr_OpportunityItem_ProductWeightSnapshot
ON dbo.OpportunityItem AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 -- Only choosing another product recaptures weight. Unrelated edits preserve it.
 -- Nested mix child INSERTs must also capture; only our internal update skips the guard.
 IF TRIGGER_NESTLEVEL(OBJECT_ID('dbo.tr_OpportunityItem_ProductWeightSnapshot'))=1
 AND EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON d.ID=i.ID
  WHERE i.ProductID=d.ProductID AND EXISTS(
   SELECT i.ProductNetWeightGrams,i.ProductWeightSnapshotCapturedAt
   EXCEPT SELECT d.ProductNetWeightGrams,d.ProductWeightSnapshotCapturedAt))
  THROW 52982,'Product net weight is a read-only snapshot from Product Master.',1;
 IF NOT EXISTS(SELECT 1 FROM inserted i LEFT JOIN deleted d ON d.ID=i.ID
  WHERE d.ID IS NULL OR d.ProductID<>i.ProductID) RETURN;
 UPDATE item SET ProductNetWeightGrams=p.WeightGrams,
  ProductWeightSnapshotCapturedAt=SYSUTCDATETIME()
 FROM dbo.OpportunityItem item JOIN inserted i ON i.ID=item.ID
 LEFT JOIN deleted d ON d.ID=i.ID JOIN dbo.Product p WITH(HOLDLOCK) ON p.ID=i.ProductID
 WHERE d.ID IS NULL OR d.ProductID<>i.ProductID;
END;
GO
-- Item description is retained for old clients/history, but no longer required.
-- Missing values default on create and preserve the previous label on same-product edits.
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_Opportunity_HeaderDetail_Batch_AuditImplementation'));
IF @D IS NULL THROW 52982,'Opportunity batch implementation is missing.',1;
IF CHARINDEX(N'COALESCE(NULLIF(r.ItemDescription',@D)=0 BEGIN
 DECLARE @Old NVARCHAR(MAX)=N'SELECT RowNum,Command,ID,OpportunityNumber,ProductID,ItemDescription,AnnualUnit,EstPctAwarded,ShelfPrice,''Draft'',RowVersionB64 FROM @ItemRows;';
 IF CHARINDEX(@Old,@D)=0 THROW 52982,'Unexpected Opportunity safe item mapping.',1;
 SET @D=REPLACE(@D,@Old,N'SELECT r.RowNum,r.Command,r.ID,r.OpportunityNumber,r.ProductID,
 COALESCE(NULLIF(r.ItemDescription,N''''),CASE WHEN oi.ProductID=r.ProductID THEN oi.ItemDescription END,p.ProductName),
 r.AnnualUnit,r.EstPctAwarded,r.ShelfPrice,''Draft'',r.RowVersionB64
 FROM @ItemRows r LEFT JOIN dbo.OpportunityItem oi ON oi.ID=r.ID
 LEFT JOIN dbo.Product p ON p.ID=r.ProductID;');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityProductLookup_Read'));
IF @D IS NULL THROW 52982,'Product lookup is missing.',1;
IF CHARINDEX(N'p.WeightGrams',@D)=0 BEGIN
 IF CHARINDEX(N'p.ProductName,p.ShelfLifeDays',@D)=0 THROW 52982,'Unexpected product lookup.',1;
 SET @D=REPLACE(@D,N'p.ProductName,p.ShelfLifeDays',N'p.ProductName,p.WeightGrams,p.ShelfLifeDays');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
-- Retained direct item reader also exposes the same snapshot.
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityItem_ReadByOpportunity'));
IF @D IS NULL THROW 52982,'Opportunity item reader is missing.',1;
IF CHARINDEX(N'ProductNetWeightGrams',@D)=0 BEGIN
 IF CHARINDEX(N'oi.ItemDescription, oi.AnnualUnit',@D)=0 THROW 52982,'Unexpected item reader.',1;
 SET @D=REPLACE(@D,N'oi.ItemDescription, oi.AnnualUnit',N'oi.ProductNetWeightGrams AS WeightGrams, oi.ItemDescription, oi.AnnualUnit');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE    PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
-- New Packaging Requests inherit the opportunity weight captured on product selection.
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingRequest_Create_AuditImplementation'));
IF @D IS NULL THROW 52982,'Packaging Request creation implementation is missing.',1;
IF CHARINDEX(N'i.ProductNetWeightGrams',@D)=0 BEGIN
 IF CHARINDEX(N'@ActorID,p.WeightGrams,p.Category',@D)=0 THROW 52982,'Unexpected Packaging Request weight mapping.',1;
 SET @D=REPLACE(@D,N'@ActorID,p.WeightGrams,p.Category',N'@ActorID,i.ProductNetWeightGrams,p.Category');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
COMMIT;
GO
GO
-- END MIGRATION 82_opportunity_product_weight_snapshot.sql

-- BEGIN MIGRATION 83_packaging_container_profiles.sql
-- SOURCE SHA256 a7ae7694b5c606c01e2ce9b71bdf73b6932b547d10ae395ae0ffe7a4de706cfb
PRINT N'Applying 83_packaging_container_profiles.sql';
GO
GO
-- After 82. Preserve all request/pricing history; legacy scalar counts remain unassigned.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','SelectedContainerType') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD SelectedContainerType NVARCHAR(5) NULL
 CONSTRAINT CK_PCRItem_ContainerType CHECK(SelectedContainerType IN(N'20DC',N'40DC',N'40HC',N'20RC',N'40RHC'));
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','ContainerLoadProfiles') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD ContainerLoadProfiles NVARCHAR(MAX) NULL
 CONSTRAINT CK_PCRItem_ContainerProfiles CHECK(ISJSON(ContainerLoadProfiles)=1 AND LEFT(LTRIM(ContainerLoadProfiles),1)=N'{');
-- Zero is a legitimate captured Pallet Master capacity; legacy user-entered counts remain positive.
IF EXISTS(SELECT 1 FROM sys.check_constraints WHERE name='CK_PCRItem_PalletsPerContainer')
 ALTER TABLE dbo.PackagingConfigurationRequestItem DROP CONSTRAINT CK_PCRItem_PalletsPerContainer;
ALTER TABLE dbo.PackagingConfigurationRequestItem WITH CHECK ADD CONSTRAINT CK_PCRItem_PalletsPerContainer CHECK(PalletsPerContainer>=0);
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation'));
IF @D IS NULL OR CHARINDEX(N'-- Calculated pallet layers.',@D)=0
 THROW 52970,'Apply migrations through 82 before container profiles.',1;
IF CHARINDEX(N'-- Container type profiles:',@D)=0 BEGIN
 IF CHARINDEX(N'HeightMM DECIMAL(12,2)) j',@D)=0
  OR CHARINDEX(N'-- Container loading count validation.',@D)=0
  THROW 52970,'Unexpected response fields signature.',1;
 SET @D=REPLACE(@D,N'WHERE [key] NOT IN(''FirstPMType'',''SecondPMType''',N'WHERE [key] NOT IN(''SelectedContainerType'',''ContainerLoadProfiles'',''FirstPMType'',''SecondPMType''');
 SET @D=REPLACE(@D,N'-- Container loading count validation.',N' -- Container type profiles: validate, merge and project the active type.
 DECLARE @ContainerType NVARCHAR(5),@OldContainerType NVARCHAR(5),@ContainerFamily NVARCHAR(200),
  @Profiles NVARCHAR(MAX),@OldProfiles NVARCHAR(MAX),@IncomingProfiles NVARCHAR(MAX),
  @LoadMode NVARCHAR(500),@ProfilePallet NVARCHAR(100),@PreviousPallet NVARCHAR(100);
 SELECT @OldContainerType=i.SelectedContainerType,@OldProfiles=COALESCE(i.ContainerLoadProfiles,N''{}''),
  @ContainerType=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''SelectedContainerType'')
   THEN JSON_VALUE(@Fields,''$.SelectedContainerType'') ELSE i.SelectedContainerType END,
  @ContainerFamily=COALESCE(NULLIF(i.ContainerRequest,N''''),parent.ContainerRequest),
  @LoadMode=COALESCE(i.ConfigurationRequest,N''''),
  @PreviousPallet=i.ResponsePalletSize,
  @ProfilePallet=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''ResponsePalletSize'')
   THEN NULLIF(JSON_VALUE(@Fields,''$.ResponsePalletSize''),N'''') ELSE i.ResponsePalletSize END
 FROM dbo.PackagingConfigurationRequestItem i
 LEFT JOIN dbo.OpportunityItem oi ON oi.ID=i.OpportunityItemID
 LEFT JOIN dbo.PackagingConfigurationRequestItem parent ON parent.RequestID=i.RequestID AND parent.OpportunityItemID=oi.ParentItemID
 WHERE i.ID=@ID;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''SelectedContainerType'' AND [type]<>0
  AND ([type]<>1 OR [value] COLLATE Latin1_General_100_BIN2 NOT IN(N''20DC'',N''40DC'',N''40HC'',N''20RC'',N''40RHC'')))
  THROW 52961,''Choose a valid container type.'',1;
 IF (@ContainerFamily=N''Dry'' AND @ContainerType NOT IN(N''20DC'',N''40DC'',N''40HC''))
  OR (@ContainerFamily=N''Reefer'' AND @ContainerType NOT IN(N''20RC'',N''40RHC''))
  THROW 52961,''Container type must match the requested Dry or Reefer family.'',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''ContainerLoadProfiles'' AND [type] NOT IN(0,5))
  THROW 52961,''Container loading profiles must be an object.'',1;
 SET @IncomingProfiles=JSON_QUERY(@Fields,''$.ContainerLoadProfiles'');
 IF EXISTS(SELECT [key] FROM OPENJSON(@IncomingProfiles) GROUP BY [key] HAVING COUNT(*)>1)
  OR EXISTS(SELECT 1 FROM OPENJSON(@IncomingProfiles) WHERE [type]<>5
   OR [key] COLLATE Latin1_General_100_BIN2 NOT IN(N''20DC'',N''40DC'',N''40HC'',N''20RC'',N''40RHC''))
  THROW 52961,''Each container profile must be a unique valid container type.'',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@IncomingProfiles) p
  WHERE (@ContainerFamily=N''Dry'' AND p.[key] NOT IN(N''20DC'',N''40DC'',N''40HC''))
   OR (@ContainerFamily=N''Reefer'' AND p.[key] NOT IN(N''20RC'',N''40RHC'')))
  THROW 52961,''Container profiles must match the requested container family.'',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@IncomingProfiles) p CROSS APPLY OPENJSON(p.value) f
  WHERE f.[key] COLLATE Latin1_General_100_BIN2 NOT IN(N''LayersPerContainer'',N''PalletsPerContainer'',N''CartonsPerContainerFloor'')
   OR f.[type]<>0 AND (f.[type] NOT IN(1,2) OR f.[value] LIKE ''%[^0-9]%'' OR TRY_CONVERT(INT,f.[value]) IS NULL
    OR TRY_CONVERT(INT,f.[value])<CASE WHEN f.[key]=''PalletsPerContainer'' THEN 0 ELSE 1 END))
  OR EXISTS(SELECT 1 FROM OPENJSON(@IncomingProfiles) p CROSS APPLY OPENJSON(p.value) f GROUP BY p.[key],f.[key] HAVING COUNT(*)>1)
  THROW 52961,''Container profile counts must be whole numbers within the allowed range.'',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@IncomingProfiles) p CROSS APPLY OPENJSON(p.value) f
  WHERE f.[type]<>0 AND ((@LoadMode=N''Floor load'' AND f.[key]=''LayersPerContainer'')
   OR (@LoadMode NOT IN(N''Floor load'',N''Both'') AND f.[key]=''CartonsPerContainerFloor'')))
  THROW 52961,''Use only the loading counts matching the request configuration snapshot.'',1;
 SET @Profiles=@OldProfiles;
 DECLARE @Kind NVARCHAR(5),@Entry NVARCHAR(MAX),@OldEntry NVARCHAR(MAX),@Capacity INT,@Path NVARCHAR(100),@Merged NVARCHAR(MAX),@CountKey NVARCHAR(100),@CountValue NVARCHAR(MAX);
 DECLARE incoming_profiles CURSOR LOCAL FAST_FORWARD FOR SELECT [key],[value] FROM OPENJSON(@IncomingProfiles);
 OPEN incoming_profiles;FETCH NEXT FROM incoming_profiles INTO @Kind,@Entry;
 WHILE @@FETCH_STATUS=0 BEGIN
  SET @Merged=COALESCE(JSON_QUERY(@Profiles,N''$."''+@Kind+N''"''),N''{}'');
  DECLARE profile_counts CURSOR LOCAL FAST_FORWARD FOR SELECT [key],[value] FROM OPENJSON(@Entry);
  OPEN profile_counts;FETCH NEXT FROM profile_counts INTO @CountKey,@CountValue;
  WHILE @@FETCH_STATUS=0 BEGIN
   SET @Merged=JSON_MODIFY(@Merged,N''$.''+@CountKey,TRY_CONVERT(INT,@CountValue));
   FETCH NEXT FROM profile_counts INTO @CountKey,@CountValue;
  END;
  CLOSE profile_counts;DEALLOCATE profile_counts;
  SET @Profiles=JSON_MODIFY(@Profiles,N''$."''+@Kind+N''"'',JSON_QUERY(@Merged));
  FETCH NEXT FROM incoming_profiles INTO @Kind,@Entry;
 END;
 CLOSE incoming_profiles;DEALLOCATE incoming_profiles;
 IF @ContainerType IS NOT NULL BEGIN
  SET @Path=N''$."''+@ContainerType+N''"'';
  SET @Entry=JSON_QUERY(@Profiles,@Path);
  IF @Entry IS NULL BEGIN
   SELECT @Entry=(SELECT
    CASE WHEN @OldContainerType IS NULL AND @LoadMode<>N''Floor load'' THEN i.LayersPerContainer END LayersPerContainer,
    CASE WHEN @OldContainerType IS NULL AND @LoadMode IN(N''Floor load'',N''Both'') THEN i.CartonsPerContainerFloor END CartonsPerContainerFloor
    FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES)
   FROM dbo.PackagingConfigurationRequestItem i WHERE i.ID=@ID;
  END;
  IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''LayersPerContainer'')
   SET @Entry=JSON_MODIFY(@Entry,''$.LayersPerContainer'',TRY_CONVERT(INT,JSON_VALUE(@Fields,''$.LayersPerContainer'')));
  IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''CartonsPerContainerFloor'')
   SET @Entry=JSON_MODIFY(@Entry,''$.CartonsPerContainerFloor'',TRY_CONVERT(INT,JSON_VALUE(@Fields,''$.CartonsPerContainerFloor'')));
  SET @Profiles=JSON_MODIFY(@Profiles,@Path,JSON_QUERY(@Entry));
 END;
 -- Master capacity is a snapshot. Do not silently refresh existing profiles on unrelated edits.
 DECLARE capacity_profiles CURSOR LOCAL FAST_FORWARD FOR SELECT [key],[value] FROM OPENJSON(@Profiles);
 OPEN capacity_profiles;FETCH NEXT FROM capacity_profiles INTO @Kind,@Entry;
 WHILE @@FETCH_STATUS=0 BEGIN
  SET @Path=N''$."''+@Kind+N''"'';
  SET @OldEntry=JSON_QUERY(@OldProfiles,@Path);
  SET @Capacity=NULL;
  IF @OldEntry IS NULL OR COALESCE(@ProfilePallet,N'''')<>COALESCE(@PreviousPallet,N'''') BEGIN
   SELECT @Capacity=CASE @Kind WHEN N''20DC'' THEN p.PalletsPer20DC WHEN N''40DC'' THEN p.PalletsPer40DC
    WHEN N''40HC'' THEN p.PalletsPer40HC WHEN N''20RC'' THEN p.PalletsPer20RC ELSE p.PalletsPer40RHC END
   FROM dbo.Pallet p JOIN dbo.v_PalletMaster v ON v.ID=p.ID WHERE v.PalletSize=@ProfilePallet;
  END ELSE SET @Capacity=TRY_CONVERT(INT,JSON_VALUE(@OldEntry,''$.PalletsPerContainer''));
  SET @Entry=JSON_MODIFY(@Entry,''$.PalletsPerContainer'',@Capacity);
  SET @Profiles=JSON_MODIFY(@Profiles,@Path,JSON_QUERY(@Entry));
  FETCH NEXT FROM capacity_profiles INTO @Kind,@Entry;
 END;
 CLOSE capacity_profiles;DEALLOCATE capacity_profiles;
 SET @Fields=JSON_MODIFY(@Fields,''$.ContainerLoadProfiles'',JSON_QUERY(@Profiles));

 -- Container loading count validation.');
 SET @D=REPLACE(@D,N'OR TRY_CONVERT(INT,[value])<1))'+CHAR(13)+CHAR(10)+N'  THROW 52961,''Container counts',
  N'OR TRY_CONVERT(INT,[value])<CASE WHEN [key]=''PalletsPerContainer'' AND @ContainerType IS NOT NULL THEN 0 ELSE 1 END))'+CHAR(13)+CHAR(10)+N'  THROW 52961,''Container counts');
 -- Migration source files may use LF instead of CRLF.
 SET @D=REPLACE(@D,N'OR TRY_CONVERT(INT,[value])<1))'+CHAR(10)+N'  THROW 52961,''Container counts',
  N'OR TRY_CONVERT(INT,[value])<CASE WHEN [key]=''PalletsPerContainer'' AND @ContainerType IS NOT NULL THEN 0 ELSE 1 END))'+CHAR(10)+N'  THROW 52961,''Container counts');
 SET @D=REPLACE(@D,N'UPDATE t SET',N'UPDATE t SET
 SelectedContainerType=@ContainerType,ContainerLoadProfiles=@Profiles,');
 SET @D=REPLACE(@D,N'LayersPerContainer=CASE WHEN EXISTS',N'LayersPerContainer=CASE WHEN @ContainerType IS NOT NULL OR @OldContainerType IS NOT NULL THEN CASE WHEN @LoadMode<>N''Floor load'' THEN TRY_CONVERT(INT,JSON_VALUE(@Entry,''$.LayersPerContainer'')) END WHEN EXISTS');
 SET @D=REPLACE(@D,N'PalletsPerContainer=CASE WHEN EXISTS',N'PalletsPerContainer=CASE WHEN @ContainerType IS NOT NULL OR @OldContainerType IS NOT NULL THEN CASE WHEN @LoadMode<>N''Floor load'' THEN TRY_CONVERT(INT,JSON_VALUE(@Entry,''$.PalletsPerContainer'')) END WHEN EXISTS');
 SET @D=REPLACE(@D,N'CartonsPerContainerFloor=CASE WHEN EXISTS',N'CartonsPerContainerFloor=CASE WHEN @ContainerType IS NOT NULL OR @OldContainerType IS NOT NULL THEN CASE WHEN @LoadMode IN(N''Floor load'',N''Both'') THEN TRY_CONVERT(INT,JSON_VALUE(@Entry,''$.CartonsPerContainerFloor'')) END WHEN EXISTS');
 -- @Entry must be the selected profile after capacity mapping, not the final cursor entry.
 SET @D=REPLACE(@D,N'DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT',N'SET @Entry=CASE WHEN @ContainerType IS NOT NULL THEN JSON_QUERY(@Profiles,N''$."''+@ContainerType+N''"'') END;
 DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
-- Both families are an explicit choice in all shared requirement editors.
SET @D=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityItem_Fields_Save'));
IF @D IS NULL THROW 52970,'Opportunity fields procedure is missing.',1;
IF CHARINDEX(N'IN(N''Dry'',N''Reefer'')',@D)>0 BEGIN
 SET @D=REPLACE(@D,N'IN(N''Dry'',N''Reefer'')',N'IN(N''Dry'',N''Reefer'',N''Both'')');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
SET @D=OBJECT_DEFINITION(OBJECT_ID('dbo.tr_PackagingConfigurationRequestItem_ChangeLog'));
IF @D IS NULL OR CHARINDEX(N'CROSS APPLY(VALUES',@D)=0 THROW 52970,'Request audit trigger is missing.',1;
IF CHARINDEX(N'''ContainerLoadProfiles'',',@D)=0 BEGIN
 SET @D=REPLACE(@D,N'CROSS APPLY(VALUES',N'CROSS APPLY(VALUES
 (''SelectedContainerType'',CONVERT(NVARCHAR(MAX),d.SelectedContainerType),CONVERT(NVARCHAR(MAX),i.SelectedContainerType),1),
 (''ContainerLoadProfiles'',CONVERT(NVARCHAR(MAX),d.ContainerLoadProfiles),CONVERT(NVARCHAR(MAX),i.ContainerLoadProfiles),1),');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER TRIGGER',N'ALTER TRIGGER'),N'CREATE   TRIGGER',N'ALTER TRIGGER'),N'CREATE TRIGGER',N'ALTER TRIGGER');
 EXEC sys.sp_executesql @D;
END;
COMMIT;
GO
GO
-- END MIGRATION 83_packaging_container_profiles.sql

-- BEGIN MIGRATION 84_packaging_container_layers.sql
-- SOURCE SHA256 e41bb7aa232550a883be621470b97146904837bfa065d2dade3b720e9d2cc740
PRINT N'Applying 84_packaging_container_layers.sql';
GO
GO
-- After 83. Calculate per-type vertical pallet counts without rewriting saved history.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF EXISTS(SELECT 1 FROM sys.check_constraints WHERE name='CK_PCRItem_LayersPerContainer')
 ALTER TABLE dbo.PackagingConfigurationRequestItem DROP CONSTRAINT CK_PCRItem_LayersPerContainer;
ALTER TABLE dbo.PackagingConfigurationRequestItem WITH CHECK ADD CONSTRAINT CK_PCRItem_LayersPerContainer CHECK(LayersPerContainer>=0);
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation'));
IF @D IS NULL OR CHARINDEX(N'-- Container type profiles:',@D)=0
 THROW 52970,'Apply migration 83 before calculated container layers.',1;
IF CHARINDEX(N'-- Calculated container layers.',@D)=0 BEGIN
 DECLARE @Anchor NVARCHAR(MAX)=N'SET @Entry=CASE WHEN @ContainerType IS NOT NULL THEN JSON_QUERY(@Profiles,N''$."''+@ContainerType+N''"'') END;';
 IF CHARINDEX(@Anchor,@D)=0 THROW 52970,'Unexpected container profile procedure signature.',1;
 SET @D=REPLACE(@D,N'CASE WHEN f.[key]=''PalletsPerContainer'' THEN 0',N'CASE WHEN f.[key] IN(''PalletsPerContainer'',''LayersPerContainer'') THEN 0');
 SET @D=REPLACE(@D,N'CASE WHEN [key]=''PalletsPerContainer'' AND @ContainerType IS NOT NULL THEN 0',
  N'CASE WHEN [key] IN(''PalletsPerContainer'',''LayersPerContainer'') AND @ContainerType IS NOT NULL THEN 0');
 SET @D=REPLACE(@D,@Anchor,N'-- Calculated container layers.
 DECLARE @ContainerPalletHeightScaled DECIMAL(28,0),@ContainerClearanceScaled DECIMAL(28,0),@AutomaticContainerLayers INT;
 IF @Height IS NOT NULL AND @PalletLayers IS NOT NULL
  SET @ContainerPalletHeightScaled=15000+CONVERT(DECIMAL(28,0),@PalletLayers)*(@Height*100);
 DECLARE geometry_profiles CURSOR LOCAL FAST_FORWARD FOR SELECT [key],[value] FROM OPENJSON(@Profiles);
 OPEN geometry_profiles;FETCH NEXT FROM geometry_profiles INTO @Kind,@Entry;
 WHILE @@FETCH_STATUS=0 BEGIN
  SET @AutomaticContainerLayers=NULL;
  IF @LoadMode<>N''Floor load'' AND @ContainerPalletHeightScaled>0 BEGIN
   SET @ContainerClearanceScaled=CASE WHEN @Kind=N''20RC'' THEN 207000 ELSE 209000 END;
   -- Scaled integer remainder guarantees ROUNDDOWN, including exact boundaries.
   SET @AutomaticContainerLayers=CONVERT(INT,(@ContainerClearanceScaled-(@ContainerClearanceScaled%@ContainerPalletHeightScaled))/@ContainerPalletHeightScaled);
  END;
  SET @Entry=JSON_MODIFY(@Entry,''$.LayersPerContainer'',@AutomaticContainerLayers);
  SET @Profiles=JSON_MODIFY(@Profiles,N''$."''+@Kind+N''"'',JSON_QUERY(@Entry));
  FETCH NEXT FROM geometry_profiles INTO @Kind,@Entry;
 END;
 CLOSE geometry_profiles;DEALLOCATE geometry_profiles;
 '+@Anchor);
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
COMMIT;
GO
GO
-- END MIGRATION 84_packaging_container_layers.sql

-- BEGIN MIGRATION 85_packaging_container_shipping_height.sql
-- SOURCE SHA256 274e1206f31155c184d1f3b4fc871a34b9dd3c0685fa66bd9885861762618db1
PRINT N'Applying 85_packaging_container_shipping_height.sql';
GO
GO
-- After 84. Correct the container denominator without rewriting saved history.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation'));
IF @D IS NULL OR CHARINDEX(N'-- Calculated container layers.',@D)=0
 THROW 52971,'Apply migration 84 before shipping-height container layers.',1;
IF CHARINDEX(N'-- Shipping height container layers.',@D)=0 BEGIN
 DECLARE @Old NVARCHAR(MAX)=N'IF @Height IS NOT NULL AND @PalletLayers IS NOT NULL
  SET @ContainerPalletHeightScaled=15000+CONVERT(DECIMAL(28,0),@PalletLayers)*(@Height*100);';
 -- Normalize line endings before matching the audited procedure definition.
 SET @D=REPLACE(@D,CHAR(13),N'');
 IF CHARINDEX(@Old,@D)=0 THROW 52971,'Unexpected calculated container layers procedure signature.',1;
 SET @D=REPLACE(@D,@Old,N'IF @Height IS NOT NULL
  SET @ContainerPalletHeightScaled=@Height*100;');
 SET @D=REPLACE(@D,N'@ContainerPalletHeightScaled',N'@ContainerShippingHeightScaled');
 SET @D=REPLACE(@D,N'-- Calculated container layers.',N'-- Calculated container layers.
 -- Shipping height container layers.');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
COMMIT;
GO
GO
-- END MIGRATION 85_packaging_container_shipping_height.sql

IF @@TRANCOUNT<>0
 THROW 52991,'Unexpected open transaction after VM upgrade; investigate before restarting the API.',1;
DECLARE @VMDefinition NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation'));
IF @VMDefinition IS NULL OR CHARINDEX(N'-- Shipping height container layers.',@VMDefinition)=0
 THROW 52991,'The final shipping-height migration was not applied.',1;
PRINT N'PythonBridge migrations 45-85 completed successfully on '+QUOTENAME(DB_NAME());
GO
