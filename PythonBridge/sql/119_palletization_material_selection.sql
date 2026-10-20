-- After 118. Palletization is the category; only Type Pallet is a load-bearing base.
-- The internal order token Pallet is retained for historical snapshots and compatibility.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','ResponsePalletMaterialID') IS NULL
  ALTER TABLE dbo.PackagingConfigurationRequestItem ADD ResponsePalletMaterialID INT NULL REFERENCES dbo.PackagingMaterial(ID);
 IF OBJECT_ID('dbo.CK_PackagingType_Pallet','C') IS NOT NULL
  ALTER TABLE dbo.PackagingType DROP CONSTRAINT CK_PackagingType_Pallet;
 ALTER TABLE dbo.PackagingType ADD CONSTRAINT CK_PackagingType_Pallet CHECK(
  PackagingOrder<>N'Pallet' OR (ParentTypeID IS NULL AND FinalComponent=1 AND Shipping=0
  AND (PackagingType<>N'Pallet' OR CopyDim=1)));
 DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingType_Batch'));
 IF @D IS NULL THROW 52996,'Apply Packaging Type migrations first.',1;
 IF CHARINDEX(N'-- Palletization category (119)',@D)=0
 BEGIN
  SET @D=REPLACE(@D,N'OR @FinalComponent=0 OR @CopyDim=0)',N'OR @FinalComponent=0 OR (@Name=N''Pallet'' AND @CopyDim=0))');
  SET @D=REPLACE(@D,N'Pallet must be Single, Copy Dim., no parent, and have no other packaging orders or Shipping flag.',
    N'Palletization requires root Single types without Shipping or other orders. Type Pallet also requires Copy Dim.');
  SET @D=STUFF(@D,1,CHARINDEX(N'PROCEDURE',UPPER(@D))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
  SET @D=@D+CHAR(10)+N'-- Palletization category (119)';
  EXEC sys.sp_executesql @D;
 END;
 DECLARE @V NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.v_PalletSizeChoice'));
 IF @V IS NULL THROW 52996,'Apply migration 114 first.',1;
 IF CHARINDEX(N'-- Material footprint source (119)',@V)=0
 BEGIN
  SET @V=REPLACE(@V,N'p.MaterialD',N'm.MaterialD');
  SET @V=REPLACE(@V,N'AND t.PackagingOrder=''Pallet''',N'AND t.PackagingOrder=''Pallet'' AND t.PackagingType=''Pallet''');
  SET @V=STUFF(@V,1,CHARINDEX(N'VIEW',UPPER(@V))+LEN(N'VIEW')-1,N'ALTER VIEW');
  SET @V=@V+CHAR(10)+N'-- Material footprint source (119)';
  EXEC sys.sp_executesql @V;
 END;
 COMMIT;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
END CATCH;
