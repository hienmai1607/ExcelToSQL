/* Requires 143. Back up the database before deployment. Rerunnable. */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
IF OBJECT_ID('dbo.fn_RequestPackagingLayerStart') IS NULL
 THROW 52997,'Apply migration 143 first.',1;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','ReferenceSetupJSON') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD ReferenceSetupJSON NVARCHAR(MAX) NULL
  CONSTRAINT CK_PackagingReferenceSetup144 CHECK(ReferenceSetupJSON IS NULL OR ISJSON(ReferenceSetupJSON)=1);
GO
CREATE OR ALTER FUNCTION dbo.fn_PackagingResponseEditable(@Actor INT,@ID INT)
RETURNS BIT
AS
BEGIN
 RETURN CASE WHEN EXISTS(
  SELECT 1 FROM dbo.PackagingConfigurationRequestItem i JOIN dbo.Users u ON u.ID=@Actor AND u.IsActive=1
  WHERE i.ID=@ID AND (
   (i.Stage IN('Assigned','Working','Returned') AND
    (EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope='Admin')
     OR (i.PICUserID=@Actor AND dbo.fn_PackagingPICMember(@Actor)=1)))
   OR (i.Stage='Pending Review' AND
    (EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope='Admin')
     OR (i.PICUserID<>@Actor AND dbo.fn_PackagingManagerAccess(@Actor)=1
      AND EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope='PackagingManager'))))
  )) THEN 1 ELSE 0 END;
END;
GO
BEGIN TRY
BEGIN TRANSACTION;
DECLARE @Names TABLE(Name SYSNAME);
INSERT @Names VALUES('usp_PackagingResponse_Batch_AuditImplementation'),
 ('usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation'),('usp_PkgPricing_ItemAuthorize');
DECLARE @Name SYSNAME,@SQL NVARCHAR(MAX),@Original NVARCHAR(MAX);
DECLARE procedures CURSOR LOCAL FAST_FORWARD FOR SELECT Name FROM @Names;
OPEN procedures;
FETCH NEXT FROM procedures INTO @Name;
WHILE @@FETCH_STATUS=0
BEGIN
 SET @Original=OBJECT_DEFINITION(OBJECT_ID('dbo.'+@Name));
 IF @Original IS NULL THROW 52997,'Required packaging procedure is missing.',1;
 IF CHARINDEX('-- Reference review (144)',@Original)=0
 BEGIN
  IF NOT EXISTS(SELECT 1 FROM dbo.PackagingLayerMigrationArchive WHERE EntityName=@Name+'144')
   INSERT dbo.PackagingLayerMigrationArchive(EntityName,OriginalJSON) SELECT @Name+'144',(SELECT @Original Definition FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  SET @SQL=REPLACE(@Original,'CREATE PROCEDURE','ALTER PROCEDURE');
  SET @SQL=REPLACE(@SQL,'SET NOCOUNT ON;','SET NOCOUNT ON; -- Reference review (144)');
  SET @SQL=REPLACE(@SQL,'''Maintain'',@ActorID OUTPUT','''Read'',@ActorID OUTPUT');
  SET @SQL=REPLACE(@SQL,'''Maintain'',@Actor OUTPUT','''Read'',@Actor OUTPUT');
  IF @Name='usp_PackagingResponse_Batch_AuditImplementation'
  BEGIN
   IF CHARINDEX('AND (@IsAdmin=1 OR (i.PICUserID=@ActorID AND dbo.fn_PackagingPICMember(@ActorID)=1))',@SQL)=0
    THROW 52997,'Unexpected response batch guard. No changes applied.',1;
   SET @SQL=REPLACE(@SQL,'AND (@IsAdmin=1 OR (i.PICUserID=@ActorID AND dbo.fn_PackagingPICMember(@ActorID)=1))','AND dbo.fn_PackagingResponseEditable(@ActorID,i.ID)=1');
   SET @SQL=REPLACE(@SQL,'AND i.Stage IN(''Assigned'',''Working'',''Returned'')','');
  END
  ELSE
  BEGIN
   IF CHARINDEX('Stage IN(''Assigned'',''Working'',''Returned'') AND (@Admin=1 OR (PICUserID=@Actor AND dbo.fn_PackagingPICMember(@Actor)=1))',@SQL)=0
    THROW 52997,'Unexpected packaging edit guard. No changes applied.',1;
   SET @SQL=REPLACE(@SQL,'Stage IN(''Assigned'',''Working'',''Returned'') AND (@Admin=1 OR (PICUserID=@Actor AND dbo.fn_PackagingPICMember(@Actor)=1))','dbo.fn_PackagingResponseEditable(@Actor,ID)=1');
   IF @Name='usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation'
    SET @SQL=REPLACE(@SQL,'IF @Admin=0 AND NOT EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope=''Packaging'')',
     'IF @Admin=0 AND NOT EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope=''Packaging'') AND NOT (dbo.fn_PackagingManagerAccess(@Actor)=1 AND EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope=''PackagingManager''))');
  END
  EXEC sys.sp_executesql @SQL;
 END;
 FETCH NEXT FROM procedures INTO @Name;
END;
CLOSE procedures; DEALLOCATE procedures;
-- Reference identity follows cumulative layers, not relative per-item slots.
SET @Name='usp_PkgPricing_Save';
SET @Original=OBJECT_DEFINITION(OBJECT_ID('dbo.'+@Name));
IF @Original IS NULL THROW 52997,'Packaging pricing save procedure is missing.',1;
IF CHARINDEX('-- Global pricing references (144)',@Original)=0
BEGIN
 IF NOT EXISTS(SELECT 1 FROM dbo.PackagingLayerMigrationArchive WHERE EntityName=@Name+'144')
  INSERT dbo.PackagingLayerMigrationArchive(EntityName,OriginalJSON) SELECT @Name+'144',(SELECT @Original Definition FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 IF CHARINDEX('WHERE ID=@Reference AND PackagingOrder=@Order',@Original)=0
  THROW 52997,'Unexpected pricing reference guard. No changes applied.',1;
 SET @SQL=REPLACE(@Original,'CREATE PROCEDURE','ALTER PROCEDURE');
 SET @SQL=REPLACE(@SQL,'SET NOCOUNT ON;','SET NOCOUNT ON; -- Global pricing references (144)');
 SET @SQL=REPLACE(@SQL,'WHERE ID=@Reference AND PackagingOrder=@Order',
  'WHERE ID=@Reference AND dbo.fn_PackagingGlobalOrder(PackagingOrder,dbo.fn_RequestPackagingLayerStart(RequestItemID))=dbo.fn_PackagingGlobalOrder(@Order,dbo.fn_RequestPackagingLayerStart(@ItemID))');
 EXEC sys.sp_executesql @SQL;
END;
COMMIT;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
END CATCH;
GO
