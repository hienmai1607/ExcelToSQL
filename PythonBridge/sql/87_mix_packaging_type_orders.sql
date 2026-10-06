USE [test];
GO
-- After 86: mix parent layers use Secondary/Tertiary master types.
-- Preserve saved choices and all request/pricing history.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','ProductMixSnapshot') IS NULL
 THROW 52993,'Apply migration 86 before mix packaging type orders.',1;
GO
CREATE OR ALTER FUNCTION dbo.fn_OpportunityIsMixParent(@ItemID INT)
RETURNS BIT
AS
BEGIN
 RETURN CASE WHEN EXISTS(SELECT 1 FROM dbo.OpportunityItem i
  JOIN dbo.OpportunityMixSnapshot m ON m.ParentItemID=i.ID
  WHERE i.ID=@ItemID AND i.ParentItemID IS NULL) THEN 1 ELSE 0 END;
END;
GO
CREATE OR ALTER FUNCTION dbo.fn_PackagingTypeOrderAllowed(
 @TypeID INT,@LayerOrder VARCHAR(20),@MixParent BIT)
RETURNS BIT
AS
BEGIN
 RETURN CASE WHEN EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder o
  WHERE o.PackagingTypeID=@TypeID AND
   ((@MixParent=1 AND o.PackagingOrder IN('Secondary','Tertiary'))
    OR (@MixParent=0 AND o.PackagingOrder=@LayerOrder))) THEN 1 ELSE 0 END;
END;
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_OpportunityItem_Fields_Save'));
IF @D IS NULL OR CHARINDEX(N'-- Mix parent logistics.',@D)=0
 THROW 52993,'Apply migration 86 request validation first.',1;
IF CHARINDEX(N'-- Mix parent packaging orders.',@D)=0 BEGIN
 DECLARE @Choice NVARCHAR(MAX)=N'EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder o WHERE o.PackagingTypeID=p.ID AND o.PackagingOrder=CASE [key] WHEN ''PrimaryTypeID'' THEN ''Primary'' WHEN ''SecondaryTypeID'' THEN ''Secondary'' ELSE ''Tertiary'' END)',
  @Final NVARCHAR(MAX)=N'EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder o WHERE o.PackagingTypeID=t.ID AND o.PackagingOrder=CASE WHEN @Layers=2 THEN ''Secondary'' ELSE ''Tertiary'' END)';
 IF CHARINDEX(@Choice,@D)=0 OR CHARINDEX(@Final,@D)=0
  THROW 52993,'Unexpected Opportunity type validation signature.',1;
 SET @D=REPLACE(@D,@Choice,N'dbo.fn_PackagingTypeOrderAllowed(p.ID,CASE [key] WHEN ''PrimaryTypeID'' THEN ''Primary'' WHEN ''SecondaryTypeID'' THEN ''Secondary'' ELSE ''Tertiary'' END,dbo.fn_OpportunityIsMixParent(@ID))=1');
 SET @D=REPLACE(@D,@Final,N'dbo.fn_PackagingTypeOrderAllowed(t.ID,CASE WHEN @Layers=2 THEN ''Secondary'' ELSE ''Tertiary'' END,dbo.fn_OpportunityIsMixParent(i.ID))=1');
 SET @D=REPLACE(@D,N'-- Shipping final request.',N'-- Mix parent packaging orders.
 -- Shipping final request.');
 SET @D=REPLACE(@D,N'Choose an active top-level Packaging Type with the matching Order.',N'Choose an active top-level Packaging Type: Secondary/Tertiary for mix parents, matching order for other Products.');
 SET @D=REPLACE(@D,N'The final packaging layer requires a Shipping type in the matching order.',N'The final packaging layer requires an eligible Shipping type.');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation'));
IF @D IS NULL OR CHARINDEX(N'-- Mix parent response logistics.',@D)=0
 THROW 52993,'Apply migration 86 response validation first.',1;
IF CHARINDEX(N'-- Mix parent packaging orders.',@D)=0 BEGIN
 DECLARE @Choice NVARCHAR(MAX)=N'EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder o WHERE o.PackagingTypeID=dbo.PackagingType.ID AND o.PackagingOrder=v.PackagingOrder)',
  @Final NVARCHAR(MAX)=N'EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder o WHERE o.PackagingTypeID=t.ID AND o.PackagingOrder=CASE WHEN @Layers=2 THEN ''Secondary'' ELSE ''Tertiary'' END)';
 IF CHARINDEX(@Choice,@D)=0 OR CHARINDEX(@Final,@D)=0
  THROW 52993,'Unexpected response type validation signature.',1;
 SET @D=REPLACE(@D,@Choice,N'dbo.fn_PackagingTypeOrderAllowed(dbo.PackagingType.ID,v.PackagingOrder,(SELECT dbo.fn_OpportunityIsMixParent(OpportunityItemID) FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ID))=1');
 SET @D=REPLACE(@D,@Final,N'dbo.fn_PackagingTypeOrderAllowed(t.ID,CASE WHEN @Layers=2 THEN ''Secondary'' ELSE ''Tertiary'' END,dbo.fn_OpportunityIsMixParent(i.OpportunityItemID))=1');
 SET @D=REPLACE(@D,N'-- Shipping final response.',N'-- Mix parent packaging orders.
 -- Shipping final response.');
 SET @D=REPLACE(@D,N'Choose an active Primary, Secondary or Tertiary Type in the matching Packaging Type Master order.',N'Choose an active top-level Packaging Type: Secondary/Tertiary for mix parents, matching order for other Products.');
 SET @D=REPLACE(@D,N'The final packaging layer requires a Shipping type in the matching order.',N'The final packaging layer requires an eligible Shipping type.');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PkgPricing_Save'));
IF @D IS NULL THROW 52993,'Pricing save procedure is missing.',1;
IF CHARINDEX(N'fn_PackagingTypeOrderAllowed',@D)=0 BEGIN
 DECLARE @Choice NVARCHAR(MAX)=N'EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder o WHERE o.PackagingTypeID=dbo.PackagingType.ID AND o.PackagingOrder=@Order)';
 IF CHARINDEX(@Choice,@D)=0 THROW 52993,'Unexpected pricing type validation signature.',1;
 SET @D=REPLACE(@D,@Choice,N'dbo.fn_PackagingTypeOrderAllowed(dbo.PackagingType.ID,@Order,(SELECT dbo.fn_OpportunityIsMixParent(OpportunityItemID) FROM dbo.PackagingConfigurationRequestItem WHERE ID=@ItemID))=1');
 SET @D=REPLACE(@D,N'Choose an active Packaging Type in the matching order.',N'Choose an active Packaging Type: Secondary/Tertiary for mix parents, matching order for other Products.');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
COMMIT;
GO
