USE [test];
GO
-- After 59. D1-D3 define names, not sample measurements.
-- Preserve old numeric values/formulas; require review before switching old rows.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.PackagingDimension','D1Name') IS NULL
 ALTER TABLE dbo.PackagingDimension ADD D1Name NVARCHAR(100) NULL,D2Name NVARCHAR(100) NULL,D3Name NVARCHAR(100) NULL,
  LegacySquareMeterFormula NVARCHAR(200) NULL,LegacyD1Unit NVARCHAR(40) NULL,LegacyD2Unit NVARCHAR(40) NULL,LegacyD3Unit NVARCHAR(40) NULL,
  FormulaNeedsReview BIT NOT NULL CONSTRAINT DF_PackagingDimension_Review DEFAULT(0);
GO
UPDATE d SET D1Name=N'Dimension 1',D2Name=N'Dimension 2',D3Name=N'Dimension 3',
 LegacySquareMeterFormula=SquareMeterFormula,LegacyD1Unit=u1.UoMCode,LegacyD2Unit=u2.UoMCode,LegacyD3Unit=u3.UoMCode,FormulaNeedsReview=1
 FROM dbo.PackagingDimension d JOIN dbo.UoM u1 ON u1.ID=d.D1UoMID
 LEFT JOIN dbo.UoM u2 ON u2.ID=d.D2UoMID LEFT JOIN dbo.UoM u3 ON u3.ID=d.D3UoMID WHERE D1Name IS NULL;
IF OBJECT_ID('dbo.CK_PackagingDimension_Values','C') IS NOT NULL
 ALTER TABLE dbo.PackagingDimension DROP CONSTRAINT CK_PackagingDimension_Values;
ALTER TABLE dbo.PackagingDimension ALTER COLUMN D1 DECIMAL(18,6) NULL;
ALTER TABLE dbo.PackagingDimension ALTER COLUMN D2 DECIMAL(18,6) NULL;
ALTER TABLE dbo.PackagingDimension ALTER COLUMN D3 DECIMAL(18,6) NULL;
ALTER TABLE dbo.PackagingDimension ALTER COLUMN D2UoMID INT NULL;
ALTER TABLE dbo.PackagingDimension ALTER COLUMN D3UoMID INT NULL;
ALTER TABLE dbo.PackagingDimension ALTER COLUMN D1Name NVARCHAR(100) NOT NULL;
ALTER TABLE dbo.PackagingDimension WITH CHECK ADD CONSTRAINT CK_PackagingDimension_Values
 CHECK((D1 IS NULL OR D1>0) AND (D2 IS NULL OR D2>0) AND (D3 IS NULL OR D3>0)
  AND LEN(LTRIM(RTRIM(SquareMeterFormula)))>0);
IF OBJECT_ID('dbo.CK_PackagingDimension_Names','C') IS NULL
 ALTER TABLE dbo.PackagingDimension WITH CHECK ADD CONSTRAINT CK_PackagingDimension_Names
 CHECK(LEN(LTRIM(RTRIM(D1Name)))>0
  AND ((D2Name IS NULL AND D2UoMID IS NULL) OR (D2Name IS NOT NULL AND LEN(LTRIM(RTRIM(D2Name)))>0 AND D2UoMID IS NOT NULL))
  AND ((D3Name IS NULL AND D3UoMID IS NULL) OR (D3Name IS NOT NULL AND LEN(LTRIM(RTRIM(D3Name)))>0 AND D3UoMID IS NOT NULL)));
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingDimension_Save
 @Username NVARCHAR(100),@ID INT=NULL,@RowVersion VARBINARY(8)=NULL,
 @PackagingTypeID INT=NULL,@D1 NVARCHAR(100)=NULL,@D2 NVARCHAR(100)=NULL,@D3 NVARCHAR(100)=NULL,
 @D1UoMID INT=NULL,@D2UoMID INT=NULL,@D3UoMID INT=NULL,
 @SquareMeterFormula NVARCHAR(200)=NULL,@Status VARCHAR(10)='Active',@FormulaReviewed BIT=0
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 DECLARE @Actor INT,@OldType INT,@Old1 INT,@Old2 INT,@Old3 INT,@NeedsReview BIT=0,@Own BIT=0;
 EXEC dbo.usp_Packaging_Authorize @Username,'Maintain',@Actor OUTPUT;
 BEGIN TRY
 IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION;SET @Own=1;END ELSE SAVE TRANSACTION DimensionRow;
 IF @ID IS NULL AND @RowVersion IS NOT NULL THROW 51111,'Create cannot have a RowVersion.',1;
 IF @ID IS NOT NULL
 BEGIN
  SELECT @OldType=PackagingTypeID,@Old1=D1UoMID,@Old2=D2UoMID,@Old3=D3UoMID,@NeedsReview=FormulaNeedsReview
  FROM dbo.PackagingDimension WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@RowVersion;
  IF @OldType IS NULL THROW 51108,'Concurrency conflict or row not found. Refresh first.',1;
 END;
 SET @D1=NULLIF(LTRIM(RTRIM(@D1)),N'');SET @D2=NULLIF(LTRIM(RTRIM(@D2)),N'');SET @D3=NULLIF(LTRIM(RTRIM(@D3)),N'');
 SET @SquareMeterFormula=NULLIF(LTRIM(RTRIM(@SquareMeterFormula)),N'');
 IF @D1 IS NULL OR @D1UoMID IS NULL OR @SquareMeterFormula IS NULL OR @Status IS NULL OR @Status NOT IN('Active','Block')
  THROW 51111,'D1 name and unit, a formula and valid status are required.',1;
 IF (@D2 IS NULL AND @D2UoMID IS NOT NULL) OR (@D2 IS NOT NULL AND @D2UoMID IS NULL)
  OR (@D3 IS NULL AND @D3UoMID IS NOT NULL) OR (@D3 IS NOT NULL AND @D3UoMID IS NULL)
  THROW 51111,'Each dimension needs both a name and unit, or both must be blank.',1;
 IF (CHARINDEX(N'D2',@SquareMeterFormula)>0 AND @D2 IS NULL) OR (CHARINDEX(N'D3',@SquareMeterFormula)>0 AND @D3 IS NULL)
  THROW 51111,'Define names and units for dimensions used in the formula.',1;
 IF @NeedsReview=1 AND COALESCE(@FormulaReviewed,0)<>1 AND @Status='Active'
  THROW 51111,'Review the legacy formula using selected input units before saving.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK)
  WHERE ID=@PackagingTypeID AND ParentTypeID IS NULL AND (Status='Active' OR (@Status='Block' AND ID=@OldType)))
  THROW 51111,'Choose an active parent Packaging Type.',1;
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
  FormulaNeedsReview=CASE WHEN @FormulaReviewed=1 THEN 0 ELSE FormulaNeedsReview END,
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
