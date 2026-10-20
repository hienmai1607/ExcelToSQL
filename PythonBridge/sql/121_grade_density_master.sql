-- Manual master updates have no source Packaging Request item.
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 IF OBJECT_ID('dbo.NutGradeDensityHistory','U') IS NULL THROW 52999,'Apply migration 101 first.',1;
 IF EXISTS(SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.NutGradeDensityHistory') AND name='ResponseItemID' AND is_nullable=0)
  ALTER TABLE dbo.NutGradeDensityHistory ALTER COLUMN ResponseItemID INT NULL;
 COMMIT;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
END CATCH;
