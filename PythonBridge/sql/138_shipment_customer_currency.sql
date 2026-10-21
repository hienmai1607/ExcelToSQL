-- After 137. Select the intended application database; saved amounts are not rewritten.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityShipment_Validate'));
 IF @D IS NULL OR CHARINDEX(N'ImportClearanceCustomerPerContainer',@D)=0
  OR CHARINDEX(N'DECLARE @Port INT',@D)=0
  THROW 52996,'Apply shipment migrations through 117 before migration 138.',1;
 IF CHARINDEX(N'-- Shipment customer currency (138)',@D)=0
 BEGIN
  SET @D=REPLACE(@D,N'''InitialDesignUSD''',N'''InitialDesignUSD'',''InitialDesignCustomer'',''PortToWHCustomerPerContainer'',''WHCostCustomerPerPallet''');
  SET @D=REPLACE(@D,N'DECLARE @Port INT',N'-- Shipment customer currency (138)
 IF JSON_VALUE(@Value,''$.InitialDesignUSD'') IS NOT NULL AND JSON_VALUE(@Value,''$.InitialDesignCustomer'') IS NOT NULL
  THROW 52996,''Choose USD or customer currency for Initial Design, not both.'',1;
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
