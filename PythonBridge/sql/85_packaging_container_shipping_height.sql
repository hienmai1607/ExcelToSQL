USE [test];
GO
-- After 84. Correct the container denominator without rewriting saved history.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation'));
IF @D IS NULL OR CHARINDEX(N'-- Calculated container layers.',@D)=0
 THROW 52971,'Apply migration 84 before shipping-height container layers.',1;
IF CHARINDEX(N'-- Shipping height container layers.',@D)=0 BEGIN
 DECLARE @Old NVARCHAR(MAX)=N'IF @Height IS NOT NULL AND @PalletLayers IS NOT NULL
  SET @ContainerPalletHeightScaled=15000+CONVERT(DECIMAL(28,0),@PalletLayers)*(@Height*100);';
 -- Normalize line endings before matching the audited procedure definition.
 SET @D=REPLACE(@D,CHAR(13),N'');
 IF CHARINDEX(@Old,@D)=0 THROW 52971,'Unexpected calculated container layers procedure signature.',1;
 SET @D=REPLACE(@D,@Old,N'IF @Height IS NOT NULL
  SET @ContainerPalletHeightScaled=@Height*100;');
 SET @D=REPLACE(@D,N'@ContainerPalletHeightScaled',N'@ContainerShippingHeightScaled');
 SET @D=REPLACE(@D,N'-- Calculated container layers.',N'-- Calculated container layers.
 -- Shipping height container layers.');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
COMMIT;
GO
