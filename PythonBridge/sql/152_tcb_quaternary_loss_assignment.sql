-- After migration 151. Allow the fourth item-owned packaging loss in TCB saves.
-- No business rows, pricing snapshots or loss assignments are rewritten.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 IF CHARINDEX(N'-- Material availability independent of pricing (151)',COALESCE(OBJECT_DEFINITION(OBJECT_ID('dbo.v_PalletSizeChoice')),N''))=0
  THROW 52996,'Apply migration 151 before migration 152.',1;
 DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityTCB_Save'));
 IF @D IS NULL THROW 52996,'TCB save procedure is missing.',1;
 IF CHARINDEX(N'-- Quaternary TCB loss assignments (152)',@D)=0
 BEGIN
  DECLARE @Before NVARCHAR(MAX)=N'assigned.ProcessType IN(''PrimaryPackaging'',''SecondaryPackaging'',''TertiaryPackaging'',''MixPrimaryPackaging'',''MixSecondaryPackaging'',''MixTertiaryPackaging'')';
  DECLARE @After NVARCHAR(MAX)=N'assigned.ProcessType IN(''PrimaryPackaging'',''SecondaryPackaging'',''TertiaryPackaging'',''QuaternaryPackaging'',''MixPrimaryPackaging'',''MixSecondaryPackaging'',''MixTertiaryPackaging'')';
  DECLARE @LegacyBefore NVARCHAR(MAX)=N'WHEN ''TertiaryPackaging'' THEN ''$.Inputs.TertiaryLossPct'' WHEN ''MixPrimaryPackaging''';
  DECLARE @LegacyAfter NVARCHAR(MAX)=N'WHEN ''TertiaryPackaging'' THEN ''$.Inputs.TertiaryLossPct'' WHEN ''QuaternaryPackaging'' THEN ''$.Inputs.QuaternaryLossPct'' WHEN ''MixPrimaryPackaging''';
  IF LEN(@D)-LEN(REPLACE(@D,@Before,N''))<>LEN(@Before)
   OR LEN(@D)-LEN(REPLACE(@D,@LegacyBefore,N''))<>LEN(@LegacyBefore)
   THROW 52996,'Unexpected TCB loss validation definition; migration 152 was not applied.',1;
  SET @D=REPLACE(REPLACE(@D,@Before,@After),@LegacyBefore,@LegacyAfter);
  SET @D=STUFF(@D,1,CHARINDEX(N'PROCEDURE',UPPER(@D))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
  SET @D=@D+CHAR(10)+N'-- Quaternary TCB loss assignments (152)';
  EXEC sys.sp_executesql @D;
 END;
 COMMIT;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
END CATCH;
