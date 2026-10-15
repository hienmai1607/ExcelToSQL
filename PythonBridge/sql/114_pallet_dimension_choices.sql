-- After 113. Request footprint choices from current Pallet material dimensions.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 EXEC sys.sp_executesql N'
 CREATE OR ALTER VIEW dbo.v_PalletSizeChoice AS
 WITH Measurements AS (
  SELECT p.ID PriceID,m.ID MaterialID,
   MAX(CASE WHEN LOWER(LTRIM(RTRIM(v.Name)))=''length'' THEN TRY_CONVERT(DECIMAL(18,6),v.Value*CASE WHEN u.UoMCode=''mm'' THEN 1 ELSE c.Factor END) END) LengthMM,
   MAX(CASE WHEN LOWER(LTRIM(RTRIM(v.Name)))=''width'' THEN TRY_CONVERT(DECIMAL(18,6),v.Value*CASE WHEN u.UoMCode=''mm'' THEN 1 ELSE c.Factor END) END) WidthMM,
   SUM(CASE WHEN LOWER(LTRIM(RTRIM(v.Name)))=''length'' THEN 1 ELSE 0 END) LengthCount,
   SUM(CASE WHEN LOWER(LTRIM(RTRIM(v.Name)))=''width'' THEN 1 ELSE 0 END) WidthCount
  FROM dbo.PackagingPrice p
  JOIN dbo.PackagingMaterial m ON m.ID=p.MaterialID AND m.Status=''Active''
  JOIN dbo.PackagingType t ON t.ID=m.PackagingTypeID AND t.Status=''Active'' AND t.PackagingOrder=''Pallet''
  JOIN dbo.PackagingDimension d ON d.ID=p.MaterialDimensionID AND d.PackagingTypeID=t.ID AND d.Status=''Active'' AND d.RowVersion=p.MaterialDimensionRowVersion
  CROSS APPLY(VALUES(d.D1Name,p.MaterialD1,d.D1UoMID),(d.D2Name,p.MaterialD2,d.D2UoMID),(d.D3Name,p.MaterialD3,d.D3UoMID)) v(Name,Value,UnitID)
  JOIN dbo.UoM u ON u.ID=v.UnitID AND u.Status=''Active''
  OUTER APPLY dbo.fn_UnitConversion(u.UoMCode,N''mm'',NULL,NULL,NULL) c
  LEFT JOIN dbo.Vendor vendor ON vendor.ID=p.VendorID
  WHERE p.Status=''Active'' AND p.EffectiveFrom<=CONVERT(DATE,SYSUTCDATETIME())
   AND (p.EffectiveTo IS NULL OR p.EffectiveTo>=CONVERT(DATE,SYSUTCDATETIME()))
   AND (p.VendorID IS NULL OR vendor.Status=''Active'')
  GROUP BY p.ID,m.ID
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
 FROM dbo.v_PalletMaster p;';
 DECLARE @ChoiceProc SYSNAME,@ChoiceDefinition NVARCHAR(MAX);
 DECLARE choice_procedures CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM (VALUES
 (N'usp_OpportunityItem_Fields_Save'),(N'usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation')
 ) p(name);
 OPEN choice_procedures;FETCH NEXT FROM choice_procedures INTO @ChoiceProc;
 WHILE @@FETCH_STATUS=0 BEGIN
  SET @ChoiceDefinition=OBJECT_DEFINITION(OBJECT_ID(N'dbo.'+@ChoiceProc));
  IF @ChoiceDefinition IS NULL THROW 52996,'Apply earlier field migrations first.',1;
  IF CHARINDEX('v_PalletSizeChoice',@ChoiceDefinition)=0 BEGIN
   IF CHARINDEX('v_PalletMaster',@ChoiceDefinition)=0 THROW 52996,'Unexpected pallet validation; migration rolled back.',1;
   -- Only validation uses alias p. Keep legacy profile-capacity joins intact.
   SET @ChoiceDefinition=REPLACE(@ChoiceDefinition,N'dbo.v_PalletMaster p JOIN dbo.UoM u ON u.ID=p.UoMID',N'dbo.v_PalletSizeChoice p JOIN dbo.UoM u ON u.ID=p.UoMID');
   SET @ChoiceDefinition=REPLACE(@ChoiceDefinition,N'Choose an active pallet size from Pallet Master.',N'Choose an active pallet footprint from Packaging Pricing.');
   SET @ChoiceDefinition=STUFF(@ChoiceDefinition,1,CHARINDEX(N'PROCEDURE',UPPER(@ChoiceDefinition))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
   EXEC sys.sp_executesql @ChoiceDefinition;
  END;
  FETCH NEXT FROM choice_procedures INTO @ChoiceProc;
 END;
 CLOSE choice_procedures;DEALLOCATE choice_procedures;
 SET @ChoiceDefinition=OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_OpportunityPalletLookup_Read'));
 IF @ChoiceDefinition IS NULL THROW 52996,'Opportunity pallet lookup is missing.',1;
 IF CHARINDEX(N'p.LengthMM',@ChoiceDefinition)=0
  SET @ChoiceDefinition=REPLACE(@ChoiceDefinition,N'SELECT p.ID,p.PalletSize',N'SELECT p.ID,p.PalletSize,p.LengthMM,p.WidthMM');
 SET @ChoiceDefinition=REPLACE(@ChoiceDefinition,N'dbo.v_PalletMaster p',N'dbo.v_PalletSizeChoice p');
 IF CHARINDEX(N'p.ChoiceSource',@ChoiceDefinition)=0
  SET @ChoiceDefinition=REPLACE(@ChoiceDefinition,N'WHERE p.Status=',N'WHERE p.ChoiceSource=''Material'' AND p.Status=');
 SET @ChoiceDefinition=STUFF(@ChoiceDefinition,1,CHARINDEX(N'PROCEDURE',UPPER(@ChoiceDefinition))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @ChoiceDefinition;
 COMMIT;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
END CATCH;
