USE [test]
GO
-- Rates now mean vendor currency units per USD. Do not invert values blindly:
-- review existing rates before rollout; some users already entered this convention.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.PackagingPrice','UnitUSDPrice') IS NOT NULL
 ALTER TABLE dbo.PackagingPrice DROP COLUMN UnitUSDPrice;
ALTER TABLE dbo.PackagingPrice ADD UnitUSDPrice AS
 CONVERT(DECIMAL(38,8),UnitPrice / NULLIF(ExchangeRateToUSD,0));
COMMIT;
GO
