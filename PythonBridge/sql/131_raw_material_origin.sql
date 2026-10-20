-- Optional Origin is separate from retired free-form Description. No data backfill.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF COL_LENGTH('dbo.RawMaterial','Origin') IS NULL
 ALTER TABLE dbo.RawMaterial ADD Origin NVARCHAR(200) NULL;
GO
IF TYPE_ID('dbo.RawMaterialBatchTypeV3') IS NULL
 EXEC(N'CREATE TYPE dbo.RawMaterialBatchTypeV3 AS TABLE(
 RowNum INT NOT NULL PRIMARY KEY,Command CHAR(1),ID INT,MaterialCode NVARCHAR(40),
 MaterialName NVARCHAR(200),Description NVARCHAR(500),UnitOfMeasure NVARCHAR(20),
 Status VARCHAR(10),RowVersionB64 VARBINARY(8),GradeID INT,GradeSet BIT,
 Origin NVARCHAR(200),OriginSet BIT,DescriptionSet BIT)');
GO
-- Retain the existing validated per-row savepoint, permissions, numbering,
-- UoM, leaf-grade, block and concurrency behavior; keep V2 for old API clients.
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_RawMaterial_BatchV2'));
IF @D IS NULL OR CHARINDEX(N'GradeID,GradeSet FROM @Rows',@D)=0
 OR CHARINDEX(N'MaterialName=@Name,Description=@Description,UnitOfMeasure=@Unit',@D)=0
 THROW 51123,'Unexpected Raw Material V2 contract. Review before applying Origin migration.',1;
SET @D=REPLACE(@D,N'usp_RawMaterial_BatchV2',N'usp_RawMaterial_BatchV3');
SET @D=REPLACE(@D,N'RawMaterialBatchTypeV2',N'RawMaterialBatchTypeV3');
SET @D=REPLACE(@D,N'@Description NVARCHAR(500),',N'@Description NVARCHAR(500),@Origin NVARCHAR(200),@OriginSet BIT,@DescriptionSet BIT,');
SET @D=REPLACE(@D,N'GradeID,GradeSet FROM @Rows',N'GradeID,GradeSet,NULLIF(LTRIM(RTRIM(Origin)),N''''),OriginSet,DescriptionSet FROM @Rows');
SET @D=REPLACE(@D,N'@RV,@Grade,@GradeSet;',N'@RV,@Grade,@GradeSet,@Origin,@OriginSet,@DescriptionSet;');
SET @D=REPLACE(@D,N'MaterialName,Description,UnitOfMeasure,Status,GradeID,CreatedBy)',N'MaterialName,Description,Origin,UnitOfMeasure,Status,GradeID,CreatedBy)');
SET @D=REPLACE(@D,N'VALUES(@Code,@Name,@Description,@Unit,',N'VALUES(@Code,@Name,@Description,@Origin,@Unit,');
SET @D=REPLACE(@D,N'MaterialName=@Name,Description=@Description,UnitOfMeasure=@Unit',
 N'MaterialName=@Name,Description=CASE WHEN @DescriptionSet=1 THEN @Description ELSE Description END,Origin=CASE WHEN @OriginSet=1 THEN @Origin ELSE Origin END,UnitOfMeasure=@Unit');
SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'CREATE OR ALTER PROCEDURE'),
 N'CREATE   PROCEDURE',N'CREATE OR ALTER PROCEDURE'),N'CREATE PROCEDURE',N'CREATE OR ALTER PROCEDURE');
EXEC sys.sp_executesql @D;
GO
