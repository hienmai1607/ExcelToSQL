USE [test];
GO
-- After 73. Shipping-only volume definitions; never store temporary measurements.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.PackagingType','Shipping') IS NULL
 THROW 52974,'Apply Shipping migration 73 first.',1;
IF COL_LENGTH('dbo.PackagingDimension','VolumeFormula') IS NULL
 ALTER TABLE dbo.PackagingDimension ADD VolumeFormula NVARCHAR(200) NULL;
GO
IF OBJECT_ID('dbo.CK_PackagingDimension_VolumeFormula','C') IS NULL
 ALTER TABLE dbo.PackagingDimension WITH CHECK ADD CONSTRAINT CK_PackagingDimension_VolumeFormula
 CHECK(VolumeFormula IS NULL OR LEN(LTRIM(RTRIM(VolumeFormula)))>0);
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingDimension_Save'));
IF @D IS NULL OR CHARINDEX(N'-- Shipping dimensions.',@D)=0
 THROW 52974,'Apply Shipping dimension procedure migration 73 first.',1;
IF CHARINDEX(N'-- Shipping volume formula.',@D)=0 BEGIN
 IF CHARINDEX(N'@FormulaReviewed BIT=0',@D)=0 OR CHARINDEX(N'@OldFormula=SquareMeterFormula',@D)=0
  OR CHARINDEX(N'SquareMeterFormula,Status,CreatedBy)',@D)=0
  THROW 52974,'Unexpected dimension save signature.',1;
 SET @D=REPLACE(@D,N'@FormulaReviewed BIT=0',N'@FormulaReviewed BIT=0,@VolumeFormula NVARCHAR(200)=NULL,@VolumeFormulaProvided BIT=0');
 SET @D=REPLACE(@D,N'DECLARE @Actor INT',N'DECLARE @OldVolumeFormula NVARCHAR(200); DECLARE @Actor INT');
 SET @D=REPLACE(@D,N'@OldFormula=SquareMeterFormula',N'@OldFormula=SquareMeterFormula,@OldVolumeFormula=VolumeFormula');
 SET @D=REPLACE(@D,N'IF @PriceBasis IS NULL THROW',N'-- Shipping volume formula.
 SET @VolumeFormula=NULLIF(LTRIM(RTRIM(@VolumeFormula)),N'''');
 IF @Shipping=0 AND @VolumeFormulaProvided=1 AND @VolumeFormula IS NOT NULL
  AND (@OldVolumeFormula IS NULL OR @VolumeFormula<>@OldVolumeFormula)
  THROW 51111,''Volume formula applies only to Shipping types.'',1;
 -- Older clients omit the new parameter; non-shipping rows retain hidden history.
 IF @VolumeFormulaProvided=0 OR @Shipping=0 SET @VolumeFormula=@OldVolumeFormula;
 IF @Shipping=1 AND ((CHARINDEX(N''D2'',@VolumeFormula)>0 AND @D2 IS NULL)
  OR (CHARINDEX(N''D3'',@VolumeFormula)>0 AND @D3 IS NULL))
  THROW 51111,''Define names and units for dimensions used in the volume formula.'',1;
 IF @PriceBasis IS NULL THROW');
 SET @D=REPLACE(@D,N'SquareMeterFormula,Status,CreatedBy)',N'SquareMeterFormula,Status,CreatedBy,VolumeFormula)');
 SET @D=REPLACE(@D,N'@SquareMeterFormula,@Status,@Actor)',N'@SquareMeterFormula,@Status,@Actor,@VolumeFormula)');
 SET @D=REPLACE(@D,N'SquareMeterFormula=@SquareMeterFormula,',N'SquareMeterFormula=@SquareMeterFormula,VolumeFormula=@VolumeFormula,');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
CREATE OR ALTER TRIGGER dbo.tr_PackagingDimension_VolumeShipping
ON dbo.PackagingDimension AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM inserted i JOIN dbo.PackagingType t ON t.ID=i.PackagingTypeID
  LEFT JOIN deleted d ON d.ID=i.ID
  WHERE t.Shipping=0 AND i.VolumeFormula IS NOT NULL
   AND (d.ID IS NULL OR d.VolumeFormula IS NULL OR d.VolumeFormula<>i.VolumeFormula))
  THROW 51111,'Volume formula applies only to Shipping types.',1;
END;
GO
COMMIT;
GO
