-- After 158. Manager approval is followed by review by the original Sales requester.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.Opportunity','EstimateDeliveryDate') IS NULL
 THROW 52996,'Apply migration 158 first.',1;
IF COL_LENGTH('dbo.PackagingConfigurationRequestItem','SalesReviewedAt') IS NULL
 ALTER TABLE dbo.PackagingConfigurationRequestItem ADD SalesReviewedBy INT NULL REFERENCES dbo.Users(ID),SalesReviewedAt DATETIME2 NULL,SalesReviewComment NVARCHAR(2000) NULL;
IF COL_LENGTH('dbo.NPDRecipeSheet','SalesReviewStatus') IS NULL
BEGIN
 ALTER TABLE dbo.NPDRecipeSheet ADD SalesReviewStatus VARCHAR(20) NOT NULL CONSTRAINT DF_NPD_SalesReview DEFAULT 'Not submitted',
 SalesReviewedBy INT NULL REFERENCES dbo.Users(ID),SalesReviewedAt DATETIME2 NULL,SalesReviewComment NVARCHAR(2000) NULL;
 EXEC(N'UPDATE dbo.NPDRecipeSheet SET SalesReviewStatus=''Accepted'' WHERE ApprovalStatus=''Approved'';');
END;
IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE name='CK_NPD_SalesReviewStatus')
 EXEC(N'ALTER TABLE dbo.NPDRecipeSheet ADD CONSTRAINT CK_NPD_SalesReviewStatus CHECK(SalesReviewStatus IN(''Not submitted'',''Pending'',''Accepted'',''Returned''));');
IF EXISTS(SELECT 1 FROM sys.check_constraints WHERE name='CK_PCRI_Stage')
 ALTER TABLE dbo.PackagingConfigurationRequestItem DROP CONSTRAINT CK_PCRI_Stage;
IF EXISTS(SELECT 1 FROM sys.check_constraints WHERE name='CK_PCRI_Open')
 ALTER TABLE dbo.PackagingConfigurationRequestItem DROP CONSTRAINT CK_PCRI_Open;
ALTER TABLE dbo.PackagingConfigurationRequestItem ADD CONSTRAINT CK_PCRI_Stage CHECK(Stage IN('Assigned','Working','Returned','Pending Review','Awaiting Sales','Approved','Canceled'));
ALTER TABLE dbo.PackagingConfigurationRequestItem ADD CONSTRAINT CK_PCRI_Open CHECK((IsOpen=0 AND Stage IN('Approved','Canceled')) OR (IsOpen=1 AND Stage IN('Assigned','Working','Returned','Pending Review','Awaiting Sales')));
DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingRequestItem_Transition_AuditImplementation'));
IF @D IS NULL THROW 52996,'Packaging transition procedure is missing.',1;
IF @D NOT LIKE '%Awaiting Sales%'
BEGIN
 IF @D NOT LIKE '%Stage=@TargetStage,IsOpen=CASE WHEN @TargetStage IN(''Approved'',''Canceled'') THEN 0 ELSE 1 END%'
  THROW 52996,'Unexpected packaging transition definition. Review migration 159.',1;
 SET @D=REPLACE(@D,'Stage=@TargetStage,IsOpen=CASE WHEN @TargetStage IN(''Approved'',''Canceled'') THEN 0 ELSE 1 END','Stage=CASE WHEN @TargetStage=''Approved'' THEN ''Awaiting Sales'' ELSE @TargetStage END,IsOpen=CASE WHEN @TargetStage=''Canceled'' THEN 0 ELSE 1 END');
 SET @D=N'ALTER '+SUBSTRING(@D,CHARINDEX('PROCEDURE',UPPER(@D)),LEN(@D));
 EXEC sys.sp_executesql @D;
END;
COMMIT TRANSACTION;
GO
