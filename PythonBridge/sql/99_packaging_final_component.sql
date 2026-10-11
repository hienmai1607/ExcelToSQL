-- After 98. Run in the intended database, stopping on errors.
-- Explicit material-assignment eligibility; keep all saved pricing/PCR snapshots.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
-- The legacy hierarchy trigger must not reject flag-only edits because of unrelated old geometry.
DECLARE @Hierarchy NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.tr_PackagingType_ShippingDimensions'));
IF @Hierarchy IS NOT NULL AND CHARINDEX(N'-- Actual hierarchy changes only.',@Hierarchy)=0
BEGIN
 DECLARE @OldHierarchy NVARCHAR(MAX)=N'IF EXISTS(SELECT 1 FROM dbo.PackagingDimension d JOIN dbo.v_PackagingTypeDimensionContext t';
 IF CHARINDEX(@OldHierarchy,@Hierarchy)=0 THROW 52999,'Unexpected Packaging Type hierarchy trigger.',1;
 SET @Hierarchy=REPLACE(@Hierarchy,@OldHierarchy,N'-- Actual hierarchy changes only.
 IF EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON d.ID=i.ID WHERE ISNULL(i.ParentTypeID,0)<>ISNULL(d.ParentTypeID,0))
 AND EXISTS(SELECT 1 FROM dbo.PackagingDimension d JOIN dbo.v_PackagingTypeDimensionContext t');
 SET @Hierarchy=REPLACE(REPLACE(REPLACE(@Hierarchy,N'CREATE OR ALTER TRIGGER',N'ALTER TRIGGER'),N'CREATE   TRIGGER',N'ALTER TRIGGER'),N'CREATE TRIGGER',N'ALTER TRIGGER');
 EXEC sys.sp_executesql @Hierarchy;
END;
IF COL_LENGTH('dbo.PackagingType','FinalComponent') IS NULL
BEGIN
 EXEC sys.sp_executesql N'CREATE OR ALTER TRIGGER dbo.tr_PackagingType_FormulaRoleScope
 ON dbo.PackagingType AFTER INSERT,UPDATE AS
 BEGIN
  SET NOCOUNT ON;
  DECLARE @Affected TABLE(ID INT PRIMARY KEY);
  ;WITH affected AS (
   SELECT i.ID FROM inserted i LEFT JOIN deleted d ON d.ID=i.ID
   WHERE ISNULL(i.ParentTypeID,0)<>ISNULL(d.ParentTypeID,0) OR i.Shipping<>ISNULL(d.Shipping,0)
   UNION ALL SELECT t.ID FROM dbo.PackagingType t JOIN affected a ON t.ParentTypeID=a.ID
  ) INSERT @Affected SELECT DISTINCT ID FROM affected OPTION(MAXRECURSION 100);
  IF EXISTS(SELECT 1 FROM dbo.PackagingDimension d JOIN dbo.v_PackagingTypeDimensionContext t ON t.ID=d.PackagingTypeID
   JOIN @Affected a ON a.ID=t.ID
   WHERE (d.OccupiedM2Formula IS NOT NULL OR d.OccupiedM3Formula IS NOT NULL)
    AND (t.ParentTypeID IS NOT NULL OR t.RootShipping<>1))
   THROW 51111,''Clear occupied formulas before removing Shipping from their parent type.'',1;
 END;';
END;
IF COL_LENGTH('dbo.PackagingType','FinalComponent') IS NULL
BEGIN
 ALTER TABLE dbo.PackagingType ADD FinalComponent BIT NOT NULL
  CONSTRAINT DF_PackagingType_FinalComponent DEFAULT(0) WITH VALUES;
 -- Preserve the formerly eligible child leaves and historical leaf material assignments.
 EXEC sys.sp_executesql N'UPDATE t SET FinalComponent=1 FROM dbo.PackagingType t
 WHERE NOT EXISTS(SELECT 1 FROM dbo.PackagingType c WHERE c.ParentTypeID=t.ID)
 AND (t.ParentTypeID IS NOT NULL OR EXISTS(SELECT 1 FROM dbo.PackagingMaterial m WHERE m.PackagingTypeID=t.ID));';
END;
EXEC sys.sp_refreshview N'dbo.v_PackagingTypeWeb';
EXEC sys.sp_refreshview N'dbo.v_PackagingTypeDimensionContext';
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingType_Batch'));
IF @D IS NULL OR CHARINDEX(N'-- Shipping root flag.',@D)=0
 THROW 52999,'Apply Packaging Type migrations through 98 first.',1;
IF CHARINDEX(N'-- Explicit final component.',@D)=0
BEGIN
 IF CHARINDEX(N'DECLARE @ChosenOrders TABLE',@D)=0 OR CHARINDEX(N'ParentTypeID=@Parent,Shipping=@Shipping,Status=@Status',@D)=0
  THROW 52999,'Unexpected Packaging Type procedure signature.',1;
 SET @D=REPLACE(@D,N'DECLARE @ChosenOrders TABLE',N'DECLARE @FinalComponent BIT,@FinalSet BIT;
 DECLARE @ChosenOrders TABLE');
 SET @D=REPLACE(@D,N'SET @Name=NULLIF',N'-- Explicit final component.
    SET @FinalSet=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@Rows) r CROSS APPLY OPENJSON(r.value) j
     WHERE TRY_CONVERT(INT,JSON_VALUE(r.value,''$.RowNum''))=@Row AND j.[key]=''FinalComponent'') THEN 1 ELSE 0 END;
    SET @FinalComponent=CASE WHEN @Parent IS NOT NULL THEN 1 ELSE 0 END;
    IF @FinalSet=1 BEGIN
     IF EXISTS(SELECT 1 FROM OPENJSON(@Rows) r CROSS APPLY OPENJSON(r.value) j
      WHERE TRY_CONVERT(INT,JSON_VALUE(r.value,''$.RowNum''))=@Row AND j.[key]=''FinalComponent'' AND j.[type]<>3)
      THROW 51111,''Final component must be True or False.'',1;
     SELECT @FinalComponent=CASE JSON_VALUE(r.value,''$.FinalComponent'') WHEN ''true'' THEN 1 ELSE 0 END
      FROM OPENJSON(@Rows) r WHERE TRY_CONVERT(INT,JSON_VALUE(r.value,''$.RowNum''))=@Row;
    END ELSE IF @Cmd=''U'' SELECT @FinalComponent=FinalComponent FROM dbo.PackagingType WHERE ID=@ID;
    IF @FinalComponent=1 AND EXISTS(SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK) WHERE ParentTypeID=@ID)
     THROW 51111,''A Final component cannot have child Packaging Types.'',1;
    IF @Cmd=''U'' AND @FinalComponent=0 AND EXISTS(SELECT 1 FROM dbo.PackagingType WHERE ID=@ID AND FinalComponent=1)
     AND EXISTS(SELECT 1 FROM dbo.PackagingMaterial WITH(UPDLOCK,HOLDLOCK) WHERE PackagingTypeID=@ID)
     THROW 51111,''Remove Material assignments before clearing Final component.'',1;
    IF @Parent IS NOT NULL AND EXISTS(SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK) WHERE ID=@Parent AND FinalComponent=1)
     THROW 51111,''A Final component cannot be selected as Parent Type.'',1;
    -- Price Basis is retired from entry; preserve legacy values and default new types to Count.
    IF @Basis IS NULL BEGIN
     IF @Cmd=''U'' SELECT @Basis=PriceBasis FROM dbo.PackagingType WHERE ID=@ID;
     ELSE SET @Basis=N''Count'';
    END;
    SET @Name=NULLIF');
 SET @D=REPLACE(@D,N'ParentTypeID,Shipping)',N'ParentTypeID,Shipping,FinalComponent)');
 SET @D=REPLACE(@D,N'@Parent,@Shipping)',N'@Parent,@Shipping,@FinalComponent)');
 SET @D=REPLACE(@D,N'ParentTypeID=@Parent,Shipping=@Shipping,Status=@Status',N'ParentTypeID=@Parent,Shipping=@Shipping,FinalComponent=@FinalComponent,Status=@Status');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingMaterial_BatchV2'));
IF @D IS NULL OR CHARINDEX(N'-- Material child-only assignments.',@D)=0
 THROW 52999,'Apply Packaging Material migration 75 first.',1;
IF CHARINDEX(N'-- Material final-component assignments.',@D)=0
BEGIN
 IF CHARINDEX(N't.ID=@TypeID AND t.ParentTypeID IS NOT NULL',@D)=0
  THROW 52999,'Unexpected Material procedure signature.',1;
 SET @D=REPLACE(@D,N'-- Material child-only assignments.',N'-- Material final-component assignments.
                -- Material child-only assignments.');
 SET @D=REPLACE(@D,N't.ID=@TypeID AND t.ParentTypeID IS NOT NULL',N't.ID=@TypeID AND t.FinalComponent=1');
 SET @D=REPLACE(@D,N'Choose an active child Packaging Type with no children.',N'Choose an active Final component Packaging Type with no children.');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
CREATE OR ALTER TRIGGER dbo.tr_PackagingType_FinalComponent
ON dbo.PackagingType AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM inserted i JOIN dbo.PackagingType c WITH(UPDLOCK,HOLDLOCK) ON c.ParentTypeID=i.ID WHERE i.FinalComponent=1)
 OR EXISTS(SELECT 1 FROM inserted i JOIN dbo.PackagingType p WITH(UPDLOCK,HOLDLOCK) ON p.ID=i.ParentTypeID WHERE p.FinalComponent=1)
  THROW 51111,'Final components cannot have child Packaging Types.',1;
 IF EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON d.ID=i.ID JOIN dbo.PackagingMaterial m WITH(UPDLOCK,HOLDLOCK) ON m.PackagingTypeID=i.ID
  WHERE d.FinalComponent=1 AND i.FinalComponent=0)
  THROW 51111,'Remove Material assignments before clearing Final component.',1;
END;
GO
CREATE OR ALTER TRIGGER dbo.tr_PackagingMaterial_FinalComponent
ON dbo.PackagingMaterial AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM inserted i LEFT JOIN deleted d ON d.ID=i.ID
  JOIN dbo.PackagingType t WITH(UPDLOCK,HOLDLOCK) ON t.ID=i.PackagingTypeID
  WHERE (d.ID IS NULL OR ISNULL(d.PackagingTypeID,0)<>i.PackagingTypeID)
   AND (t.FinalComponent=0 OR t.Status<>'Active' OR EXISTS(SELECT 1 FROM dbo.PackagingType c WHERE c.ParentTypeID=t.ID)))
  THROW 51111,'Materials require an active Final component Packaging Type with no children.',1;
END;
GO
COMMIT;
GO
