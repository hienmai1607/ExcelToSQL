/* Requires 145. Back up before VM deployment. Existing configurations and snapshots are unchanged. */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
IF OBJECT_ID('dbo.PackagingLayerMigrationArchive','U') IS NULL
 OR CHARINDEX('-- Optional shipping D2 (145)',COALESCE(OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingDimension_Save')),''))=0
 THROW 52999,'Apply migrations through 145 first.',1;
GO
BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @Name SYSNAME=N'usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation';
 DECLARE @Original NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.'+@Name)),@SQL NVARCHAR(MAX);
 IF @Original IS NULL THROW 52999,'Response fields implementation is missing.',1;
 IF CHARINDEX('-- Container proposal flags (146)',@Original)=0
 BEGIN
  DECLARE @Allowed NVARCHAR(500)=N'NOT IN(N''LayersPerContainer'',N''PalletsPerContainer'',N''CartonsPerContainerFloor'')';
  DECLARE @Count NVARCHAR(500)=N'OR f.[type]<>0 AND (f.[type] NOT IN(1,2)';
  DECLARE @Merge NVARCHAR(500)=N'SET @Merged=JSON_MODIFY(@Merged,N''$.''+@CountKey,TRY_CONVERT(INT,@CountValue));';
  IF CHARINDEX(@Allowed,@Original)=0 OR CHARINDEX(@Count,@Original)=0 OR CHARINDEX(@Merge,@Original)=0
   THROW 52999,'Unexpected response profile implementation. No changes applied.',1;
  IF NOT EXISTS(SELECT 1 FROM dbo.PackagingLayerMigrationArchive WHERE EntityName=@Name+'146')
   INSERT dbo.PackagingLayerMigrationArchive(EntityName,OriginalJSON)
    SELECT @Name+'146',(SELECT @Original Definition FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  SET @SQL=REPLACE(REPLACE(REPLACE(@Original,'CREATE OR ALTER','ALTER'),'CREATE   PROCEDURE','ALTER PROCEDURE'),'CREATE PROCEDURE','ALTER PROCEDURE');
  SET @SQL=REPLACE(@SQL,@Allowed,N'NOT IN(N''LayersPerContainer'',N''PalletsPerContainer'',N''CartonsPerContainerFloor'',N''Proposal'')');
  SET @SQL=REPLACE(@SQL,@Count,N'OR f.[key]=N''Proposal'' AND f.[type]<>3 OR f.[key]<>N''Proposal'' AND f.[type]<>0 AND (f.[type] NOT IN(1,2)');
  SET @SQL=REPLACE(@SQL,@Merge,N'IF @CountKey=N''Proposal'' SET @Merged=JSON_MODIFY(@Merged,N''$.Proposal'',CONVERT(BIT,CASE WHEN @CountValue=N''true'' THEN 1 ELSE 0 END)); ELSE '+@Merge);
  SET @SQL=@SQL+CHAR(13)+CHAR(10)+'-- Container proposal flags (146)';
  EXEC sys.sp_executesql @SQL;
 END;
 COMMIT TRANSACTION;
END TRY
BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
 THROW;
END CATCH;
GO
IF CHARINDEX('-- Container proposal flags (146)',COALESCE(OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation')),''))=0
 THROW 52999,'Container proposal migration verification failed.',1;
PRINT N'Container proposal flags (146) verified. Restart the matching API after deploying.';
GO
