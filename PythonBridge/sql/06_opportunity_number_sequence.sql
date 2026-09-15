USE [test]
GO

/*
   Run once before the updated usp_Opportunity_HeaderDetail_Batch.
   The seed continues after the largest existing identity so generated
   OPP-YYYY-##### values cannot collide with records created by the old
   MAX(ID)+1 implementation.
*/
IF OBJECT_ID(N'dbo.OpportunityNumberSequence', N'SO') IS NULL
BEGIN
    DECLARE @StartWith BIGINT = ISNULL((SELECT MAX(ID) + 1 FROM dbo.Opportunity), 1);
    DECLARE @Sql NVARCHAR(MAX) =
        N'CREATE SEQUENCE dbo.OpportunityNumberSequence AS INT START WITH ' +
        CAST(@StartWith AS NVARCHAR(20)) + N' INCREMENT BY 1;';
    EXEC sys.sp_executesql @Sql;
END
GO
