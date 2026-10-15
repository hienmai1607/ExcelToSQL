-- After 112. Admin may respond without taking over the PIC assignment.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @OverrideP SYSNAME,@OverrideOld NVARCHAR(MAX),@OverrideNew NVARCHAR(MAX),@OverrideD NVARCHAR(MAX);
 DECLARE override_changes CURSOR LOCAL FAST_FORWARD FOR SELECT * FROM (VALUES
 (N'dbo.usp_PackagingResponse_Batch_AuditImplementation',
  N'(i.PICUserID=@ActorID AND (@IsAdmin=1 OR dbo.fn_PackagingPICMember(@ActorID)=1))',
  N'(@IsAdmin=1 OR (i.PICUserID=@ActorID AND dbo.fn_PackagingPICMember(@ActorID)=1))'),
 (N'dbo.usp_PackagingRequestItem_Transition_AuditImplementation',
  N'IF @Action=''Maintain'' AND (@PIC IS NULL OR @PIC<>@ActorID OR (@IsAdmin=0 AND dbo.fn_PackagingPICMember(@ActorID)=0))',
  N'IF @IsAdmin=0 AND @Action=''Maintain'' AND (@PIC IS NULL OR @PIC<>@ActorID OR dbo.fn_PackagingPICMember(@ActorID)=0)'),
 (N'dbo.usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation',
  N'(PICUserID=@Actor AND (@Admin=1 OR dbo.fn_PackagingPICMember(@Actor)=1))',
  N'(@Admin=1 OR (PICUserID=@Actor AND dbo.fn_PackagingPICMember(@Actor)=1))'),
 (N'dbo.usp_PkgPricing_ItemAuthorize',
  N'(PICUserID=@Actor AND (@Admin=1 OR dbo.fn_PackagingPICMember(@Actor)=1))',
  N'(@Admin=1 OR (PICUserID=@Actor AND dbo.fn_PackagingPICMember(@Actor)=1))')
 ) v(ProcedureName,OldText,NewText);
 OPEN override_changes;
 FETCH NEXT FROM override_changes INTO @OverrideP,@OverrideOld,@OverrideNew;
 WHILE @@FETCH_STATUS=0
 BEGIN
  SET @OverrideD=OBJECT_DEFINITION(OBJECT_ID(@OverrideP));
  IF @OverrideD IS NULL THROW 52996,'Apply earlier Packaging migrations first.',1;
  IF CHARINDEX(@OverrideNew,@OverrideD)=0
  BEGIN
   IF CHARINDEX(@OverrideOld,@OverrideD)=0 THROW 52996,'Unexpected Packaging authorization definition; migration rolled back.',1;
   SET @OverrideD=REPLACE(@OverrideD,@OverrideOld,@OverrideNew);
  END;
  SET @OverrideD=REPLACE(@OverrideD,N'Only the assigned PIC can',N'Only the assigned PIC or Admin can');
  IF CHARINDEX(N'-- Admin response ownership override (113)',@OverrideD)=0
   SET @OverrideD=@OverrideD+CHAR(10)+N'-- Admin response ownership override (113)';
  SET @OverrideD=STUFF(@OverrideD,1,CHARINDEX(N'PROCEDURE',UPPER(@OverrideD))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
  EXEC sys.sp_executesql @OverrideD;
  FETCH NEXT FROM override_changes INTO @OverrideP,@OverrideOld,@OverrideNew;
 END;
 CLOSE override_changes;
 DEALLOCATE override_changes;
 COMMIT;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
END CATCH;
