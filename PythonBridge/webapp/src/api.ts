export type Row = Record<string, string | number | boolean | null>;
export interface Page { rows: Row[]; total: number; page: number; page_size?: number }
export interface Session { username: string; scopes: string[]; is_admin: boolean; user_id?:number }
export interface RequestPayload {
 OpportunityID: number; ExpectedRowVersion: string; CreationKey: string;
 ResponseDue: string; RequestNotes: string | null;
 items: {OpportunityItemID:number; ExpectedRowVersion:string; PackagingRequirement:string|null}[];
}
export class ApiError extends Error { constructor(public status:number, message:string){super(message)} }
export async function call<T>(path:string, body?:unknown):Promise<T> {
 const headers:Record<string,string>={Accept:'application/json'};
 const testUser=sessionStorage.getItem('bridge.testUser');
 if(testUser) headers['X-User-Name']=testUser;
 if(body) headers['Content-Type']='application/json';
 let response:Response;
 try { response=await fetch(path,{method:body?'POST':'GET',headers,credentials:'same-origin',cache:'no-store',body:body?JSON.stringify(body):undefined}); }
 catch {throw new ApiError(0,'Cannot reach the API. Check the connection, then retry.');}
 const data=await response.json().catch(()=>null);
 if(!response.ok) {
  const detail=data?.detail;
  const message=Array.isArray(detail)?detail.map((x:{loc:string[];msg:string})=>x.loc.join('.')+': '+x.msg).join('; '):typeof detail==='string'?detail:'API request failed ('+response.status+').';
  throw new ApiError(response.status,message);
 }
 return data as T;
}
function query(values:Record<string,string|number|undefined>){return new URLSearchParams(Object.entries(values).filter(([,v])=>v!==''&&v!==undefined).map(([k,v])=>[k,String(v)])).toString()}
// Replace this adapter with generated connector services for Code Apps.
// Screens never reference a server address or database credentials.
export const api={
 customers:(page:number,size:number,filters:Record<string,string>)=>call<Page>('/api/customer?'+query({page,page_size:size,...filters})),
 customerLookups:()=>call<{markets:Row[];currencies:Row[];creators?:Row[]}>('/api/customer/lookups'),
 saveCustomers:(rows:Row[])=>call<{results:Row[]}>('/api/customer/batch',{rows}),
 saveCustomer:(row:Row)=>call<{results:Row[]}>('/api/customer/batch',{rows:[row]}),
 session:()=>call<Session>('/api/workbench/session'),
 opportunities:(page:number,size:number,filters:Record<string,string>)=>call<Page>('/api/opportunity/grid?'+query({page,page_size:size,...filters})),
 requests:(page:number,size:number,search:string,status:string,sort?:string)=>call<Page>('/api/workbench/requests?'+query({page,page_size:size,search,status,sort})),
 requestItems:(id:number,page:number,size=200,sort?:string)=>call<Page>('/api/packaging/requests?'+query({request_id:id,page,page_size:size,sort})),
 pics:()=>call<{rows:Row[]}>('/api/workbench/pics'),
 create:(payload:RequestPayload)=>call<{header:Row;items:Row[];replayed:boolean}>('/api/packaging/manual',payload),
 assign:(item:Row,pic:number)=>call<{result:Row}>('/api/packaging/items/'+item.ItemID+'/assign',{PICUserID:pic,ExpectedRowVersion:item.ItemRowVersion}),
};
export const text=(v:unknown)=>v===null||v===undefined||v===''?'—':String(v);
export const date=(v:unknown)=>v?String(v).slice(0,10):'—';
