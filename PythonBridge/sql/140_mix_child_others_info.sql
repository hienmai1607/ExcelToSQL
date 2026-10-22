-- After 139. Child-owned Others Info; existing amounts are preserved, not redistributed.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @D NVARCHAR(MAX)=REPLACE(OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityShipment_Validate')),CHAR(13),N'');
 IF @D IS NULL OR CHARINDEX(N'-- Shipment customer currency (138)',@D)=0
  THROW 52996,'Apply shipment migrations through 138 before migration 140.',1;
 IF CHARINDEX(N'-- Mix child Others ownership (140)',@D)=0
 BEGIN
  DECLARE @Guard NVARCHAR(MAX)=N' IF EXISTS(SELECT 1 FROM dbo.OpportunityItem WHERE ID=@ID AND ParentItemID IS NOT NULL)
  THROW 52996,''Shipment, Logistics, Co-Man and Others belong to the Mix parent.'',1;';
  IF CHARINDEX(@Guard,@D)=0 THROW 52996,'Unexpected shipment ownership guard; migration 140 not applied.',1;
  SET @D=REPLACE(@D,@Guard,N' -- Mix child Others ownership (140)
 IF EXISTS(SELECT 1 FROM dbo.OpportunityItem WHERE ID=@ID AND ParentItemID IS NOT NULL)
  AND EXISTS(SELECT 1 FROM OPENJSON(@Value) WHERE [type]<>0 AND [key] NOT IN
   (''PackingUSDPerLb'',''InitialDesignUSD'',''InitialDesignCustomer'',''OtherFixedCostsUSD'',''InterestPct'',''InterestDays'',''InterestMonths'',''MarginPct'',''MarginMode'',''MarginUSDPerLb''))
  THROW 52996,''Mix children maintain only Others Info; shared shipment and logistics belong to the parent.'',1;
 IF EXISTS(SELECT 1 FROM dbo.OpportunityMixSnapshot WHERE ParentItemID=@ID)
  AND EXISTS(SELECT 1 FROM OPENJSON(@Value) WHERE [type]<>0 AND [key] IN
   (''PackingUSDPerLb'',''InitialDesignUSD'',''InitialDesignCustomer'',''OtherFixedCostsUSD'',''InterestPct'',''InterestDays'',''InterestMonths'',''MarginPct'',''MarginMode'',''MarginUSDPerLb''))
  THROW 52996,''Maintain packing, design, fixed costs, interest and margin on each Mix child, not the parent.'',1;');
  SET @D=STUFF(@D,1,CHARINDEX(N'PROCEDURE',UPPER(@D))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
  EXEC sys.sp_executesql @D;
 END;
 SET @D=REPLACE(OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityItem_Fields_Save')),CHAR(13),N'');
 IF @D IS NULL THROW 52996,'Opportunity fields save procedure is missing.',1;
 IF CHARINDEX(N'-- Mix child Others save (140)',@D)=0
 BEGIN
  DECLARE @SaveGuard NVARCHAR(MAX)=N'  IF EXISTS(SELECT 1 FROM dbo.OpportunityItem WHERE ID=@ID AND ParentItemID IS NOT NULL)
   THROW 52996,''Shipment, Logistics, Co-Man and Others belong to the Mix parent.'',1;';
  IF CHARINDEX(@SaveGuard,@D)=0 OR CHARINDEX(N'EXEC dbo.usp_OpportunityShipment_Validate',@D)=0
   THROW 52996,'Unexpected shipment save guard; migration 140 not applied.',1;
  SET @D=REPLACE(@D,@SaveGuard,N'  -- Mix child Others save (140): the validator enforces field ownership.');
  SET @D=STUFF(@D,1,CHARINDEX(N'PROCEDURE',UPPER(@D))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
  EXEC sys.sp_executesql @D;
 END;
 COMMIT;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
END CATCH;
