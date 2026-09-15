USE [test]
GO
SET NOCOUNT ON;

IF COL_LENGTH('dbo.Product','Status') IS NULL
    THROW 52600,'PRODUCT QUALITY: Status is required for soft blocking.',1;

IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE name='CK_Product_WeightGrams_Positive')
    THROW 52601,'PRODUCT QUALITY: positive weight constraint is required.',1;

IF NOT EXISTS(
    SELECT 1 FROM sys.table_types AS t JOIN sys.columns AS c ON c.object_id=t.type_table_object_id
    WHERE SCHEMA_NAME(t.schema_id)='dbo' AND t.name='ProductBatchType' AND c.name='Status'
) THROW 52602,'PRODUCT QUALITY: ProductBatchType must carry Status.',1;

IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.Customer') AND name='IX_Customer_Market_Status_Name')
    THROW 52603,'CUSTOMER PERFORMANCE: expected filter index.',1;

PRINT 'PASS: Customer/Product User Master hardening schema';
GO
