USE [test];
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

