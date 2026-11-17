-- Requires 160. Duty % and its tax lines allow four decimals; Payment term becomes free text
-- (PaymentTerm, up to 200 characters). Legacy PaymentTermDays stays valid; existing values are unchanged.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityShipment_Validate'));
 IF @D IS NULL OR CHARINDEX(N'-- Duty breakdown (160)',@D)=0
  THROW 52996,'Apply migration 160 first.',1;
 IF CHARINDEX(N'-- Duty precision and payment term (161)',@D)=0
 BEGIN
  DECLARE @Generic NVARCHAR(200)=N'''FreightUSDPerContainer'',''DutyPct'',''ImportClearanceUSDPerContainer''',
          @Range NVARCHAR(200)=N'[key] IN(''DutyPct'',''OverageShortageDamagePct''',
          @Line NVARCHAR(400)=N'AND (CHARINDEX(''.'',f.[value])=0 OR LEN(SUBSTRING(f.[value],CHARINDEX(''.'',f.[value])+1,100))<=2)))',
          @LineText NVARCHAR(200)=N'a percentage from 0 to 100 with up to two decimals.',
          @Sum NVARCHAR(200)=N'DECLARE @DutyTotal DECIMAL(19,2)=(SELECT SUM(TRY_CONVERT(DECIMAL(19,2),JSON_VALUE(d.[value],''$.Pct'')))',
          @DutyValue NVARCHAR(200)=N'TRY_CONVERT(DECIMAL(19,2),JSON_VALUE(@Value,''$.DutyPct''))',
          @LinePct NVARCHAR(200)=N'AND TRY_CONVERT(DECIMAL(19,2),NULLIF(f.[value],'''')) BETWEEN 0 AND 100';
  IF CHARINDEX(@Generic,@D)=0 OR CHARINDEX(@Range,@D)=0 OR CHARINDEX(@Line,@D)=0 OR CHARINDEX(@LineText,@D)=0
   OR CHARINDEX(@Sum,@D)=0 OR CHARINDEX(@DutyValue,@D)=0 OR CHARINDEX(@LinePct,@D)=0
   OR CHARINDEX(N'[key] NOT IN(''DutyBreakdown'',',@D)=0
   THROW 52996,'Unexpected shipment validator definition; migration 161 was not applied.',1;
  -- Duty % leaves the shared two-decimal amount rule and gets its own four-decimal rule below.
  -- @Generic also occurs in the allowed-key list; change only the numeric-rule list.
  DECLARE @Numeric INT=CHARINDEX(N'WHERE [key] IN(''FloorLoadUSDPerMT''',@D),@At INT;
  SET @At=CHARINDEX(@Generic,@D,@Numeric);
  IF @Numeric=0 OR @At=0 OR @At>CHARINDEX(N')',@D,@Numeric)
   THROW 52996,'Unexpected shipment numeric rule; migration 161 was not applied.',1;
  SET @D=STUFF(@D,@At,LEN(@Generic),N'''FreightUSDPerContainer'',''ImportClearanceUSDPerContainer''');
  SET @D=REPLACE(@D,@Range,N'[key] IN(''OverageShortageDamagePct''');
  SET @D=REPLACE(@D,@Line,N'AND (CHARINDEX(''.'',f.[value])=0 OR LEN(SUBSTRING(f.[value],CHARINDEX(''.'',f.[value])+1,100))<=4)))');
  SET @D=REPLACE(@D,@LineText,N'a percentage from 0 to 100 with up to four decimals.');
  SET @D=REPLACE(@D,@LinePct,N'AND TRY_CONVERT(DECIMAL(19,4),NULLIF(f.[value],'''')) BETWEEN 0 AND 100');
  SET @D=REPLACE(@D,@Sum,N'DECLARE @DutyTotal DECIMAL(19,4)=(SELECT SUM(TRY_CONVERT(DECIMAL(19,4),JSON_VALUE(d.[value],''$.Pct'')))');
  SET @D=REPLACE(@D,@DutyValue,N'TRY_CONVERT(DECIMAL(19,4),JSON_VALUE(@Value,''$.DutyPct''))');
  SET @D=REPLACE(@D,N'[key] NOT IN(''DutyBreakdown'',',N'[key] NOT IN(''PaymentTerm'',''DutyBreakdown'',');
  SET @D=REPLACE(@D,N'-- Duty breakdown (160)',N'-- Duty precision and payment term (161)
 IF EXISTS(SELECT 1 FROM OPENJSON(@Value) WHERE [key]=''DutyPct'' AND [type]<>0 AND
   ([type] NOT IN(1,2) OR TRY_CONVERT(DECIMAL(19,4),NULLIF([value],'''')) IS NULL OR [value] LIKE ''%[eE]%''
    OR TRY_CONVERT(DECIMAL(19,4),[value]) NOT BETWEEN 0 AND 100
    OR (CHARINDEX(''.'',[value])>0 AND LEN(SUBSTRING([value],CHARINDEX(''.'',[value])+1,100))>4)))
  THROW 52996,''Duty % must be from 0 to 100 with up to four decimals.'',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Value) WHERE [key]=''PaymentTerm'' AND [type]<>0 AND ([type]<>1 OR LEN([value])>200))
  THROW 52996,''Payment term must be text of up to 200 characters.'',1;
 -- Duty breakdown (160)');
  SET @D=STUFF(@D,1,CHARINDEX(N'PROCEDURE',UPPER(@D))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
  EXEC sys.sp_executesql @D;
 END;
 COMMIT;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
END CATCH;
