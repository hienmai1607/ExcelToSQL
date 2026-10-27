/* Requires 146. Alternatives are allowed; the requested container remains mandatory. */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @Name SYSNAME=N'usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation';
 DECLARE @Original NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.'+@Name)),@SQL NVARCHAR(MAX);
 IF CHARINDEX('-- Container proposal flags (146)',COALESCE(@Original,''))=0
  THROW 52999,'Apply migration 146 first.',1;
 IF CHARINDEX('-- Required container proposal (147)',@Original)=0
 BEGIN
  DECLARE @Anchor NVARCHAR(500)=N'SET @Fields=JSON_MODIFY(@Fields,''$.ContainerLoadProfiles'',JSON_QUERY(@Profiles));';
  IF CHARINDEX(@Anchor,@Original)=0 THROW 52999,'Unexpected response profile merge. No changes applied.',1;
  IF NOT EXISTS(SELECT 1 FROM dbo.PackagingLayerMigrationArchive WHERE EntityName=@Name+'147')
   INSERT dbo.PackagingLayerMigrationArchive(EntityName,OriginalJSON)
    SELECT @Name+'147',(SELECT @Original Definition FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  DECLARE @Guard NVARCHAR(MAX)=N'
 DECLARE @ProposalRequested NVARCHAR(200),@ProposalSize NVARCHAR(50);
 SELECT @ProposalRequested=COALESCE(NULLIF(i.ContainerRequest,N''''),parent.ContainerRequest),
   @ProposalSize=COALESCE(i.ShipmentContainerSizeFT,parent.ShipmentContainerSizeFT)
 FROM dbo.PackagingConfigurationRequestItem i
 LEFT JOIN dbo.OpportunityItem oi ON oi.ID=i.OpportunityItemID
 LEFT JOIN dbo.PackagingConfigurationRequestItem parent ON parent.RequestID=i.RequestID AND parent.OpportunityItemID=oi.ParentItemID
 WHERE i.ID=@ID;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Profiles) p CROSS APPLY OPENJSON(p.value) f WHERE f.[key]=N''Proposal'')
 AND NOT EXISTS(SELECT 1 FROM OPENJSON(@Profiles) p WHERE JSON_VALUE(p.value,''$.Proposal'')=N''true''
  AND ((@ProposalRequested IN(N''20DC'',N''40DC'',N''40HC'',N''20RC'',N''40RHC'') AND p.[key]=@ProposalRequested)
   OR ((@ProposalRequested IS NULL OR @ProposalRequested NOT IN(N''20DC'',N''40DC'',N''40HC'',N''20RC'',N''40RHC''))
    AND (@ProposalRequested<>N''Dry'' OR p.[key] IN(N''20DC'',N''40DC'',N''40HC''))
    AND (@ProposalRequested<>N''Reefer'' OR p.[key] IN(N''20RC'',N''40RHC''))
    AND (@ProposalSize IS NULL OR @ProposalSize NOT IN(N''20FT'',N''40FT'') OR LEFT(p.[key],2)=LEFT(@ProposalSize,2)))))
  THROW 52999,''Include the requested container type (or a matching family/size option) in Proposal.'',1;
 ';
  SET @SQL=REPLACE(REPLACE(REPLACE(@Original,'CREATE OR ALTER','ALTER'),'CREATE   PROCEDURE','ALTER PROCEDURE'),'CREATE PROCEDURE','ALTER PROCEDURE');
  SET @SQL=REPLACE(@SQL,@Anchor,@Guard+@Anchor)+CHAR(13)+CHAR(10)+'-- Required container proposal (147)';
  EXEC sys.sp_executesql @SQL;
 END;
 COMMIT TRANSACTION;
END TRY
BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
 THROW;
END CATCH;
GO
IF CHARINDEX('-- Required container proposal (147)',COALESCE(OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation')),''))=0
 THROW 52999,'Required container proposal verification failed.',1;
PRINT N'Required container proposal (147) verified. Existing configurations are retained.';
GO
