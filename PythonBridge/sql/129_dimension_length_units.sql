-- After 128. Physical D1-D3 measurements use Length/Distance units.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingDimension_SaveV2'));
 IF @D IS NULL OR COL_LENGTH('dbo.UoM','Category') IS NULL THROW 52999,'Apply migrations through 128 first.',1;
 IF CHARINDEX('-- Length units (129)',@D)=0 BEGIN
  DECLARE @Old NVARCHAR(MAX)=N'WHERE UoM.ID=x.ID AND Status=''Active''))';
  IF CHARINDEX(@Old,@D)=0 THROW 52999,'Unexpected dimension unit validation. Review before migrating.',1;
  SET @D=REPLACE(@D,@Old,N'WHERE UoM.ID=x.ID AND Status=''Active'' AND Category=N''Length/Distance'')) -- Length units (129)');
  SET @D=REPLACE(@D,N'Choose active dimension units.',N'Choose active Length/Distance units for D1-D3.');
  SET @D=STUFF(@D,1,CHARINDEX(N'PROCEDURE',UPPER(@D))+8,N'ALTER PROCEDURE');
  EXEC sys.sp_executesql @D;
 END;
 COMMIT TRANSACTION;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
 THROW;
END CATCH;
