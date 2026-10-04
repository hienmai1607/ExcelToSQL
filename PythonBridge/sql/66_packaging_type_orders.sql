USE [test];
GO
-- After 65. One type may serve Primary, Secondary and/or Tertiary.
-- Retain the legacy single Order and existing IDs; do not merge historical types.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;
IF OBJECT_ID('dbo.CK_PackagingType_Order','C') IS NOT NULL
 ALTER TABLE dbo.PackagingType DROP CONSTRAINT CK_PackagingType_Order;
ALTER TABLE dbo.PackagingType WITH CHECK ADD CONSTRAINT CK_PackagingType_Order
 CHECK(PackagingOrder COLLATE Latin1_General_100_BIN2 IN(N'Primary',N'Secondary',N'Tertiary'));
IF OBJECT_ID('dbo.PackagingTypeOrder','U') IS NULL
 CREATE TABLE dbo.PackagingTypeOrder(
  PackagingTypeID INT NOT NULL REFERENCES dbo.PackagingType(ID),
  PackagingOrder NVARCHAR(9) NOT NULL,
  CONSTRAINT PK_PackagingTypeOrder PRIMARY KEY(PackagingTypeID,PackagingOrder),
  CONSTRAINT CK_PackagingTypeOrder_Order CHECK(PackagingOrder COLLATE Latin1_General_100_BIN2 IN(N'Primary',N'Secondary',N'Tertiary'))
 );
INSERT dbo.PackagingTypeOrder(PackagingTypeID,PackagingOrder)
 SELECT ID,PackagingOrder FROM dbo.PackagingType p
 WHERE NOT EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder o WHERE o.PackagingTypeID=p.ID);
COMMIT;
GO
CREATE OR ALTER TRIGGER dbo.tr_PackagingType_DefaultOrder
ON dbo.PackagingType AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 -- Preserve old SQL/Excel inserts. The batch below owns explicit multi-order changes.
 INSERT dbo.PackagingTypeOrder(PackagingTypeID,PackagingOrder)
 SELECT i.ID,i.PackagingOrder FROM inserted i
 WHERE NOT EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder o WHERE o.PackagingTypeID=i.ID AND o.PackagingOrder=i.PackagingOrder);
END;
GO
CREATE OR ALTER VIEW dbo.v_PackagingTypeWeb AS
 SELECT p.*,o.PackagingOrdersJSON,
  CONVERT(BIT,CASE WHEN EXISTS(SELECT 1 FROM dbo.PackagingType c WHERE c.ParentTypeID=p.ID) THEN 1 ELSE 0 END) HasChildren
 FROM dbo.PackagingType p CROSS APPLY(
  SELECT N'["'+STRING_AGG(CONVERT(NVARCHAR(MAX),PackagingOrder),N'","') WITHIN GROUP(
   ORDER BY CASE PackagingOrder WHEN 'Primary' THEN 1 WHEN 'Secondary' THEN 2 ELSE 3 END)+N'"]' PackagingOrdersJSON
  FROM dbo.PackagingTypeOrder WHERE PackagingTypeID=p.ID) o;
GO

CREATE OR ALTER PROCEDURE dbo.usp_PackagingType_Batch
 @Rows NVARCHAR(MAX),@Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT OFF;
 DECLARE @Actor INT;
 EXEC dbo.usp_Packaging_Authorize @Username,'Maintain',@Actor OUTPUT;
 IF ISJSON(@Rows)<>1 OR LEFT(LTRIM(@Rows),1)<>'[' THROW 51105,'A JSON array of rows is required.',1;
 DECLARE @Input TABLE(RowNum INT,Command VARCHAR(10),ID INT,RowVersion VARBINARY(8),
  PackagingOrder NVARCHAR(4000),PackagingType NVARCHAR(4000),PriceBasis NVARCHAR(4000),Status VARCHAR(20),ParentTypeID INT,ParentTypeSet BIT,PackagingOrders NVARCHAR(MAX),OrdersSet BIT);
 INSERT @Input SELECT RowNum,Command,ID,TRY_CONVERT(VARBINARY(8),RowVersionHex,1),PackagingOrder,PackagingType,PriceBasis,Status,ParentTypeID,
  CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(r.value) WHERE [key]='ParentTypeID') THEN 1 ELSE 0 END,PackagingOrders,CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(r.value) WHERE [key]='PackagingOrders') THEN 1 ELSE 0 END
 FROM OPENJSON(@Rows) r CROSS APPLY OPENJSON(r.value) WITH(RowNum INT,Command VARCHAR(10),ID INT,RowVersionHex VARCHAR(100),
  PackagingOrder NVARCHAR(4000),PackagingType NVARCHAR(4000),PriceBasis NVARCHAR(4000),Status VARCHAR(20),ParentTypeID INT,PackagingOrders NVARCHAR(MAX) AS JSON);
 IF (SELECT COUNT(*) FROM @Input) NOT BETWEEN 1 AND 500 THROW 51105,'Use 1 to 500 rows per batch.',1;
 IF EXISTS(SELECT RowNum FROM @Input GROUP BY RowNum HAVING COUNT(*)>1)
  OR EXISTS(SELECT ID FROM @Input WHERE ID IS NOT NULL GROUP BY ID HAVING COUNT(*)>1)
  THROW 51106,'Duplicate row numbers or record IDs.',1;
 DECLARE @Result TABLE(RowNum INT,Status VARCHAR(10),Message NVARCHAR(2048),NewID INT,NewRowVersion VARBINARY(8));
 DECLARE @Row INT,@Cmd VARCHAR(10),@ID INT,@RV VARBINARY(8),@Order NVARCHAR(4000),@Name NVARCHAR(4000),
  @Basis NVARCHAR(4000),@Status VARCHAR(20),@Own BIT,@Parent INT,@ParentSet BIT,@Ancestor INT,@Lock INT,@Orders NVARCHAR(MAX),@OrdersSet BIT;
 DECLARE @ChosenOrders TABLE(PackagingOrder NVARCHAR(9) PRIMARY KEY);
 DECLARE @Visited TABLE(ID INT PRIMARY KEY);
 DECLARE c CURSOR LOCAL FAST_FORWARD FOR
  SELECT RowNum,Command,ID,RowVersion,PackagingOrder,PackagingType,PriceBasis,Status,ParentTypeID,ParentTypeSet,PackagingOrders,OrdersSet FROM @Input ORDER BY RowNum;
 OPEN c; FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@RV,@Order,@Name,@Basis,@Status,@Parent,@ParentSet,@Orders,@OrdersSet;
 WHILE @@FETCH_STATUS=0
 BEGIN
  SET @Own=0;
  BEGIN TRY
   IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION; SET @Own=1; END ELSE SAVE TRANSACTION PackagingTypeRow;
   EXEC @Lock=sys.sp_getapplock @Resource=N'PackagingTypeHierarchy',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
   IF @Lock<0 THROW 51108,'Packaging Type hierarchy is busy. Try again.',1;
   IF @Row IS NULL OR @Row<1 OR @Cmd IS NULL OR @Cmd NOT IN('C','U','D') THROW 51107,'Use a positive row number and C, U or D.',1;
   IF @Cmd='C' AND (@ID IS NOT NULL OR @RV IS NOT NULL) THROW 51107,'Create cannot have an ID or RowVersion.',1;
   IF @Cmd IN('U','D') AND NOT EXISTS(SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@RV)
    THROW 51108,'Concurrency conflict or row not found. Refresh first.',1;
   IF @Cmd<>'D'
   BEGIN
    IF @Cmd='U' AND COALESCE(@ParentSet,0)=0
     SELECT @Parent=ParentTypeID FROM dbo.PackagingType WHERE ID=@ID;
    IF @Parent IS NOT NULL
    BEGIN
     IF NOT EXISTS(SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK) WHERE ID=@Parent
      AND (Status='Active' OR (@Cmd='U' AND EXISTS(SELECT 1 FROM dbo.PackagingType WHERE ID=@ID AND ParentTypeID=@Parent))))
      THROW 51111,'Choose an active Parent Type from Packaging Type Master.',1;
     DELETE @Visited;
     SET @Ancestor=@Parent;
     WHILE @Ancestor IS NOT NULL
     BEGIN
      IF @Ancestor=@ID OR EXISTS(SELECT 1 FROM @Visited WHERE ID=@Ancestor)
       THROW 51111,'Parent Type cannot be this type or one of its descendants.',1;
      INSERT @Visited VALUES(@Ancestor);
      SELECT @Ancestor=ParentTypeID FROM dbo.PackagingType WHERE ID=@Ancestor;
     END;
    END;

    SET @Name=NULLIF(LTRIM(RTRIM(@Name)),N'');
    DELETE @ChosenOrders;
    IF @OrdersSet=1
    BEGIN
     IF ISJSON(@Orders)<>1 OR LEFT(LTRIM(@Orders),1)<>'[' OR (SELECT COUNT(*) FROM OPENJSON(@Orders)) NOT BETWEEN 1 AND 3
      THROW 51111,'Select one to three packaging orders.',1;
     IF EXISTS(SELECT 1 FROM OPENJSON(@Orders) WHERE [type]<>1 OR [value] COLLATE Latin1_General_100_BIN2 NOT IN(N'Primary',N'Secondary',N'Tertiary'))
      OR EXISTS(SELECT [value] FROM OPENJSON(@Orders) GROUP BY [value] HAVING COUNT(*)>1)
      THROW 51111,'Choose distinct Primary, Secondary or Tertiary orders.',1;
     INSERT @ChosenOrders SELECT [value] FROM OPENJSON(@Orders);
     SELECT TOP(1) @Order=PackagingOrder FROM @ChosenOrders ORDER BY CASE PackagingOrder WHEN 'Primary' THEN 1 WHEN 'Secondary' THEN 2 ELSE 3 END;
    END
    ELSE
    BEGIN
     IF @Order IS NULL OR @Order COLLATE Latin1_General_100_BIN2 NOT IN(N'Primary',N'Secondary',N'Tertiary')
      THROW 51111,'Choose Primary, Secondary or Tertiary for Order.',1;
     IF @Cmd='U' AND EXISTS(SELECT 1 FROM dbo.PackagingType WHERE ID=@ID AND PackagingOrder=@Order)
      INSERT @ChosenOrders SELECT PackagingOrder FROM dbo.PackagingTypeOrder WHERE PackagingTypeID=@ID;
     IF NOT EXISTS(SELECT 1 FROM @ChosenOrders) INSERT @ChosenOrders VALUES(@Order);
    END;
    IF @Basis IS NULL OR @Basis COLLATE Latin1_General_100_BIN2 NOT IN(N'Count',N'Square meter',N'Volume')
     THROW 51111,'Choose Count, Square meter or Volume for Price Basis.',1;
    IF @Name IS NULL OR LEN(@Name)>100 THROW 51111,'Packaging Type is required (maximum 100 characters).',1;
    IF @Cmd='U' AND @Status IS NULL SELECT @Status=Status FROM dbo.PackagingType WHERE ID=@ID;
    SET @Status=COALESCE(@Status,'Active');
    IF @Status NOT IN('Active','Block') THROW 51109,'Status must be Active or Block.',1;
    IF EXISTS(SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK)
     WHERE PackagingType=@Name AND EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder o JOIN @ChosenOrders c ON c.PackagingOrder=o.PackagingOrder WHERE o.PackagingTypeID=dbo.PackagingType.ID) AND (@Cmd='C' OR ID<>@ID))
     THROW 51111,'This Packaging Type already exists for this Order. Edit the existing record instead.',1;
   END;
   IF @Cmd='C'
    INSERT dbo.PackagingType(PackagingOrder,PackagingType,PriceBasis,TareWeight,Status,CreatedBy,ParentTypeID)
    OUTPUT @Row,'OK','Created',inserted.ID,inserted.RowVersion INTO @Result VALUES(@Order,@Name,@Basis,0,@Status,@Actor,@Parent);
   ELSE IF @Cmd='D'
    UPDATE dbo.PackagingType SET Status='Block',UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@Actor
    OUTPUT @Row,'OK','Blocked',inserted.ID,inserted.RowVersion INTO @Result WHERE ID=@ID AND RowVersion=@RV;
   ELSE
    UPDATE dbo.PackagingType SET PackagingOrder=@Order,PackagingType=@Name,PriceBasis=@Basis,
     ParentTypeID=@Parent,Status=@Status,UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@Actor
    OUTPUT @Row,'OK','Updated',inserted.ID,inserted.RowVersion INTO @Result WHERE ID=@ID AND RowVersion=@RV;
   IF @Cmd<>'D'
   BEGIN
    SELECT @ID=NewID FROM @Result WHERE RowNum=@Row;
    DELETE dbo.PackagingTypeOrder WHERE PackagingTypeID=@ID;
    INSERT dbo.PackagingTypeOrder SELECT @ID,PackagingOrder FROM @ChosenOrders;
   END;
   IF @Own=1 COMMIT;
  END TRY
  BEGIN CATCH
   IF @Own=1 AND XACT_STATE()<>0 ROLLBACK;
   ELSE IF XACT_STATE()=1 ROLLBACK TRANSACTION PackagingTypeRow;
   ELSE IF XACT_STATE()=-1 THROW;
   DELETE @Result WHERE RowNum=@Row;
   INSERT @Result VALUES(@Row,'ERROR',ERROR_MESSAGE(),@ID,NULL);
  END CATCH;
  FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@RV,@Order,@Name,@Basis,@Status,@Parent,@ParentSet,@Orders,@OrdersSet;
 END;
 CLOSE c; DEALLOCATE c;
 SELECT * FROM @Result ORDER BY RowNum;
END;
GO

GO
-- Serialize new material assignments with hierarchy maintenance; allow unchanged
-- historical parent assignments on unrelated edits, never offer new ones.
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingMaterial_BatchV2'));
IF @D IS NULL THROW 52970,'Run material type migration 53 first.',1;
IF CHARINDEX(N'non-parent Packaging Type',@D)=0
BEGIN
 SET @D=REPLACE(@D,N'IF @Command NOT IN',N'DECLARE @HierarchyLock INT;
 EXEC @HierarchyLock=sys.sp_getapplock @Resource=N''PackagingTypeHierarchy'',@LockMode=''Exclusive'',@LockOwner=''Transaction'',@LockTimeout=10000;
 IF @HierarchyLock<0 THROW 51108,''Packaging Type hierarchy is busy. Try again.'',1;
 IF @Command NOT IN');
 SET @D=REPLACE(@D,N'IF @Command=''U'' AND @Status IS NULL',N'IF @TypeID IS NOT NULL AND EXISTS(SELECT 1 FROM dbo.PackagingType WHERE ParentTypeID=@TypeID)
 AND NOT(@Command=''U'' AND EXISTS(SELECT 1 FROM dbo.PackagingMaterial WHERE ID=@ID AND PackagingTypeID=@TypeID))
 THROW 51111,''Choose an active non-parent Packaging Type.'',1;
 IF @Command=''U'' AND @Status IS NULL');
 SET @D=REPLACE(REPLACE(REPLACE(@D,N'CREATE OR ALTER PROCEDURE',N'ALTER PROCEDURE'),N'CREATE   PROCEDURE',N'ALTER PROCEDURE'),N'CREATE PROCEDURE',N'ALTER PROCEDURE');
 EXEC sys.sp_executesql @D;
END;
GO
