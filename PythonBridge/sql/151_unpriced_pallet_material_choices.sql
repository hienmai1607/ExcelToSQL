-- After migration 150. Active pallet materials remain selectable before pricing.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 IF OBJECT_ID('dbo.CK_PackagingMaterial_TareMassUnit','C') IS NULL
  THROW 52996,'Apply migration 150 before migration 151.',1;
 EXEC sys.sp_executesql N'CREATE OR ALTER VIEW dbo.v_PalletSizeChoice AS
 WITH Measurements AS (
  SELECT m.ID MaterialID,
   MAX(CASE WHEN LOWER(LTRIM(RTRIM(v.Name)))=''length'' THEN TRY_CONVERT(DECIMAL(18,6),v.Value*CASE WHEN u.UoMCode=''mm'' THEN 1 ELSE c.Factor END) END) LengthMM,
   MAX(CASE WHEN LOWER(LTRIM(RTRIM(v.Name)))=''width'' THEN TRY_CONVERT(DECIMAL(18,6),v.Value*CASE WHEN u.UoMCode=''mm'' THEN 1 ELSE c.Factor END) END) WidthMM,
   SUM(CASE WHEN LOWER(LTRIM(RTRIM(v.Name)))=''length'' THEN 1 ELSE 0 END) LengthCount,
   SUM(CASE WHEN LOWER(LTRIM(RTRIM(v.Name)))=''width'' THEN 1 ELSE 0 END) WidthCount
  FROM dbo.PackagingMaterial m
  JOIN dbo.PackagingType t ON t.ID=m.PackagingTypeID AND t.Status=''Active'' AND t.PackagingOrder=''Pallet'' AND t.PackagingType=''Pallet''
  JOIN dbo.PackagingDimension d ON d.ID=m.MaterialDimensionID AND d.PackagingTypeID=t.ID AND d.Status=''Active'' AND d.RowVersion=m.MaterialDimensionRowVersion
  CROSS APPLY(VALUES(d.D1Name,m.MaterialD1,d.D1UoMID),(d.D2Name,m.MaterialD2,d.D2UoMID),(d.D3Name,m.MaterialD3,d.D3UoMID)) v(Name,Value,UnitID)
  JOIN dbo.UoM u ON u.ID=v.UnitID AND u.Status=''Active''
  OUTER APPLY dbo.fn_UnitConversion(u.UoMCode,N''mm'',NULL,NULL,NULL) c
  WHERE m.Status=''Active''
  GROUP BY m.ID
 ), Footprints AS (
  SELECT MIN(MaterialID) ID,LengthMM,WidthMM FROM Measurements
  WHERE LengthMM>0 AND LengthMM<=20000 AND WidthMM>0 AND WidthMM<=20000 AND LengthCount=1 AND WidthCount=1
  GROUP BY LengthMM,WidthMM
 ), Names AS (
  SELECT ID,LengthMM,WidthMM,
   RTRIM(REPLACE(RTRIM(REPLACE(CONVERT(VARCHAR(30),LengthMM),''0'','' '')), '' '',''0'')) L,
   RTRIM(REPLACE(RTRIM(REPLACE(CONVERT(VARCHAR(30),WidthMM),''0'','' '')), '' '',''0'')) W
  FROM Footprints
 )
 SELECT n.ID,CONVERT(NVARCHAR(100),CONCAT(CASE WHEN RIGHT(n.L,1)=''.'' THEN LEFT(n.L,LEN(n.L)-1) ELSE n.L END,N''x'',CASE WHEN RIGHT(n.W,1)=''.'' THEN LEFT(n.W,LEN(n.W)-1) ELSE n.W END,N''mm'')) PalletSize,
  n.LengthMM,n.WidthMM,n.LengthMM*n.WidthMM PalletAreaMM2,mm.ID UoMID,CONVERT(VARCHAR(10),''Active'') Status,
  CONVERT(VARCHAR(10),''Material'') ChoiceSource,
  CONVERT(INT,NULL) PalletsPer20DC,CONVERT(INT,NULL) PalletsPer40DC,CONVERT(INT,NULL) PalletsPer40HC,CONVERT(INT,NULL) PalletsPer20RC,CONVERT(INT,NULL) PalletsPer40RHC
 FROM Names n JOIN dbo.UoM mm ON mm.UoMCode=''mm'' AND mm.Status=''Active''
 UNION ALL
 SELECT -p.ID,p.PalletSize,TRY_CONVERT(DECIMAL(18,6),p.Length*p.FactorToMM),TRY_CONVERT(DECIMAL(18,6),p.Width*p.FactorToMM),
  p.PalletAreaMM2,p.UoMID,p.Status,''Legacy'',p.PalletsPer20DC,p.PalletsPer40DC,p.PalletsPer40HC,p.PalletsPer20RC,p.PalletsPer40RHC
 FROM dbo.v_PalletMaster p;
-- Material footprint source (119)
-- Material availability independent of pricing (151)';
 COMMIT;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
END CATCH;
