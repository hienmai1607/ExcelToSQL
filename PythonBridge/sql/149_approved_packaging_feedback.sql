-- After migration 148. Approved-only packaging feedback to Opportunities.
-- Publish only approved packaging responses; retain existing data and history.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 IF CHARINDEX(N'-- Incoterms and WH breakdown (148)',COALESCE(OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityShipment_Validate')),N''))=0
  THROW 52996,'Apply migration 148 before migration 149.',1;
 DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.v_OpportunityItemPackaging'));
 IF @D IS NULL THROW 52996,'Opportunity packaging publication view is missing.',1;
 IF CHARINDEX(N'-- Approved packaging feedback (149)',@D)=0
 BEGIN
  IF CHARINDEX(N'CREATE VIEW dbo.v_OpportunityItemPackaging',@D)=0
   OR CHARINDEX(N'ri.Stage<>''Canceled''',@D)=0
   OR CHARINDEX(N'ORDER BY ri.IsOpen DESC,ri.ID DESC',@D)=0
   THROW 52996,'Unexpected packaging view definition; migration 149 was not applied.',1;
  SET @D=REPLACE(@D,N'CREATE VIEW dbo.v_OpportunityItemPackaging',N'ALTER VIEW dbo.v_OpportunityItemPackaging');
  SET @D=REPLACE(@D,N'ri.Stage<>''Canceled''',N'ri.Stage=''Approved''');
  SET @D=REPLACE(@D,N'ORDER BY ri.IsOpen DESC,ri.ID DESC',N'ORDER BY ri.ID DESC');
  SET @D=N'-- Approved packaging feedback (149)'+CHAR(13)+CHAR(10)+@D;
  EXEC sys.sp_executesql @D;
 END;
 IF CHARINDEX(N'ri.Stage=''Approved''',OBJECT_DEFINITION(OBJECT_ID('dbo.v_OpportunityItemPackaging')))=0
  THROW 52996,'Approved-only packaging publication was not verified.',1;
 COMMIT;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
END CATCH;
