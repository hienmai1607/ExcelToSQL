USE [test]
GO
-- Additional optional parameters preserve existing Excel callers.
CREATE OR ALTER PROCEDURE dbo.usp_Customer_Read
    @Username NVARCHAR(100),
    @IsAdmin BIT = 0,
    @CustomerName VARCHAR(200) = NULL,
    @MarketID INT = NULL,
    @Status VARCHAR(10) = NULL,
    @PageNumber INT = 1,
    @PageSize INT = 200,
    @CurrencyID INT = NULL,
    @CreatedBy INT = NULL,
    @Sort NVARCHAR(2000) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @PageSize>500 SET @PageSize=500;
    IF @PageSize<1 SET @PageSize=1;
    IF @PageNumber<1 SET @PageNumber=1;

    IF NOT EXISTS(
        SELECT 1
        FROM dbo.Users AS u
        JOIN dbo.UserAccess AS a ON a.UserID=u.ID
        WHERE u.UserName=@Username AND u.IsActive=1
          AND a.Scope IN(N'Admin',N'Customer',N'Opportunity')
    ) THROW 51041,'Customer access is required for this action.',1;


    SET @Sort=COALESCE(NULLIF(@Sort,N''),N'[{"column":"CustomerName","direction":"asc"}]');
    IF ISJSON(@Sort)<>1 OR LEFT(LTRIM(@Sort),1)<>N'['
        THROW 51042,'Invalid Customer sort.',1;
    IF (SELECT COUNT(*) FROM OPENJSON(@Sort))>8
        THROW 51042,'Too many sort columns.',1;
    IF EXISTS(SELECT 1 FROM OPENJSON(@Sort) WITH(col NVARCHAR(100) '$.column',dir NVARCHAR(10) '$.direction') s
        WHERE col IS NULL OR col COLLATE Latin1_General_100_BIN2 NOT IN(N'CustomerName',N'MarketCode',N'CurrencyCode',N'Status',N'UpdatedAt',N'CreatedAt',N'CreatedByName',N'UpdatedByName')
           OR dir IS NULL OR dir COLLATE Latin1_General_100_BIN2 NOT IN(N'asc',N'desc'))
        THROW 51042,'Invalid Customer sort column or direction.',1;
    IF EXISTS(SELECT col FROM OPENJSON(@Sort) WITH(col NVARCHAR(100) '$.column') s GROUP BY col HAVING COUNT(*)>1)
        THROW 51042,'Duplicate sort column.',1;

    SELECT c.ID,c.CustomerName,c.MarketID,m.MarketCode,
           c.CurrencyID,cur.CurrencyCode,c.Status,c.CreatedAt,c.CreatedBy,
           c.UpdatedAt,c.UpdatedBy,c.RowVersion,
           creator.UserName AS CreatedByName, updater.UserName AS UpdatedByName,
           COUNT(*) OVER() AS TotalMatchingRows
    FROM dbo.Customer AS c
    JOIN dbo.Market AS m ON m.ID=c.MarketID
    JOIN dbo.Currency AS cur ON cur.ID=c.CurrencyID
    LEFT JOIN dbo.Users creator ON creator.ID=c.CreatedBy
    LEFT JOIN dbo.Users updater ON updater.ID=c.UpdatedBy
    WHERE (@CustomerName IS NULL OR c.CustomerName LIKE @CustomerName+'%')
      AND (@MarketID IS NULL OR c.MarketID=@MarketID)
      AND (@Status IS NULL OR c.Status=@Status)
      AND (@CurrencyID IS NULL OR c.CurrencyID=@CurrencyID)
      AND (@CreatedBy IS NULL OR c.CreatedBy=@CreatedBy)
    -- Each key keeps its native text/date type; ID provides stable page boundaries.
    ORDER BY CASE WHEN JSON_VALUE(@Sort,'$[0].direction')='asc' THEN CASE JSON_VALUE(@Sort,'$[0].column') WHEN 'CustomerName' THEN c.CustomerName WHEN 'MarketCode' THEN m.MarketCode WHEN 'CurrencyCode' THEN cur.CurrencyCode WHEN 'Status' THEN c.Status WHEN 'CreatedByName' THEN creator.UserName WHEN 'UpdatedByName' THEN updater.UserName END END ASC,
        CASE WHEN JSON_VALUE(@Sort,'$[0].direction')='asc' THEN CASE JSON_VALUE(@Sort,'$[0].column') WHEN 'CreatedAt' THEN c.CreatedAt WHEN 'UpdatedAt' THEN c.UpdatedAt END END ASC,
        CASE WHEN JSON_VALUE(@Sort,'$[0].direction')='desc' THEN CASE JSON_VALUE(@Sort,'$[0].column') WHEN 'CustomerName' THEN c.CustomerName WHEN 'MarketCode' THEN m.MarketCode WHEN 'CurrencyCode' THEN cur.CurrencyCode WHEN 'Status' THEN c.Status WHEN 'CreatedByName' THEN creator.UserName WHEN 'UpdatedByName' THEN updater.UserName END END DESC,
        CASE WHEN JSON_VALUE(@Sort,'$[0].direction')='desc' THEN CASE JSON_VALUE(@Sort,'$[0].column') WHEN 'CreatedAt' THEN c.CreatedAt WHEN 'UpdatedAt' THEN c.UpdatedAt END END DESC,
        CASE WHEN JSON_VALUE(@Sort,'$[1].direction')='asc' THEN CASE JSON_VALUE(@Sort,'$[1].column') WHEN 'CustomerName' THEN c.CustomerName WHEN 'MarketCode' THEN m.MarketCode WHEN 'CurrencyCode' THEN cur.CurrencyCode WHEN 'Status' THEN c.Status WHEN 'CreatedByName' THEN creator.UserName WHEN 'UpdatedByName' THEN updater.UserName END END ASC,
        CASE WHEN JSON_VALUE(@Sort,'$[1].direction')='asc' THEN CASE JSON_VALUE(@Sort,'$[1].column') WHEN 'CreatedAt' THEN c.CreatedAt WHEN 'UpdatedAt' THEN c.UpdatedAt END END ASC,
        CASE WHEN JSON_VALUE(@Sort,'$[1].direction')='desc' THEN CASE JSON_VALUE(@Sort,'$[1].column') WHEN 'CustomerName' THEN c.CustomerName WHEN 'MarketCode' THEN m.MarketCode WHEN 'CurrencyCode' THEN cur.CurrencyCode WHEN 'Status' THEN c.Status WHEN 'CreatedByName' THEN creator.UserName WHEN 'UpdatedByName' THEN updater.UserName END END DESC,
        CASE WHEN JSON_VALUE(@Sort,'$[1].direction')='desc' THEN CASE JSON_VALUE(@Sort,'$[1].column') WHEN 'CreatedAt' THEN c.CreatedAt WHEN 'UpdatedAt' THEN c.UpdatedAt END END DESC,
        CASE WHEN JSON_VALUE(@Sort,'$[2].direction')='asc' THEN CASE JSON_VALUE(@Sort,'$[2].column') WHEN 'CustomerName' THEN c.CustomerName WHEN 'MarketCode' THEN m.MarketCode WHEN 'CurrencyCode' THEN cur.CurrencyCode WHEN 'Status' THEN c.Status WHEN 'CreatedByName' THEN creator.UserName WHEN 'UpdatedByName' THEN updater.UserName END END ASC,
        CASE WHEN JSON_VALUE(@Sort,'$[2].direction')='asc' THEN CASE JSON_VALUE(@Sort,'$[2].column') WHEN 'CreatedAt' THEN c.CreatedAt WHEN 'UpdatedAt' THEN c.UpdatedAt END END ASC,
        CASE WHEN JSON_VALUE(@Sort,'$[2].direction')='desc' THEN CASE JSON_VALUE(@Sort,'$[2].column') WHEN 'CustomerName' THEN c.CustomerName WHEN 'MarketCode' THEN m.MarketCode WHEN 'CurrencyCode' THEN cur.CurrencyCode WHEN 'Status' THEN c.Status WHEN 'CreatedByName' THEN creator.UserName WHEN 'UpdatedByName' THEN updater.UserName END END DESC,
        CASE WHEN JSON_VALUE(@Sort,'$[2].direction')='desc' THEN CASE JSON_VALUE(@Sort,'$[2].column') WHEN 'CreatedAt' THEN c.CreatedAt WHEN 'UpdatedAt' THEN c.UpdatedAt END END DESC,
        CASE WHEN JSON_VALUE(@Sort,'$[3].direction')='asc' THEN CASE JSON_VALUE(@Sort,'$[3].column') WHEN 'CustomerName' THEN c.CustomerName WHEN 'MarketCode' THEN m.MarketCode WHEN 'CurrencyCode' THEN cur.CurrencyCode WHEN 'Status' THEN c.Status WHEN 'CreatedByName' THEN creator.UserName WHEN 'UpdatedByName' THEN updater.UserName END END ASC,
        CASE WHEN JSON_VALUE(@Sort,'$[3].direction')='asc' THEN CASE JSON_VALUE(@Sort,'$[3].column') WHEN 'CreatedAt' THEN c.CreatedAt WHEN 'UpdatedAt' THEN c.UpdatedAt END END ASC,
        CASE WHEN JSON_VALUE(@Sort,'$[3].direction')='desc' THEN CASE JSON_VALUE(@Sort,'$[3].column') WHEN 'CustomerName' THEN c.CustomerName WHEN 'MarketCode' THEN m.MarketCode WHEN 'CurrencyCode' THEN cur.CurrencyCode WHEN 'Status' THEN c.Status WHEN 'CreatedByName' THEN creator.UserName WHEN 'UpdatedByName' THEN updater.UserName END END DESC,
        CASE WHEN JSON_VALUE(@Sort,'$[3].direction')='desc' THEN CASE JSON_VALUE(@Sort,'$[3].column') WHEN 'CreatedAt' THEN c.CreatedAt WHEN 'UpdatedAt' THEN c.UpdatedAt END END DESC,
        CASE WHEN JSON_VALUE(@Sort,'$[4].direction')='asc' THEN CASE JSON_VALUE(@Sort,'$[4].column') WHEN 'CustomerName' THEN c.CustomerName WHEN 'MarketCode' THEN m.MarketCode WHEN 'CurrencyCode' THEN cur.CurrencyCode WHEN 'Status' THEN c.Status WHEN 'CreatedByName' THEN creator.UserName WHEN 'UpdatedByName' THEN updater.UserName END END ASC,
        CASE WHEN JSON_VALUE(@Sort,'$[4].direction')='asc' THEN CASE JSON_VALUE(@Sort,'$[4].column') WHEN 'CreatedAt' THEN c.CreatedAt WHEN 'UpdatedAt' THEN c.UpdatedAt END END ASC,
        CASE WHEN JSON_VALUE(@Sort,'$[4].direction')='desc' THEN CASE JSON_VALUE(@Sort,'$[4].column') WHEN 'CustomerName' THEN c.CustomerName WHEN 'MarketCode' THEN m.MarketCode WHEN 'CurrencyCode' THEN cur.CurrencyCode WHEN 'Status' THEN c.Status WHEN 'CreatedByName' THEN creator.UserName WHEN 'UpdatedByName' THEN updater.UserName END END DESC,
        CASE WHEN JSON_VALUE(@Sort,'$[4].direction')='desc' THEN CASE JSON_VALUE(@Sort,'$[4].column') WHEN 'CreatedAt' THEN c.CreatedAt WHEN 'UpdatedAt' THEN c.UpdatedAt END END DESC,
        CASE WHEN JSON_VALUE(@Sort,'$[5].direction')='asc' THEN CASE JSON_VALUE(@Sort,'$[5].column') WHEN 'CustomerName' THEN c.CustomerName WHEN 'MarketCode' THEN m.MarketCode WHEN 'CurrencyCode' THEN cur.CurrencyCode WHEN 'Status' THEN c.Status WHEN 'CreatedByName' THEN creator.UserName WHEN 'UpdatedByName' THEN updater.UserName END END ASC,
        CASE WHEN JSON_VALUE(@Sort,'$[5].direction')='asc' THEN CASE JSON_VALUE(@Sort,'$[5].column') WHEN 'CreatedAt' THEN c.CreatedAt WHEN 'UpdatedAt' THEN c.UpdatedAt END END ASC,
        CASE WHEN JSON_VALUE(@Sort,'$[5].direction')='desc' THEN CASE JSON_VALUE(@Sort,'$[5].column') WHEN 'CustomerName' THEN c.CustomerName WHEN 'MarketCode' THEN m.MarketCode WHEN 'CurrencyCode' THEN cur.CurrencyCode WHEN 'Status' THEN c.Status WHEN 'CreatedByName' THEN creator.UserName WHEN 'UpdatedByName' THEN updater.UserName END END DESC,
        CASE WHEN JSON_VALUE(@Sort,'$[5].direction')='desc' THEN CASE JSON_VALUE(@Sort,'$[5].column') WHEN 'CreatedAt' THEN c.CreatedAt WHEN 'UpdatedAt' THEN c.UpdatedAt END END DESC,
        CASE WHEN JSON_VALUE(@Sort,'$[6].direction')='asc' THEN CASE JSON_VALUE(@Sort,'$[6].column') WHEN 'CustomerName' THEN c.CustomerName WHEN 'MarketCode' THEN m.MarketCode WHEN 'CurrencyCode' THEN cur.CurrencyCode WHEN 'Status' THEN c.Status WHEN 'CreatedByName' THEN creator.UserName WHEN 'UpdatedByName' THEN updater.UserName END END ASC,
        CASE WHEN JSON_VALUE(@Sort,'$[6].direction')='asc' THEN CASE JSON_VALUE(@Sort,'$[6].column') WHEN 'CreatedAt' THEN c.CreatedAt WHEN 'UpdatedAt' THEN c.UpdatedAt END END ASC,
        CASE WHEN JSON_VALUE(@Sort,'$[6].direction')='desc' THEN CASE JSON_VALUE(@Sort,'$[6].column') WHEN 'CustomerName' THEN c.CustomerName WHEN 'MarketCode' THEN m.MarketCode WHEN 'CurrencyCode' THEN cur.CurrencyCode WHEN 'Status' THEN c.Status WHEN 'CreatedByName' THEN creator.UserName WHEN 'UpdatedByName' THEN updater.UserName END END DESC,
        CASE WHEN JSON_VALUE(@Sort,'$[6].direction')='desc' THEN CASE JSON_VALUE(@Sort,'$[6].column') WHEN 'CreatedAt' THEN c.CreatedAt WHEN 'UpdatedAt' THEN c.UpdatedAt END END DESC,
        CASE WHEN JSON_VALUE(@Sort,'$[7].direction')='asc' THEN CASE JSON_VALUE(@Sort,'$[7].column') WHEN 'CustomerName' THEN c.CustomerName WHEN 'MarketCode' THEN m.MarketCode WHEN 'CurrencyCode' THEN cur.CurrencyCode WHEN 'Status' THEN c.Status WHEN 'CreatedByName' THEN creator.UserName WHEN 'UpdatedByName' THEN updater.UserName END END ASC,
        CASE WHEN JSON_VALUE(@Sort,'$[7].direction')='asc' THEN CASE JSON_VALUE(@Sort,'$[7].column') WHEN 'CreatedAt' THEN c.CreatedAt WHEN 'UpdatedAt' THEN c.UpdatedAt END END ASC,
        CASE WHEN JSON_VALUE(@Sort,'$[7].direction')='desc' THEN CASE JSON_VALUE(@Sort,'$[7].column') WHEN 'CustomerName' THEN c.CustomerName WHEN 'MarketCode' THEN m.MarketCode WHEN 'CurrencyCode' THEN cur.CurrencyCode WHEN 'Status' THEN c.Status WHEN 'CreatedByName' THEN creator.UserName WHEN 'UpdatedByName' THEN updater.UserName END END DESC,
        CASE WHEN JSON_VALUE(@Sort,'$[7].direction')='desc' THEN CASE JSON_VALUE(@Sort,'$[7].column') WHEN 'CreatedAt' THEN c.CreatedAt WHEN 'UpdatedAt' THEN c.UpdatedAt END END DESC,c.ID ASC
    OFFSET (@PageNumber-1)*@PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;
END
GO


