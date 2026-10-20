-- After 123. Explicit regular/Mix layer flags; root Single derives CopyDim.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingType_Batch'));
 IF @D IS NULL OR COL_LENGTH('dbo.PackagingType','CopyDim') IS NULL THROW 52996,'Apply Packaging Type migrations through 123 first.',1;
 IF CHARINDEX(N'-- Explicit Mix layer flags (124)',@D)=0
 BEGIN
  IF CHARINDEX(N'[value] COLLATE Latin1_General_100_BIN2 NOT IN(N''Primary'',N''Secondary'',N''Tertiary'',N''Pallet'')',@D)=0 OR CHARINDEX(N'DECLARE @ChosenOrders TABLE(PackagingOrder NVARCHAR(9)',@D)=0
   THROW 52996,'Unexpected Packaging Type procedure; review before migrating.',1;
  ALTER TABLE dbo.PackagingTypeOrder DROP CONSTRAINT CK_PackagingTypeOrder_Order;
  ALTER TABLE dbo.PackagingTypeOrder DROP CONSTRAINT PK_PackagingTypeOrder;
  ALTER TABLE dbo.PackagingTypeOrder ALTER COLUMN PackagingOrder NVARCHAR(16) NOT NULL;
  ALTER TABLE dbo.PackagingTypeOrder ADD CONSTRAINT PK_PackagingTypeOrder PRIMARY KEY(PackagingTypeID,PackagingOrder);
  ALTER TABLE dbo.PackagingTypeOrder WITH CHECK ADD CONSTRAINT CK_PackagingTypeOrder_Order
   CHECK(PackagingOrder COLLATE Latin1_General_100_BIN2 IN(N'Primary',N'Secondary',N'Tertiary',N'Primary Mix',N'Secondary Mix',N'Tertiary Mix',N'Pallet'));
  -- Previously any Secondary/Tertiary root served every Mix layer. Preserve that eligibility.
  INSERT dbo.PackagingTypeOrder(PackagingTypeID,PackagingOrder)
  SELECT p.ID,m.Orders FROM dbo.PackagingType p CROSS JOIN(VALUES(N'Primary Mix'),(N'Secondary Mix'),(N'Tertiary Mix'))m(Orders)
  WHERE p.ParentTypeID IS NULL AND EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder o WHERE o.PackagingTypeID=p.ID AND o.PackagingOrder IN(N'Secondary',N'Tertiary'))
   AND NOT EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder o WHERE o.PackagingTypeID=p.ID AND o.PackagingOrder=m.Orders);
  SET @D=REPLACE(@D,N'DECLARE @ChosenOrders TABLE(PackagingOrder NVARCHAR(9)',N'DECLARE @ChosenOrders TABLE(PackagingOrder NVARCHAR(16)');
  SET @D=REPLACE(@D,N'NOT BETWEEN 1 AND 3',N'NOT BETWEEN 1 AND 7');
  SET @D=REPLACE(@D,N'Select one to three packaging orders.',N'Select one or more regular or Mix layer flags.');
  SET @D=REPLACE(@D,N'[value] COLLATE Latin1_General_100_BIN2 NOT IN(N''Primary'',N''Secondary'',N''Tertiary'',N''Pallet'')',N'[value] COLLATE Latin1_General_100_BIN2 NOT IN(N''Primary'',N''Secondary'',N''Tertiary'',N''Primary Mix'',N''Secondary Mix'',N''Tertiary Mix'',N''Pallet'')');
  SET @D=REPLACE(@D,N'SELECT TOP(1) @Order=PackagingOrder FROM @ChosenOrders',N'SELECT TOP(1) @Order=REPLACE(PackagingOrder,N'' Mix'',N'''') FROM @ChosenOrders');
  DECLARE @OldCopy NVARCHAR(MAX)=N'IF @CopyDim=1 AND (@FinalComponent=0 OR @Parent IS NOT NULL) THROW 51111,''Copy Dim. requires Single with no parent.'',1;';
  IF CHARINDEX(@OldCopy,@D)=0 THROW 52996,'Unexpected CopyDim derivation; migration rolled back.',1;
  SET @D=REPLACE(@D,@OldCopy,N'-- Explicit Mix layer flags (124)
    SET @CopyDim=CASE WHEN @FinalComponent=1 AND @Parent IS NULL THEN 1 ELSE 0 END;');
  SET @D=STUFF(@D,1,CHARINDEX(N'PROCEDURE',UPPER(@D))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
  EXEC sys.sp_executesql @D;
 END;
 EXEC sys.sp_executesql N'CREATE OR ALTER TRIGGER dbo.tr_PackagingType_DefaultOrder ON dbo.PackagingType AFTER INSERT,UPDATE AS BEGIN
 SET NOCOUNT ON;
 INSERT dbo.PackagingTypeOrder(PackagingTypeID,PackagingOrder)
 SELECT i.ID,i.PackagingOrder FROM inserted i WHERE i.ParentTypeID IS NULL
 AND NOT EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder o WHERE o.PackagingTypeID=i.ID);
END;';
 UPDATE dbo.PackagingType SET CopyDim=CASE WHEN FinalComponent=1 AND ParentTypeID IS NULL THEN 1 ELSE 0 END
 WHERE CopyDim<>CASE WHEN FinalComponent=1 AND ParentTypeID IS NULL THEN 1 ELSE 0 END;
 IF OBJECT_ID('dbo.CK_PackagingType_AutoCopyDim','C') IS NULL
  ALTER TABLE dbo.PackagingType WITH CHECK ADD CONSTRAINT CK_PackagingType_AutoCopyDim
   CHECK(CopyDim=CASE WHEN FinalComponent=1 AND ParentTypeID IS NULL THEN 1 ELSE 0 END);
 EXEC sys.sp_executesql N'CREATE OR ALTER VIEW dbo.v_PackagingTypeWeb AS
 SELECT p.*,CASE WHEN p.ParentTypeID IS NULL THEN o.PackagingOrdersJSON ELSE N''[]'' END AS PackagingOrdersJSON,
 CONVERT(BIT,CASE WHEN EXISTS(SELECT 1 FROM dbo.PackagingType c WHERE c.ParentTypeID=p.ID) THEN 1 ELSE 0 END) HasChildren,
 CONVERT(BIT,CASE WHEN p.ParentTypeID IS NULL AND EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder f WHERE f.PackagingTypeID=p.ID AND f.PackagingOrder=N''Primary'') THEN 1 ELSE 0 END) AS [Primary],
 CONVERT(BIT,CASE WHEN p.ParentTypeID IS NULL AND EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder f WHERE f.PackagingTypeID=p.ID AND f.PackagingOrder=N''Secondary'') THEN 1 ELSE 0 END) AS [Secondary],
 CONVERT(BIT,CASE WHEN p.ParentTypeID IS NULL AND EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder f WHERE f.PackagingTypeID=p.ID AND f.PackagingOrder=N''Tertiary'') THEN 1 ELSE 0 END) AS [Tertiary],
 CONVERT(BIT,CASE WHEN p.ParentTypeID IS NULL AND EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder f WHERE f.PackagingTypeID=p.ID AND f.PackagingOrder=N''Primary Mix'') THEN 1 ELSE 0 END) AS [PrimaryMix],
 CONVERT(BIT,CASE WHEN p.ParentTypeID IS NULL AND EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder f WHERE f.PackagingTypeID=p.ID AND f.PackagingOrder=N''Secondary Mix'') THEN 1 ELSE 0 END) AS [SecondaryMix],
 CONVERT(BIT,CASE WHEN p.ParentTypeID IS NULL AND EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder f WHERE f.PackagingTypeID=p.ID AND f.PackagingOrder=N''Tertiary Mix'') THEN 1 ELSE 0 END) AS [TertiaryMix],
 CONVERT(BIT,CASE WHEN p.ParentTypeID IS NULL AND EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder f WHERE f.PackagingTypeID=p.ID AND f.PackagingOrder=N''Pallet'') THEN 1 ELSE 0 END) AS [Palletization]
 FROM dbo.PackagingType p OUTER APPLY(
 SELECT N''["''+STRING_AGG(CONVERT(NVARCHAR(MAX),PackagingOrder),N''","'') WITHIN GROUP(ORDER BY PackagingOrder)+N''"]'' AS PackagingOrdersJSON
 FROM dbo.PackagingTypeOrder WHERE PackagingTypeID=p.ID) o;';
 EXEC sys.sp_executesql N'CREATE OR ALTER FUNCTION dbo.fn_PackagingTypeOrderAllowed(@TypeID INT,@LayerOrder VARCHAR(20),@MixParent BIT)
RETURNS BIT AS BEGIN
 RETURN CASE WHEN EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder o JOIN dbo.PackagingType p ON p.ID=o.PackagingTypeID
 WHERE p.ID=@TypeID AND p.ParentTypeID IS NULL AND o.PackagingOrder=CASE WHEN @MixParent=1 THEN CONCAT(@LayerOrder,N'' Mix'') ELSE @LayerOrder END) THEN 1 ELSE 0 END;
END;';
 COMMIT;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
END CATCH;
