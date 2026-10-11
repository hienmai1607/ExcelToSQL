
import {expect,type Page} from '@playwright/test';
export async function captureRevealScrolls(page:Page){
 await page.addInitScript(()=>{
  (window as any).revealScrolls=[];
  HTMLElement.prototype.scrollIntoView=function(options){
   (window as any).revealScrolls.push({label:this.getAttribute('aria-label'),classes:this.className,...(typeof options==='object'?options:{})});
  };
 });
}
export async function expectReveal(page:Page,label:string|null,behavior='smooth'){
 await expect.poll(()=>page.evaluate(()=> (window as any).revealScrolls.at(-1))).toMatchObject({label,...(label===null?{classes:"add-section"}:{}),behavior,block:'end'});
}
