-- After 116. New customer-currency per-container clearance; historical bases retained.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityShipment_Validate'));
 IF @D IS NULL OR CHARINDEX(N'ImportClearanceCustomerPerPallet',@D)=0
  THROW 52996,'Apply shipment migrations through 102 first.',1;
 IF CHARINDEX(N'-- Customer clearance per container (117)',@D)=0
 BEGIN
  SET @D=REPLACE(@D,N'''ImportClearanceCustomerPerPallet''',N'''ImportClearanceCustomerPerContainer'',''ImportClearanceCustomerPerPallet''');
  SET @D=STUFF(@D,1,CHARINDEX(N'PROCEDURE',UPPER(@D))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
  SET @D=@D+CHAR(10)+N'-- Customer clearance per container (117)';
  EXEC sys.sp_executesql @D;
 END;
 COMMIT;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
END CATCH;
