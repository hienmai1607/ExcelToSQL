-- After 155. Capture sheet FX and calculated seasoning buffer uplift.
-- Existing approved calculations and Opportunity results are retained.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.NPDRecipeSheet','SeasoningLossPct') IS NULL
 THROW 52996,'Apply migration 155 first.',1;
IF COL_LENGTH('dbo.NPDRecipeSheet','ExchangeRateVNDPerUSD') IS NULL
 ALTER TABLE dbo.NPDRecipeSheet ADD ExchangeRateVNDPerUSD DECIMAL(19,6) NULL
  CONSTRAINT CK_NPDRecipeSheet_ExchangeRate CHECK(ExchangeRateVNDPerUSD>0);
-- Drafts may exceed 100% uplift; submission enforces the Process Loss limit.
DECLARE @constraint_name SYSNAME, @statement NVARCHAR(500);
DECLARE loss_checks CURSOR LOCAL FAST_FORWARD FOR
 SELECT name FROM sys.check_constraints
 WHERE parent_object_id=OBJECT_ID('dbo.NPDRecipeSheet') AND definition LIKE '%SeasoningLossPct%';
OPEN loss_checks;
FETCH NEXT FROM loss_checks INTO @constraint_name;
WHILE @@FETCH_STATUS=0
BEGIN
 SET @statement=N'ALTER TABLE dbo.NPDRecipeSheet DROP CONSTRAINT '+QUOTENAME(@constraint_name);
 EXEC sys.sp_executesql @statement;
 FETCH NEXT FROM loss_checks INTO @constraint_name;
END;
CLOSE loss_checks;
DEALLOCATE loss_checks;
ALTER TABLE dbo.NPDRecipeSheet ALTER COLUMN SeasoningLossPct DECIMAL(28,12) NOT NULL;
ALTER TABLE dbo.NPDRecipeSheet ADD CONSTRAINT CK_NPDRecipeSheet_SeasoningLoss CHECK(SeasoningLossPct>=0);
COMMIT TRANSACTION;
