-- Requires shipment customer-currency migration 138. Existing amounts are unchanged.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityShipment_Validate'));
 IF @D IS NULL OR CHARINDEX(N'-- Shipment customer currency (138)',@D)=0
  THROW 52996,'Apply shipment migrations through 138 before migration 148.',1;
 IF CHARINDEX(N'-- Incoterms and WH breakdown (148)',@D)=0
 BEGIN
  IF CHARINDEX(N'[value] NOT IN(''CFA'',''DDP'',''EXW'',''FOB'')',@D)=0
   OR CHARINDEX(N'[key] NOT IN(''FloorLoadUSDPerMT''',@D)=0
   OR CHARINDEX(N'DECLARE @Port INT',@D)=0
   THROW 52996,'Unexpected shipment validator definition; migration 148 was not applied.',1;
  SET @D=REPLACE(@D,N'[value] NOT IN(''CFA'',''DDP'',''EXW'',''FOB'')',N'[value] NOT IN(''CFA'',''CFR'',''CIF'',''CIP'',''CPT'',''DAP'',''DDP'',''DPU'',''EXW'',''FAS'',''FCA'',''FOB'')');
  SET @D=REPLACE(@D,N'[key] NOT IN(''FloorLoadUSDPerMT''',N'[key] NOT IN(''WHCostBreakdown'',''FloorLoadUSDPerMT''');
  SET @D=REPLACE(@D,N'DECLARE @Port INT',N'-- Incoterms and WH breakdown (148)
 IF EXISTS(SELECT 1 FROM OPENJSON(@Value) WHERE [key]=''WHCostBreakdown'' AND [type] NOT IN(0,5))
  THROW 52996,''WH Cost breakdown must be a JSON object.'',1;
 DECLARE @WH NVARCHAR(MAX)=JSON_QUERY(@Value,''$.WHCostBreakdown'');
 IF @WH IS NOT NULL
 BEGIN
  IF EXISTS(SELECT 1 FROM OPENJSON(@WH) WHERE [key] NOT IN(''Unloading'',''Palletize'',''Inbound'',''Outbound'',''StorageCostPerMonth'',''StorageMonths'',''OrderFeeAdminCost'',''OthersCost''))
   OR EXISTS(SELECT [key] FROM OPENJSON(@WH) GROUP BY [key] HAVING COUNT(*)>1)
   THROW 52996,''Unknown or duplicate WH Cost breakdown field.'',1;
  IF EXISTS(SELECT 1 FROM OPENJSON(@WH) WHERE [type] NOT IN(1,2) OR TRY_CONVERT(DECIMAL(19,2),NULLIF([value],'''')) IS NULL
    OR TRY_CONVERT(DECIMAL(19,2),[value])<0 OR [value] LIKE ''%[eE]%''
    OR (CHARINDEX(''.'',[value])>0 AND LEN(SUBSTRING([value],CHARINDEX(''.'',[value])+1,100))>2))
   THROW 52996,''WH Cost inputs must be nonnegative amounts with up to two decimals.'',1;
  DECLARE @Storage DECIMAL(19,0)=CONVERT(DECIMAL(19,0),COALESCE(TRY_CONVERT(DECIMAL(19,2),JSON_VALUE(@WH,''$.StorageCostPerMonth'')),0)*100),
          @Months DECIMAL(19,0)=CONVERT(DECIMAL(19,0),COALESCE(TRY_CONVERT(DECIMAL(19,2),JSON_VALUE(@WH,''$.StorageMonths'')),0)*100),
          @Fixed DECIMAL(38,0),@Scaled DECIMAL(38,0),@Total DECIMAL(19,2);
  SELECT @Fixed=COALESCE(SUM(CONVERT(DECIMAL(19,0),TRY_CONVERT(DECIMAL(19,2),[value])*100)),0)
   FROM OPENJSON(@WH) WHERE [key] NOT IN(''StorageCostPerMonth'',''StorageMonths'');
  SET @Scaled=@Fixed*100+@Storage*@Months;
  IF @Scaled>999999999999999999949 THROW 52996,''WH Cost exceeds the supported amount.'',1;
  SET @Total=CONVERT(DECIMAL(19,2),FLOOR((@Scaled+50)/100)/100);
  IF JSON_VALUE(@Value,''$.WHCostCustomerPerPallet'') IS NULL
   OR TRY_CONVERT(DECIMAL(19,2),JSON_VALUE(@Value,''$.WHCostCustomerPerPallet''))<>@Total
   OR JSON_VALUE(@Value,''$.WHCostUSDPerPallet'') IS NOT NULL
   THROW 52996,''WH Cost must match its customer-currency calculation breakdown.'',1;
 END;
 DECLARE @Port INT');
  SET @D=STUFF(@D,1,CHARINDEX(N'PROCEDURE',UPPER(@D))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
  EXEC sys.sp_executesql @D;
 END;
 COMMIT;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
END CATCH;
