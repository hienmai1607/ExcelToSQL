import {test,expect} from '@playwright/test';
import {floorVisualization} from '../src/load-visualization';

const bounds={length:12032,width:2352,height:2393};
const positions=Array.from({length:1200},(_,i)=>({x:Math.floor(i/15)*150,y:i%15*150,length:150,width:150}));

test('4800 cartons are fully represented by a detailed third and a grouped remainder',()=>{
 const view=floorVisualization(positions,4800,4,500,bounds);
 expect(view.error).toBeUndefined();expect(view.cutMM).toBe(4050);
 expect(view.detailed.cartons).toBe(1620);expect(view.grouped.cartons).toBe(3180);
 expect(view.detailed.rows).toBe(27);expect(view.grouped.rows).toBe(53);
 expect(view.detailed.acrossMin).toBe(15);expect(view.detailed.layers).toBe(4);
 expect(view.boxes).toHaveLength(2);
 expect(view.boxes[0].grid).toEqual({x:27,y:15,z:4});
 expect(view.boxes[1]).toMatchObject({x:4050,length:7950,width:2250,height:2000,aggregate:true});
 expect(view.boxes.reduce((n,b)=>n+(b.cartons??0),0)).toBe(4800);
});

test('partial loads fill from the back towards the doors without phantom cartons',()=>{
 const view=floorVisualization(positions,2500,4,500,bounds);
 expect(view.detailed.cartons+view.grouped.cartons).toBe(2500);
 expect(view.boxes.reduce((n,b)=>n+(b.cartons??0),0)).toBe(2500);
 expect(view.grouped.partialCartons).toBe(40);
 expect(view.grouped.envelope).toBe(true);
 for(const box of view.boxes){expect(box.x+box.length).toBeLessThanOrEqual(bounds.length);expect(box.z+box.height).toBeLessThanOrEqual(bounds.height)}
});

test('large carton counts use compressed grid surfaces rather than per-carton objects',()=>{
 const view=floorVisualization(positions,1200000,1000,1,{...bounds,height:1000});
 expect(view.error).toBeUndefined();expect(view.boxes).toHaveLength(2);
 expect(view.detailed.cartons+view.grouped.cartons).toBe(1200000);
 expect(view.boxes.reduce((sum,box)=>sum+(box.cartons??0),0)).toBe(1200000);
});

test('small and zero loads are never forced into an invented remaining block',()=>{
 const small=floorVisualization(positions,10,4,500,bounds);
 expect(small.detailed.cartons).toBe(10);expect(small.grouped.cartons).toBe(0);
 expect(small.boxes.reduce((n,b)=>n+(b.cartons??0),0)).toBe(10);
 expect(floorVisualization(positions,0,4,500,bounds).boxes).toEqual([]);
});

test('mixed footprint rows retain exact counts and do not cut a carton in half',()=>{
 const p=[{x:0,y:0,length:300,width:200},{x:0,y:200,length:300,width:200},{x:300,y:0,length:200,width:300},{x:500,y:0,length:200,width:300}];
 const view=floorVisualization(p,7,2,200,{length:900,width:400,height:400});
 expect(view.error).toBeUndefined();expect(view.detailed.cartons+view.grouped.cartons).toBe(7);
 expect(view.boxes.reduce((n,b)=>n+(b.cartons??0),0)).toBe(7);
 for(const box of view.boxes.filter(b=>!b.aggregate))expect(box.x+box.length).toBeLessThanOrEqual(view.cutMM);
});

test('incomplete or invalid geometry is explained rather than silently truncating a load',()=>{
 expect(floorVisualization([],100,4,500,bounds).error).toBeTruthy();
 expect(floorVisualization(positions,4801,4,500,bounds).error).toBeTruthy();
 expect(floorVisualization(positions,4800,5,500,bounds).error).toBeTruthy();
});
