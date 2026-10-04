USE [test];
GO
-- After 76. Parent geometry, child formula overrides. Historical pricing JSON is immutable.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.PackagingDimension','VolumeFormula') IS NULL
 THROW 52977,'Apply migration 74 first.',1;
IF COL_LENGTH('dbo.PackagingDimension','ParentDimensionID') IS NULL
 ALTER TABLE dbo.PackagingDimension ADD ParentDimensionID INT NULL
  CONSTRAINT FK_PackagingDimension_Parent REFERENCES dbo.PackagingDimension(ID);
IF OBJECT_ID('dbo.PackagingDimensionInheritanceLog') IS NULL
 CREATE TABLE dbo.PackagingDimensionInheritanceLog(
  DimensionID INT PRIMARY KEY, BeforeJSON NVARCHAR(MAX) NOT NULL,
  CapturedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());
GO
CREATE OR ALTER VIEW dbo.v_PackagingTypeDimensionContext AS
WITH tree AS (
 SELECT ID,ParentTypeID,ID RootTypeID,Shipping RootShipping,Status RootStatus,0 Depth
 FROM dbo.PackagingType WHERE ParentTypeID IS NULL
 UNION ALL
 SELECT t.ID,t.ParentTypeID,p.RootTypeID,p.RootShipping,p.RootStatus,p.Depth+1
 FROM dbo.PackagingType t JOIN tree p ON t.ParentTypeID=p.ID WHERE p.Depth<99
)
SELECT t.*,c.RootTypeID,c.RootShipping,c.RootStatus FROM dbo.PackagingType t JOIN tree c ON c.ID=t.ID;
GO
-- Promote legacy child geometry into a parent definition without discarding any formula.
-- Multiple geometries are kept as separate parent definitions, not silently merged.
DECLARE @ID INT,@Root INT,@Parent INT,@D1 NVARCHAR(100),@D2 NVARCHAR(100),@D3 NVARCHAR(100),
 @U1 INT,@U2 INT,@U3 INT,@Actor INT;
DECLARE legacy CURSOR LOCAL FAST_FORWARD FOR
 SELECT d.ID,t.RootTypeID,d.D1Name,d.D2Name,d.D3Name,d.D1UoMID,d.D2UoMID,d.D3UoMID,d.CreatedBy
 FROM dbo.PackagingDimension d JOIN dbo.v_PackagingTypeDimensionContext t ON t.ID=d.PackagingTypeID
 WHERE t.ParentTypeID IS NOT NULL AND d.ParentDimensionID IS NULL;
OPEN legacy; FETCH NEXT FROM legacy INTO @ID,@Root,@D1,@D2,@D3,@U1,@U2,@U3,@Actor;
WHILE @@FETCH_STATUS=0 BEGIN
 IF NOT EXISTS(SELECT 1 FROM dbo.PackagingDimensionInheritanceLog WHERE DimensionID=@ID)
  INSERT dbo.PackagingDimensionInheritanceLog(DimensionID,BeforeJSON)
  SELECT @ID,(SELECT d.* FROM dbo.PackagingDimension d WHERE d.ID=@ID FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 SET @Parent=NULL;
 SELECT TOP(1) @Parent=ID FROM dbo.PackagingDimension
 WHERE PackagingTypeID=@Root AND ParentDimensionID IS NULL
  AND D1Name=@D1 AND COALESCE(D2Name,N'')=COALESCE(@D2,N'') AND COALESCE(D3Name,N'')=COALESCE(@D3,N'')
  AND D1UoMID=@U1 AND COALESCE(D2UoMID,0)=COALESCE(@U2,0) AND COALESCE(D3UoMID,0)=COALESCE(@U3,0)
 ORDER BY CASE WHEN Status='Active' THEN 0 ELSE 1 END,ID;
 IF @Parent IS NULL BEGIN
  INSERT dbo.PackagingDimension(PackagingTypeID,D1Name,D2Name,D3Name,D1UoMID,D2UoMID,D3UoMID,SquareMeterFormula,VolumeFormula,FormulaNeedsReview,Status,CreatedBy)
  SELECT @Root,D1Name,D2Name,D3Name,D1UoMID,D2UoMID,D3UoMID,SquareMeterFormula,VolumeFormula,FormulaNeedsReview,Status,@Actor
  FROM dbo.PackagingDimension WHERE ID=@ID;
  SET @Parent=SCOPE_IDENTITY();
 END;
 UPDATE dbo.PackagingDimension SET ParentDimensionID=@Parent WHERE ID=@ID;
 FETCH NEXT FROM legacy INTO @ID,@Root,@D1,@D2,@D3,@U1,@U2,@U3,@Actor;
END;
CLOSE legacy; DEALLOCATE legacy;
-- Do not reinterpret an existing Shipping gusset as height.
IF EXISTS(SELECT 1 FROM dbo.PackagingDimension d JOIN dbo.PackagingType t ON t.ID=d.PackagingTypeID
 WHERE t.Shipping=1 AND d.Status='Active' AND d.D3Name<>N'Height')
 THROW 52977,'Review existing Shipping D3 definitions: D3 must be Height before applying 77.',1;
GO
CREATE OR ALTER VIEW dbo.v_PackagingDimensionWeb AS
SELECT d.*,t.ParentTypeID,t.RootTypeID,t.RootShipping AS Shipping,t.PackagingType,t.PriceBasis,
 p.RowVersion AS ParentDimensionRowVersion,
 COALESCE(d.SquareMeterFormula,p.SquareMeterFormula) AS EffectiveSquareMeterFormula,
 COALESCE(d.VolumeFormula,p.VolumeFormula) AS EffectiveVolumeFormula,
 CONVERT(BIT,CASE WHEN d.FormulaNeedsReview=1 OR p.FormulaNeedsReview=1 THEN 1 ELSE 0 END) AS EffectiveNeedsReview
FROM dbo.PackagingDimension d JOIN dbo.v_PackagingTypeDimensionContext t ON t.ID=d.PackagingTypeID
LEFT JOIN dbo.PackagingDimension p ON p.ID=d.ParentDimensionID;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingDimension_Save
 @Username NVARCHAR(100),@ID INT=NULL,@RowVersion VARBINARY(8)=NULL,
 @PackagingTypeID INT=NULL,@D1 NVARCHAR(100)=NULL,@D2 NVARCHAR(100)=NULL,@D3 NVARCHAR(100)=NULL,
 @D1UoMID INT=NULL,@D2UoMID INT=NULL,@D3UoMID INT=NULL,
 @SquareMeterFormula NVARCHAR(200)=NULL,@Status VARCHAR(10)='Active',@FormulaReviewed BIT=0,
 @VolumeFormula NVARCHAR(200)=NULL,@VolumeFormulaProvided BIT=0,
 @ParentDimensionID INT=NULL,@ParentDimensionRowVersion VARBINARY(8)=NULL
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 -- Shipping dimensions.
 -- Shipping volume formula.
 -- Markers retained for older migration reruns.
 DECLARE @Actor INT,@Own BIT=0,@Root INT,@Shipping BIT,@TypeStatus VARCHAR(10),@OldType INT,
  @OldVolume NVARCHAR(200),@OldArea NVARCHAR(200),@PriceBasis NVARCHAR(20),@NeedsReview BIT=0,@Lock INT;
 EXEC dbo.usp_Packaging_Authorize @Username,'Maintain',@Actor OUTPUT;
 BEGIN TRY
 IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION;SET @Own=1;END ELSE SAVE TRANSACTION DimensionRow;
 EXEC @Lock=sys.sp_getapplock @Resource='PackagingTypeHierarchy',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
 IF @Lock<0 THROW 51108,'Packaging type hierarchy is busy. Retry.',1;
 IF @ID IS NULL AND @RowVersion IS NOT NULL THROW 51111,'Create cannot have a RowVersion.',1;
 IF @ID IS NOT NULL BEGIN
  SELECT @OldType=PackagingTypeID,@OldVolume=VolumeFormula,@OldArea=SquareMeterFormula,@NeedsReview=FormulaNeedsReview
  FROM dbo.PackagingDimension WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@RowVersion;
  IF @OldType IS NULL THROW 51108,'Concurrency conflict. Refresh first.',1;
 END;
 SELECT @Root=RootTypeID,@Shipping=RootShipping,@TypeStatus=Status,@PriceBasis=PriceBasis
 FROM dbo.v_PackagingTypeDimensionContext WHERE ID=@PackagingTypeID;
 IF @Root IS NULL OR (@TypeStatus<>'Active' AND NOT(@Status='Block' AND @OldType=@PackagingTypeID))
  THROW 51111,'Choose an active Packaging Type.',1;
 IF @Status IS NULL OR @Status NOT IN('Active','Block') THROW 51111,'Invalid status.',1;
 IF @Root<>@PackagingTypeID BEGIN
  IF NOT EXISTS(SELECT 1 FROM dbo.PackagingDimension WITH(UPDLOCK,HOLDLOCK)
   WHERE ID=@ParentDimensionID AND PackagingTypeID=@Root AND ParentDimensionID IS NULL
    AND (Status='Active' OR @Status='Block') AND RowVersion=@ParentDimensionRowVersion)
   THROW 51108,'Choose a current parent dimension definition. Refresh first.',1;
  SELECT @D1=D1Name,@D2=D2Name,@D3=D3Name,@D1UoMID=D1UoMID,@D2UoMID=D2UoMID,@D3UoMID=D3UoMID
  FROM dbo.PackagingDimension WHERE ID=@ParentDimensionID;
 END ELSE IF @ParentDimensionID IS NOT NULL THROW 51111,'Parent types own their dimensions.',1;
 SET @D1=NULLIF(LTRIM(RTRIM(@D1)),N''); SET @D2=NULLIF(LTRIM(RTRIM(@D2)),N''); SET @D3=NULLIF(LTRIM(RTRIM(@D3)),N'');
 SET @SquareMeterFormula=NULLIF(LTRIM(RTRIM(@SquareMeterFormula)),N'');
 IF @Root=@PackagingTypeID AND @PriceBasis<>'Square meter' AND @Shipping=0
  SET @SquareMeterFormula=@OldArea;
 IF @Root=@PackagingTypeID AND @PriceBasis='Square meter' AND @SquareMeterFormula IS NULL
  THROW 51111,'Square meter types require a Square meter formula.',1;
 SET @VolumeFormula=CASE WHEN @VolumeFormulaProvided=0 THEN @OldVolume ELSE NULLIF(LTRIM(RTRIM(@VolumeFormula)),N'') END;
 IF @D1 IS NULL OR @D1UoMID IS NULL THROW 51111,'D1 name and unit are required.',1;
 IF (@D2 IS NULL AND @D2UoMID IS NOT NULL) OR (@D2 IS NOT NULL AND @D2UoMID IS NULL)
  OR (@D3 IS NULL AND @D3UoMID IS NOT NULL) OR (@D3 IS NOT NULL AND @D3UoMID IS NULL)
  THROW 51111,'Each dimension needs a name and unit.',1;
 IF @Shipping=1 AND (@D2 IS NULL OR @D3<>N'Height' OR @D3 IS NULL OR @D2UoMID IS NULL OR @D3UoMID IS NULL)
  THROW 51111,'Shipping types require three dimensions; D3 is fixed as Height.',1;
 IF @VolumeFormula IS NOT NULL AND @Shipping=0 AND (@OldVolume IS NULL OR @VolumeFormula<>@OldVolume)
  THROW 51111,'Volume formula applies only to Shipping types and their child components.',1;
 IF EXISTS(SELECT 1 FROM (VALUES(@D1UoMID),(@D2UoMID),(@D3UoMID)) x(ID)
  WHERE ID IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.UoM WITH(HOLDLOCK) WHERE UoM.ID=x.ID AND Status='Active'))
  AND @Status='Active' THROW 51111,'Choose active dimension units.',1;
 IF CHARINDEX(N'D2',COALESCE(@SquareMeterFormula,N'')+COALESCE(@VolumeFormula,N''))>0 AND @D2 IS NULL
  OR CHARINDEX(N'D3',COALESCE(@SquareMeterFormula,N'')+COALESCE(@VolumeFormula,N''))>0 AND @D3 IS NULL
  THROW 51111,'Define dimensions used in the formulas.',1;
 IF (@PriceBasis='Square meter' OR @Shipping=1 OR @Root<>@PackagingTypeID) AND @NeedsReview=1 AND @FormulaReviewed<>1 AND @Status='Active'
  THROW 51111,'Review the legacy formula using selected input units before saving.',1;
 IF @ID IS NULL BEGIN
  INSERT dbo.PackagingDimension(PackagingTypeID,ParentDimensionID,D1Name,D2Name,D3Name,D1UoMID,D2UoMID,D3UoMID,SquareMeterFormula,VolumeFormula,Status,CreatedBy)
  VALUES(@PackagingTypeID,@ParentDimensionID,@D1,@D2,@D3,@D1UoMID,@D2UoMID,@D3UoMID,@SquareMeterFormula,@VolumeFormula,@Status,@Actor);
  SET @ID=SCOPE_IDENTITY();
 END ELSE UPDATE dbo.PackagingDimension SET PackagingTypeID=@PackagingTypeID,ParentDimensionID=@ParentDimensionID,
  D1Name=@D1,D2Name=@D2,D3Name=@D3,D1UoMID=@D1UoMID,D2UoMID=@D2UoMID,D3UoMID=@D3UoMID,
  SquareMeterFormula=@SquareMeterFormula,VolumeFormula=@VolumeFormula,
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
CREATE OR ALTER TRIGGER dbo.tr_PackagingDimension_ParentGeometry
ON dbo.PackagingDimension AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 -- Parent changes propagate copied geometry, never overwrite child formulas.
 UPDATE c SET D1Name=p.D1Name,D2Name=p.D2Name,D3Name=p.D3Name,
  D1UoMID=p.D1UoMID,D2UoMID=p.D2UoMID,D3UoMID=p.D3UoMID,UpdatedAt=SYSUTCDATETIME(),UpdatedBy=p.UpdatedBy
 FROM dbo.PackagingDimension c JOIN inserted p ON c.ParentDimensionID=p.ID
 WHERE p.ParentDimensionID IS NULL;
 IF EXISTS(SELECT 1 FROM inserted d JOIN dbo.v_PackagingTypeDimensionContext t ON t.ID=d.PackagingTypeID
  LEFT JOIN dbo.PackagingDimension p ON p.ID=d.ParentDimensionID
  WHERE (t.ParentTypeID IS NULL AND d.ParentDimensionID IS NOT NULL)
   OR (t.ParentTypeID IS NOT NULL AND (p.ID IS NULL OR p.ParentDimensionID IS NOT NULL OR p.PackagingTypeID<>t.RootTypeID
    OR d.D1Name<>p.D1Name OR COALESCE(d.D2Name,N'')<>COALESCE(p.D2Name,N'') OR COALESCE(d.D3Name,N'')<>COALESCE(p.D3Name,N'')
    OR d.D1UoMID<>p.D1UoMID OR COALESCE(d.D2UoMID,0)<>COALESCE(p.D2UoMID,0) OR COALESCE(d.D3UoMID,0)<>COALESCE(p.D3UoMID,0))))
  THROW 51111,'Child dimensions must copy their parent definition; only formulas can differ.',1;
 IF EXISTS(SELECT 1 FROM inserted d JOIN dbo.v_PackagingTypeDimensionContext t ON t.ID=d.PackagingTypeID
  WHERE t.RootShipping=1 AND d.Status='Active' AND (d.D3Name<>N'Height' OR d.D3Name IS NULL))
  THROW 51111,'Shipping D3 is fixed as Height.',1;
 IF EXISTS(SELECT 1 FROM dbo.PackagingDimension c JOIN inserted p ON c.ParentDimensionID=p.ID
  JOIN dbo.v_PackagingTypeDimensionContext t ON t.ID=c.PackagingTypeID
  WHERE p.PackagingTypeID<>t.RootTypeID OR p.ParentDimensionID IS NOT NULL)
  THROW 51111,'Parent geometry cannot be moved away from its linked child types.',1;
END;
GO
CREATE OR ALTER TRIGGER dbo.tr_PackagingDimension_VolumeShipping
ON dbo.PackagingDimension AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM inserted i JOIN dbo.v_PackagingTypeDimensionContext t ON t.ID=i.PackagingTypeID
  LEFT JOIN deleted d ON d.ID=i.ID WHERE t.RootShipping=0 AND i.VolumeFormula IS NOT NULL
   AND (d.ID IS NULL OR d.VolumeFormula IS NULL OR d.VolumeFormula<>i.VolumeFormula))
  THROW 51111,'Volume formula applies only to Shipping types and their child components.',1;
END;
GO
CREATE OR ALTER TRIGGER dbo.tr_PackagingType_ShippingDimensions
ON dbo.PackagingType AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM inserted t JOIN dbo.PackagingDimension d ON d.PackagingTypeID=t.ID
  WHERE t.Shipping=1 AND d.Status='Active' AND (d.D1Name IS NULL OR d.D2Name IS NULL OR d.D3Name<>N'Height'
   OR d.D3Name IS NULL OR d.D1UoMID IS NULL OR d.D2UoMID IS NULL OR d.D3UoMID IS NULL))
  THROW 51111,'Shipping dimensions require D1, D2 and D3 fixed as Height.',1;
 -- Reparenting a type with linked geometry needs an explicit remapping first.
 IF EXISTS(SELECT 1 FROM dbo.PackagingDimension d JOIN dbo.v_PackagingTypeDimensionContext t ON t.ID=d.PackagingTypeID
  LEFT JOIN dbo.PackagingDimension p ON p.ID=d.ParentDimensionID
  WHERE p.PackagingTypeID<>t.RootTypeID OR t.ParentTypeID IS NOT NULL AND d.ParentDimensionID IS NULL
   OR t.ParentTypeID IS NULL AND d.ParentDimensionID IS NOT NULL)
  THROW 51111,'Remap child dimension definitions before changing the type hierarchy.',1;
END;
GO
COMMIT;
GO
