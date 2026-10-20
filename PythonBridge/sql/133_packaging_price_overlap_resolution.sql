-- After 132. Preserve row validation errors and opt in to safe tier resolution.
-- Procedure changes only: existing price records are untouched by this migration.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingPrice_BatchV5'));
 IF @D IS NULL THROW 51123,'Packaging Price V5 is required before migration 133.',1;
 IF CHARINDEX(N'@ReturnJSON',@D)=0
 BEGIN
  IF CHARINDEX(N'@Username NVARCHAR(100)',@D)=0
   OR CHARINDEX(N'SELECT * FROM @Result ORDER BY RowNum;',@D)=0
   OR CHARINDEX(N'/* Half-open quantity intervals [from,to); inclusive effective dates. */',@D)=0
   THROW 51123,'Unexpected Packaging Price V5 contract.',1;
  SET @D=REPLACE(@D,N'@Username NVARCHAR(100)',N'@Username NVARCHAR(100),
    @ResultJSON NVARCHAR(MAX)=NULL OUTPUT,@ReturnJSON BIT=0,@ResolveOverlap BIT=0');
  SET @D=REPLACE(@D,N'/* Half-open quantity intervals [from,to); inclusive effective dates. */',N'-- Opt-in tier resolution; never permit overlapping active prices.
                    IF @ResolveOverlap=1 AND @Command=''C'' AND COALESCE(@Status,''Active'')=''Active''
                    BEGIN
                        DECLARE @NextBoundary DECIMAL(18,4);
                        SELECT @NextBoundary=MIN(QuantityFrom)
                        FROM dbo.PackagingPrice WITH(UPDLOCK,HOLDLOCK)
                        WHERE MaterialID=@Material AND CurrencyID=@Currency AND PriceBasis=@Basis
                          AND (VendorID=@Vendor OR (VendorID IS NULL AND @Vendor IS NULL))
                          AND Status=''Active'' AND QuantityFrom>@QFrom
                          AND (@To IS NULL OR EffectiveFrom<=@To)
                          AND (EffectiveTo IS NULL OR @From<=EffectiveTo);
                        IF @NextBoundary IS NOT NULL AND (@QTo IS NULL OR @QTo>@NextBoundary)
                            SET @QTo=@NextBoundary;
                        -- Close only the identical tier. Do not discard another quantity tier
                        -- or the tail of an existing price after a finite new date window.
                        IF @To IS NULL
                            UPDATE dbo.PackagingPrice WITH(UPDLOCK,HOLDLOCK)
                            SET EffectiveTo=DATEADD(DAY,-1,@From),
                                UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@ActorID
                            WHERE MaterialID=@Material AND CurrencyID=@Currency AND PriceBasis=@Basis
                              AND (VendorID=@Vendor OR (VendorID IS NULL AND @Vendor IS NULL))
                              AND Status=''Active'' AND QuantityFrom=@QFrom
                              AND (QuantityTo=@QTo OR (QuantityTo IS NULL AND @QTo IS NULL))
                              AND EffectiveFrom<@From AND (EffectiveTo IS NULL OR EffectiveTo>=@From);
                    END;
                    /* Half-open quantity intervals [from,to); inclusive effective dates. */');
  SET @D=REPLACE(@D,N'Active price date and quantity ranges overlap.',N'Price ranges overlap');
  SET @D=REPLACE(@D,N'SELECT * FROM @Result ORDER BY RowNum;',N'
    IF @ReturnJSON=1
        SET @ResultJSON=(SELECT RowNum,Status,Message,NewID,
            CONVERT(VARCHAR(18),NewRowVersion,1) NewRowVersion FROM @Result ORDER BY RowNum FOR JSON PATH);
    ELSE SELECT * FROM @Result ORDER BY RowNum;');
  SET @D=STUFF(@D,1,CHARINDEX(N'PROCEDURE',UPPER(@D))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
  EXEC sys.sp_executesql @D;
 END;

 SET @D=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingPrice_BatchV6'));
 IF @D IS NULL THROW 51123,'Packaging Price V6 is required before migration 133.',1;
 IF CHARINDEX(N'@CapturedResult',@D)=0
 BEGIN
  IF CHARINDEX(N'INSERT @One EXEC dbo.usp_PackagingPrice_BatchV5 @Rows,@Username;',@D)=0
   THROW 51123,'Unexpected Packaging Price V6 contract.',1;
  -- Output parameters avoid INSERT-EXEC, which forbids a callee rolling back.
  SET @D=REPLACE(@D,N'INSERT @One EXEC dbo.usp_PackagingPrice_BatchV5 @Rows,@Username;',N'
   DECLARE @CapturedResult NVARCHAR(MAX),@Resolve BIT;
   SET @CapturedResult=NULL;
   SET @Resolve=CASE JSON_VALUE(@Doc,''$.ResolveOverlap'') WHEN ''true'' THEN 1 WHEN ''1'' THEN 1 ELSE 0 END;
   EXEC dbo.usp_PackagingPrice_BatchV5 @Rows,@Username,@CapturedResult OUTPUT,1,@Resolve;
   INSERT @One SELECT RowNum,Status,Message,NewID,CONVERT(VARBINARY(8),NewRowVersion,1)
   FROM OPENJSON(@CapturedResult) WITH(RowNum INT,Status VARCHAR(10),Message NVARCHAR(2048),NewID INT,NewRowVersion VARCHAR(18));');
  SET @D=STUFF(@D,1,CHARINDEX(N'PROCEDURE',UPPER(@D))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
  EXEC sys.sp_executesql @D;
 END;
 COMMIT TRANSACTION;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
 THROW;
END CATCH;
