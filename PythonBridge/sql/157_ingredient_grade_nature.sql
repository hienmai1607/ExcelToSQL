-- After 156. Ingredient grade/type/nature metadata used by recipe sheets.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.NPDRecipeSheet','ExchangeRateVNDPerUSD') IS NULL
 THROW 52996,'Apply migration 156 first.',1;
IF COL_LENGTH('dbo.NPDIngredient','GradeNature') IS NULL
 ALTER TABLE dbo.NPDIngredient ADD GradeNature NVARCHAR(150) NOT NULL
  CONSTRAINT DF_NPDIngredient_GradeNature DEFAULT N'';
COMMIT TRANSACTION;
