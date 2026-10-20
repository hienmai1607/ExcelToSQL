-- Copy Dim. validates Shipping Singles against the dimensions supplied from Material.
-- Non-shipping Singles (for example, Rigid Corner) can be priced without geometry.
-- No business records or history are modified.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingPrice_BatchV6'));
 IF @D IS NULL THROW 51123,'Packaging Price V6 is required before migration 132.',1;
 DECLARE @Old NVARCHAR(MAX)=N'SELECT @Copy=t.CopyDim,@Type=t.ID';
 DECLARE @New NVARCHAR(MAX)=N'SELECT @Copy=CASE WHEN t.Shipping=1 AND t.FinalComponent=1 THEN t.CopyDim ELSE 0 END,@Type=t.ID';
 IF CHARINDEX(@Old,@D)>0
 BEGIN
  SET @D=REPLACE(@D,@Old,@New);
  SET @D=REPLACE(@D,N'Copy Dim. requires material dimensions in Packaging Pricing.',N'Copy Dim. requires maintained dimensions in Packaging Material for a Shipping Single.');
  SET @D=STUFF(@D,1,CHARINDEX(N'PROCEDURE',UPPER(@D))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
  EXEC sys.sp_executesql @D;
 END
 ELSE IF CHARINDEX(@New,@D)=0
  THROW 51123,'Unexpected Packaging Price Copy Dim. contract. Migration 132 was not applied.',1;
 COMMIT TRANSACTION;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
 THROW;
END CATCH;
