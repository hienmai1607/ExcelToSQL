-- Process recipes belong to one grade node; legacy NULL preserves historical per-leaf costing.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 IF COL_LENGTH('dbo.ProductGradeItem','Process') IS NULL
  ALTER TABLE dbo.ProductGradeItem ADD Process BIT NULL;
 DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_ProductGrade_Save'));
 IF @D IS NULL THROW 51124,'Product Grade Save is required before migration 137.',1;
 IF CHARINDEX(N'GradeProcess137',@D)=0
 BEGIN
  IF CHARINDEX(N'RawMaterialID INT);',@D)=0 OR CHARINDEX(N'RawGradeID,RawMaterialID FROM @Tree',@D)=0
   THROW 51124,'Unexpected Product Grade save contract before migration 137.',1;
  SET @D=REPLACE(@D,N'(SELECT COUNT(*) FROM OPENJSON(j.value))<>6 OR',N'(SELECT COUNT(*) FROM OPENJSON(j.value)) NOT IN(6,7) OR
  EXISTS(SELECT 1 FROM OPENJSON(j.value) k WHERE k.[key] COLLATE Latin1_General_100_BIN2 NOT IN(''ParentID'',''ID'',''Grade'',''RatioPct'',''RawGradeID'',''RawMaterialID'',''Process'')) OR');
  SET @D=REPLACE(@D,N'DECLARE @Tree TABLE',N'-- GradeProcess137
 IF EXISTS(SELECT 1 FROM OPENJSON(@Items) j CROSS APPLY OPENJSON(j.value) k WHERE k.[key]=''Process'' AND k.type NOT IN(0,3))
  THROW 52960,''Process must be a checkbox value.'',1;
 DECLARE @Tree TABLE');
  SET @D=REPLACE(@D,N'RawMaterialID INT);',N'RawMaterialID INT,Process BIT);');
  SET @D=REPLACE(@D,N'RawGradeID,RawMaterialID',N'RawGradeID,RawMaterialID,Process');
  SET @D=REPLACE(@D,N'BEGIN TRY',N'IF EXISTS(SELECT 1 FROM @Tree child JOIN @Tree parent ON child.NodePath LIKE parent.NodePath+''/%'' WHERE child.Process=1 AND parent.Process=1)
  THROW 52960,''A child under a Process grade cannot also be Process.'',1;
 BEGIN TRY');
  SET @D=STUFF(@D,1,CHARINDEX(N'PROCEDURE',UPPER(@D))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
  EXEC sys.sp_executesql @D;
 END;
 -- Carry the flag into newly captured snapshots only; never rewrite existing documents/history.
 DECLARE @Object SYSNAME,@Kind CHAR(2);
 DECLARE snapshots CURSOR LOCAL FAST_FORWARD FOR
  SELECT o.name,o.type FROM sys.objects o JOIN sys.sql_modules m ON m.object_id=o.object_id
  WHERE o.name IN('usp_OpportunityItem_Fields_Save','usp_PackagingRequest_Create_AuditImplementation','v_ProductActiveGradeSnapshot','usp_ProductMix_Grades_Read');
 OPEN snapshots;FETCH NEXT FROM snapshots INTO @Object,@Kind;
 WHILE @@FETCH_STATUS=0
 BEGIN
  SET @D=OBJECT_DEFINITION(OBJECT_ID(N'dbo.'+@Object));
  IF @Object='usp_ProductMix_Grades_Read'
  BEGIN
   IF CHARINDEX(N'gi.Process',@D)=0 SET @D=REPLACE(@D,N'gi.Grade,gi.RatioPct',N'gi.Grade,gi.RatioPct,gi.Process');
  END
  ELSE IF CHARINDEX(N'g.Process',@D)=0
   SET @D=REPLACE(@D,N'g.RawMaterialID,g.Grade,g.RatioPct',N'g.RawMaterialID,g.Grade,g.RatioPct,g.Process');
  IF @Kind='V' SET @D=STUFF(@D,1,CHARINDEX(N'VIEW',UPPER(@D))+LEN(N'VIEW')-1,N'ALTER VIEW');
  ELSE SET @D=STUFF(@D,1,CHARINDEX(N'PROCEDURE',UPPER(@D))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
  EXEC sys.sp_executesql @D;
  FETCH NEXT FROM snapshots INTO @Object,@Kind;
 END;
 CLOSE snapshots;DEALLOCATE snapshots;
 COMMIT TRANSACTION;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
 THROW;
END CATCH;
