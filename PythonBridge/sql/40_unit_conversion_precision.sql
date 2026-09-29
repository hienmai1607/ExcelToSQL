USE [test];
GO
-- After 39. Preserve the existing 15 whole digits and add six decimal places.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
ALTER TABLE dbo.UnitConversion ALTER COLUMN Factor DECIMAL(24,9) NOT NULL;
GO
CREATE OR ALTER FUNCTION dbo.fn_UnitConversion(
 @From NVARCHAR(40),@To NVARCHAR(40),@Packaging INT,@Raw INT,@Vendor INT)
RETURNS TABLE
AS RETURN
 SELECT TOP(1) c.ID,c.Factor
 FROM dbo.UnitConversion c
 JOIN dbo.UoM f ON f.ID=c.FromUoMID AND f.Status='Active'
 JOIN dbo.UoM t ON t.ID=c.ToUoMID AND t.Status='Active'
 WHERE c.Status='Active' AND f.UoMCode=@From AND t.UoMCode=@To
 AND ((c.PackagingMaterialID IS NULL AND c.RawMaterialID IS NULL)
   OR c.PackagingMaterialID=@Packaging OR c.RawMaterialID=@Raw)
 AND (c.VendorID IS NULL OR c.VendorID=@Vendor)
 ORDER BY CASE WHEN c.VendorID IS NOT NULL THEN 0
 WHEN c.PackagingMaterialID IS NOT NULL OR c.RawMaterialID IS NOT NULL THEN 1 ELSE 2 END,c.ID;
GO
CREATE OR ALTER PROCEDURE dbo.usp_UnitConversion_Save
 @Username NVARCHAR(100),@ID INT=NULL,@RowVersion VARBINARY(8)=NULL,
 @FromUoMID INT=NULL,@ToUoMID INT=NULL,@Factor DECIMAL(24,9)=NULL,
 @PackagingMaterialID INT=NULL,@RawMaterialID INT=NULL,@VendorID INT=NULL,@Status VARCHAR(10)='Active'
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 DECLARE @Actor INT,@Admin BIT=0,@Packaging BIT=0,@Raw BIT=0,@OldPackaging INT,@OldRaw INT;
 SELECT @Actor=ID FROM dbo.Users WHERE UserName=@Username AND IsActive=1;
 IF @Actor IS NULL THROW 51101,'Username is incorrect.',1;
 SELECT @Admin=MAX(CASE WHEN Scope='Admin' THEN 1 ELSE 0 END),
 @Packaging=MAX(CASE WHEN Scope='Packaging' THEN 1 ELSE 0 END),
 @Raw=MAX(CASE WHEN Scope='RawMaterial' THEN 1 ELSE 0 END)
 FROM dbo.UserAccess WHERE UserID=@Actor;
 BEGIN TRY
 BEGIN TRANSACTION;
 IF @ID IS NOT NULL
 BEGIN
  IF NOT EXISTS(SELECT 1 FROM dbo.UnitConversion WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@RowVersion)
   THROW 51108,'Concurrency conflict. Refresh first.',1;
  SELECT @OldPackaging=PackagingMaterialID,@OldRaw=RawMaterialID FROM dbo.UnitConversion WHERE ID=@ID;
  IF COALESCE(@Admin,0)=0 AND NOT(
   (@OldPackaging IS NOT NULL AND COALESCE(@Packaging,0)=1) OR (@OldRaw IS NOT NULL AND COALESCE(@Raw,0)=1))
   THROW 51102,'Conversion maintenance access is required.',1;
 END;
 IF COALESCE(@Admin,0)=0 AND NOT(
  (@PackagingMaterialID IS NOT NULL AND COALESCE(@Packaging,0)=1) OR (@RawMaterialID IS NOT NULL AND COALESCE(@Raw,0)=1))
  THROW 51102,'Conversion maintenance access is required.',1;
 IF @Factor IS NULL OR @Factor<=0 OR @FromUoMID=@ToUoMID OR @Status IS NULL OR @Status NOT IN('Active','Block')
  THROW 51111,'Use different units, a positive factor and valid status.',1;
 IF @Status='Active'
 BEGIN
  IF (SELECT COUNT(*) FROM dbo.UoM WITH(UPDLOCK,HOLDLOCK) WHERE ID IN(@FromUoMID,@ToUoMID) AND Status='Active')<>2
   THROW 51111,'Choose two active units.',1;
  IF @PackagingMaterialID IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.PackagingMaterial WHERE ID=@PackagingMaterialID AND Status='Active')
   THROW 51111,'Choose an active Packaging Material.',1;
  IF @RawMaterialID IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.RawMaterial WHERE ID=@RawMaterialID AND Status='Active')
   THROW 51111,'Choose an active Raw Material.',1;
  IF @VendorID IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.Vendor WHERE ID=@VendorID AND Status='Active')
   THROW 51111,'Choose an active Vendor.',1;
 END;
 IF @ID IS NULL
 BEGIN
  INSERT dbo.UnitConversion(FromUoMID,ToUoMID,Factor,PackagingMaterialID,RawMaterialID,VendorID,Status,CreatedBy)
  VALUES(@FromUoMID,@ToUoMID,@Factor,@PackagingMaterialID,@RawMaterialID,@VendorID,@Status,@Actor);
  SET @ID=SCOPE_IDENTITY();
 END
 ELSE UPDATE dbo.UnitConversion SET FromUoMID=@FromUoMID,ToUoMID=@ToUoMID,Factor=@Factor,
 PackagingMaterialID=@PackagingMaterialID,RawMaterialID=@RawMaterialID,VendorID=@VendorID,Status=@Status,
 UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@Actor WHERE ID=@ID;
 SELECT ID,RowVersion FROM dbo.UnitConversion WHERE ID=@ID;
 COMMIT;
 END TRY
 BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
 END CATCH
END;
GO
