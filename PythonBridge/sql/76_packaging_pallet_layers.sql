USE [test];
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
