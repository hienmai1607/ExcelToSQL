"""Rollback-only family workflow tests using real parent/child identity."""
import unittest
from db import bytes_to_b64
from fastapi import HTTPException
from container_profiles_contract import ProfileFixture
import mix_parent_logistics_contract as foundation
import packaging_api as api
from auth import AccessContext

class Families(ProfileFixture,unittest.TestCase):
    batch=foundation.MixLogisticsSQL.batch
    activate=foundation.MixLogisticsSQL.activate
    create_mix=foundation.MixLogisticsSQL.create_mix
    edit=foundation.MixLogisticsSQL.edit
    request=foundation.MixLogisticsSQL.request
    def setUp(self):
        foundation.mix.OpportunityMixSQL.setUp(self)
        self.create_mix()
        self.migrate('105_packaging_pic_ownership.sql')
        self.migrate('113_admin_response_override.sql')
        standalone=foundation.mix.foundation.PackagingFoundation.request(self)
        self.request_id=self.cur.execute('SELECT RequestID FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',standalone).fetchval()
        for oid in (self.parent,self.child):
            self.cur.execute("""INSERT dbo.PackagingConfigurationRequestItem(RequestID,OpportunityItemID,ProductID,ProductCode,
                ProductName,ItemDescription,AnnualUnit,SourceRowVersion,Stage,IsOpen,CreatedBy)
                SELECT ?,oi.ID,p.ID,p.ProductCode,p.ProductName,oi.ItemDescription,oi.AnnualUnit,oi.RowVersion,'Assigned',1,?
                FROM dbo.OpportunityItem oi JOIN dbo.Product p ON p.ID=oi.ProductID WHERE oi.ID=?""",self.request_id,self.actor,oid)
        mapping={r[0]:r[1] for r in self.cur.execute('SELECT OpportunityItemID,ID FROM dbo.PackagingConfigurationRequestItem WHERE RequestID=?',self.request_id)}
        self.root=mapping[self.parent];self.kid=mapping[self.child];self.alone=mapping[self.item]
        self.group=[self.root,self.kid]
        from uuid import uuid4
        self.picname='FAMILY_'+uuid4().hex[:16]
        self.pic=self.cur.execute('INSERT dbo.Users(UserName,IsActive) OUTPUT inserted.ID VALUES(?,1)',self.picname).fetchval()
        self.cur.execute("INSERT dbo.UserAccess(UserID,Scope) VALUES(?,'Packaging')",self.pic)
        self.member=AccessContext(self.pic,self.picname,frozenset({'Packaging'}),{'requests':'edit'})
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET ResponseLayerCount=1,FirstPMType='Film',FirstPMMOQ=100 WHERE RequestID=?",self.request_id)
    def versions(self):
        return {r[0]:bytes_to_b64(r[1]) for r in self.cur.execute('SELECT ID,RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE RequestID=?',self.request_id) if r[0] in self.group}
    def assign(self):
        v=self.versions()
        return api.assign(self.root,api.Assignment(PICUserID=self.pic,ExpectedRowVersion=v[self.root],ExpectedGroupVersions=v),self.ctx)
    def transition(self,target,ctx=None,**changes):
        v=self.versions()
        return api.transition(self.root,api.Transition(ExpectedRowVersion=v[self.root],ExpectedGroupVersions=v,TargetStage=target,**changes),ctx or self.member)
    def stages(self):
        return {r[0]:r[1] for r in self.cur.execute('SELECT ID,Stage FROM dbo.PackagingConfigurationRequestItem WHERE RequestID=?',self.request_id)}
    def test_assignment_submit_approve_are_parent_atomic_and_leave_standalone(self):
        result=self.assign()
        self.assertEqual(set(result['GroupItemIDs']),set(self.group))
        pics=dict(self.cur.execute('SELECT ID,PICUserID FROM dbo.PackagingConfigurationRequestItem WHERE RequestID=?',self.request_id).fetchall())
        self.assertEqual(pics[self.root],self.pic);self.assertEqual(pics[self.kid],self.pic)
        self.assertNotEqual(pics[self.alone],self.pic)
        self.transition('Pending Review')
        self.assertEqual(self.stages(),{self.root:'Pending Review',self.kid:'Pending Review',self.alone:'Assigned'})
        self.transition('Approved',self.ctx)
        self.assertEqual(self.stages(),{self.root:'Approved',self.kid:'Approved',self.alone:'Assigned'})
    def test_incomplete_child_prevents_parent_submission(self):
        self.assign()
        self.cur.execute('UPDATE dbo.PackagingConfigurationRequestItem SET FirstPMMOQ=NULL WHERE ID=?',self.kid)
        with self.assertRaises(HTTPException) as failure:self.transition('Pending Review')
        self.assertEqual(failure.exception.status_code,422)
        self.assertEqual(set(self.stages().values()),{'Assigned'})

    def test_independent_child_edit_invalidates_only_its_parent_loading_plans(self):
        import json
        import load_planning_contract
        from load_planning import plan
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET PICUserID=?,SameConfig=0,ConfigurationRequest='Pallet load' WHERE RequestID=?",self.actor,self.request_id)
        container=self.cur.execute("SELECT TOP(1) ID FROM dbo.ContainerTypeMaster WHERE Status='Active'").fetchval()
        inputs=load_planning_contract.LoadingTests().inputs()
        identities={}
        for item in (self.root,self.alone):
            identity=self.cur.execute("INSERT dbo.ContainerLoadPlan(ItemID,ContainerID,Inputs,Result,CreatedBy) OUTPUT INSERTED.ID VALUES(?,?,?,?,?)",item,container,inputs.model_dump_json(),json.dumps(plan(inputs)),self.actor).fetchval()
            identities[item]=identity
            self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET LoadPlanID=? WHERE ID=?",identity,item)
            self.cur.execute("INSERT dbo.ResponseContainerLoadPlan(ItemID,ContainerID,PlanID,UpdatedBy) VALUES(?,?,?,?)",item,container,identity,self.actor)
        root_version=bytes(self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.root).fetchval())
        version=bytes_to_b64(self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.kid).fetchval())
        saved=api.response_save(api.ResponseBatch(rows=[dict(RowNum=1,ID=self.kid,RowVersion=version,ApplicableNetWeightGrams='175')]),self.ctx)['results'][0]
        self.assertEqual(saved['Status'],'OK')
        self.assertIsNone(self.cur.execute("SELECT LoadPlanID FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.root).fetchval())
        self.assertEqual(self.cur.execute("SELECT COUNT(*) FROM dbo.ResponseContainerLoadPlan WHERE ItemID=?",self.root).fetchval(),0)
        self.assertNotEqual(bytes(self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.root).fetchval()),root_version)
        self.assertEqual(self.cur.execute("SELECT LoadPlanID FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.alone).fetchval(),identities[self.alone])
        self.assertEqual(self.cur.execute("SELECT COUNT(*) FROM dbo.ContainerLoadPlan WHERE ID IN(?,?)",*identities.values()).fetchval(),2)
    def test_stale_child_prevents_whole_assignment(self):
        v=self.versions()
        self.cur.execute('UPDATE dbo.PackagingConfigurationRequestItem SET ResponseNotes=? WHERE ID=?','Concurrent child edit',self.kid)
        with self.assertRaises(HTTPException) as failure:api.assign(self.root,api.Assignment(PICUserID=self.pic,ExpectedRowVersion=v[self.root],ExpectedGroupVersions=v),self.ctx)
        self.assertEqual(failure.exception.status_code,409)
        self.assertNotEqual(self.cur.execute('SELECT PICUserID FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.root).fetchval(),self.pic)
    def test_header_counts_parent_groups_not_physical_children(self):
        from request_views import header_read
        result=header_read(self.username,1,25,self.number,None,'[]')
        row=next(r for r in result['rows'] if r['RequestID']==self.request_id)
        self.assertEqual(row['ItemCount'],2)
        self.assertEqual(row['Unassigned'],2)

    def test_child_endpoint_cannot_bypass_family(self):
        v=self.versions()
        api.assign(self.kid,api.Assignment(PICUserID=self.pic,ExpectedRowVersion=v[self.kid],ExpectedGroupVersions=v),self.ctx)
        self.assertEqual(self.cur.execute('SELECT PICUserID FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.root).fetchval(),self.pic)
    def test_other_pic_cannot_submit_any_member(self):
        self.assign()
        stranger=AccessContext(self.actor,self.username,frozenset({'Packaging'}),{'requests':'edit'})
        with self.assertRaises(HTTPException) as failure:self.transition('Pending Review',stranger)
        self.assertEqual(failure.exception.status_code,403)
        self.assertEqual(set(self.stages().values()),{'Assigned'})
