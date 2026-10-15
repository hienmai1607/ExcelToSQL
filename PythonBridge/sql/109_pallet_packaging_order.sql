-- Pallet is an exclusive packaging use, separate from the three product layers.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID('dbo.CK_PackagingType_Order','C') IS NOT NULL ALTER TABLE dbo.PackagingType DROP CONSTRAINT CK_PackagingType_Order;
ALTER TABLE dbo.PackagingType ADD CONSTRAINT CK_PackagingType_Order CHECK(PackagingOrder IN(N'Primary',N'Secondary',N'Tertiary',N'Pallet'));
IF OBJECT_ID('dbo.CK_PackagingTypeOrder_Order','C') IS NOT NULL ALTER TABLE dbo.PackagingTypeOrder DROP CONSTRAINT CK_PackagingTypeOrder_Order;
ALTER TABLE dbo.PackagingTypeOrder ADD CONSTRAINT CK_PackagingTypeOrder_Order CHECK(PackagingOrder IN(N'Primary',N'Secondary',N'Tertiary',N'Pallet'));
IF OBJECT_ID('dbo.CK_PackagingType_Pallet','C') IS NULL
 ALTER TABLE dbo.PackagingType ADD CONSTRAINT CK_PackagingType_Pallet CHECK(PackagingOrder<>N'Pallet' OR (ParentTypeID IS NULL AND FinalComponent=1 AND CopyDim=1 AND Shipping=0));
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingType_Batch'));
IF CHARINDEX(N'-- Pallet exclusive use',@D)=0
BEGIN
 IF CHARINDEX(N'IF @Basis IS NULL OR @Basis',@D)=0 THROW 52996,'Unexpected Packaging Type procedure.',1;
 SET @D=REPLACE(@D,N'NOT IN(N''Primary'',N''Secondary'',N''Tertiary'')',N'NOT IN(N''Primary'',N''Secondary'',N''Tertiary'',N''Pallet'')');
 SET @D=REPLACE(@D,N'IF @Basis IS NULL OR @Basis',N'-- Pallet exclusive use
    IF EXISTS(SELECT 1 FROM @ChosenOrders WHERE PackagingOrder=N''Pallet'')
      AND ((SELECT COUNT(*) FROM @ChosenOrders)<>1 OR @Parent IS NOT NULL OR @Shipping=1 OR @FinalComponent=0 OR @CopyDim=0)
      THROW 51111,''Pallet must be Single, Copy Dim., no parent, and have no other packaging orders or Shipping flag.'',1;
    IF @Parent IS NOT NULL AND EXISTS(SELECT 1 FROM dbo.PackagingType WHERE ID=@Parent AND PackagingOrder=N''Pallet'')
      THROW 51111,''A pallet cannot be a component parent.'',1;
    IF @Basis IS NULL OR @Basis');
 SET @D=STUFF(@D,1,CHARINDEX(N'PROCEDURE',UPPER(@D))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
COMMIT;
