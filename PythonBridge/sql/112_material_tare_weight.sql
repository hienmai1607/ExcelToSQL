-- After 111. Tare is maintained on material, independently of vendor price.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.PackagingMaterial','TareWeight') IS NULL
 ALTER TABLE dbo.PackagingMaterial ADD TareWeight DECIMAL(18,9) NULL,TareWeightBasis VARCHAR(10) NULL;
EXEC(N'IF OBJECT_ID(''dbo.CK_PackagingMaterial_TareWeight'',''C'') IS NULL
 ALTER TABLE dbo.PackagingMaterial ADD CONSTRAINT CK_PackagingMaterial_TareWeight CHECK(
 (TareWeight IS NULL AND TareWeightBasis IS NULL) OR
 (TareWeight IS NOT NULL AND TareWeight>=0 AND TareWeightBasis IS NOT NULL AND TareWeightBasis IN(''kg/EA'',''kg/m2'')))');
COMMIT;
