USE [test];
GO
-- After 70. Additive fields; meters and legacy Primary columns stay compatible.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
DECLARE @Table SYSNAME,@Field SYSNAME,@Type NVARCHAR(40),@DDL NVARCHAR(MAX);
DECLARE columns_to_add CURSOR LOCAL FAST_FORWARD FOR
SELECT t.name,f.name,f.type FROM (VALUES(N'OpportunityItem'),(N'PackagingConfigurationRequestItem')) t(name)
CROSS JOIN (VALUES (N'MaxPalletHeightMM',N'INT'),(N'ProductGradeSnapshot',N'NVARCHAR(MAX)'),(N'SecondaryRecyclableRequirement',N'NVARCHAR(200)'),(N'SecondaryRecycledContent',N'NVARCHAR(200)'),(N'SecondaryMetalizedAluminum',N'NVARCHAR(100)'),(N'SecondarySpecialComments',N'NVARCHAR(1000)'),(N'TertiaryRecyclableRequirement',N'NVARCHAR(200)'),(N'TertiaryRecycledContent',N'NVARCHAR(200)'),(N'TertiaryMetalizedAluminum',N'NVARCHAR(100)'),(N'TertiarySpecialComments',N'NVARCHAR(1000)')) f(name,type);
OPEN columns_to_add; FETCH NEXT FROM columns_to_add INTO @Table,@Field,@Type;
WHILE @@FETCH_STATUS=0 BEGIN
 IF COL_LENGTH(N'dbo.'+@Table,@Field) IS NULL BEGIN
  SET @DDL=N'ALTER TABLE dbo.'+QUOTENAME(@Table)+N' ADD '+QUOTENAME(@Field)+N' '+@Type+N' NULL';EXEC sys.sp_executesql @DDL;
 END;
 FETCH NEXT FROM columns_to_add INTO @Table,@Field,@Type;
END;
CLOSE columns_to_add; DEALLOCATE columns_to_add;
GO
-- Copy shared values to every existing active layer, without replacing per-layer data.
-- Only new columns are changed; previously captured request values stay unchanged.
IF NOT EXISTS(SELECT 1 FROM sys.extended_properties WHERE class=0 AND name=N'PythonBridge.RequestLayerDetailsBackfill')
BEGIN
UPDATE dbo.OpportunityItem SET
 SecondaryRecyclableRequirement=COALESCE(SecondaryRecyclableRequirement,CASE WHEN PackagingLayerCount>=2 THEN RecyclableRequirement END),
 SecondaryRecycledContent=COALESCE(SecondaryRecycledContent,CASE WHEN PackagingLayerCount>=2 THEN RecycledContent END),
 SecondaryMetalizedAluminum=COALESCE(SecondaryMetalizedAluminum,CASE WHEN PackagingLayerCount>=2 THEN MetalizedAluminum END),
 SecondarySpecialComments=COALESCE(SecondarySpecialComments,CASE WHEN PackagingLayerCount>=2 THEN SpecialComments END),
 TertiaryRecyclableRequirement=COALESCE(TertiaryRecyclableRequirement,CASE WHEN PackagingLayerCount>=3 THEN RecyclableRequirement END),
 TertiaryRecycledContent=COALESCE(TertiaryRecycledContent,CASE WHEN PackagingLayerCount>=3 THEN RecycledContent END),
 TertiaryMetalizedAluminum=COALESCE(TertiaryMetalizedAluminum,CASE WHEN PackagingLayerCount>=3 THEN MetalizedAluminum END),
 TertiarySpecialComments=COALESCE(TertiarySpecialComments,CASE WHEN PackagingLayerCount>=3 THEN SpecialComments END),
 MaxPalletHeightMM=COALESCE(MaxPalletHeightMM,CONVERT(INT,MaxPalletHeightM*1000))
WHERE SecondaryRecyclableRequirement IS NULL OR SecondaryRecycledContent IS NULL OR SecondaryMetalizedAluminum IS NULL OR SecondarySpecialComments IS NULL OR TertiaryRecyclableRequirement IS NULL OR TertiaryRecycledContent IS NULL OR TertiaryMetalizedAluminum IS NULL OR TertiarySpecialComments IS NULL OR MaxPalletHeightMM IS NULL;
UPDATE dbo.PackagingConfigurationRequestItem SET
 SecondaryRecyclableRequirement=COALESCE(SecondaryRecyclableRequirement,CASE WHEN RequestedLayerCount>=2 THEN RecyclableRequirement END),
 SecondaryRecycledContent=COALESCE(SecondaryRecycledContent,CASE WHEN RequestedLayerCount>=2 THEN RecycledContent END),
 SecondaryMetalizedAluminum=COALESCE(SecondaryMetalizedAluminum,CASE WHEN RequestedLayerCount>=2 THEN MetalizedAluminum END),
 SecondarySpecialComments=COALESCE(SecondarySpecialComments,CASE WHEN RequestedLayerCount>=2 THEN SpecialComments END),
 TertiaryRecyclableRequirement=COALESCE(TertiaryRecyclableRequirement,CASE WHEN RequestedLayerCount>=3 THEN RecyclableRequirement END),
 TertiaryRecycledContent=COALESCE(TertiaryRecycledContent,CASE WHEN RequestedLayerCount>=3 THEN RecycledContent END),
 TertiaryMetalizedAluminum=COALESCE(TertiaryMetalizedAluminum,CASE WHEN RequestedLayerCount>=3 THEN MetalizedAluminum END),
 TertiarySpecialComments=COALESCE(TertiarySpecialComments,CASE WHEN RequestedLayerCount>=3 THEN SpecialComments END),
 MaxPalletHeightMM=COALESCE(MaxPalletHeightMM,CONVERT(INT,MaxPalletHeightM*1000))
WHERE SecondaryRecyclableRequirement IS NULL OR SecondaryRecycledContent IS NULL OR SecondaryMetalizedAluminum IS NULL OR SecondarySpecialComments IS NULL OR TertiaryRecyclableRequirement IS NULL OR TertiaryRecycledContent IS NULL OR TertiaryMetalizedAluminum IS NULL OR TertiarySpecialComments IS NULL OR MaxPalletHeightMM IS NULL;
 EXEC sys.sp_addextendedproperty @name=N'PythonBridge.RequestLayerDetailsBackfill',@value=N'71';
END;
COMMIT;
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityItem_Fields_Save'));
IF @D IS NULL THROW 52970,'Opportunity fields procedure is missing.',1;
IF CHARINDEX(N'ProductGradeSnapshot',@D)=0 BEGIN
 IF CHARINDEX(N'''NumberOfSecondary''))',@D)=0 OR CHARINDEX(N'UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()',@D)=0
  THROW 52970,'Unexpected Opportunity save signature.',1;
 SET @D=REPLACE(@D,N'''NumberOfSecondary''))',N'''NumberOfSecondary'',''MaxPalletHeightMM'',''ProductGradeSnapshot'',''SecondaryRecyclableRequirement'',''SecondaryRecycledContent'',''SecondaryMetalizedAluminum'',''SecondarySpecialComments'',''TertiaryRecyclableRequirement'',''TertiaryRecycledContent'',''TertiaryMetalizedAluminum'',''TertiarySpecialComments''))');
 SET @D=REPLACE(@D,N'''MaxPalletHeightM'',''ContainerRequest''',N'''MaxPalletHeightM'',''MaxPalletHeightMM'',''ContainerRequest''');
 SET @D=REPLACE(@D,N'DECLARE @OldUser SQL_VARIANT',N'
 -- Normalize mm into the retained meter column, so legacy clients see the same height.
 IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''MaxPalletHeightMM'')
 BEGIN
  DECLARE @MM INT=TRY_CONVERT(INT,JSON_VALUE(@Fields,''$.MaxPalletHeightMM''));
  IF EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''MaxPalletHeightMM'' AND [type]<>0)
   AND (@MM IS NULL OR @MM<1 OR @MM>999999999 OR TRY_CONVERT(DECIMAL(18,6),JSON_VALUE(@Fields,''$.MaxPalletHeightMM''))<>@MM)
   THROW 52957,''Max pallet height must be a positive whole number of millimeters.'',1;
  SET @Fields=JSON_MODIFY(@Fields,''$.MaxPalletHeightM'',CONVERT(DECIMAL(9,3),COALESCE(@MM,0)/1000.0));
  IF @MM IS NULL SET @Fields=JSON_MODIFY(@Fields,''strict $.MaxPalletHeightM'',NULL);
 END;
 DECLARE @Grade NVARCHAR(MAX)=JSON_QUERY(@Fields,''$.ProductGradeSnapshot'');
 IF @Grade IS NULL AND NOT EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''ProductGradeSnapshot'')
  SELECT @Grade=ProductGradeSnapshot FROM dbo.OpportunityItem WHERE ID=@ID;
 IF @Grade IS NULL
 SELECT @Grade=(SELECT JSON_QUERY(COALESCE((SELECT g.ParentID,g.ID,g.RawGradeID,g.RawMaterialID,g.Grade,g.RatioPct,m.MaterialCode RawMaterialCode,m.MaterialName RawMaterialName
  FROM dbo.ProductGradeItem g JOIN dbo.ProductGradeVersion v ON v.ID=g.VersionID
  LEFT JOIN dbo.RawMaterial m ON m.ID=g.RawMaterialID
  JOIN dbo.OpportunityItem oi ON oi.ProductID=v.ProductID AND oi.ID=@ID
  WHERE v.Status=''Active'' ORDER BY g.ParentID,g.ID FOR JSON PATH),N''[]'')) items FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 -- SQL callers receive the same structural safeguards as HTTP callers.
 IF @Grade IS NOT NULL AND (ISJSON(@Grade)<>1 OR JSON_QUERY(@Grade,''$.items'') IS NULL)
  THROW 52957,''Invalid product grade snapshot.'',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Grade,''$.items'') j
  WHERE TRY_CONVERT(DECIMAL(5,2),JSON_VALUE(j.value,''$.RatioPct'')) IS NULL
   OR TRY_CONVERT(DECIMAL(5,2),JSON_VALUE(j.value,''$.RatioPct''))<=0)
  THROW 52957,''Invalid grade ratio.'',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Grade,''$.items'') WITH(ParentID NVARCHAR(60),RatioPct DECIMAL(5,2))
  GROUP BY ParentID HAVING SUM(RatioPct)<>100)
  THROW 52957,''Grade ratios must total 100 per parent.'',1;
 -- Dropdown validation permits unchanged historical free text.
 IF @Web=1 AND EXISTS(SELECT 1 FROM OPENJSON(@Fields) j JOIN dbo.OpportunityItem i ON i.ID=@ID
  WHERE j.[key] IN(''RecyclableRequirement'',''RecycledContent'',''MetalizedAluminum'',''SecondaryRecyclableRequirement'',''SecondaryRecycledContent'',''SecondaryMetalizedAluminum'',''TertiaryRecyclableRequirement'',''TertiaryRecycledContent'',''TertiaryMetalizedAluminum'') AND j.[type]<>0
  AND NOT(j.[type]=1 AND ((j.[key] LIKE ''%MetalizedAluminum'' AND j.[value] COLLATE Latin1_General_100_BIN2 IN(N''Metalized'',N''Aluminum'',N''NA''))
   OR (j.[key] NOT LIKE ''%MetalizedAluminum'' AND j.[value] COLLATE Latin1_General_100_BIN2 IN(N''Yes'',N''No'',N''NA''))))
  AND NOT EXISTS(SELECT 1 WHERE CONVERT(VARBINARY(MAX),j.[value])=CONVERT(VARBINARY(MAX),CASE j.[key] WHEN ''RecyclableRequirement'' THEN i.RecyclableRequirement WHEN ''RecycledContent'' THEN i.RecycledContent WHEN ''MetalizedAluminum'' THEN i.MetalizedAluminum WHEN ''SecondaryRecyclableRequirement'' THEN i.SecondaryRecyclableRequirement WHEN ''SecondaryRecycledContent'' THEN i.SecondaryRecycledContent WHEN ''SecondaryMetalizedAluminum'' THEN i.SecondaryMetalizedAluminum WHEN ''TertiaryRecyclableRequirement'' THEN i.TertiaryRecyclableRequirement WHEN ''TertiaryRecycledContent'' THEN i.TertiaryRecycledContent WHEN ''TertiaryMetalizedAluminum'' THEN i.TertiaryMetalizedAluminum END)))
  THROW 52957,''Choose valid recyclable, recycled content and metalized / aluminum options.'',1;
 DECLARE @OldUser SQL_VARIANT');
 SET @D=REPLACE(@D,N'UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()',N'   SecondaryRecyclableRequirement=CASE WHEN @Layers<2 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''SecondaryRecyclableRequirement'') THEN NULLIF(LTRIM(RTRIM(j.SecondaryRecyclableRequirement)),N'''') ELSE t.SecondaryRecyclableRequirement END,
   SecondaryRecycledContent=CASE WHEN @Layers<2 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''SecondaryRecycledContent'') THEN NULLIF(LTRIM(RTRIM(j.SecondaryRecycledContent)),N'''') ELSE t.SecondaryRecycledContent END,
   SecondaryMetalizedAluminum=CASE WHEN @Layers<2 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''SecondaryMetalizedAluminum'') THEN NULLIF(LTRIM(RTRIM(j.SecondaryMetalizedAluminum)),N'''') ELSE t.SecondaryMetalizedAluminum END,
   SecondarySpecialComments=CASE WHEN @Layers<2 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''SecondarySpecialComments'') THEN NULLIF(LTRIM(RTRIM(j.SecondarySpecialComments)),N'''') ELSE t.SecondarySpecialComments END,
   TertiaryRecyclableRequirement=CASE WHEN @Layers<3 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''TertiaryRecyclableRequirement'') THEN NULLIF(LTRIM(RTRIM(j.TertiaryRecyclableRequirement)),N'''') ELSE t.TertiaryRecyclableRequirement END,
   TertiaryRecycledContent=CASE WHEN @Layers<3 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''TertiaryRecycledContent'') THEN NULLIF(LTRIM(RTRIM(j.TertiaryRecycledContent)),N'''') ELSE t.TertiaryRecycledContent END,
   TertiaryMetalizedAluminum=CASE WHEN @Layers<3 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''TertiaryMetalizedAluminum'') THEN NULLIF(LTRIM(RTRIM(j.TertiaryMetalizedAluminum)),N'''') ELSE t.TertiaryMetalizedAluminum END,
   TertiarySpecialComments=CASE WHEN @Layers<3 THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''TertiarySpecialComments'') THEN NULLIF(LTRIM(RTRIM(j.TertiarySpecialComments)),N'''') ELSE t.TertiarySpecialComments END,
   MaxPalletHeightMM=CASE WHEN @Web=1 AND @Configuration=''Floor load'' THEN NULL WHEN EXISTS(SELECT 1 FROM OPENJSON(@Fields) WHERE [key]=''MaxPalletHeightM'') THEN CONVERT(INT,j.MaxPalletHeightM*1000) ELSE t.MaxPalletHeightMM END,
   ProductGradeSnapshot=@Grade,
   UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()');
 SET @D=REPLACE(@D,N'NumberOfSecondary INT) j',N'NumberOfSecondary INT,SecondaryRecyclableRequirement NVARCHAR(200),SecondaryRecycledContent NVARCHAR(200),SecondaryMetalizedAluminum NVARCHAR(100),SecondarySpecialComments NVARCHAR(1000),TertiaryRecyclableRequirement NVARCHAR(200),TertiaryRecycledContent NVARCHAR(200),TertiaryMetalizedAluminum NVARCHAR(100),TertiarySpecialComments NVARCHAR(1000)) j');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
-- Freeze the additional fields at request INSERT time, never from live Product afterward.
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingRequest_Create_AuditImplementation'));
IF @D IS NULL THROW 52970,'Request creation implementation is missing.',1;
IF CHARINDEX(N'ProductGradeSnapshot',@D)=0 BEGIN
 IF CHARINDEX(N'TertiaryTransparency,NumberOfSecondary)',@D)=0 THROW 52970,'Unexpected request INSERT.',1;
 SET @D=REPLACE(@D,N'TertiaryTransparency,NumberOfSecondary)',N'TertiaryTransparency,NumberOfSecondary,MaxPalletHeightMM,ProductGradeSnapshot,SecondaryRecyclableRequirement,SecondaryRecycledContent,SecondaryMetalizedAluminum,SecondarySpecialComments,TertiaryRecyclableRequirement,TertiaryRecycledContent,TertiaryMetalizedAluminum,TertiarySpecialComments)');
 SET @D=REPLACE(@D,N'i.TertiaryTransparency,i.NumberOfSecondary',N'i.TertiaryTransparency,i.NumberOfSecondary,i.MaxPalletHeightMM,COALESCE(i.ProductGradeSnapshot,(SELECT JSON_QUERY(COALESCE((SELECT g.ParentID,g.ID,g.RawGradeID,g.RawMaterialID,g.Grade,g.RatioPct,m.MaterialCode RawMaterialCode,m.MaterialName RawMaterialName FROM dbo.ProductGradeItem g JOIN dbo.ProductGradeVersion v ON v.ID=g.VersionID LEFT JOIN dbo.RawMaterial m ON m.ID=g.RawMaterialID WHERE v.ProductID=i.ProductID AND v.Status=''Active'' ORDER BY g.ParentID,g.ID FOR JSON PATH),N''[]'')) items FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)),i.SecondaryRecyclableRequirement,i.SecondaryRecycledContent,i.SecondaryMetalizedAluminum,i.SecondarySpecialComments,i.TertiaryRecyclableRequirement,i.TertiaryRecycledContent,i.TertiaryMetalizedAluminum,i.TertiarySpecialComments');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
-- Extend processing locks and immutable snapshots to all new fields.
DECLARE @Name SYSNAME,@D NVARCHAR(MAX),@Prefix CHAR(1),@Extra NVARCHAR(MAX);
DECLARE guards CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM sys.triggers
 WHERE name IN('tr_OpportunityItem_ProcessingLock','tr_PackagingRequestItem_LayerSnapshotImmutable');
OPEN guards;FETCH NEXT FROM guards INTO @Name;
WHILE @@FETCH_STATUS=0 BEGIN
 SET @D=OBJECT_DEFINITION(OBJECT_ID('dbo.'+@Name));
 IF CHARINDEX(N'i.ProductGradeSnapshot',@D)=0 BEGIN
  SET @D=REPLACE(@D,N'i.NumberOfSecondary',N'i.NumberOfSecondary,i.MaxPalletHeightMM,CONVERT(VARBINARY(MAX),i.ProductGradeSnapshot),CONVERT(VARBINARY(MAX),i.SecondaryRecyclableRequirement),CONVERT(VARBINARY(MAX),i.SecondaryRecycledContent),CONVERT(VARBINARY(MAX),i.SecondaryMetalizedAluminum),CONVERT(VARBINARY(MAX),i.SecondarySpecialComments),CONVERT(VARBINARY(MAX),i.TertiaryRecyclableRequirement),CONVERT(VARBINARY(MAX),i.TertiaryRecycledContent),CONVERT(VARBINARY(MAX),i.TertiaryMetalizedAluminum),CONVERT(VARBINARY(MAX),i.TertiarySpecialComments)');
  SET @D=REPLACE(@D,N'd.NumberOfSecondary',N'd.NumberOfSecondary,d.MaxPalletHeightMM,CONVERT(VARBINARY(MAX),d.ProductGradeSnapshot),CONVERT(VARBINARY(MAX),d.SecondaryRecyclableRequirement),CONVERT(VARBINARY(MAX),d.SecondaryRecycledContent),CONVERT(VARBINARY(MAX),d.SecondaryMetalizedAluminum),CONVERT(VARBINARY(MAX),d.SecondarySpecialComments),CONVERT(VARBINARY(MAX),d.TertiaryRecyclableRequirement),CONVERT(VARBINARY(MAX),d.TertiaryRecycledContent),CONVERT(VARBINARY(MAX),d.TertiaryMetalizedAluminum),CONVERT(VARBINARY(MAX),d.TertiarySpecialComments)');
  SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER TRIGGER',N'ALTER TRIGGER'),N'CREATE   TRIGGER',N'ALTER TRIGGER'),N'CREATE TRIGGER',N'ALTER TRIGGER');
  EXEC sys.sp_executesql @D;
 END;
 FETCH NEXT FROM guards INTO @Name;
END;
CLOSE guards;DEALLOCATE guards;
GO
-- Audit through the established per-field history, with request fields marked non-response.
DECLARE @Name SYSNAME,@D NVARCHAR(MAX),@Rows NVARCHAR(MAX),@Field SYSNAME;
DECLARE audits CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM sys.triggers
 WHERE name IN('tr_OpportunityItem_ChangeLog','tr_PackagingConfigurationRequestItem_ChangeLog');
OPEN audits;FETCH NEXT FROM audits INTO @Name;
WHILE @@FETCH_STATUS=0 BEGIN
 SET @D=OBJECT_DEFINITION(OBJECT_ID(N'dbo.'+@Name));SET @Rows=N'';
 DECLARE fields CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM sys.columns
 WHERE object_id=OBJECT_ID(CASE WHEN @Name='tr_OpportunityItem_ChangeLog' THEN 'dbo.OpportunityItem' ELSE 'dbo.PackagingConfigurationRequestItem' END)
 AND name IN('MaxPalletHeightMM','ProductGradeSnapshot','SecondaryRecyclableRequirement','SecondaryRecycledContent','SecondaryMetalizedAluminum','SecondarySpecialComments','TertiaryRecyclableRequirement','TertiaryRecycledContent','TertiaryMetalizedAluminum','TertiarySpecialComments');
 OPEN fields;FETCH NEXT FROM fields INTO @Field;
 WHILE @@FETCH_STATUS=0 BEGIN
  IF CHARINDEX(QUOTENAME(@Field,'''')+N',',@D)=0
   SET @Rows+=N'('+QUOTENAME(@Field,'''')+N',CONVERT(NVARCHAR(MAX),d.'+QUOTENAME(@Field)+N'),CONVERT(NVARCHAR(MAX),i.'+QUOTENAME(@Field)+N')'+CASE WHEN @Name='tr_OpportunityItem_ChangeLog' THEN N'' ELSE N',0' END+N'),';
  FETCH NEXT FROM fields INTO @Field;
 END;
 CLOSE fields;DEALLOCATE fields;
 IF @Rows<>N'' BEGIN
  IF CHARINDEX(N'CROSS APPLY(VALUES',@D)=0 THROW 52970,'Unexpected audit trigger.',1;
  SET @D=REPLACE(@D,N'CROSS APPLY(VALUES',N'CROSS APPLY(VALUES'+@Rows);
  SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER TRIGGER',N'ALTER TRIGGER'),N'CREATE   TRIGGER',N'ALTER TRIGGER'),N'CREATE TRIGGER',N'ALTER TRIGGER');
  EXEC sys.sp_executesql @D;
 END;
 FETCH NEXT FROM audits INTO @Name;
END;
CLOSE audits;DEALLOCATE audits;
GO
