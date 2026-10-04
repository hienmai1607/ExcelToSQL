USE [test];
GO
-- Targeted, recoverable PET jar consolidation. Do not run against different IDs.
SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;
BEGIN TRANSACTION;
DECLARE @LockResult INT;
EXEC @LockResult=sys.sp_getapplock @Resource=N'PackagingTypeHierarchy',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
IF @LockResult<0 THROW 52975,'Could not lock Packaging Type hierarchy.',1;
IF OBJECT_ID('dbo.PackagingTypeMergeLog','U') IS NULL
 CREATE TABLE dbo.PackagingTypeMergeLog(
  MergeKey NVARCHAR(100) NOT NULL PRIMARY KEY,CanonicalID INT NOT NULL,RetiredID INT NOT NULL,
  BeforeJSON NVARCHAR(MAX) NOT NULL,MergedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),MergedBy INT NOT NULL);
IF NOT EXISTS(SELECT 1 FROM dbo.PackagingTypeMergeLog WITH(UPDLOCK,HOLDLOCK) WHERE MergeKey=N'PET jar 16 into 74032')
BEGIN
 IF NOT EXISTS(SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK) WHERE ID=16 AND ParentTypeID IS NULL AND PackagingType=N'PET jar' AND PackagingOrder='Primary' AND PriceBasis='Count' AND Status='Block')
  OR NOT EXISTS(SELECT 1 FROM dbo.PackagingType WITH(UPDLOCK,HOLDLOCK) WHERE ID=74032 AND ParentTypeID IS NULL AND PackagingType=N'PET jar' AND PackagingOrder='Secondary' AND PriceBasis='Count' AND Status='Active' AND Shipping=1)
  THROW 52975,'PET jar records changed. Inspect the merge targets before proceeding.',1;
 IF EXISTS(SELECT 1 FROM dbo.PackagingMaterial WHERE PackagingTypeID IN(16,210,211))
  OR EXISTS(SELECT 1 FROM dbo.PkgPricingMaster WHERE PackagingTypeID IN(16,210,211))
  OR EXISTS(SELECT 1 FROM dbo.OpportunityItem WHERE PrimaryTypeID IN(16,210,211) OR SecondaryTypeID IN(16,210,211) OR TertiaryTypeID IN(16,210,211))
  OR EXISTS(SELECT 1 FROM dbo.PackagingType WHERE ParentTypeID=16 AND ID NOT IN(210,211))
  OR EXISTS(SELECT 1 FROM dbo.PackagingType WHERE ParentTypeID IN(210,211))
  OR EXISTS(SELECT 1 FROM dbo.PackagingDimension WHERE PackagingTypeID IN(74032,210,211))
  OR (SELECT COUNT(*) FROM dbo.PackagingDimension WHERE PackagingTypeID=16)<>1
  OR NOT EXISTS(SELECT 1 FROM dbo.PackagingDimension WHERE ID=37112 AND PackagingTypeID=16 AND D1Name IS NOT NULL AND D2Name IS NOT NULL AND D3Name IS NOT NULL AND D1UoMID IS NOT NULL AND D2UoMID IS NOT NULL AND D3UoMID IS NOT NULL)
  OR NOT EXISTS(SELECT 1 FROM dbo.PackagingType WHERE ID=210 AND ParentTypeID=16 AND PackagingType=N'Lid')
  OR NOT EXISTS(SELECT 1 FROM dbo.PackagingType WHERE ID=211 AND ParentTypeID=16 AND PackagingType=N'Seal')
  THROW 52975,'PET jar dependencies changed. Inspect them before proceeding.',1;
 DECLARE @Actor INT=(SELECT TOP(1) u.ID FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE u.IsActive=1 AND a.Scope='Admin' ORDER BY u.ID);
 IF @Actor IS NULL THROW 52975,'An active Admin is required for the merge audit.',1;
 DECLARE @Before NVARCHAR(MAX)=(SELECT
  JSON_QUERY((SELECT * FROM dbo.PackagingType WHERE ID IN(16,74032,210,211) FOR JSON PATH)) Types,
  JSON_QUERY((SELECT * FROM dbo.PackagingTypeOrder WHERE PackagingTypeID IN(16,74032) FOR JSON PATH)) Orders,
  JSON_QUERY((SELECT * FROM dbo.PackagingDimension WHERE ID=37112 FOR JSON PATH)) Dimensions FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 INSERT dbo.PackagingTypeMergeLog(MergeKey,CanonicalID,RetiredID,BeforeJSON,MergedBy)
 VALUES(N'PET jar 16 into 74032',74032,16,@Before,@Actor);
 -- Archive, do not delete: the before-image also preserves all original attributes.
 UPDATE dbo.PackagingType SET PackagingType=N'PET jar (legacy #16)',Status='Block',UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME() WHERE ID=16;
 UPDATE dbo.PackagingType SET Status='Block',UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME() WHERE ID IN(210,211);
 UPDATE dbo.PackagingDimension SET PackagingTypeID=74032,UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME() WHERE ID=37112;
 IF NOT EXISTS(SELECT 1 FROM dbo.PackagingTypeOrder WHERE PackagingTypeID=74032 AND PackagingOrder='Primary')
  INSERT dbo.PackagingTypeOrder(PackagingTypeID,PackagingOrder) VALUES(74032,'Primary');
 UPDATE dbo.PackagingType SET PackagingOrder='Primary',UpdatedBy=@Actor,UpdatedAt=SYSUTCDATETIME() WHERE ID=74032;
END;
IF NOT EXISTS(SELECT 1 FROM dbo.PackagingType WHERE ID=74032 AND PackagingType=N'PET jar' AND Shipping=1 AND Status='Active')
 OR (SELECT COUNT(*) FROM dbo.PackagingTypeOrder WHERE PackagingTypeID=74032 AND PackagingOrder IN('Primary','Secondary'))<>2
 OR NOT EXISTS(SELECT 1 FROM dbo.PackagingDimension WHERE ID=37112 AND PackagingTypeID=74032)
 THROW 52975,'PET jar consolidation postcondition failed.',1;
COMMIT;
GO
