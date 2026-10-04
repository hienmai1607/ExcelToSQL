USE [test];
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
