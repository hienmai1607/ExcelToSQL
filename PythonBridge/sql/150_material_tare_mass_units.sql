-- After migration 149. Approved for desktop application on 2026-10-28.
-- New tare bases store the mass unit; denominator is material Base UoM.
-- Retain legacy bases and amounts without rewriting existing records/snapshots.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 IF CHARINDEX(N'-- Approved packaging feedback (149)',COALESCE(OBJECT_DEFINITION(OBJECT_ID('dbo.v_OpportunityItemPackaging')),N''))=0
  THROW 52996,'Apply migration 149 before migration 150.',1;
 IF COL_LENGTH('dbo.PackagingMaterial','TareWeightBasis') IS NULL
  THROW 52996,'Material tare columns are missing.',1;
 IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.PackagingMaterial') AND name='CK_PackagingMaterial_TareMassUnit')
 BEGIN
  IF EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.PackagingMaterial') AND name='CK_PackagingMaterial_TareWeight')
   ALTER TABLE dbo.PackagingMaterial DROP CONSTRAINT CK_PackagingMaterial_TareWeight;
  ALTER TABLE dbo.PackagingMaterial WITH CHECK ADD CONSTRAINT CK_PackagingMaterial_TareMassUnit CHECK
   ((TareWeight IS NULL AND TareWeightBasis IS NULL) OR
    (TareWeight IS NOT NULL AND TareWeight>=0 AND TareWeightBasis IS NOT NULL AND TareWeightBasis IN('g','kg','kg/EA','kg/m2')));
 END;
 COMMIT;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
END CATCH;
