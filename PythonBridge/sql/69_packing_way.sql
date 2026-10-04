USE [test];
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
