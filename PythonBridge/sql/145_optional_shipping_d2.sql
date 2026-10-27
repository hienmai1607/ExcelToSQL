/* Requires 144. Back up before deployment. No existing master values or snapshots are changed. */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
IF OBJECT_ID('dbo.fn_PackagingResponseEditable','FN') IS NULL
 THROW 52998,'Apply migration 144 first.',1;
GO
BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @Changes TABLE(Name SYSNAME,OldGuard NVARCHAR(1000),NewGuard NVARCHAR(1000),OldMessage NVARCHAR(200));
 INSERT @Changes VALUES
 ('usp_PackagingDimension_Save',
  N'(@D2 IS NULL OR @D3<>N''Height'' OR @D3 IS NULL OR @D2UoMID IS NULL OR @D3UoMID IS NULL)',
  N'(@D3<>N''Height'' OR @D3 IS NULL OR @D3UoMID IS NULL)',
  N'Shipping types require three dimensions; D3 is fixed as Height.'),
 ('usp_PackagingDimension_SaveV2',
  N'(@D2 IS NULL OR @D3<>N''Height'' OR @D3 IS NULL OR @D2UoMID IS NULL OR @D3UoMID IS NULL)',
  N'(@D3<>N''Height'' OR @D3 IS NULL OR @D3UoMID IS NULL)',
  N'Shipping types require three dimensions; D3 is fixed as Height.'),
 ('tr_PackagingDimension_ParentGeometry',
  N'd.D1Name IS NULL OR d.D2Name IS NULL OR d.D3Name IS NULL OR d.D3Name<>N''Height''',
  N'd.D1Name IS NULL OR d.D3Name IS NULL OR d.D3Name<>N''Height''',
  N'Shipping parent dimensions require D1, D2 and D3 fixed as Height.'),
 ('tr_PackagingType_ShippingDimensions',
  N'd.D1Name IS NULL OR d.D2Name IS NULL OR d.D3Name<>N''Height''',
  N'd.D1Name IS NULL OR d.D3Name<>N''Height''',
  N'Shipping dimensions require D1, D2 and D3 fixed as Height.'),
 ('tr_PackagingDimension_ShippingRequired',
  N'OR NULLIF(LTRIM(RTRIM(d.D2Name)),N'''') IS NULL OR NULLIF(LTRIM(RTRIM(d.D3Name)),N'''') IS NULL',
  N'OR NULLIF(LTRIM(RTRIM(d.D3Name)),N'''') IS NULL',
  N'Shipping types require D1, D2 and D3 names and units.');
 DECLARE @Name SYSNAME,@Old NVARCHAR(1000),@New NVARCHAR(1000),@Message NVARCHAR(200),@Original NVARCHAR(MAX),@SQL NVARCHAR(MAX);
 DECLARE definitions CURSOR LOCAL FAST_FORWARD FOR SELECT Name,OldGuard,NewGuard,OldMessage FROM @Changes;
 OPEN definitions;
 FETCH NEXT FROM definitions INTO @Name,@Old,@New,@Message;
 WHILE @@FETCH_STATUS=0
 BEGIN
  SET @Original=OBJECT_DEFINITION(OBJECT_ID('dbo.'+@Name));
  IF @Original IS NULL THROW 52998,'Required shipping dimension procedure or trigger is missing.',1;
  IF CHARINDEX('-- Optional shipping D2 (145)',@Original)=0
  BEGIN
   IF CHARINDEX(@Old,@Original)=0 OR CHARINDEX(@Message,@Original)=0
    THROW 52998,'Unexpected shipping dimension guard. No changes applied.',1;
   IF NOT EXISTS(SELECT 1 FROM dbo.PackagingLayerMigrationArchive WHERE EntityName=@Name+'145')
    INSERT dbo.PackagingLayerMigrationArchive(EntityName,OriginalJSON)
     SELECT @Name+'145',(SELECT @Original Definition FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
   SET @SQL=REPLACE(REPLACE(@Original,'CREATE OR ALTER','ALTER'),'CREATE   PROCEDURE','ALTER PROCEDURE');
   SET @SQL=REPLACE(REPLACE(@SQL,'CREATE PROCEDURE','ALTER PROCEDURE'),'CREATE TRIGGER','ALTER TRIGGER');
   SET @SQL=REPLACE(@SQL,'CREATE   TRIGGER','ALTER TRIGGER');
   SET @SQL=REPLACE(@SQL,@Old,@New);
   IF LEFT(@Name,3)='tr_'
   BEGIN
    IF CHARINDEX('OR d.D1UoMID IS NULL OR d.D2UoMID IS NULL OR d.D3UoMID IS NULL',@SQL)=0
     THROW 52998,'Unexpected shipping dimension unit guard. No changes applied.',1;
    SET @SQL=REPLACE(@SQL,'OR d.D1UoMID IS NULL OR d.D2UoMID IS NULL OR d.D3UoMID IS NULL',
     'OR d.D1UoMID IS NULL OR d.D3UoMID IS NULL');
   END;
   SET @SQL=REPLACE(@SQL,@Message,N'Shipping requires D1 and D3 fixed as Height; D2 is optional unless used in a formula.');
   SET @SQL=@SQL+CHAR(13)+CHAR(10)+'-- Optional shipping D2 (145)';
   EXEC sys.sp_executesql @SQL;
  END;
  FETCH NEXT FROM definitions INTO @Name,@Old,@New,@Message;
 END;
 CLOSE definitions;
 DEALLOCATE definitions;
 IF EXISTS(SELECT 1 FROM @Changes WHERE CHARINDEX('-- Optional shipping D2 (145)',COALESCE(OBJECT_DEFINITION(OBJECT_ID('dbo.'+Name)),''))=0)
  THROW 52998,'Optional shipping D2 verification failed.',1;
 COMMIT;
END TRY
BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK;
 THROW;
END CATCH;
GO
