-- Final grades, including root grades, are eligible for direct Raw Material links.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 IF COL_LENGTH('dbo.RawGrade','FinalGrade') IS NULL
 BEGIN
  IF EXISTS(SELECT 1 FROM dbo.RawMaterial m JOIN dbo.RawGrade child ON child.ParentGradeID=m.GradeID)
   THROW 51123,'A material is assigned to a parent grade. Resolve before migrating final grades.',1;
  ALTER TABLE dbo.RawGrade ADD FinalGrade BIT NOT NULL CONSTRAINT DF_RawGrade_FinalGrade DEFAULT(0);
  EXEC(N'UPDATE g SET FinalGrade=1 FROM dbo.RawGrade g WHERE NOT EXISTS(SELECT 1 FROM dbo.RawGrade child WHERE child.ParentGradeID=g.ID);');
 END;
 IF TYPE_ID('dbo.RawGradeBatchTypeV5') IS NULL
  EXEC(N'CREATE TYPE dbo.RawGradeBatchTypeV5 AS TABLE(RowNum INT NOT NULL PRIMARY KEY,Command CHAR(1),ID INT,GradeName NVARCHAR(100),Status VARCHAR(10),RowVersionB64 VARBINARY(8),ParentGradeID INT,ParentGradeSet BIT,FinalGrade BIT)');

 DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_RawGrade_BatchV4'));
 IF @D IS NULL THROW 51123,'Raw Grade V4 is required before migration 134.',1;
 IF CHARINDEX(N'A final grade cannot have child grades.',@D)=0
 BEGIN
  IF CHARINDEX(N'IF EXISTS(SELECT 1 FROM dbo.RawMaterial WHERE GradeID=@Parent)',@D)=0
   THROW 51123,'Unexpected Raw Grade parent validation contract.',1;
  SET @D=REPLACE(@D,N'IF EXISTS(SELECT 1 FROM dbo.RawMaterial WHERE GradeID=@Parent)',N'IF EXISTS(SELECT 1 FROM dbo.RawGrade WHERE ID=@Parent AND FinalGrade=1)
      THROW 51111,''A final grade cannot have child grades.'',1;
     IF EXISTS(SELECT 1 FROM dbo.RawMaterial WHERE GradeID=@Parent)');
  SET @D=STUFF(@D,1,CHARINDEX(N'PROCEDURE',UPPER(@D))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
  EXEC sys.sp_executesql @D;
 END;
 IF OBJECT_ID('dbo.usp_RawGrade_BatchV5') IS NULL
 BEGIN
  IF CHARINDEX(N'@ParentSet BIT,',@D)=0 OR CHARINDEX(N'ParentGradeID,ParentGradeSet FROM @Rows',@D)=0
   THROW 51123,'Unexpected Raw Grade V4 data contract.',1;
  SET @D=REPLACE(REPLACE(@D,N'usp_RawGrade_BatchV4',N'usp_RawGrade_BatchV5'),N'RawGradeBatchTypeV4',N'RawGradeBatchTypeV5');
  SET @D=REPLACE(@D,N'@ParentSet BIT,',N'@ParentSet BIT,@Final BIT,');
  SET @D=REPLACE(@D,N'ParentGradeID,ParentGradeSet FROM @Rows',N'ParentGradeID,ParentGradeSet,FinalGrade FROM @Rows');
  SET @D=REPLACE(@D,N'@RV,@Parent,@ParentSet;',N'@RV,@Parent,@ParentSet,@Final;');
  SET @D=REPLACE(@D,N'IF @Name IS NULL THROW 51111,''Grade name is required.'',1;',N'IF @Cmd=''U'' AND @Final IS NULL SELECT @Final=FinalGrade FROM dbo.RawGrade WHERE ID=@ID;
    SET @Final=COALESCE(@Final,0);
    IF @Final=1 AND EXISTS(SELECT 1 FROM dbo.RawGrade WHERE ParentGradeID=@ID)
     THROW 51111,''A grade with children cannot be a final grade.'',1;
    IF @Final=0 AND EXISTS(SELECT 1 FROM dbo.RawMaterial WHERE GradeID=@ID)
     THROW 51111,''A grade assigned to Raw Material must remain a final grade. Reassign materials first.'',1;
    IF @Name IS NULL THROW 51111,''Grade name is required.'',1;');
  SET @D=REPLACE(@D,N'CreatedBy,ParentGradeID)',N'CreatedBy,ParentGradeID,FinalGrade)');
  SET @D=REPLACE(@D,N'@Actor,@Parent);',N'@Actor,@Parent,@Final);');
  SET @D=REPLACE(@D,N'SET ParentGradeID=@Parent,GradeName=@Name,',N'SET FinalGrade=@Final,ParentGradeID=@Parent,GradeName=@Name,');
  SET @D=STUFF(@D,1,CHARINDEX(N'PROCEDURE',UPPER(@D))+LEN(N'PROCEDURE')-1,N'CREATE PROCEDURE');
  EXEC sys.sp_executesql @D;
 END;

 DECLARE @Proc SYSNAME;
 DECLARE materials CURSOR LOCAL FAST_FORWARD FOR
  SELECT name FROM sys.procedures WHERE name IN('usp_RawMaterial_BatchV2','usp_RawMaterial_BatchV3');
 OPEN materials;FETCH NEXT FROM materials INTO @Proc;
 WHILE @@FETCH_STATUS=0
 BEGIN
  SET @D=OBJECT_DEFINITION(OBJECT_ID(N'dbo.'+@Proc));
  IF CHARINDEX(N'AND g.FinalGrade=1',@D)=0
  BEGIN
   IF CHARINDEX(N'AND NOT EXISTS(SELECT 1 FROM dbo.RawGrade child WHERE child.ParentGradeID=g.ID)',@D)=0
    THROW 51123,'Unexpected Raw Material grade validation contract.',1;
   SET @D=REPLACE(@D,N'AND NOT EXISTS(SELECT 1 FROM dbo.RawGrade child WHERE child.ParentGradeID=g.ID)',N'AND g.FinalGrade=1');
   SET @D=REPLACE(@D,N'Choose an active leaf grade (a grade with no children).',N'Choose an active final grade.');
   SET @D=STUFF(@D,1,CHARINDEX(N'PROCEDURE',UPPER(@D))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
   EXEC sys.sp_executesql @D;
  END;
  FETCH NEXT FROM materials INTO @Proc;
 END;
 CLOSE materials;DEALLOCATE materials;

 SET @D=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_ProductGrade_Save'));
 IF @D IS NULL THROW 51123,'Product Grade Save is required before migration 134.',1;
 IF CHARINDEX(N'Raw Material may be selected only for a final grade.',@D)=0
 BEGIN
  IF CHARINDEX(N'IF EXISTS(SELECT 1 FROM @Tree WHERE ParentID=''0'' AND RawMaterialID IS NOT NULL)
   THROW 52960,''Raw Material may be selected only for child grades.'',1;',@D)=0 THROW 51123,'Unexpected Product Grade material validation contract.',1;
  SET @D=REPLACE(@D,N'IF EXISTS(SELECT 1 FROM @Tree WHERE ParentID=''0'' AND RawMaterialID IS NOT NULL)
   THROW 52960,''Raw Material may be selected only for child grades.'',1;',N'IF EXISTS(SELECT 1 FROM @Tree t JOIN dbo.RawGrade g ON g.ID=t.RawGradeID
    WHERE t.RawMaterialID IS NOT NULL AND g.FinalGrade=0)
   THROW 52960,''Raw Material may be selected only for a final grade.'',1;
  IF EXISTS(SELECT 1 FROM @Tree child JOIN @Tree parent ON parent.NodePath=child.ParentID
    JOIN dbo.RawGrade g ON g.ID=parent.RawGradeID WHERE g.FinalGrade=1)
   THROW 52960,''A final grade cannot have child grades.'',1;');
  SET @D=REPLACE(@D,N'Choose an active Raw Material assigned to the selected child grade.',N'Choose an active Raw Material assigned to the selected final grade.');
  SET @D=STUFF(@D,1,CHARINDEX(N'PROCEDURE',UPPER(@D))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
  EXEC sys.sp_executesql @D;
 END;
 COMMIT TRANSACTION;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
 THROW;
END CATCH;
