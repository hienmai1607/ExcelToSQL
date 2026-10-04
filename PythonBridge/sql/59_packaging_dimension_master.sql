USE [test];
GO
-- After 58. Web-only master; no Layout or Excel Local Update changes.
-- Area is calculated safely in the API, using current general conversions to M.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
IF OBJECT_ID('dbo.PackagingDimension','U') IS NULL
BEGIN
 CREATE TABLE dbo.PackagingDimension(
  ID INT IDENTITY PRIMARY KEY,
  PackagingTypeID INT NOT NULL REFERENCES dbo.PackagingType(ID),
  D1 DECIMAL(18,6) NOT NULL,
  D2 DECIMAL(18,6) NOT NULL,
  D3 DECIMAL(18,6) NOT NULL,
  D1UoMID INT NOT NULL REFERENCES dbo.UoM(ID),
  D2UoMID INT NOT NULL REFERENCES dbo.UoM(ID),
  D3UoMID INT NOT NULL REFERENCES dbo.UoM(ID),
  SquareMeterFormula NVARCHAR(200) NOT NULL,
  Status VARCHAR(10) NOT NULL DEFAULT('Active'),
  CreatedAt DATETIME2(7) NOT NULL DEFAULT(SYSUTCDATETIME()),
  CreatedBy INT NOT NULL REFERENCES dbo.Users(ID),
  UpdatedAt DATETIME2(7) NULL,
  UpdatedBy INT NULL REFERENCES dbo.Users(ID),
  RowVersion ROWVERSION NOT NULL,
  CONSTRAINT CK_PackagingDimension_Values CHECK(D1>0 AND D2>0 AND D3>0 AND LEN(LTRIM(RTRIM(SquareMeterFormula)))>0),
  CONSTRAINT CK_PackagingDimension_Status CHECK(Status IN('Active','Block'))
 );
 CREATE INDEX IX_PackagingDimension_Type ON dbo.PackagingDimension(PackagingTypeID,Status,ID);
END;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingDimension_Save
 @Username NVARCHAR(100),@ID INT=NULL,@RowVersion VARBINARY(8)=NULL,
 @PackagingTypeID INT=NULL,@D1 DECIMAL(18,6)=NULL,@D2 DECIMAL(18,6)=NULL,@D3 DECIMAL(18,6)=NULL,
 @D1UoMID INT=NULL,@D2UoMID INT=NULL,@D3UoMID INT=NULL,
 @SquareMeterFormula NVARCHAR(200)=NULL,@Status VARCHAR(10)='Active'
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 DECLARE @Actor INT,@OldType INT,@Old1 INT,@Old2 INT,@Old3 INT,@Own BIT=0;
 EXEC dbo.usp_Packaging_Authorize @Username,'Maintain',@Actor OUTPUT;
 BEGIN TRY
 IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION;SET @Own=1;END ELSE SAVE TRANSACTION DimensionRow;
 IF @ID IS NULL AND @RowVersion IS NOT NULL THROW 51111,'Create cannot have a RowVersion.',1;
 IF @ID IS NOT NULL
 BEGIN
  SELECT @OldType=PackagingTypeID,@Old1=D1UoMID,@Old2=D2UoMID,@Old3=D3UoMID
  FROM dbo.PackagingDimension WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@RowVersion;
  IF @OldType IS NULL THROW 51108,'Concurrency conflict or row not found. Refresh first.',1;
 END;
 IF @D1 IS NULL OR @D1<=0 OR @D2 IS NULL OR @D2<=0 OR @D3 IS NULL OR @D3<=0
  OR @Status IS NULL OR @Status NOT IN('Active','Block') OR NULLIF(LTRIM(RTRIM(@SquareMeterFormula)),N'') IS NULL
  THROW 51111,'Positive dimensions, a formula and valid status are required.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK)
  WHERE ID=@PackagingTypeID AND ParentTypeID IS NULL AND (Status='Active' OR (@Status='Block' AND ID=@OldType)))
  THROW 51111,'Choose an active parent Packaging Type.',1;
 IF @D1UoMID IS NULL OR @D2UoMID IS NULL OR @D3UoMID IS NULL
  THROW 51111,'Choose a unit for each dimension.',1;
 IF EXISTS(SELECT 1 FROM (VALUES(@D1UoMID,@Old1),(@D2UoMID,@Old2),(@D3UoMID,@Old3)) chosen(ID,OldID)
  WHERE NOT EXISTS(SELECT 1 FROM dbo.UoM u WITH(UPDLOCK,HOLDLOCK)
   WHERE u.ID=chosen.ID AND (u.Status='Active' OR (@Status='Block' AND u.ID=chosen.OldID))))
  THROW 51111,'Choose active units for the dimensions.',1;
 IF @Status='Active'
 BEGIN
  -- Hold the target unit and conversion rows during the save.
  DECLARE @M INT,@Locked BIGINT;
  SELECT @M=ID FROM dbo.UoM WITH(UPDLOCK,HOLDLOCK) WHERE UoMCode='M' AND Status='Active';
  SELECT @Locked=COUNT_BIG(*) FROM dbo.UnitConversion WITH(UPDLOCK,HOLDLOCK)
   WHERE FromUoMID IN(@D1UoMID,@D2UoMID,@D3UoMID) AND ToUoMID=@M
    AND PackagingMaterialID IS NULL AND RawMaterialID IS NULL AND VendorID IS NULL;
  IF @M IS NULL OR EXISTS(SELECT 1 FROM (VALUES(@D1UoMID),(@D2UoMID),(@D3UoMID)) chosen(ID)
   WHERE chosen.ID<>@M AND NOT EXISTS(SELECT 1 FROM dbo.UnitConversion
    WHERE FromUoMID=chosen.ID AND ToUoMID=@M AND Status='Active'
     AND PackagingMaterialID IS NULL AND RawMaterialID IS NULL AND VendorID IS NULL))
   THROW 51111,'Admin must maintain active general conversions from each dimension UoM to M (metres).',1;
 END;
 IF @ID IS NULL
 BEGIN
  INSERT dbo.PackagingDimension(PackagingTypeID,D1,D2,D3,D1UoMID,D2UoMID,D3UoMID,SquareMeterFormula,Status,CreatedBy)
  VALUES(@PackagingTypeID,@D1,@D2,@D3,@D1UoMID,@D2UoMID,@D3UoMID,LTRIM(RTRIM(@SquareMeterFormula)),@Status,@Actor);
  SET @ID=SCOPE_IDENTITY();
 END
 ELSE UPDATE dbo.PackagingDimension SET PackagingTypeID=@PackagingTypeID,D1=@D1,D2=@D2,D3=@D3,
  D1UoMID=@D1UoMID,D2UoMID=@D2UoMID,D3UoMID=@D3UoMID,SquareMeterFormula=LTRIM(RTRIM(@SquareMeterFormula)),
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
-- Referenced parent types must remain parents, even when maintained outside the web.
CREATE OR ALTER TRIGGER dbo.tr_PackagingType_DimensionParent
ON dbo.PackagingType AFTER UPDATE
AS
BEGIN
 SET NOCOUNT ON;
 IF UPDATE(ParentTypeID) AND EXISTS(SELECT 1 FROM inserted p JOIN dbo.PackagingDimension d ON d.PackagingTypeID=p.ID WHERE p.ParentTypeID IS NOT NULL)
  THROW 51111,'Packaging Type referenced by Dimension Master must remain a parent.',1;
END;
GO
