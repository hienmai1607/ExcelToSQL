USE [test];
GO
-- After 41. Optional hierarchy; existing grades remain root grades.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF COL_LENGTH('dbo.RawGrade','ParentGradeID') IS NULL
 ALTER TABLE dbo.RawGrade ADD ParentGradeID INT NULL REFERENCES dbo.RawGrade(ID);
GO
IF TYPE_ID('dbo.RawGradeBatchTypeV2') IS NULL
 EXEC(N'CREATE TYPE dbo.RawGradeBatchTypeV2 AS TABLE(
 RowNum INT NOT NULL PRIMARY KEY,Command CHAR(1),ID INT,MaterialID INT,
 GradeName NVARCHAR(100),Status VARCHAR(10),RowVersionB64 VARBINARY(8),
 ParentGradeID INT,ParentGradeSet BIT)');
GO
CREATE OR ALTER PROCEDURE dbo.usp_RawGrade_BatchV2
 @Rows dbo.RawGradeBatchTypeV2 READONLY,@Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT OFF;
 DECLARE @Actor INT;EXEC dbo.usp_RawMaterial_Authorize @Username,@Actor OUTPUT;
 IF (SELECT COUNT(*) FROM @Rows)>500 THROW 51105,'Maximum 500 rows per batch.',1;
 IF EXISTS(SELECT ID FROM @Rows WHERE ID IS NOT NULL GROUP BY ID HAVING COUNT(*)>1) THROW 51106,'Duplicate IDs.',1;
 DECLARE @Result TABLE(RowNum INT,Status VARCHAR(10),Message NVARCHAR(2048),NewID INT,NewRowVersion VARBINARY(8));
 DECLARE @Row INT,@Cmd CHAR(1),@ID INT,@Material INT,@Name NVARCHAR(100),@Status VARCHAR(10),@RV VARBINARY(8),@Own BIT,@Parent INT,@ParentSet BIT,@Ancestor INT,@Lock INT;
 DECLARE c CURSOR LOCAL FAST_FORWARD FOR
 SELECT RowNum,Command,ID,MaterialID,NULLIF(LTRIM(RTRIM(GradeName)),''),Status,RowVersionB64,ParentGradeID,ParentGradeSet FROM @Rows ORDER BY RowNum;
 OPEN c;FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@Material,@Name,@Status,@RV,@Parent,@ParentSet;
 WHILE @@FETCH_STATUS=0
 BEGIN
  SET @Own=0;
  BEGIN TRY
   IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION;SET @Own=1;END ELSE SAVE TRANSACTION RawGradeRow;
   EXEC @Lock=sys.sp_getapplock @Resource=N'RawGradeHierarchy',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
   IF @Lock<0 THROW 51108,'Grade hierarchy is busy. Try again.',1;
   IF @Cmd NOT IN('C','U','D') THROW 51107,'Use C, U or D.',1;
   IF @Cmd IN('U','D') AND NOT EXISTS(SELECT 1 FROM dbo.RawGrade WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@RV)
    THROW 51108,'Concurrency conflict. Refresh first.',1;
   IF @Cmd<>'D'
   BEGIN
    IF @Cmd='U' AND COALESCE(@ParentSet,0)=0 SELECT @Parent=ParentGradeID FROM dbo.RawGrade WHERE ID=@ID;
    IF @Parent IS NOT NULL
    BEGIN
     IF NOT EXISTS(SELECT 1 FROM dbo.RawGrade g WITH(UPDLOCK,HOLDLOCK)
      JOIN dbo.RawMaterial m ON m.ID=g.MaterialID WHERE g.ID=@Parent AND
      ((g.Status='Active' AND m.Status='Active') OR (@Cmd='U' AND EXISTS(
       SELECT 1 FROM dbo.RawGrade WHERE ID=@ID AND ParentGradeID=@Parent))))
      THROW 51111,'Choose an active Parent Grade linked to an active Raw Material.',1;
     SET @Ancestor=@Parent;
     DECLARE @Visited TABLE(ID INT PRIMARY KEY);
     DELETE @Visited;
     WHILE @Ancestor IS NOT NULL
     BEGIN
      IF @Ancestor=@ID OR EXISTS(SELECT 1 FROM @Visited WHERE ID=@Ancestor)
       THROW 51111,'Parent Grade cannot be this grade or one of its descendants.',1;
      INSERT @Visited VALUES(@Ancestor);
      SELECT @Ancestor=ParentGradeID FROM dbo.RawGrade WHERE ID=@Ancestor;
     END;
    END;
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
    INSERT dbo.RawGrade(MaterialID,GradeName,Status,CreatedBy,ParentGradeID)
    OUTPUT @Row,'OK','Created',inserted.ID,inserted.RowVersion INTO @Result
    VALUES(@Material,@Name,COALESCE(@Status,'Active'),@Actor,@Parent);
   ELSE IF @Cmd='D'
    UPDATE dbo.RawGrade SET Status='Block',UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()
    OUTPUT @Row,'OK','Blocked',inserted.ID,inserted.RowVersion INTO @Result WHERE ID=@ID AND RowVersion=@RV;
   ELSE
    UPDATE dbo.RawGrade SET ParentGradeID=@Parent,MaterialID=@Material,GradeName=@Name,Status=COALESCE(@Status,Status),UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()
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
  FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@Material,@Name,@Status,@RV,@Parent,@ParentSet;
 END;
 CLOSE c;DEALLOCATE c;SELECT * FROM @Result ORDER BY RowNum;
END;
GO
