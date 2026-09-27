USE [test]
GO
-- Preserve existing material units before enforcing master selections.
INSERT dbo.UoM(UoMCode,UoMName,CreatedBy)
 SELECT m.UnitOfMeasure,m.UnitOfMeasure,MIN(m.CreatedBy) FROM dbo.PackagingMaterial m
 WHERE NOT EXISTS(SELECT 1 FROM dbo.UoM u WHERE u.UoMCode=m.UnitOfMeasure)
 GROUP BY m.UnitOfMeasure;
GO
CREATE OR ALTER PROCEDURE dbo.usp_PackagingMaterial_Batch
    @Rows dbo.PackagingMaterialBatchType READONLY, @Username NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT OFF;
    DECLARE @ActorID INT;
    EXEC dbo.usp_Packaging_Authorize @Username,'Maintain',@ActorID OUTPUT;
    IF (SELECT COUNT(*) FROM @Rows)>500 THROW 51105,'Maximum 500 rows per batch.',1;
    IF EXISTS(SELECT ID FROM @Rows WHERE ID IS NOT NULL GROUP BY ID HAVING COUNT(*)>1)
        THROW 51106,'Duplicate record IDs in batch.',1;
    DECLARE @Result TABLE(RowNum INT,Status VARCHAR(10),Message NVARCHAR(2048),NewID INT,NewRowVersion VARBINARY(8));
    DECLARE @RowNum INT,@Command CHAR(1),@ID INT,@RV VARBINARY(8),@OwnTran BIT,@Code NVARCHAR(40),@Name NVARCHAR(200),@Description NVARCHAR(500),@Unit NVARCHAR(20),@Status VARCHAR(10);
    DECLARE rows_cursor CURSOR LOCAL FAST_FORWARD FOR
        SELECT RowNum,UPPER(Command),ID,RowVersionB64,NULLIF(LTRIM(RTRIM(MaterialCode)),N''),NULLIF(LTRIM(RTRIM(MaterialName)),N''),Description,NULLIF(LTRIM(RTRIM(UnitOfMeasure)),N''),Status FROM @Rows ORDER BY RowNum;
    OPEN rows_cursor;
    FETCH NEXT FROM rows_cursor INTO @RowNum,@Command,@ID,@RV,@Code,@Name,@Description,@Unit,@Status;
    WHILE @@FETCH_STATUS=0
    BEGIN
        SET @OwnTran=0;
        BEGIN TRY
            IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION; SET @OwnTran=1; END
            ELSE SAVE TRANSACTION PackagingRow;
            IF @Command NOT IN('C','U','D') THROW 51107,'Use C, U or D.',1;
            IF @Command IN('U','D') AND NOT EXISTS(
                SELECT 1 FROM dbo.PackagingMaterial WITH(UPDLOCK,HOLDLOCK)
                WHERE ID=@ID AND RowVersion=@RV)
                THROW 51108,'Concurrency conflict or row not found. Refresh first.',1;
            IF @Command<>'D'
            BEGIN
                IF @Command='U' AND @Status IS NULL
                    SELECT @Status=Status FROM dbo.PackagingMaterial WHERE ID=@ID;
                IF @Status IS NOT NULL AND @Status NOT IN('Active','Block')
                    THROW 51109,'Status must be Active or Block.',1;
                IF @Name IS NULL OR @Unit IS NULL THROW 51110,'Material Name and Unit of Measure are required.',1;
                IF NOT EXISTS(SELECT 1 FROM dbo.UoM WITH(UPDLOCK,HOLDLOCK) WHERE UoMCode=@Unit AND
                 (Status='Active' OR (@Command='U' AND EXISTS(SELECT 1 FROM dbo.PackagingMaterial WHERE ID=@ID AND UnitOfMeasure=@Unit))))
                 THROW 51111,'Choose an active Unit of Measure from UoM Master.',1;
            END;
            IF @Command IN('U','D') AND @Code IS NOT NULL AND EXISTS(SELECT 1 FROM dbo.PackagingMaterial WHERE ID=@ID AND MaterialCode COLLATE Latin1_General_100_BIN2<>@Code COLLATE Latin1_General_100_BIN2)
                THROW 51110,'Material code is read-only.',1;
            IF @Command='C'
            BEGIN
                IF @Code IS NOT NULL THROW 51110,'Material code is generated automatically. Leave it blank.',1;
                DECLARE @Number BIGINT;
                SET @Number=NEXT VALUE FOR dbo.PackagingMaterialCodeSequence;
                SET @Code='PKG-'+RIGHT(REPLICATE('0',10)+CONVERT(VARCHAR(10),@Number),10);
                WHILE EXISTS(SELECT 1 FROM dbo.PackagingMaterial WHERE MaterialCode=@Code)
                BEGIN
                    SET @Number=NEXT VALUE FOR dbo.PackagingMaterialCodeSequence;
                    SET @Code='PKG-'+RIGHT(REPLICATE('0',10)+CONVERT(VARCHAR(10),@Number),10);
                END;
                INSERT dbo.PackagingMaterial(MaterialCode,MaterialName,Description,UnitOfMeasure,Status,CreatedBy)
                OUTPUT @RowNum,'OK','Created',inserted.ID,inserted.RowVersion INTO @Result
                VALUES(@Code,@Name,@Description,@Unit,COALESCE(@Status,'Active'),@ActorID);
            END
            ELSE IF @Command='D'
                UPDATE dbo.PackagingMaterial SET Status='Block',UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@ActorID
                OUTPUT @RowNum,'OK','Blocked',inserted.ID,inserted.RowVersion INTO @Result
                WHERE ID=@ID AND RowVersion=@RV;
            ELSE
                UPDATE dbo.PackagingMaterial SET MaterialName=@Name,Description=@Description,UnitOfMeasure=@Unit,Status=COALESCE(@Status,Status),UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@ActorID
                OUTPUT @RowNum,'OK','Updated',inserted.ID,inserted.RowVersion INTO @Result
                WHERE ID=@ID AND RowVersion=@RV;
            IF @OwnTran=1 COMMIT;
        END TRY
        BEGIN CATCH
            IF @OwnTran=1 AND XACT_STATE()<>0 ROLLBACK;
            ELSE IF XACT_STATE()=1 ROLLBACK TRANSACTION PackagingRow;
            ELSE IF XACT_STATE()=-1 THROW;
            DELETE @Result WHERE RowNum=@RowNum;
            INSERT @Result VALUES(@RowNum,'ERROR',ERROR_MESSAGE(),@ID,NULL);
        END CATCH;
        FETCH NEXT FROM rows_cursor INTO @RowNum,@Command,@ID,@RV,@Code,@Name,@Description,@Unit,@Status;
    END;
    CLOSE rows_cursor; DEALLOCATE rows_cursor;
    SELECT r.*,m.MaterialCode AS NewMaterialCode FROM @Result r LEFT JOIN dbo.PackagingMaterial m ON m.ID=r.NewID ORDER BY r.RowNum;
END;
GO

CREATE OR ALTER PROCEDURE dbo.usp_UoM_Batch @Rows dbo.UoMBatchType READONLY,@Username NVARCHAR(100)
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT OFF;
 DECLARE @Actor INT;
 SELECT @Actor=u.ID FROM dbo.Users u WHERE u.UserName=@Username AND u.IsActive=1;
 IF @Actor IS NULL THROW 51101,'Username is incorrect.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope='Admin') THROW 51102,'Admin access is required for this action.',1;
 IF (SELECT COUNT(*) FROM @Rows)>500 THROW 51105,'Maximum 500 rows per batch.',1;
 IF EXISTS(SELECT ID FROM @Rows WHERE ID IS NOT NULL GROUP BY ID HAVING COUNT(*)>1) THROW 51106,'Duplicate record IDs.',1;
 DECLARE @Result TABLE(RowNum INT,Status VARCHAR(10),Message NVARCHAR(2048),NewID INT,NewRowVersion VARBINARY(8));
 DECLARE @Row INT,@Cmd CHAR(1),@ID INT,@Name NVARCHAR(40),@UoMName NVARCHAR(500),@Status VARCHAR(10),@RV VARBINARY(8),@Own BIT;
 DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT RowNum,UPPER(Command),ID,NULLIF(LTRIM(RTRIM(UoMCode)),''),NULLIF(LTRIM(RTRIM(UoMName)),''),Status,RowVersionB64 FROM @Rows ORDER BY RowNum;
 OPEN c;FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@Name,@UoMName,@Status,@RV;
 WHILE @@FETCH_STATUS=0
 BEGIN
  SET @Own=0;
  BEGIN TRY
   IF @@TRANCOUNT=0 BEGIN BEGIN TRANSACTION;SET @Own=1;END ELSE SAVE TRANSACTION UoMRow;
   IF @Cmd NOT IN('C','U','D') THROW 51107,'Use C, U or D.',1;
   IF @Cmd IN('U','D') AND NOT EXISTS(SELECT 1 FROM dbo.UoM WITH(UPDLOCK,HOLDLOCK) WHERE ID=@ID AND RowVersion=@RV)
    THROW 51108,'Concurrency conflict or row not found. Refresh first.',1;
   IF @Cmd<>'D' AND @Name IS NULL THROW 51110,'UoM name is required.',1;
   IF @Status IS NOT NULL AND @Status NOT IN('Active','Block') THROW 51109,'Status must be Active or Block.',1;
   IF @Cmd='U' AND (EXISTS(SELECT 1 FROM dbo.PackagingPrice p JOIN dbo.UoM u ON p.PriceBasis=u.UoMCode WHERE u.ID=@ID AND u.UoMCode<>@Name)
    OR EXISTS(SELECT 1 FROM dbo.PackagingMaterial m JOIN dbo.UoM u ON m.UnitOfMeasure=u.UoMCode WHERE u.ID=@ID AND u.UoMCode<>@Name))
    THROW 51111,'Referenced UoM code cannot be changed. Change its name instead.',1;
   IF @Cmd='C'
    INSERT dbo.UoM(UoMCode,UoMName,Status,CreatedBy)
    OUTPUT @Row,'OK','Created',inserted.ID,inserted.RowVersion INTO @Result VALUES(@Name,@UoMName,COALESCE(@Status,'Active'),@Actor);
   ELSE IF @Cmd='D'
    UPDATE dbo.UoM SET Status='Block',UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()
    OUTPUT @Row,'OK','Blocked',inserted.ID,inserted.RowVersion INTO @Result WHERE ID=@ID AND RowVersion=@RV;
   ELSE
    UPDATE dbo.UoM SET UoMCode=@Name,UoMName=@UoMName,Status=COALESCE(@Status,Status),UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME()
    OUTPUT @Row,'OK','Updated',inserted.ID,inserted.RowVersion INTO @Result WHERE ID=@ID AND RowVersion=@RV;
   IF @Own=1 COMMIT;
  END TRY
  BEGIN CATCH
   IF @Own=1 AND XACT_STATE()<>0 ROLLBACK;
   ELSE IF XACT_STATE()=1 ROLLBACK TRANSACTION UoMRow;
   ELSE IF XACT_STATE()=-1 THROW;
   DELETE @Result WHERE RowNum=@Row;
   INSERT @Result VALUES(@Row,'ERROR',ERROR_MESSAGE(),@ID,NULL);
  END CATCH;
  FETCH NEXT FROM c INTO @Row,@Cmd,@ID,@Name,@UoMName,@Status,@RV;
 END
 CLOSE c;DEALLOCATE c;SELECT * FROM @Result ORDER BY RowNum;
END
GO
