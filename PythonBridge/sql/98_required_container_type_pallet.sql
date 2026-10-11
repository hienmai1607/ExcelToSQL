-- After 97. Run in the intended application database, stopping on errors.
-- Retain legacy families and existing PCR snapshots; new requests use exact types.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityItem_Fields_Save'));
IF @D IS NULL OR CHARINDEX(N'-- Shipment cost information.',@D)=0
 THROW 52957,'Apply migrations through 97 before the Container Type upgrade.',1;
IF CHARINDEX(N'-- Required parent Container Type and Pallet size.',@D)=0
BEGIN
 DECLARE @Old NVARCHAR(MAX)=N'(j.[key]=''ContainerRequest'' AND j.[value] COLLATE Latin1_General_100_BIN2 IN(N''Dry'',N''Reefer'',N''Both''))';
 IF CHARINDEX(@Old,@D)=0 OR CHARINDEX(N'DECLARE @OldUser SQL_VARIANT',@D)=0
  THROW 52957,'Unexpected Opportunity field validation signature.',1;
 SET @D=REPLACE(@D,@Old,N'(j.[key]=''ContainerRequest'' AND j.[value] COLLATE Latin1_General_100_BIN2 IN(N''Dry'',N''Reefer'',N''Both'',N''20DC'',N''20RC'',N''40DC'',N''40HC'',N''40RHC''))');
 SET @D=REPLACE(@D,N'EXEC dbo.usp_OpportunityShipment_Validate @ID,@Shipment;',N'EXEC dbo.usp_OpportunityShipment_Validate @ID,@Shipment,@RequestedType;'); SET @D=REPLACE(@D,N'PalletSize=CASE WHEN @Web=1 AND @Configuration=''Floor load'' THEN NULL WHEN',N'PalletSize=CASE WHEN');
 SET @D=REPLACE(@D,N'-- Shipment cost information.',N'-- Required parent Container Type and Pallet size.
 DECLARE @RequestedType NVARCHAR(200),@RequiredPallet NVARCHAR(100);
 SELECT @RequestedType=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''ContainerRequest'')
  THEN JSON_VALUE(@Fields,''$.ContainerRequest'') ELSE ContainerRequest END,
  @RequiredPallet=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''PalletSize'')
  THEN JSON_VALUE(@Fields,''$.PalletSize'') ELSE PalletSize END
 FROM dbo.OpportunityItem WHERE ID=@ID;
 IF (@IsCreate=1 OR @Web=1) AND EXISTS(SELECT 1 FROM dbo.OpportunityItem WHERE ID=@ID AND ParentItemID IS NULL)
 BEGIN
  IF NULLIF(LTRIM(RTRIM(@RequiredPallet)),N'''') IS NULL
   THROW 52957,''Pallet size is required.'',1;
  IF NOT EXISTS(SELECT 1 FROM dbo.v_PalletMaster p JOIN dbo.UoM u ON u.ID=p.UoMID
    WHERE p.PalletSize=@RequiredPallet AND p.Status=''Active'' AND u.Status=''Active'')
   AND NOT EXISTS(SELECT 1 FROM dbo.OpportunityItem WHERE ID=@ID AND PalletSize=@RequiredPallet)
   THROW 52957,''Choose an active pallet size from Pallet Master.'',1;
  IF @RequestedType IS NULL OR @RequestedType COLLATE Latin1_General_100_BIN2 NOT IN(N''20DC'',N''20RC'',N''40DC'',N''40HC'',N''40RHC'')
   THROW 52957,''Choose a required Container Type: 20DC, 20RC, 40DC, 40HC or 40RHC.'',1;
  -- Keep the legacy size snapshot consistent, without exposing a second input.
  DECLARE @TypeShipment NVARCHAR(MAX)=COALESCE(JSON_QUERY(@Fields,''$.ShipmentCostInfo''),
   (SELECT ShipmentCostInfo FROM dbo.OpportunityItem WHERE ID=@ID),N''{}'');
  SET @TypeShipment=JSON_MODIFY(@TypeShipment,''$.ContainerSizeFT'',LEFT(@RequestedType,2)+''FT'');
  SET @Fields=JSON_MODIFY(@Fields,''$.ShipmentCostInfo'',JSON_QUERY(@TypeShipment));
 END;
 -- Shipment cost information.');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation'));
IF @D IS NULL OR CHARINDEX(N'-- Container type profiles:',@D)=0
 THROW 52961,'Container response validation is missing.',1;
IF CHARINDEX(N'-- Exact requested container type.',@D)=0
BEGIN
 DECLARE @Anchor NVARCHAR(MAX)=N' IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''ContainerLoadProfiles'' AND [type] NOT IN(0,5))';
 IF CHARINDEX(@Anchor,@D)=0 THROW 52961,'Unexpected response container profile signature.',1;
 SET @D=REPLACE(@D,@Anchor,N' -- Exact requested container type.
 IF @ContainerFamily COLLATE Latin1_General_100_BIN2 IN(N''20DC'',N''20RC'',N''40DC'',N''40HC'',N''40RHC'')
 BEGIN
  IF @ContainerType IS NOT NULL AND @ContainerType COLLATE Latin1_General_100_BIN2<>@ContainerFamily COLLATE Latin1_General_100_BIN2
   THROW 52961,''Container type must match the exact requested Container Type.'',1;
  IF EXISTS(SELECT 1 FROM OPENJSON(JSON_QUERY(@Fields,''$.ContainerLoadProfiles''))
    WHERE [key] COLLATE Latin1_General_100_BIN2<>@ContainerFamily COLLATE Latin1_General_100_BIN2)
   THROW 52961,''Container profiles must match the exact requested Container Type.'',1;
 END;
'+@Anchor);
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityShipment_Validate'));
IF @D IS NULL THROW 52996,'Shipment validation is missing.',1;
IF CHARINDEX(N'-- Exact type size guard.',@D)=0
BEGIN
 SET @D=REPLACE(@D,N'@ID INT,@Value NVARCHAR(MAX)',N'@ID INT,@Value NVARCHAR(MAX),@RequestedContainerType NVARCHAR(200)=NULL'); SET @D=REPLACE(@D,N' DECLARE @Port INT=',N' -- Exact type size guard.
 DECLARE @ExactType NVARCHAR(200)=COALESCE(@RequestedContainerType,(SELECT ContainerRequest FROM dbo.OpportunityItem WHERE ID=@ID));
 IF @ExactType IN(N''20DC'',N''20RC'',N''40DC'',N''40HC'',N''40RHC'')
  AND JSON_VALUE(@Value,''$.ContainerSizeFT'') IS NOT NULL
  AND JSON_VALUE(@Value,''$.ContainerSizeFT'')<>LEFT(@ExactType,2)+''FT''
  THROW 52996,''Container size must match the requested Container Type.'',1;
 DECLARE @Port INT=');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
COMMIT;
GO
