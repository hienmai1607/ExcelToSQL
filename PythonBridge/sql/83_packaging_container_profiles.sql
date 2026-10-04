USE [test];
GO
-- After 82. Preserve all request/pricing history; legacy scalar counts remain unassigned.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','SelectedContainerType') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD SelectedContainerType NVARCHAR(5) NULL
 CONSTRAINT CK_PCRItem_ContainerType CHECK(SelectedContainerType IN(N'20DC',N'40DC',N'40HC',N'20RC',N'40RHC'));
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','ContainerLoadProfiles') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD ContainerLoadProfiles NVARCHAR(MAX) NULL
 CONSTRAINT CK_PCRItem_ContainerProfiles CHECK(ISJSON(ContainerLoadProfiles)=1 AND LEFT(LTRIM(ContainerLoadProfiles),1)=N'{');
-- Zero is a legitimate captured Pallet Master capacity; legacy user-entered counts remain positive.
IF EXISTS(SELECT 1 FROM sys.check_constraints WHERE name='CK_PCRItem_PalletsPerContainer')
 ALTER TABLE dbo.PackagingConfigurationRequestItem DROP CONSTRAINT CK_PCRItem_PalletsPerContainer;
ALTER TABLE dbo.PackagingConfigurationRequestItem WITH CHECK ADD CONSTRAINT CK_PCRItem_PalletsPerContainer CHECK(PalletsPerContainer>=0);
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation'));
IF @D IS NULL OR CHARINDEX(N'-- Calculated pallet layers.',@D)=0
 THROW 52970,'Apply migrations through 82 before container profiles.',1;
IF CHARINDEX(N'-- Container type profiles:',@D)=0 BEGIN
 IF CHARINDEX(N'HeightMM DECIMAL(12,2)) j',@D)=0
  OR CHARINDEX(N'-- Container loading count validation.',@D)=0
  THROW 52970,'Unexpected response fields signature.',1;
 SET @D=REPLACE(@D,N'WHERE [key] NOT IN(''FirstPMType'',''SecondPMType''',N'WHERE [key] NOT IN(''SelectedContainerType'',''ContainerLoadProfiles'',''FirstPMType'',''SecondPMType''');
 SET @D=REPLACE(@D,N'-- Container loading count validation.',N' -- Container type profiles: validate, merge and project the active type.
 DECLARE @ContainerType NVARCHAR(5),@OldContainerType NVARCHAR(5),@ContainerFamily NVARCHAR(200),
  @Profiles NVARCHAR(MAX),@OldProfiles NVARCHAR(MAX),@IncomingProfiles NVARCHAR(MAX),
  @LoadMode NVARCHAR(500),@ProfilePallet NVARCHAR(100),@PreviousPallet NVARCHAR(100);
 SELECT @OldContainerType=i.SelectedContainerType,@OldProfiles=COALESCE(i.ContainerLoadProfiles,N''{}''),
  @ContainerType=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''SelectedContainerType'')
   THEN JSON_VALUE(@Fields,''$.SelectedContainerType'') ELSE i.SelectedContainerType END,
  @ContainerFamily=COALESCE(NULLIF(i.ContainerRequest,N''''),parent.ContainerRequest),
  @LoadMode=COALESCE(i.ConfigurationRequest,N''''),
  @PreviousPallet=i.ResponsePalletSize,
  @ProfilePallet=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''ResponsePalletSize'')
   THEN NULLIF(JSON_VALUE(@Fields,''$.ResponsePalletSize''),N'''') ELSE i.ResponsePalletSize END
 FROM dbo.PackagingConfigurationRequestItem i
 LEFT JOIN dbo.OpportunityItem oi ON oi.ID=i.OpportunityItemID
 LEFT JOIN dbo.PackagingConfigurationRequestItem parent ON parent.RequestID=i.RequestID AND parent.OpportunityItemID=oi.ParentItemID
 WHERE i.ID=@ID;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''SelectedContainerType'' AND [type]<>0
  AND ([type]<>1 OR [value] COLLATE Latin1_General_100_BIN2 NOT IN(N''20DC'',N''40DC'',N''40HC'',N''20RC'',N''40RHC'')))
  THROW 52961,''Choose a valid container type.'',1;
 IF (@ContainerFamily=N''Dry'' AND @ContainerType NOT IN(N''20DC'',N''40DC'',N''40HC''))
  OR (@ContainerFamily=N''Reefer'' AND @ContainerType NOT IN(N''20RC'',N''40RHC''))
  THROW 52961,''Container type must match the requested Dry or Reefer family.'',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''ContainerLoadProfiles'' AND [type] NOT IN(0,5))
  THROW 52961,''Container loading profiles must be an object.'',1;
 SET @IncomingProfiles=JSON_QUERY(@Fields,''$.ContainerLoadProfiles'');
 IF EXISTS(SELECT [key] FROM OPENJSON(@IncomingProfiles) GROUP BY [key] HAVING COUNT(*)>1)
  OR EXISTS(SELECT 1 FROM OPENJSON(@IncomingProfiles) WHERE [type]<>5
   OR [key] COLLATE Latin1_General_100_BIN2 NOT IN(N''20DC'',N''40DC'',N''40HC'',N''20RC'',N''40RHC''))
  THROW 52961,''Each container profile must be a unique valid container type.'',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@IncomingProfiles) p
  WHERE (@ContainerFamily=N''Dry'' AND p.[key] NOT IN(N''20DC'',N''40DC'',N''40HC''))
   OR (@ContainerFamily=N''Reefer'' AND p.[key] NOT IN(N''20RC'',N''40RHC'')))
  THROW 52961,''Container profiles must match the requested container family.'',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@IncomingProfiles) p CROSS APPLY OPENJSON(p.value) f
  WHERE f.[key] COLLATE Latin1_General_100_BIN2 NOT IN(N''LayersPerContainer'',N''PalletsPerContainer'',N''CartonsPerContainerFloor'')
   OR f.[type]<>0 AND (f.[type] NOT IN(1,2) OR f.[value] LIKE ''%[^0-9]%'' OR TRY_CONVERT(INT,f.[value]) IS NULL
    OR TRY_CONVERT(INT,f.[value])<CASE WHEN f.[key]=''PalletsPerContainer'' THEN 0 ELSE 1 END))
  OR EXISTS(SELECT 1 FROM OPENJSON(@IncomingProfiles) p CROSS APPLY OPENJSON(p.value) f GROUP BY p.[key],f.[key] HAVING COUNT(*)>1)
  THROW 52961,''Container profile counts must be whole numbers within the allowed range.'',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@IncomingProfiles) p CROSS APPLY OPENJSON(p.value) f
  WHERE f.[type]<>0 AND ((@LoadMode=N''Floor load'' AND f.[key]=''LayersPerContainer'')
   OR (@LoadMode NOT IN(N''Floor load'',N''Both'') AND f.[key]=''CartonsPerContainerFloor'')))
  THROW 52961,''Use only the loading counts matching the request configuration snapshot.'',1;
 SET @Profiles=@OldProfiles;
 DECLARE @Kind NVARCHAR(5),@Entry NVARCHAR(MAX),@OldEntry NVARCHAR(MAX),@Capacity INT,@Path NVARCHAR(100),@Merged NVARCHAR(MAX),@CountKey NVARCHAR(100),@CountValue NVARCHAR(MAX);
 DECLARE incoming_profiles CURSOR LOCAL FAST_FORWARD FOR SELECT [key],[value] FROM OPENJSON(@IncomingProfiles);
 OPEN incoming_profiles;FETCH NEXT FROM incoming_profiles INTO @Kind,@Entry;
 WHILE @@FETCH_STATUS=0 BEGIN
  SET @Merged=COALESCE(JSON_QUERY(@Profiles,N''$."''+@Kind+N''"''),N''{}'');
  DECLARE profile_counts CURSOR LOCAL FAST_FORWARD FOR SELECT [key],[value] FROM OPENJSON(@Entry);
  OPEN profile_counts;FETCH NEXT FROM profile_counts INTO @CountKey,@CountValue;
  WHILE @@FETCH_STATUS=0 BEGIN
   SET @Merged=JSON_MODIFY(@Merged,N''$.''+@CountKey,TRY_CONVERT(INT,@CountValue));
   FETCH NEXT FROM profile_counts INTO @CountKey,@CountValue;
  END;
  CLOSE profile_counts;DEALLOCATE profile_counts;
  SET @Profiles=JSON_MODIFY(@Profiles,N''$."''+@Kind+N''"'',JSON_QUERY(@Merged));
  FETCH NEXT FROM incoming_profiles INTO @Kind,@Entry;
 END;
 CLOSE incoming_profiles;DEALLOCATE incoming_profiles;
 IF @ContainerType IS NOT NULL BEGIN
  SET @Path=N''$."''+@ContainerType+N''"'';
  SET @Entry=JSON_QUERY(@Profiles,@Path);
  IF @Entry IS NULL BEGIN
   SELECT @Entry=(SELECT
    CASE WHEN @OldContainerType IS NULL AND @LoadMode<>N''Floor load'' THEN i.LayersPerContainer END LayersPerContainer,
    CASE WHEN @OldContainerType IS NULL AND @LoadMode IN(N''Floor load'',N''Both'') THEN i.CartonsPerContainerFloor END CartonsPerContainerFloor
    FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES)
   FROM dbo.PackagingConfigurationRequestItem i WHERE i.ID=@ID;
  END;
  IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''LayersPerContainer'')
   SET @Entry=JSON_MODIFY(@Entry,''$.LayersPerContainer'',TRY_CONVERT(INT,JSON_VALUE(@Fields,''$.LayersPerContainer'')));
  IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''CartonsPerContainerFloor'')
   SET @Entry=JSON_MODIFY(@Entry,''$.CartonsPerContainerFloor'',TRY_CONVERT(INT,JSON_VALUE(@Fields,''$.CartonsPerContainerFloor'')));
  SET @Profiles=JSON_MODIFY(@Profiles,@Path,JSON_QUERY(@Entry));
 END;
 -- Master capacity is a snapshot. Do not silently refresh existing profiles on unrelated edits.
 DECLARE capacity_profiles CURSOR LOCAL FAST_FORWARD FOR SELECT [key],[value] FROM OPENJSON(@Profiles);
 OPEN capacity_profiles;FETCH NEXT FROM capacity_profiles INTO @Kind,@Entry;
 WHILE @@FETCH_STATUS=0 BEGIN
  SET @Path=N''$."''+@Kind+N''"'';
  SET @OldEntry=JSON_QUERY(@OldProfiles,@Path);
  SET @Capacity=NULL;
  IF @OldEntry IS NULL OR COALESCE(@ProfilePallet,N'''')<>COALESCE(@PreviousPallet,N'''') BEGIN
   SELECT @Capacity=CASE @Kind WHEN N''20DC'' THEN p.PalletsPer20DC WHEN N''40DC'' THEN p.PalletsPer40DC
    WHEN N''40HC'' THEN p.PalletsPer40HC WHEN N''20RC'' THEN p.PalletsPer20RC ELSE p.PalletsPer40RHC END
   FROM dbo.Pallet p JOIN dbo.v_PalletMaster v ON v.ID=p.ID WHERE v.PalletSize=@ProfilePallet;
  END ELSE SET @Capacity=TRY_CONVERT(INT,JSON_VALUE(@OldEntry,''$.PalletsPerContainer''));
  SET @Entry=JSON_MODIFY(@Entry,''$.PalletsPerContainer'',@Capacity);
  SET @Profiles=JSON_MODIFY(@Profiles,@Path,JSON_QUERY(@Entry));
  FETCH NEXT FROM capacity_profiles INTO @Kind,@Entry;
 END;
 CLOSE capacity_profiles;DEALLOCATE capacity_profiles;
 SET @Fields=JSON_MODIFY(@Fields,''$.ContainerLoadProfiles'',JSON_QUERY(@Profiles));

 -- Container loading count validation.');
 SET @D=REPLACE(@D,N'OR TRY_CONVERT(INT,[value])<1))'+CHAR(13)+CHAR(10)+N'  THROW 52961,''Container counts',
  N'OR TRY_CONVERT(INT,[value])<CASE WHEN [key]=''PalletsPerContainer'' AND @ContainerType IS NOT NULL THEN 0 ELSE 1 END))'+CHAR(13)+CHAR(10)+N'  THROW 52961,''Container counts');
 -- Migration source files may use LF instead of CRLF.
 SET @D=REPLACE(@D,N'OR TRY_CONVERT(INT,[value])<1))'+CHAR(10)+N'  THROW 52961,''Container counts',
  N'OR TRY_CONVERT(INT,[value])<CASE WHEN [key]=''PalletsPerContainer'' AND @ContainerType IS NOT NULL THEN 0 ELSE 1 END))'+CHAR(10)+N'  THROW 52961,''Container counts');
 SET @D=REPLACE(@D,N'UPDATE t SET',N'UPDATE t SET
 SelectedContainerType=@ContainerType,ContainerLoadProfiles=@Profiles,');
 SET @D=REPLACE(@D,N'LayersPerContainer=CASE WHEN EXISTS',N'LayersPerContainer=CASE WHEN @ContainerType IS NOT NULL OR @OldContainerType IS NOT NULL THEN CASE WHEN @LoadMode<>N''Floor load'' THEN TRY_CONVERT(INT,JSON_VALUE(@Entry,''$.LayersPerContainer'')) END WHEN EXISTS');
 SET @D=REPLACE(@D,N'PalletsPerContainer=CASE WHEN EXISTS',N'PalletsPerContainer=CASE WHEN @ContainerType IS NOT NULL OR @OldContainerType IS NOT NULL THEN CASE WHEN @LoadMode<>N''Floor load'' THEN TRY_CONVERT(INT,JSON_VALUE(@Entry,''$.PalletsPerContainer'')) END WHEN EXISTS');
 SET @D=REPLACE(@D,N'CartonsPerContainerFloor=CASE WHEN EXISTS',N'CartonsPerContainerFloor=CASE WHEN @ContainerType IS NOT NULL OR @OldContainerType IS NOT NULL THEN CASE WHEN @LoadMode IN(N''Floor load'',N''Both'') THEN TRY_CONVERT(INT,JSON_VALUE(@Entry,''$.CartonsPerContainerFloor'')) END WHEN EXISTS');
 -- @Entry must be the selected profile after capacity mapping, not the final cursor entry.
 SET @D=REPLACE(@D,N'DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT',N'SET @Entry=CASE WHEN @ContainerType IS NOT NULL THEN JSON_QUERY(@Profiles,N''$."''+@ContainerType+N''"'') END;
 DECLARE @OldUser SQL_VARIANT=SESSION_CONTEXT');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
-- Both families are an explicit choice in all shared requirement editors.
SET @D=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityItem_Fields_Save'));
IF @D IS NULL THROW 52970,'Opportunity fields procedure is missing.',1;
IF CHARINDEX(N'IN(N''Dry'',N''Reefer'')',@D)>0 BEGIN
 SET @D=REPLACE(@D,N'IN(N''Dry'',N''Reefer'')',N'IN(N''Dry'',N''Reefer'',N''Both'')');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
SET @D=OBJECT_DEFINITION(OBJECT_ID('dbo.tr_PackagingConfigurationRequestItem_ChangeLog'));
IF @D IS NULL OR CHARINDEX(N'CROSS APPLY(VALUES',@D)=0 THROW 52970,'Request audit trigger is missing.',1;
IF CHARINDEX(N'''ContainerLoadProfiles'',',@D)=0 BEGIN
 SET @D=REPLACE(@D,N'CROSS APPLY(VALUES',N'CROSS APPLY(VALUES
 (''SelectedContainerType'',CONVERT(NVARCHAR(MAX),d.SelectedContainerType),CONVERT(NVARCHAR(MAX),i.SelectedContainerType),1),
 (''ContainerLoadProfiles'',CONVERT(NVARCHAR(MAX),d.ContainerLoadProfiles),CONVERT(NVARCHAR(MAX),i.ContainerLoadProfiles),1),');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER TRIGGER',N'ALTER TRIGGER'),N'CREATE   TRIGGER',N'ALTER TRIGGER'),N'CREATE TRIGGER',N'ALTER TRIGGER');
 EXEC sys.sp_executesql @D;
END;
COMMIT;
GO
