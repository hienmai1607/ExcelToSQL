-- After 101. Select the intended application database. No saved costs are reinterpreted.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityShipment_Validate'));
IF @D IS NULL THROW 52996,'Apply migration 89 first.',1;
IF CHARINDEX(N'-- Shipment revised units.',@D)=0
BEGIN
 SET @D=REPLACE(@D,CHAR(13),N'');
 SET @D=REPLACE(@D,N'[key] NOT IN(''Incoterm''',N'[key] NOT IN(''FloorLoadUSDPerMT'',''ImportClearanceCustomerPerPallet'',''InterestDays'',''PaymentTermDays'',''MarginUSDPerLb'',''MarginMode'',''Incoterm''');
 SET @D=REPLACE(@D,N'[key] IN(''FreightUSDPerContainer''',N'[key] IN(''FloorLoadUSDPerMT'',''ImportClearanceCustomerPerPallet'',''InterestDays'',''PaymentTermDays'',''MarginUSDPerLb'',''FreightUSDPerContainer''');
 SET @D=REPLACE(@D,N'[key]=''InterestMonths''',N'[key] IN(''InterestMonths'',''InterestDays'',''PaymentTermDays'')');
 SET @D=REPLACE(@D,N'DECLARE @Port INT',N'-- Shipment revised units.
 IF EXISTS(SELECT 1 FROM OPENJSON(@Value) WHERE [key]=''MarginMode'' AND [type]<>0 AND ([type]<>1 OR [value] NOT IN(''Percent'',''USDPerLb'')))
 THROW 52996,''Choose a valid Margin basis.'',1;
 IF JSON_VALUE(@Value,''$.MarginPct'') IS NOT NULL AND JSON_VALUE(@Value,''$.MarginUSDPerLb'') IS NOT NULL
 OR JSON_VALUE(@Value,''$.MarginMode'')=''Percent'' AND JSON_VALUE(@Value,''$.MarginUSDPerLb'') IS NOT NULL
 OR JSON_VALUE(@Value,''$.MarginMode'')=''USDPerLb'' AND JSON_VALUE(@Value,''$.MarginPct'') IS NOT NULL
 THROW 52996,''Choose one Margin basis with its matching value.'',1;
 DECLARE @Port INT');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
COMMIT TRANSACTION;
GO
