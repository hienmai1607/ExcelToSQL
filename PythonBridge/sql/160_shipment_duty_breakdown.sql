-- Requires 159 and shipment validator 148. Duty % may carry a tax-line breakdown; existing values are unchanged.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 IF COL_LENGTH('dbo.NPDRecipeSheet','SalesReviewStatus') IS NULL
  THROW 52996,'Apply migration 159 first.',1;
 DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityShipment_Validate'));
 IF @D IS NULL OR CHARINDEX(N'-- Incoterms and WH breakdown (148)',@D)=0
  THROW 52996,'Apply shipment migration 148 before migration 160.',1;
 IF CHARINDEX(N'-- Duty breakdown (160)',@D)=0
 BEGIN
  IF CHARINDEX(N'[key] NOT IN(''WHCostBreakdown'',',@D)=0
   OR CHARINDEX(N'DECLARE @Port INT=TRY_CONVERT(INT,JSON_VALUE(@Value,''$.PortOfEntryID''));',@D)=0
   THROW 52996,'Unexpected shipment validator definition; migration 160 was not applied.',1;
  SET @D=REPLACE(@D,N'[key] NOT IN(''WHCostBreakdown'',',N'[key] NOT IN(''DutyBreakdown'',''WHCostBreakdown'',');
  SET @D=REPLACE(@D,N'DECLARE @Port INT=TRY_CONVERT(INT,JSON_VALUE(@Value,''$.PortOfEntryID''));',N'-- Duty breakdown (160)
 IF EXISTS(SELECT 1 FROM OPENJSON(@Value) WHERE [key]=''DutyBreakdown'' AND [type] NOT IN(0,4))
  THROW 52996,''Duty breakdown must be a JSON array.'',1;
 DECLARE @Duty NVARCHAR(MAX)=JSON_QUERY(@Value,''$.DutyBreakdown'');
 IF @Duty IS NOT NULL
 BEGIN
  IF NOT EXISTS(SELECT 1 FROM OPENJSON(@Duty)) OR (SELECT COUNT(*) FROM OPENJSON(@Duty))>50
   OR EXISTS(SELECT 1 FROM OPENJSON(@Duty) WHERE [type]<>5)
   THROW 52996,''Duty breakdown needs 1 to 50 tax lines.'',1;
  IF EXISTS(SELECT 1 FROM OPENJSON(@Duty) d CROSS APPLY OPENJSON(d.[value]) f WHERE f.[key] NOT IN(''TaxType'',''Pct''))
   OR EXISTS(SELECT 1 FROM OPENJSON(@Duty) d CROSS APPLY OPENJSON(d.[value]) f GROUP BY d.[key],f.[key] HAVING COUNT(*)>1)
   THROW 52996,''Unknown or duplicate Duty breakdown field.'',1;
  IF EXISTS(SELECT 1 FROM OPENJSON(@Duty) d WHERE
     NOT EXISTS(SELECT 1 FROM OPENJSON(d.[value]) f WHERE f.[key]=''TaxType'' AND f.[type]=1 AND LEN(LTRIM(RTRIM(f.[value]))) BETWEEN 1 AND 100)
     OR NOT EXISTS(SELECT 1 FROM OPENJSON(d.[value]) f WHERE f.[key]=''Pct'' AND f.[type] IN(1,2)
       AND TRY_CONVERT(DECIMAL(19,2),NULLIF(f.[value],'''')) BETWEEN 0 AND 100 AND f.[value] NOT LIKE ''%[eE]%''
       AND (CHARINDEX(''.'',f.[value])=0 OR LEN(SUBSTRING(f.[value],CHARINDEX(''.'',f.[value])+1,100))<=2)))
   THROW 52996,''Each Duty tax line needs a Tax type (up to 100 characters) and a percentage from 0 to 100 with up to two decimals.'',1;
  DECLARE @DutyTotal DECIMAL(19,2)=(SELECT SUM(TRY_CONVERT(DECIMAL(19,2),JSON_VALUE(d.[value],''$.Pct''))) FROM OPENJSON(@Duty) d);
  IF @DutyTotal>100
   THROW 52996,''Duty tax lines must not exceed 100% in total.'',1;
  IF TRY_CONVERT(DECIMAL(19,2),JSON_VALUE(@Value,''$.DutyPct'')) IS NULL
   OR TRY_CONVERT(DECIMAL(19,2),JSON_VALUE(@Value,''$.DutyPct''))<>@DutyTotal
   THROW 52996,''Duty % must match the sum of its tax lines.'',1;
 END;
 DECLARE @Port INT=TRY_CONVERT(INT,JSON_VALUE(@Value,''$.PortOfEntryID''));');
  SET @D=STUFF(@D,1,CHARINDEX(N'PROCEDURE',UPPER(@D))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
  EXEC sys.sp_executesql @D;
 END;
 COMMIT;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
END CATCH;
