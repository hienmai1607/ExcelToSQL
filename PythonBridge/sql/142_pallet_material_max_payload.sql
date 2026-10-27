-- After 141. Pallet limits are maximum GROSS kg, including base and accessories.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 IF COL_LENGTH('dbo.LossProcessMaster','Shared') IS NULL
  THROW 52996,'Apply migrations through 141 first.',1;
 IF COL_LENGTH('dbo.PackagingMaterial','MaxPayloadKG') IS NULL
 BEGIN
  ALTER TABLE dbo.PackagingMaterial ADD MaxPayloadKG DECIMAL(18,3) NULL;
  EXEC(N'ALTER TABLE dbo.PackagingMaterial ADD CONSTRAINT CK_PackagingMaterial_MaxPayload CHECK(MaxPayloadKG>0);');
 END;
 -- User-approved initial gross limits. Reruns never overwrite maintained values.
 EXEC sys.sp_executesql N'UPDATE m SET MaxPayloadKG=1200
 FROM dbo.PackagingMaterial m JOIN dbo.PackagingType t ON t.ID=m.PackagingTypeID
 WHERE t.PackagingType=N''Pallet'' AND m.MaterialCode IN(N''PKG-0000000412'',N''PKG-0000000424'')
 AND m.MaxPayloadKG IS NULL;';
 COMMIT;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
END CATCH;
