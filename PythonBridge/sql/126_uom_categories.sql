-- Unit categories and canonical factors: mass=g, distance=mm, area=mm2, volume=ml, count=EA.
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;
BEGIN TRY
 BEGIN TRANSACTION;
 IF COL_LENGTH('dbo.UoM','Category') IS NULL ALTER TABLE dbo.UoM ADD Category NVARCHAR(30) NOT NULL CONSTRAINT DF_UoM_Category DEFAULT N'Unit/Count';
 IF COL_LENGTH('dbo.UoM','BaseFactor') IS NULL ALTER TABLE dbo.UoM ADD BaseFactor DECIMAL(24,12) NOT NULL CONSTRAINT DF_UoM_BaseFactor DEFAULT 1;
 IF OBJECT_ID('dbo.CK_UoM_Category','C') IS NULL EXEC(N'ALTER TABLE dbo.UoM WITH CHECK ADD CONSTRAINT CK_UoM_Category CHECK(Category IN(N''Weight/Mass'',N''Length/Distance'',N''Area'',N''Volume'',N''Unit/Count'',N''Other''))');
 IF OBJECT_ID('dbo.CK_UoM_BaseFactor','C') IS NULL EXEC(N'ALTER TABLE dbo.UoM WITH CHECK ADD CONSTRAINT CK_UoM_BaseFactor CHECK(BaseFactor>0)');
 IF NOT EXISTS(SELECT 1 FROM dbo.UoM WHERE UoMCode=N'g')
  INSERT dbo.UoM(UoMCode,UoMName,Status,CreatedBy) SELECT N'g',N'Grams',N'Active',MIN(ID) FROM dbo.Users WHERE IsActive=1;
 -- Classify existing units once; subsequent runs must not overwrite Admin-maintained factors.
 IF NOT EXISTS(SELECT 1 FROM sys.extended_properties WHERE major_id=OBJECT_ID('dbo.UoM') AND name=N'Categories126')
 BEGIN
  EXEC(N'UPDATE u SET Category=v.Category,BaseFactor=v.Factor FROM dbo.UoM u JOIN(VALUES
   (N''g'',N''Weight/Mass'',CONVERT(DECIMAL(24,12),1)),
   (N''kg'',N''Weight/Mass'',1000),(N''mt'',N''Weight/Mass'',1000000),
   (N''oz'',N''Weight/Mass'',28.349523125),(N''lbs'',N''Weight/Mass'',453.59237),(N''lb'',N''Weight/Mass'',453.59237),
   (N''mm'',N''Length/Distance'',1),(N''m'',N''Length/Distance'',1000),(N''cm'',N''Length/Distance'',10),(N''in'',N''Length/Distance'',25.4),
   (N''m2'',N''Area'',1000000),(N''ml'',N''Volume'',1),(N''l'',N''Volume'',1000),(N''m3'',N''Volume'',1000000),
   (N''ea'',N''Unit/Count'',1))v(Code,Category,Factor) ON LOWER(u.UoMCode)=v.Code;');
  EXEC sys.sp_addextendedproperty @name=N'Categories126',@value=N'1',@level0type=N'SCHEMA',@level0name=N'dbo',@level1type=N'TABLE',@level1name=N'UoM';
 END;
 COMMIT;
END TRY
BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK;
 THROW;
END CATCH;
