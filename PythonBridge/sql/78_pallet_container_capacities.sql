USE [test];
GO
-- After 77. Optional pallet/container capacities; existing records remain NULL.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
IF OBJECT_ID('dbo.Pallet','U') IS NULL
 THROW 51111,'Apply 49_pallet_master.sql before this migration.',1;
IF COL_LENGTH('dbo.Pallet','PalletsPer20DC') IS NULL ALTER TABLE dbo.Pallet ADD PalletsPer20DC INT NULL;
IF COL_LENGTH('dbo.Pallet','PalletsPer40DC') IS NULL ALTER TABLE dbo.Pallet ADD PalletsPer40DC INT NULL;
IF COL_LENGTH('dbo.Pallet','PalletsPer40HC') IS NULL ALTER TABLE dbo.Pallet ADD PalletsPer40HC INT NULL;
IF COL_LENGTH('dbo.Pallet','PalletsPer20RC') IS NULL ALTER TABLE dbo.Pallet ADD PalletsPer20RC INT NULL;
IF COL_LENGTH('dbo.Pallet','PalletsPer40RHC') IS NULL ALTER TABLE dbo.Pallet ADD PalletsPer40RHC INT NULL;
GO
IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.Pallet') AND name='CK_Pallet_PalletsPer20DC')
 ALTER TABLE dbo.Pallet WITH CHECK ADD CONSTRAINT CK_Pallet_PalletsPer20DC CHECK(PalletsPer20DC IS NULL OR PalletsPer20DC>=0);
IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.Pallet') AND name='CK_Pallet_PalletsPer40DC')
 ALTER TABLE dbo.Pallet WITH CHECK ADD CONSTRAINT CK_Pallet_PalletsPer40DC CHECK(PalletsPer40DC IS NULL OR PalletsPer40DC>=0);
IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.Pallet') AND name='CK_Pallet_PalletsPer40HC')
 ALTER TABLE dbo.Pallet WITH CHECK ADD CONSTRAINT CK_Pallet_PalletsPer40HC CHECK(PalletsPer40HC IS NULL OR PalletsPer40HC>=0);
IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.Pallet') AND name='CK_Pallet_PalletsPer20RC')
 ALTER TABLE dbo.Pallet WITH CHECK ADD CONSTRAINT CK_Pallet_PalletsPer20RC CHECK(PalletsPer20RC IS NULL OR PalletsPer20RC>=0);
IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.Pallet') AND name='CK_Pallet_PalletsPer40RHC')
 ALTER TABLE dbo.Pallet WITH CHECK ADD CONSTRAINT CK_Pallet_PalletsPer40RHC CHECK(PalletsPer40RHC IS NULL OR PalletsPer40RHC>=0);
GO
-- Refresh SELECT p.* metadata so new columns are returned without changing calculations.
EXEC sys.sp_refreshview N'dbo.v_PalletMaster';
GO
CREATE OR ALTER PROCEDURE dbo.usp_Pallet_Batch
 @Rows NVARCHAR(MAX),@Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT OFF;
 DECLARE @Actor INT;
 EXEC dbo.usp_Packaging_Authorize @Username,'Maintain',@Actor OUTPUT;
 IF ISJSON(@Rows)<>1 OR LEFT(LTRIM(@Rows),1)<>'['
  THROW 51105,'A JSON array of rows is required.',1;
 DECLARE @Input TABLE(RowNum INT,Command VARCHAR(10),ID INT,RowVersion VARBINARY(8),
  UnitOfMeasure NVARCHAR(4000),WidthText NVARCHAR(100),LengthText NVARCHAR(100),Status VARCHAR(20),
  PalletsPer20DCText NVARCHAR(100),PalletsPer20DCSet BIT,
  PalletsPer40DCText NVARCHAR(100),PalletsPer40DCSet BIT,
  PalletsPer40HCText NVARCHAR(100),PalletsPer40HCSet BIT,
  PalletsPer20RCText NVARCHAR(100),PalletsPer20RCSet BIT,
  PalletsPer40RHCText NVARCHAR(100),PalletsPer40RHCSet BIT);
 INSERT @Input SELECT RowNum,Command,ID,TRY_CONVERT(VARBINARY(8),RowVersionHex,1),
  UnitOfMeasure,Width,Length,Status,
  r.PalletsPer20DC,CONVERT(BIT,CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(j.value) WHERE [key]='PalletsPer20DC') THEN 1 ELSE 0 END),
  r.PalletsPer40DC,CONVERT(BIT,CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(j.value) WHERE [key]='PalletsPer40DC') THEN 1 ELSE 0 END),
  r.PalletsPer40HC,CONVERT(BIT,CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(j.value) WHERE [key]='PalletsPer40HC') THEN 1 ELSE 0 END),
  r.PalletsPer20RC,CONVERT(BIT,CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(j.value) WHERE [key]='PalletsPer20RC') THEN 1 ELSE 0 END),
  r.PalletsPer40RHC,CONVERT(BIT,CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(j.value) WHERE [key]='PalletsPer40RHC') THEN 1 ELSE 0 END)
 FROM OPENJSON(@Rows) j CROSS APPLY OPENJSON(j.value) WITH(RowNum INT,Command VARCHAR(10),ID INT,
  RowVersionHex VARCHAR(100),UnitOfMeasure NVARCHAR(4000),Width NVARCHAR(100),Length NVARCHAR(100),Status VARCHAR(20),
  PalletsPer20DC NVARCHAR(100),PalletsPer40DC NVARCHAR(100),PalletsPer40HC NVARCHAR(100),PalletsPer20RC NVARCHAR(100),PalletsPer40RHC NVARCHAR(100)) r;
 IF (SELECT COUNT(*) FROM @Input) NOT BETWEEN 1 AND 500 THROW 51105,'Use 1 to 500 rows per batch.',1;
 IF EXISTS(SELECT RowNum FROM @Input GROUP BY RowNum HAVING COUNT(*)>1)
  OR EXISTS(SELECT ID FROM @Input WHERE ID IS NOT NULL GROUP BY ID HAVING COUNT(*)>1)
  THROW 51106,'Duplicate row numbers or record IDs.',1;
 DECLARE @Result TABLE(RowNum INT,Status VARCHAR(10),Message NVARCHAR(2048),NewID INT,NewRowVersion VARBINARY(8));
 DECLARE @Row INT,@Cmd VARCHAR(10),@ID INT,@RV VARBINARY(8),@Unit NVARCHAR(4000),
  @WText NVARCHAR(100),@LText NVARCHAR(100),@Status VARCHAR(20),@Own BIT,
  @UnitID INT,@W DECIMAL(12,4),@L DECIMAL(12,4),@Factor DECIMAL(24,9),@Area DECIMAL(38,8),
  @C0Text NVARCHAR(100),@C0Set BIT,@C0 INT,
  @C1Text NVARCHAR(100),@C1Set BIT,@C1 INT,
  @C2Text NVARCHAR(100),@C2Set BIT,@C2 INT,
  @C3Text NVARCHAR(100),@C3Set BIT,@C3 INT,
  @C4Text NVARCHAR(100),@C4Set BIT,@C4 INT;
 DECLARE c CURSOR LOCAL FAST_FORWARD FOR
  SELECT RowNum,Command,ID,RowVersion,UnitOfMeasure,WidthText,LengthText,Status,PalletsPer20DCText,PalletsPer20DCSet,PalletsPer40DCText,PalletsPer40DCSet,PalletsPer40HCText,PalletsPer40HCSet,PalletsPer20RCText,PalletsPer20RCSet,PalletsPer40RHCText,PalletsPer40RHCSet FROM @Input ORDER BY RowNum;
 OPEN c; FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@RV,@Unit,@WText,@LText,@Status,@C0Text,@C0Set,@C1Text,@C1Set,@C2Text,@C2Set,@C3Text,@C3Set,@C4Text,@C4Set;
 WHILE @@FETCH_STATUS=0
 BEGIN
  SET @Own=0;
  BEGIN TRY
   IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION; SET @Own=1; END
   ELSE SAVE TRANSACTION PalletRow;
   IF @Row IS NULL OR @Row<1 OR @Cmd IS NULL OR @Cmd NOT IN('C','U','D')
    THROW 51107,'Use a positive row number and C, U or D.',1;
   IF @Cmd='C' AND (@ID IS NOT NULL OR @RV IS NOT NULL)
    THROW 51107,'Create cannot have an ID or RowVersion.',1;
   IF @Cmd IN('U','D') AND NOT EXISTS(SELECT 1 FROM dbo.Pallet WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@RV)
    THROW 51108,'Concurrency conflict or row not found. Refresh first.',1;
   IF @Cmd<>'D'
   BEGIN
    SET @C0=TRY_CONVERT(INT,@C0Text);
    IF @C0Text IS NOT NULL AND (@C0 IS NULL OR @C0<0 OR LTRIM(RTRIM(@C0Text))='' OR @C0Text LIKE '%[^0-9]%')
     THROW 51111,'Pallet/container counts must be whole numbers from 0 to 2,147,483,647 or blank.',1;
    IF @Cmd='U' AND @C0Set=0 SELECT @C0=PalletsPer20DC FROM dbo.Pallet WHERE ID=@ID;
    SET @C1=TRY_CONVERT(INT,@C1Text);
    IF @C1Text IS NOT NULL AND (@C1 IS NULL OR @C1<0 OR LTRIM(RTRIM(@C1Text))='' OR @C1Text LIKE '%[^0-9]%')
     THROW 51111,'Pallet/container counts must be whole numbers from 0 to 2,147,483,647 or blank.',1;
    IF @Cmd='U' AND @C1Set=0 SELECT @C1=PalletsPer40DC FROM dbo.Pallet WHERE ID=@ID;
    SET @C2=TRY_CONVERT(INT,@C2Text);
    IF @C2Text IS NOT NULL AND (@C2 IS NULL OR @C2<0 OR LTRIM(RTRIM(@C2Text))='' OR @C2Text LIKE '%[^0-9]%')
     THROW 51111,'Pallet/container counts must be whole numbers from 0 to 2,147,483,647 or blank.',1;
    IF @Cmd='U' AND @C2Set=0 SELECT @C2=PalletsPer40HC FROM dbo.Pallet WHERE ID=@ID;
    SET @C3=TRY_CONVERT(INT,@C3Text);
    IF @C3Text IS NOT NULL AND (@C3 IS NULL OR @C3<0 OR LTRIM(RTRIM(@C3Text))='' OR @C3Text LIKE '%[^0-9]%')
     THROW 51111,'Pallet/container counts must be whole numbers from 0 to 2,147,483,647 or blank.',1;
    IF @Cmd='U' AND @C3Set=0 SELECT @C3=PalletsPer20RC FROM dbo.Pallet WHERE ID=@ID;
    SET @C4=TRY_CONVERT(INT,@C4Text);
    IF @C4Text IS NOT NULL AND (@C4 IS NULL OR @C4<0 OR LTRIM(RTRIM(@C4Text))='' OR @C4Text LIKE '%[^0-9]%')
     THROW 51111,'Pallet/container counts must be whole numbers from 0 to 2,147,483,647 or blank.',1;
    IF @Cmd='U' AND @C4Set=0 SELECT @C4=PalletsPer40RHC FROM dbo.Pallet WHERE ID=@ID;
    SET @UnitID=NULL; SET @Factor=NULL; SET @Area=NULL;
    SET @W=TRY_CONVERT(DECIMAL(12,4),@WText); SET @L=TRY_CONVERT(DECIMAL(12,4),@LText);
    IF @W IS NULL OR @L IS NULL OR @W<=0 OR @L<=0
     OR TRY_CONVERT(DECIMAL(38,18),@WText)<>@W OR TRY_CONVERT(DECIMAL(38,18),@LText)<>@L
     THROW 51111,'Width and Length must be positive, with at most 8 whole digits and 4 decimals.',1;
    IF @Status IS NULL AND @Cmd='U' SELECT @Status=Status FROM dbo.Pallet WHERE ID=@ID;
    SET @Status=COALESCE(@Status,'Active');
    IF @Status NOT IN('Active','Block') THROW 51109,'Status must be Active or Block.',1;
    SELECT @UnitID=ID FROM dbo.UoM WITH(UPDLOCK,HOLDLOCK) WHERE UoMCode=LTRIM(RTRIM(@Unit))
     AND (Status='Active' OR (@Status='Block' AND @Cmd='U' AND EXISTS(SELECT 1 FROM dbo.Pallet WHERE ID=@ID AND UoMID=dbo.UoM.ID)));
    IF @UnitID IS NULL THROW 51111,'Choose an active UoM from UoM Master.',1;
    IF @Status='Active'
    BEGIN
     -- Lock the reference rows until this record is saved.
     SELECT @Factor=CASE WHEN u.UoMCode=N'MM' THEN CONVERT(DECIMAL(24,9),1) ELSE cv.Factor END
     FROM dbo.UoM u WITH(UPDLOCK,HOLDLOCK)
     LEFT JOIN dbo.UoM mm WITH(UPDLOCK,HOLDLOCK) ON mm.UoMCode=N'MM' AND mm.Status='Active'
     LEFT JOIN dbo.UnitConversion cv WITH(UPDLOCK,HOLDLOCK)
      ON cv.FromUoMID=u.ID AND cv.ToUoMID=mm.ID AND cv.Status='Active'
      AND cv.PackagingMaterialID IS NULL AND cv.RawMaterialID IS NULL AND cv.VendorID IS NULL
     WHERE u.ID=@UnitID AND u.Status='Active';
     IF @Factor IS NULL THROW 51111,'Admin must maintain an active general conversion from this UoM to MM.',1;
     SELECT @Area=PalletAreaMM2 FROM dbo.fn_PalletArea(@W,@L,@Factor);
     IF @Area IS NULL OR @Area<=0 THROW 51111,'Converted dimensions or area are out of range.',1;
    END;
    IF EXISTS(SELECT 1 FROM dbo.Pallet WITH(UPDLOCK,HOLDLOCK) WHERE UoMID=@UnitID AND Width=@W AND Length=@L AND (@Cmd='C' OR ID<>@ID))
     THROW 51111,'This pallet size already exists. Edit the existing record instead.',1;
   END;
   IF @Cmd='C'
    INSERT dbo.Pallet(UoMID,Width,Length,Status,CreatedBy,PalletsPer20DC,PalletsPer40DC,PalletsPer40HC,PalletsPer20RC,PalletsPer40RHC)
    OUTPUT @Row,'OK','Created',inserted.ID,inserted.RowVersion INTO @Result
    VALUES(@UnitID,@W,@L,@Status,@Actor,@C0,@C1,@C2,@C3,@C4);
   ELSE IF @Cmd='D'
    UPDATE dbo.Pallet SET Status='Block',UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@Actor
    OUTPUT @Row,'OK','Blocked',inserted.ID,inserted.RowVersion INTO @Result WHERE ID=@ID AND RowVersion=@RV;
   ELSE
    UPDATE dbo.Pallet SET UoMID=@UnitID,Width=@W,Length=@L,Status=@Status,PalletsPer20DC=@C0,PalletsPer40DC=@C1,PalletsPer40HC=@C2,PalletsPer20RC=@C3,PalletsPer40RHC=@C4,UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@Actor
    OUTPUT @Row,'OK','Updated',inserted.ID,inserted.RowVersion INTO @Result WHERE ID=@ID AND RowVersion=@RV;
   IF @Own=1 COMMIT;
  END TRY
  BEGIN CATCH
   IF @Own=1 AND XACT_STATE()<>0 ROLLBACK;
   ELSE IF XACT_STATE()=1 ROLLBACK TRANSACTION PalletRow;
   ELSE IF XACT_STATE()=-1 THROW;
   DELETE @Result WHERE RowNum=@Row;
   INSERT @Result VALUES(@Row,'ERROR',ERROR_MESSAGE(),@ID,NULL);
  END CATCH;
  FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@RV,@Unit,@WText,@LText,@Status,@C0Text,@C0Set,@C1Text,@C1Set,@C2Text,@C2Set,@C3Text,@C3Set,@C4Text,@C4Set;
 END;
 CLOSE c; DEALLOCATE c;
 SELECT * FROM @Result ORDER BY RowNum;
END;
GO

