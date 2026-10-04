USE [test];
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
