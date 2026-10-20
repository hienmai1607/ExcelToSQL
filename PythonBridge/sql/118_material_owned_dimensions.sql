-- After 117. Material is the sole owner of physical measurements.
-- Price columns are retained only for historical compatibility, not new editing.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 IF COL_LENGTH('dbo.PackagingMaterial','MaterialDimensionID') IS NULL
 BEGIN
  ALTER TABLE dbo.PackagingMaterial ADD
   MaterialDimensionID INT NULL REFERENCES dbo.PackagingDimension(ID),
   MaterialDimensionRowVersion BINARY(8) NULL,
   MaterialD1 DECIMAL(18,6) NULL,MaterialD2 DECIMAL(18,6) NULL,MaterialD3 DECIMAL(18,6) NULL,
   MaterialDimensionsNeedsReview BIT NOT NULL CONSTRAINT DF_Material_DimReview DEFAULT(0);
  EXEC(N'
   ;WITH Choices AS(
    SELECT DISTINCT MaterialID,MaterialDimensionID,MaterialDimensionRowVersion,MaterialD1,MaterialD2,MaterialD3
    FROM dbo.PackagingPrice WHERE MaterialDimensionID IS NOT NULL
   ), Counts AS(SELECT MaterialID,COUNT(*) N FROM Choices GROUP BY MaterialID)
   UPDATE m SET MaterialDimensionID=c.MaterialDimensionID,MaterialDimensionRowVersion=c.MaterialDimensionRowVersion,
    MaterialD1=c.MaterialD1,MaterialD2=c.MaterialD2,MaterialD3=c.MaterialD3,
    MaterialDimensionsNeedsReview=CASE WHEN c.MaterialDimensionRowVersion=d.RowVersion THEN 0 ELSE 1 END
   FROM dbo.PackagingMaterial m JOIN Counts n ON n.MaterialID=m.ID AND n.N=1
   JOIN Choices c ON c.MaterialID=m.ID JOIN dbo.PackagingDimension d ON d.ID=c.MaterialDimensionID;
   UPDATE m SET MaterialDimensionsNeedsReview=1 FROM dbo.PackagingMaterial m
   WHERE m.MaterialDimensionID IS NULL AND EXISTS(SELECT 1 FROM dbo.PackagingPrice p WHERE p.MaterialID=m.ID
    AND (p.MaterialDimensionID IS NOT NULL OR p.SupplierDimensionID IS NOT NULL));
   ALTER TABLE dbo.PackagingMaterial ADD CONSTRAINT CK_Material_DimValues CHECK(
    (MaterialDimensionID IS NOT NULL OR (MaterialD1 IS NULL AND MaterialD2 IS NULL AND MaterialD3 IS NULL))
    AND (MaterialD1 IS NULL OR MaterialD1>0) AND (MaterialD2 IS NULL OR MaterialD2>0) AND (MaterialD3 IS NULL OR MaterialD3>0));
  ');
 END;
 COMMIT;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
END CATCH;
