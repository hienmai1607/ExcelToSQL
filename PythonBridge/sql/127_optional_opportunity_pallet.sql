-- After 126. Pallet is optional on Opportunities; exact container and supplied-pallet validation remain.
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @D NVARCHAR(MAX)=REPLACE(OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityItem_Fields_Save')),CHAR(13)+CHAR(10),CHAR(10));
 IF @D IS NULL THROW 52998,'Opportunity fields writer is missing.',1;
 IF CHARINDEX(N'-- Optional Pallet size (127).',@D)=0
 BEGIN
  DECLARE @Old NVARCHAR(MAX)=N'IF NULLIF(LTRIM(RTRIM(@RequiredPallet)),N'''') IS NULL
   THROW 52957,''Pallet size is required.'',1;
  IF NOT EXISTS(SELECT 1 FROM dbo.v_PalletSizeChoice p';
  IF CHARINDEX(@Old,@D)=0 THROW 52998,'Unexpected pallet requirement. Review before migrating.',1;
  SET @D=REPLACE(@D,@Old,N'-- Optional Pallet size (127).
  SET @RequiredPallet=NULLIF(LTRIM(RTRIM(@RequiredPallet)),N'''');
  IF @RequiredPallet IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.v_PalletSizeChoice p');
  SET @D=REPLACE(@D,N'-- Required parent Container Type and Pallet size.',N'-- Required parent Container Type; optional Pallet size.');
  SET @D=STUFF(@D,1,CHARINDEX(N'PROCEDURE',UPPER(@D))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
  EXEC sys.sp_executesql @D;
 END;
 COMMIT;
END TRY
BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK;
 THROW;
END CATCH;
