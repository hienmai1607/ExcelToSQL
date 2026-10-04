USE [test];
GO
-- After 61. All active Packaging Types are eligible; only Square meter needs a formula.
-- Existing formulas, numeric archives and review flags are preserved for other bases.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF OBJECT_ID('dbo.tr_PackagingType_DimensionParent','TR') IS NOT NULL
 DROP TRIGGER dbo.tr_PackagingType_DimensionParent;
IF OBJECT_ID('dbo.CK_PackagingDimension_Values','C') IS NOT NULL
 ALTER TABLE dbo.PackagingDimension DROP CONSTRAINT CK_PackagingDimension_Values;
ALTER TABLE dbo.PackagingDimension ALTER COLUMN SquareMeterFormula NVARCHAR(200) NULL;
ALTER TABLE dbo.PackagingDimension WITH CHECK ADD CONSTRAINT CK_PackagingDimension_Values
 CHECK((D1 IS NULL OR D1>0) AND (D2 IS NULL OR D2>0) AND (D3 IS NULL OR D3>0)
  AND (SquareMeterFormula IS NULL OR LEN(LTRIM(RTRIM(SquareMeterFormula)))>0));
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingDimension_Save
 @Username NVARCHAR(100),@ID INT=NULL,@RowVersion VARBINARY(8)=NULL,
 @PackagingTypeID INT=NULL,@D1 NVARCHAR(100)=NULL,@D2 NVARCHAR(100)=NULL,@D3 NVARCHAR(100)=NULL,
 @D1UoMID INT=NULL,@D2UoMID INT=NULL,@D3UoMID INT=NULL,
 @SquareMeterFormula NVARCHAR(200)=NULL,@Status VARCHAR(10)='Active',@FormulaReviewed BIT=0
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 DECLARE @Actor INT,@OldType INT,@Old1 INT,@Old2 INT,@Old3 INT,@NeedsReview BIT=0,@Own BIT=0,@PriceBasis NVARCHAR(20),@OldFormula NVARCHAR(200);
 EXEC dbo.usp_Packaging_Authorize @Username,'Maintain',@Actor OUTPUT;
 BEGIN TRY
 IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION;SET @Own=1;END ELSE SAVE TRANSACTION DimensionRow;
 IF @ID IS NULL AND @RowVersion IS NOT NULL THROW 51111,'Create cannot have a RowVersion.',1;
 IF @ID IS NOT NULL
 BEGIN
  SELECT @OldType=PackagingTypeID,@Old1=D1UoMID,@Old2=D2UoMID,@Old3=D3UoMID,@NeedsReview=FormulaNeedsReview,@OldFormula=SquareMeterFormula
  FROM dbo.PackagingDimension WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@RowVersion;
  IF @OldType IS NULL THROW 51108,'Concurrency conflict or row not found. Refresh first.',1;
 END;
 SET @D1=NULLIF(LTRIM(RTRIM(@D1)),N'');SET @D2=NULLIF(LTRIM(RTRIM(@D2)),N'');SET @D3=NULLIF(LTRIM(RTRIM(@D3)),N'');
 SET @SquareMeterFormula=NULLIF(LTRIM(RTRIM(@SquareMeterFormula)),N'');
 SELECT @PriceBasis=PriceBasis FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK)
  WHERE ID=@PackagingTypeID AND (Status='Active' OR (@Status='Block' AND ID=@OldType));
 IF @PriceBasis IS NULL THROW 51111,'Choose an active Packaging Type.',1;
 IF @PriceBasis=N'Square meter' AND @SquareMeterFormula IS NULL
  THROW 51111,'Square meter types require a Square meter formula.',1;
 -- Non-area types retain prior formulas for preservation, but never use a hidden input.
 IF @PriceBasis<>N'Square meter' SET @SquareMeterFormula=@OldFormula;
 IF @D1 IS NULL OR @D1UoMID IS NULL OR @Status IS NULL OR @Status NOT IN('Active','Block')
  THROW 51111,'D1 name and unit and valid status are required.',1;
 IF (@D2 IS NULL AND @D2UoMID IS NOT NULL) OR (@D2 IS NOT NULL AND @D2UoMID IS NULL)
  OR (@D3 IS NULL AND @D3UoMID IS NOT NULL) OR (@D3 IS NOT NULL AND @D3UoMID IS NULL)
  THROW 51111,'Each dimension needs both a name and unit, or both must be blank.',1;
 IF @PriceBasis=N'Square meter' AND ((CHARINDEX(N'D2',@SquareMeterFormula)>0 AND @D2 IS NULL) OR (CHARINDEX(N'D3',@SquareMeterFormula)>0 AND @D3 IS NULL))
  THROW 51111,'Define names and units for dimensions used in the formula.',1;
 IF @PriceBasis=N'Square meter' AND @NeedsReview=1 AND COALESCE(@FormulaReviewed,0)<>1 AND @Status='Active'
  THROW 51111,'Review the legacy formula using selected input units before saving.',1;
 IF EXISTS(SELECT 1 FROM (VALUES(@D1UoMID,@Old1),(@D2UoMID,@Old2),(@D3UoMID,@Old3)) chosen(ID,OldID)
  WHERE chosen.ID IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.UoM u WITH(UPDLOCK,HOLDLOCK)
   WHERE u.ID=chosen.ID AND (u.Status='Active' OR (@Status='Block' AND u.ID=chosen.OldID))))
  THROW 51111,'Choose active units for the dimensions.',1;
 IF @ID IS NULL
 BEGIN
  INSERT dbo.PackagingDimension(PackagingTypeID,D1Name,D2Name,D3Name,D1UoMID,D2UoMID,D3UoMID,SquareMeterFormula,Status,CreatedBy)
  VALUES(@PackagingTypeID,@D1,@D2,@D3,@D1UoMID,@D2UoMID,@D3UoMID,@SquareMeterFormula,@Status,@Actor);
  SET @ID=SCOPE_IDENTITY();
 END
 ELSE UPDATE dbo.PackagingDimension SET PackagingTypeID=@PackagingTypeID,D1Name=@D1,D2Name=@D2,D3Name=@D3,
  D1UoMID=@D1UoMID,D2UoMID=@D2UoMID,D3UoMID=@D3UoMID,SquareMeterFormula=@SquareMeterFormula,
  FormulaNeedsReview=CASE WHEN @PriceBasis=N'Square meter' AND @FormulaReviewed=1 THEN 0 ELSE FormulaNeedsReview END,
  Status=@Status,UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@Actor WHERE ID=@ID;
 IF @Own=1 COMMIT;
 SELECT ID,RowVersion FROM dbo.PackagingDimension WHERE ID=@ID;
 END TRY
 BEGIN CATCH
 IF @Own=1 AND XACT_STATE()<>0 ROLLBACK;
 ELSE IF XACT_STATE()=1 ROLLBACK TRANSACTION DimensionRow;
 THROW;
 END CATCH;
END;
GO
COMMIT;
GO

