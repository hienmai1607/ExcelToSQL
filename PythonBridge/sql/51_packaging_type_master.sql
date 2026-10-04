USE [test];
GO
-- After 50. Packaging Type Master; no business records are seeded.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('dbo.PackagingType','U') IS NULL
BEGIN
 CREATE TABLE dbo.PackagingType(
  ID INT IDENTITY PRIMARY KEY,
  PackagingOrder NVARCHAR(9) NOT NULL,
  PackagingType NVARCHAR(100) NOT NULL,
  PriceBasis NVARCHAR(20) NOT NULL,
  TareWeight DECIMAL(17,3) NOT NULL,
  Status VARCHAR(10) NOT NULL DEFAULT('Active'),
  CreatedAt DATETIME2(7) NOT NULL DEFAULT(SYSUTCDATETIME()),
  CreatedBy INT NOT NULL REFERENCES dbo.Users(ID),
  UpdatedAt DATETIME2(7) NULL,
  UpdatedBy INT NULL REFERENCES dbo.Users(ID),
  RowVersion ROWVERSION NOT NULL,
  CONSTRAINT CK_PackagingType_Order CHECK(PackagingOrder COLLATE Latin1_General_100_BIN2 IN(N'Primary',N'Secondary')),
  CONSTRAINT CK_PackagingType_Name CHECK(LEN(LTRIM(RTRIM(PackagingType)))>0),
  CONSTRAINT CK_PackagingType_PriceBasis CHECK(PriceBasis COLLATE Latin1_General_100_BIN2 IN(N'Count',N'Square meter',N'Volume')),
  CONSTRAINT CK_PackagingType_Tare CHECK(TareWeight>=0),
  CONSTRAINT CK_PackagingType_Status CHECK(Status IN('Active','Block')),
  CONSTRAINT UQ_PackagingType_Order_Name UNIQUE(PackagingOrder,PackagingType)
 );
END;
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
  PackagingOrder NVARCHAR(4000),PackagingType NVARCHAR(4000),PriceBasis NVARCHAR(4000),TareText NVARCHAR(100),Status VARCHAR(20));
 INSERT @Input SELECT RowNum,Command,ID,TRY_CONVERT(VARBINARY(8),RowVersionHex,1),PackagingOrder,PackagingType,PriceBasis,TareWeight,Status
 FROM OPENJSON(@Rows) WITH(RowNum INT,Command VARCHAR(10),ID INT,RowVersionHex VARCHAR(100),
  PackagingOrder NVARCHAR(4000),PackagingType NVARCHAR(4000),PriceBasis NVARCHAR(4000),TareWeight NVARCHAR(100),Status VARCHAR(20));
 IF (SELECT COUNT(*) FROM @Input) NOT BETWEEN 1 AND 500 THROW 51105,'Use 1 to 500 rows per batch.',1;
 IF EXISTS(SELECT RowNum FROM @Input GROUP BY RowNum HAVING COUNT(*)>1)
  OR EXISTS(SELECT ID FROM @Input WHERE ID IS NOT NULL GROUP BY ID HAVING COUNT(*)>1)
  THROW 51106,'Duplicate row numbers or record IDs.',1;
 DECLARE @Result TABLE(RowNum INT,Status VARCHAR(10),Message NVARCHAR(2048),NewID INT,NewRowVersion VARBINARY(8));
 DECLARE @Row INT,@Cmd VARCHAR(10),@ID INT,@RV VARBINARY(8),@Order NVARCHAR(4000),@Name NVARCHAR(4000),
  @Basis NVARCHAR(4000),@TareText NVARCHAR(100),@Tare DECIMAL(17,3),@Status VARCHAR(20),@Own BIT;
 DECLARE c CURSOR LOCAL FAST_FORWARD FOR
  SELECT RowNum,Command,ID,RowVersion,PackagingOrder,PackagingType,PriceBasis,TareText,Status FROM @Input ORDER BY RowNum;
 OPEN c; FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@RV,@Order,@Name,@Basis,@TareText,@Status;
 WHILE @@FETCH_STATUS=0
 BEGIN
  SET @Own=0;
  BEGIN TRY
   IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION; SET @Own=1; END ELSE SAVE TRANSACTION PackagingTypeRow;
   IF @Row IS NULL OR @Row<1 OR @Cmd IS NULL OR @Cmd NOT IN('C','U','D') THROW 51107,'Use a positive row number and C, U or D.',1;
   IF @Cmd='C' AND (@ID IS NOT NULL OR @RV IS NOT NULL) THROW 51107,'Create cannot have an ID or RowVersion.',1;
   IF @Cmd IN('U','D') AND NOT EXISTS(SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@RV)
    THROW 51108,'Concurrency conflict or row not found. Refresh first.',1;
   IF @Cmd<>'D'
   BEGIN
    SET @Name=NULLIF(LTRIM(RTRIM(@Name)),N'');
    IF @Order IS NULL OR @Order COLLATE Latin1_General_100_BIN2 NOT IN(N'Primary',N'Secondary')
     THROW 51111,'Choose Primary or Secondary for Order.',1;
    IF @Basis IS NULL OR @Basis COLLATE Latin1_General_100_BIN2 NOT IN(N'Count',N'Square meter',N'Volume')
     THROW 51111,'Choose Count, Square meter or Volume for Price Basis.',1;
    IF @Name IS NULL OR LEN(@Name)>100 THROW 51111,'Packaging Type is required (maximum 100 characters).',1;
    SET @Tare=TRY_CONVERT(DECIMAL(17,3),@TareText);
    IF @Tare IS NULL OR @Tare<0 OR TRY_CONVERT(DECIMAL(38,18),@TareText)<>@Tare
     THROW 51111,'Tare weight must be nonnegative, with at most 14 whole digits and 3 decimals.',1;
    IF @Cmd='U' AND @Status IS NULL SELECT @Status=Status FROM dbo.PackagingType WHERE ID=@ID;
    SET @Status=COALESCE(@Status,'Active');
    IF @Status NOT IN('Active','Block') THROW 51109,'Status must be Active or Block.',1;
    IF EXISTS(SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK)
     WHERE PackagingOrder=@Order AND PackagingType=@Name AND (@Cmd='C' OR ID<>@ID))
     THROW 51111,'This Packaging Type already exists for this Order. Edit the existing record instead.',1;
   END;
   IF @Cmd='C'
    INSERT dbo.PackagingType(PackagingOrder,PackagingType,PriceBasis,TareWeight,Status,CreatedBy)
    OUTPUT @Row,'OK','Created',inserted.ID,inserted.RowVersion INTO @Result VALUES(@Order,@Name,@Basis,@Tare,@Status,@Actor);
   ELSE IF @Cmd='D'
    UPDATE dbo.PackagingType SET Status='Block',UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@Actor
    OUTPUT @Row,'OK','Blocked',inserted.ID,inserted.RowVersion INTO @Result WHERE ID=@ID AND RowVersion=@RV;
   ELSE
    UPDATE dbo.PackagingType SET PackagingOrder=@Order,PackagingType=@Name,PriceBasis=@Basis,TareWeight=@Tare,
     Status=@Status,UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@Actor
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
  FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@RV,@Order,@Name,@Basis,@TareText,@Status;
 END;
 CLOSE c; DEALLOCATE c;
 SELECT * FROM @Result ORDER BY RowNum;
END;
GO
