import {test,expect} from '@playwright/test';
import {tcbReviewItems} from '../src/tcb-review-model';
test('review includes only the selected top-level item and all descendants',()=>{
 const rows=[{ItemID:10},{ItemID:11,ParentItemID:10},{ItemID:13},{ItemID:15,ParentItemID:11},{ItemID:12,ParentItemID:10},{ItemID:16,ParentItemID:13}];
 expect(tcbReviewItems(rows,10).map(r=>r.ItemID)).toEqual([10,11,15,12]);
 expect(tcbReviewItems(rows,13).map(r=>r.ItemID)).toEqual([13,16]);
 expect(tcbReviewItems(rows,11)).toEqual([]);
 expect(tcbReviewItems(rows,99)).toEqual([]);
});
