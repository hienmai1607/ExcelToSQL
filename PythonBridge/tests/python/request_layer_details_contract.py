"""Local SQL integration; schema and fixtures are rolled back."""
import json
import re
import unittest
import web_requirement_sections_contract as foundation
from packaging_fields import consume
from schemas import OpportunityItemRow
from pydantic import ValidationError

class LayerDetails(foundation.WebRequirementSections):
    def setUp(self):
        super().setUp()
        if self._testMethodName=="test_migration_copies_all_active_layers_without_overwriting":
            self.cur.execute("IF COL_LENGTH('dbo.OpportunityItem','SecondarySpecialComments') IS NULL ALTER TABLE dbo.OpportunityItem ADD SecondarySpecialComments NVARCHAR(1000) NULL")
            self.cur.execute("IF EXISTS(SELECT 1 FROM sys.extended_properties WHERE class=0 AND name='PythonBridge.RequestLayerDetailsBackfill') EXEC sys.sp_dropextendedproperty @name=N'PythonBridge.RequestLayerDetailsBackfill'")
            self.cur.execute("UPDATE dbo.OpportunityItem SET PackagingLayerCount=3,RecycledContent='20%',SpecialComments='Legacy',SecondarySpecialComments='Keep' WHERE ID=?",self.item)
        self.apply_details()
        self.apply_details()

    def apply_details(self):
        source=(foundation.mix.foundation.ROOT/"sql/71_packaging_request_layer_details.sql").read_text(encoding="utf-8")
        for batch in re.split(r"^GO\s*$",source,flags=re.M|re.I):
            if batch.strip():
                self.cur.execute(batch)
                while self.cur.nextset():pass
        self.cur.execute("SET XACT_ABORT OFF")

    def test_independent_layers_mm_snapshot_and_audit(self):
        self.cur.execute("INSERT dbo.PackagingTypeOrder VALUES(?,'Tertiary')",self.types["Primary"])
        self.save_fields(PackagingLayerCount=3,MaxPalletHeightMM=1800,PrimaryTypeID=self.types["Primary"],
            SecondaryTypeID=self.types["Secondary"],TertiaryTypeID=self.types["Primary"],NumberOfPrimary=12,NumberOfSecondary=8,
            RecyclableRequirement="Yes",SecondaryRecyclableRequirement="No",
            TertiaryRecyclableRequirement="NA",SecondarySpecialComments="Secondary only",
            TertiarySpecialComments="Tertiary only")
        row=self.cur.execute("SELECT MaxPalletHeightM,MaxPalletHeightMM,SecondaryRecyclableRequirement,TertiarySpecialComments,ProductGradeSnapshot FROM dbo.OpportunityItem WHERE ID=?",self.item).fetchone()
        self.assertEqual(str(row[0]),"1.800");self.assertEqual(row[1],1800);self.assertEqual(row[2],"No")
        self.assertEqual(json.loads(row[4]),{"items":[]})
        self.assertGreater(self.cur.execute("SELECT COUNT(*) FROM dbo.OpportunityChangeLog WHERE ItemID=? AND FieldName='SecondarySpecialComments' AND ChangedBy=?",self.item,self.username).fetchval(),0)
        created=self.request([self.item]);id=created["items"][0]["ID"]
        saved=self.cur.execute("SELECT MaxPalletHeightMM,SecondaryRecyclableRequirement,TertiarySpecialComments FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",id).fetchone()
        self.assertEqual(tuple(saved),(1800,"No","Tertiary only"))
        with self.assertRaisesRegex(Exception,"immutable"):
            self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET SecondarySpecialComments='changed' WHERE ID=?",id)

    def test_migration_copies_all_active_layers_without_overwriting(self):
        row=self.cur.execute("SELECT SecondaryRecycledContent,TertiaryRecycledContent,SecondarySpecialComments,TertiarySpecialComments FROM dbo.OpportunityItem WHERE ID=?",self.item).fetchone()
        self.assertEqual(tuple(row),("20%","20%","Keep","Legacy"))
        self.save_fields(SecondaryRecycledContent=None)
        self.apply_details()
        self.assertIsNone(self.cur.execute("SELECT SecondaryRecycledContent FROM dbo.OpportunityItem WHERE ID=?",self.item).fetchval())

    def test_floor_load_and_inactive_layers_clear_new_fields(self):
        self.save_fields(PackagingLayerCount=3,MaxPalletHeightMM=1500,SecondarySpecialComments="S",TertiarySpecialComments="T")
        self.save_fields(WebPackagingRequirements=True,ConfigurationRequest="Floor load",PackagingLayerCount=1)
        row=self.cur.execute("SELECT MaxPalletHeightMM,MaxPalletHeightM,SecondarySpecialComments,TertiarySpecialComments FROM dbo.OpportunityItem WHERE ID=?",self.item).fetchone()
        self.assertEqual(tuple(row),(None,None,None,None))

    def test_height_clear_and_legacy_meter_edits_stay_synchronized(self):
        self.save_fields(MaxPalletHeightMM=1800)
        self.save_fields(MaxPalletHeightMM=None)
        self.assertEqual(tuple(self.cur.execute("SELECT MaxPalletHeightMM,MaxPalletHeightM FROM dbo.OpportunityItem WHERE ID=?",self.item).fetchone()),(None,None))
        self.save_fields(MaxPalletHeightM="1.234")
        self.assertEqual(self.cur.execute("SELECT MaxPalletHeightMM FROM dbo.OpportunityItem WHERE ID=?",self.item).fetchval(),1234)

    def test_grade_snapshot_tree_validation(self):
        base=dict(RowNum=1,Command="U",OpportunityNumber="X",ID=1)
        with self.assertRaises(ValidationError):
            OpportunityItemRow(**base,ProductGradeSnapshot={"items":[dict(ParentID="0",ID=1,Grade="G",RatioPct="99")]})
        with self.assertRaises(ValidationError):OpportunityItemRow(**base,MaxPalletHeightMM=1.8)

    def test_product_grade_snapshot_survives_master_changes_and_request_creation(self):
        version=self.cur.execute("INSERT dbo.ProductGradeVersion(ProductID,Version,Status,CreatedBy) VALUES(?,1,'Draft',?);SELECT CONVERT(INT,SCOPE_IDENTITY())",self.product,self.actor).fetchval()
        self.cur.execute("INSERT dbo.ProductGradeItem(VersionID,ParentID,ID,Grade,RatioPct) VALUES(?,'0',1,'Original snapshot',100)",version)
        self.cur.execute("UPDATE dbo.ProductGradeVersion SET Status='Active' WHERE ID=?",version)
        self.save_fields(PrimaryTypeID=self.types["Primary"],SecondaryTypeID=self.types["Secondary"])
        snapshot=self.cur.execute("SELECT ProductGradeSnapshot FROM dbo.OpportunityItem WHERE ID=?",self.item).fetchval()
        self.assertEqual(json.loads(snapshot)["items"][0]["Grade"],"Original snapshot")
        self.cur.execute("UPDATE dbo.ProductGradeVersion SET Status='Inactive' WHERE ID=?",version)
        new=self.cur.execute("INSERT dbo.ProductGradeVersion(ProductID,Version,Status,CreatedBy) VALUES(?,2,'Draft',?);SELECT CONVERT(INT,SCOPE_IDENTITY())",self.product,self.actor).fetchval()
        self.cur.execute("INSERT dbo.ProductGradeItem(VersionID,ParentID,ID,Grade,RatioPct) VALUES(?,'0',1,'New Master grade',100)",new)
        self.cur.execute("UPDATE dbo.ProductGradeVersion SET Status='Active' WHERE ID=?",new)
        self.save_fields(SpecialComments="Unrelated")
        self.assertEqual(self.cur.execute("SELECT ProductGradeSnapshot FROM dbo.OpportunityItem WHERE ID=?",self.item).fetchval(),snapshot)
        created=self.request([self.item]);request_item=created["items"][0]["ID"]
        self.assertEqual(self.cur.execute("SELECT ProductGradeSnapshot FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",request_item).fetchval(),snapshot)
        with self.assertRaisesRegex(Exception,"immutable"):
            self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET ProductGradeSnapshot=NULL WHERE ID=?",request_item)

    def test_web_dropdown_rejects_invalid_new_values_and_keeps_legacy(self):
        with self.assertRaisesRegex(Exception,"valid recyclable"):
            self.save_fields(WebPackagingRequirements=True,SecondaryRecycledContent="20%")
        self.save_fields(SecondaryRecycledContent="20%")
        self.save_fields(WebPackagingRequirements=True,SecondaryRecycledContent="20%")
        self.save_fields(WebPackagingRequirements=True,SecondaryRecycledContent="Yes")
        with self.assertRaisesRegex(Exception,"valid recyclable"):
            self.save_fields(WebPackagingRequirements=True,SecondaryRecycledContent="20%")

    def test_opportunity_grade_edit_does_not_write_product_master(self):
        name="Snapshot-only grade "+self.number
        grade=self.cur.execute("INSERT dbo.RawGrade(GradeName,CreatedBy) VALUES(?,?);SELECT CONVERT(INT,SCOPE_IDENTITY())",name,self.actor).fetchval()
        before=self.cur.execute("SELECT RowVersion FROM dbo.Product WHERE ID=?",self.product).fetchval()
        result=self.batch(self.edit(self.item,ProductID=self.product,ItemDescription="Grade snapshot copy",AnnualUnit=100,ProductGradeSnapshot={"items":[dict(ParentID="0",ID=1,RawGradeID=grade,Grade="Untrusted label",RatioPct="100")]}))
        self.assertEqual(result["item_results"][0]["Status"],"OK",result)
        stored=json.loads(self.cur.execute("SELECT ProductGradeSnapshot FROM dbo.OpportunityItem WHERE ID=?",self.item).fetchval())
        self.assertEqual(stored["items"][0]["Grade"],name)
        self.assertEqual(self.cur.execute("SELECT RowVersion FROM dbo.Product WHERE ID=?",self.product).fetchval(),before)
        self.assertEqual(self.cur.execute("SELECT COUNT(*) FROM dbo.ProductGradeVersion WHERE ProductID=?",self.product).fetchval(),0)

if __name__=="__main__":unittest.main()
