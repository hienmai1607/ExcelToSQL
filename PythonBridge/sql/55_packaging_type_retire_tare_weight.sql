USE [test];
GO
-- After 54. Retire the input; keep historical TareWeight values unchanged.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
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
  PackagingOrder NVARCHAR(4000),PackagingType NVARCHAR(4000),PriceBasis NVARCHAR(4000),Status VARCHAR(20),ParentTypeID INT,ParentTypeSet BIT);
 INSERT @Input SELECT RowNum,Command,ID,TRY_CONVERT(VARBINARY(8),RowVersionHex,1),PackagingOrder,PackagingType,PriceBasis,Status,ParentTypeID,
  CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(r.value) WHERE [key]='ParentTypeID') THEN 1 ELSE 0 END
 FROM OPENJSON(@Rows) r CROSS APPLY OPENJSON(r.value) WITH(RowNum INT,Command VARCHAR(10),ID INT,RowVersionHex VARCHAR(100),
  PackagingOrder NVARCHAR(4000),PackagingType NVARCHAR(4000),PriceBasis NVARCHAR(4000),Status VARCHAR(20),ParentTypeID INT);
 IF (SELECT COUNT(*) FROM @Input) NOT BETWEEN 1 AND 500 THROW 51105,'Use 1 to 500 rows per batch.',1;
 IF EXISTS(SELECT RowNum FROM @Input GROUP BY RowNum HAVING COUNT(*)>1)
  OR EXISTS(SELECT ID FROM @Input WHERE ID IS NOT NULL GROUP BY ID HAVING COUNT(*)>1)
  THROW 51106,'Duplicate row numbers or record IDs.',1;
 DECLARE @Result TABLE(RowNum INT,Status VARCHAR(10),Message NVARCHAR(2048),NewID INT,NewRowVersion VARBINARY(8));
 DECLARE @Row INT,@Cmd VARCHAR(10),@ID INT,@RV VARBINARY(8),@Order NVARCHAR(4000),@Name NVARCHAR(4000),
  @Basis NVARCHAR(4000),@Status VARCHAR(20),@Own BIT,@Parent INT,@ParentSet BIT,@Ancestor INT,@Lock INT;
 DECLARE @Visited TABLE(ID INT PRIMARY KEY);
 DECLARE c CURSOR LOCAL FAST_FORWARD FOR
  SELECT RowNum,Command,ID,RowVersion,PackagingOrder,PackagingType,PriceBasis,Status,ParentTypeID,ParentTypeSet FROM @Input ORDER BY RowNum;
 OPEN c; FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@RV,@Order,@Name,@Basis,@Status,@Parent,@ParentSet;
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
    IF @Order IS NULL OR @Order COLLATE Latin1_General_100_BIN2 NOT IN(N'Primary',N'Secondary')
     THROW 51111,'Choose Primary or Secondary for Order.',1;
    IF @Basis IS NULL OR @Basis COLLATE Latin1_General_100_BIN2 NOT IN(N'Count',N'Square meter',N'Volume')
     THROW 51111,'Choose Count, Square meter or Volume for Price Basis.',1;
    IF @Name IS NULL OR LEN(@Name)>100 THROW 51111,'Packaging Type is required (maximum 100 characters).',1;
    IF @Cmd='U' AND @Status IS NULL SELECT @Status=Status FROM dbo.PackagingType WHERE ID=@ID;
    SET @Status=COALESCE(@Status,'Active');
    IF @Status NOT IN('Active','Block') THROW 51109,'Status must be Active or Block.',1;
    IF EXISTS(SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK)
     WHERE PackagingOrder=@Order AND PackagingType=@Name AND (@Cmd='C' OR ID<>@ID))
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
   IF @Own=1 COMMIT;
  END TRY
  BEGIN CATCH
   IF @Own=1 AND XACT_STATE()<>0 ROLLBACK;
   ELSE IF XACT_STATE()=1 ROLLBACK TRANSACTION PackagingTypeRow;
   ELSE IF XACT_STATE()=-1 THROW;
   DELETE @Result WHERE RowNum=@Row;
   INSERT @Result VALUES(@Row,'ERROR',ERROR_MESSAGE(),@ID,NULL);
  END CATCH;
  FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@RV,@Order,@Name,@Basis,@Status,@Parent,@ParentSet;
 END;
 CLOSE c; DEALLOCATE c;
 SELECT * FROM @Result ORDER BY RowNum;
END;
GO
