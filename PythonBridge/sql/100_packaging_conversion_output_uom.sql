-- After 99. Shared output unit for both child conversion formulas.
-- Existing definitions retain NULL (legacy implicit units) and snapshots are untouched.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.PackagingDimension','ConversionOutputUoMID') IS NULL
 ALTER TABLE dbo.PackagingDimension ADD ConversionOutputUoMID INT NULL;
IF OBJECT_ID('dbo.FK_PackagingDimension_ConversionOutputUoM','F') IS NULL
 ALTER TABLE dbo.PackagingDimension WITH CHECK ADD CONSTRAINT FK_PackagingDimension_ConversionOutputUoM
 FOREIGN KEY(ConversionOutputUoMID) REFERENCES dbo.UoM(ID);
EXEC sys.sp_refreshview N'dbo.v_PackagingDimensionWeb';
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingDimension_SaveV2'));
IF @D IS NULL OR CHARINDEX(N'@ConvertFromSupplierFormula NVARCHAR(200)=NULL',@D)=0
 THROW 52999,'Apply formula-role migration 80 and migrations through 99 first.',1;
IF CHARINDEX(N'-- Shared conversion output unit.',@D)=0
BEGIN
 IF CHARINDEX(N'SET @AllFormulas=',@D)=0 OR CHARINDEX(N'ConvertFromSupplierFormula=@ConvertFromSupplierFormula,',@D)=0
  THROW 52999,'Unexpected Packaging Dimension save signature.',1;
 SET @D=REPLACE(@D,N'@ConvertFromSupplierFormula NVARCHAR(200)=NULL',N'@ConvertFromSupplierFormula NVARCHAR(200)=NULL,
 @ConversionOutputUoMID INT=NULL,@ConversionOutputUoMSet BIT=0');
 SET @D=REPLACE(@D,N'SET @AllFormulas=',N'-- Shared conversion output unit.
 IF @ID IS NOT NULL AND @ConversionOutputUoMSet=0
  SELECT @ConversionOutputUoMID=ConversionOutputUoMID FROM dbo.PackagingDimension WHERE ID=@ID;
 IF @ConversionOutputUoMSet=1 AND @ConversionOutputUoMID IS NULL AND @Status=''Active''
  AND (@ConvertFromParentFormula IS NOT NULL OR @ConvertFromSupplierFormula IS NOT NULL)
  THROW 51111,''Choose the shared formula output UoM for both conversion formulas.'',1;
 IF @ConversionOutputUoMID IS NOT NULL AND @Root=@PackagingTypeID
  THROW 51111,''Shared output UoM applies only to child conversion formulas.'',1;
 IF @ConversionOutputUoMID IS NOT NULL AND @Status=''Active'' AND NOT EXISTS(
  SELECT 1 FROM dbo.UoM WITH(HOLDLOCK) WHERE ID=@ConversionOutputUoMID AND Status=''Active'')
  THROW 51111,''Choose an active shared formula output UoM.'',1;
 SET @AllFormulas=');
 SET @D=REPLACE(@D,N'ConvertFromSupplierFormula,Status,CreatedBy)',N'ConvertFromSupplierFormula,ConversionOutputUoMID,Status,CreatedBy)');
 SET @D=REPLACE(@D,N'@ConvertFromSupplierFormula,@Status,@Actor)',N'@ConvertFromSupplierFormula,@ConversionOutputUoMID,@Status,@Actor)');
 SET @D=REPLACE(@D,N'ConvertFromSupplierFormula=@ConvertFromSupplierFormula,',N'ConvertFromSupplierFormula=@ConvertFromSupplierFormula,ConversionOutputUoMID=@ConversionOutputUoMID,');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
-- Supplier prices cannot freshly select a definition with a blocked output unit.
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingPrice_BatchV5'));
IF @D IS NULL THROW 52999,'Apply Packaging Supplier Pricing migration 80 first.',1;
IF CHARINDEX(N'-- Shared supplier output unit.',@D)=0
BEGIN
 IF CHARINDEX(N'AND d.ConvertFromSupplierFormula IS NOT NULL)',@D)=0
  THROW 52999,'Unexpected supplier formula validation signature.',1;
 SET @D=REPLACE(@D,N'AND d.ConvertFromSupplierFormula IS NOT NULL)',N'-- Shared supplier output unit.
                   AND (d.ConversionOutputUoMID IS NULL OR EXISTS(SELECT 1 FROM dbo.UoM WITH(HOLDLOCK) WHERE ID=d.ConversionOutputUoMID AND Status=''Active''))
                   AND d.ConvertFromSupplierFormula IS NOT NULL)');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
COMMIT;
GO
