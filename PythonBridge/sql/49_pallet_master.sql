USE [test];
GO
-- After 48. No UoMs or conversion factors are seeded.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO
IF OBJECT_ID('dbo.Pallet','U') IS NULL
BEGIN
 CREATE TABLE dbo.Pallet(
  ID INT IDENTITY PRIMARY KEY,
  UoMID INT NOT NULL REFERENCES dbo.UoM(ID),
  Width DECIMAL(12,4) NOT NULL,
  Length DECIMAL(12,4) NOT NULL,
  Status VARCHAR(10) NOT NULL DEFAULT('Active'),
  CreatedAt DATETIME2(7) NOT NULL DEFAULT(SYSUTCDATETIME()),
  CreatedBy INT NOT NULL REFERENCES dbo.Users(ID),
  UpdatedAt DATETIME2(7) NULL,
  UpdatedBy INT NULL REFERENCES dbo.Users(ID),
  RowVersion ROWVERSION NOT NULL,
  CONSTRAINT CK_Pallet_Dimensions CHECK(Width>0 AND Length>0),
  CONSTRAINT CK_Pallet_Status CHECK(Status IN('Active','Block')),
  CONSTRAINT UQ_Pallet_Dimensions UNIQUE(UoMID,Width,Length)
 );
END;
GO
CREATE OR ALTER FUNCTION dbo.fn_PalletDimensionText(@Value DECIMAL(12,4))
RETURNS VARCHAR(32)
AS
BEGIN
 DECLARE @Text VARCHAR(32)=CONVERT(VARCHAR(32),@Value);
 WHILE RIGHT(@Text,1)='0' SET @Text=LEFT(@Text,LEN(@Text)-1);
 IF RIGHT(@Text,1)='.' SET @Text=LEFT(@Text,LEN(@Text)-1);
 RETURN @Text;
END;
GO
-- Shared calculation for validation and reads. A factor is mm per selected unit.
-- Round each converted dimension to eight places before multiplying.
CREATE OR ALTER FUNCTION dbo.fn_PalletArea(
 @Width DECIMAL(12,4),@Length DECIMAL(12,4),@Factor DECIMAL(24,9))
RETURNS TABLE
AS RETURN
 SELECT d.WidthMM,d.LengthMM,
  CASE WHEN d.WidthMM>0 AND d.LengthMM>0
   THEN CONVERT(DECIMAL(38,8),d.WidthMM*d.LengthMM) END AS PalletAreaMM2
 FROM (SELECT TRY_CONVERT(DECIMAL(18,8),@Width*@Factor) AS WidthMM,
              TRY_CONVERT(DECIMAL(18,8),@Length*@Factor) AS LengthMM) d;
GO
CREATE OR ALTER VIEW dbo.v_PalletMaster
AS
 SELECT p.*,u.UoMCode AS UnitOfMeasure,
  CONCAT(dbo.fn_PalletDimensionText(p.Width),'x',dbo.fn_PalletDimensionText(p.Length),u.UoMCode) AS PalletSize,
  f.FactorToMM,CASE WHEN a.PalletAreaMM2>0 THEN a.PalletAreaMM2 END AS PalletAreaMM2,
  CASE WHEN f.FactorToMM IS NULL THEN 'Conversion required'
       WHEN a.PalletAreaMM2 IS NULL OR a.PalletAreaMM2<=0 THEN 'Conversion out of range'
       ELSE 'Calculated' END AS ConversionStatus
 FROM dbo.Pallet p
 JOIN dbo.UoM u ON u.ID=p.UoMID
 OUTER APPLY dbo.fn_UnitConversion(u.UoMCode,N'MM',NULL,NULL,NULL) c
 CROSS APPLY (SELECT CASE WHEN u.Status<>'Active' THEN NULL
  WHEN u.UoMCode=N'MM' THEN CONVERT(DECIMAL(24,9),1) ELSE c.Factor END AS FactorToMM) f
 CROSS APPLY dbo.fn_PalletArea(p.Width,p.Length,f.FactorToMM) a;
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
  UnitOfMeasure NVARCHAR(4000),WidthText NVARCHAR(100),LengthText NVARCHAR(100),Status VARCHAR(20));
 INSERT @Input SELECT RowNum,Command,ID,TRY_CONVERT(VARBINARY(8),RowVersionHex,1),
  UnitOfMeasure,Width,Length,Status
 FROM OPENJSON(@Rows) WITH(RowNum INT,Command VARCHAR(10),ID INT,
  RowVersionHex VARCHAR(100),UnitOfMeasure NVARCHAR(4000),Width NVARCHAR(100),Length NVARCHAR(100),Status VARCHAR(20));
 IF (SELECT COUNT(*) FROM @Input) NOT BETWEEN 1 AND 500 THROW 51105,'Use 1 to 500 rows per batch.',1;
 IF EXISTS(SELECT RowNum FROM @Input GROUP BY RowNum HAVING COUNT(*)>1)
  OR EXISTS(SELECT ID FROM @Input WHERE ID IS NOT NULL GROUP BY ID HAVING COUNT(*)>1)
  THROW 51106,'Duplicate row numbers or record IDs.',1;
 DECLARE @Result TABLE(RowNum INT,Status VARCHAR(10),Message NVARCHAR(2048),NewID INT,NewRowVersion VARBINARY(8));
 DECLARE @Row INT,@Cmd VARCHAR(10),@ID INT,@RV VARBINARY(8),@Unit NVARCHAR(4000),
  @WText NVARCHAR(100),@LText NVARCHAR(100),@Status VARCHAR(20),@Own BIT,
  @UnitID INT,@W DECIMAL(12,4),@L DECIMAL(12,4),@Factor DECIMAL(24,9),@Area DECIMAL(38,8);
 DECLARE c CURSOR LOCAL FAST_FORWARD FOR
  SELECT RowNum,Command,ID,RowVersion,UnitOfMeasure,WidthText,LengthText,Status FROM @Input ORDER BY RowNum;
 OPEN c; FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@RV,@Unit,@WText,@LText,@Status;
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
    INSERT dbo.Pallet(UoMID,Width,Length,Status,CreatedBy)
    OUTPUT @Row,'OK','Created',inserted.ID,inserted.RowVersion INTO @Result
    VALUES(@UnitID,@W,@L,@Status,@Actor);
   ELSE IF @Cmd='D'
    UPDATE dbo.Pallet SET Status='Block',UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@Actor
    OUTPUT @Row,'OK','Blocked',inserted.ID,inserted.RowVersion INTO @Result WHERE ID=@ID AND RowVersion=@RV;
   ELSE
    UPDATE dbo.Pallet SET UoMID=@UnitID,Width=@W,Length=@L,Status=@Status,UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@Actor
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
  FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@RV,@Unit,@WText,@LText,@Status;
 END;
 CLOSE c; DEALLOCATE c;
 SELECT * FROM @Result ORDER BY RowNum;
END;
GO
