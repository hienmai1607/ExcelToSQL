"""Level 1 grade eligibility for approved seasoning recipes and local process stages."""
import copy,re

def root_path(path):
    return '/'.join(str(path).split('/')[:2])

def seasoning_ids(config):
    components={r['ID'] for r in config['components'] if r['SystemKey']=='Seasoning'}
    return {r['ProcessID'] for r in config['mappings'] if r['ComponentID'] in components}

def allows_seasoning(approved,path,requires=False):
    if path=='0':return False
    if approved and not approved.get('Inactive') and not approved.get('Stale'):
        paths=approved.get('ApplicableGradePaths')
        if paths is None and approved.get('CapturedGrades') is not None:
            paths=['0/'+str(g['ID']) for g in approved['CapturedGrades'] if str(g.get('ParentID'))=='0']
        return paths is None or root_path(path) in paths
    return not requires

def validate_seasoning_scope(inputs,config,approved,requires=False):
    ids=seasoning_ids(config)
    for stage in inputs.get('ProcessLosses') or []:
        if any(c.get('MasterID') in ids for c in stage.get('Codes') or []) and not allows_seasoning(approved,stage['Path'],requires):
            raise ValueError('Seasoning is allowed only on grades included in an approved Recipe Sheet; it cannot be assigned to All grades.')
    # Legacy item-wide process assignments cannot express a seasoning grade scope.
    if any(c.get('MasterID') in ids for c in inputs.get('LossProcesses') or []):
        raise ValueError('Assign Seasoning to its confirmed grade in Process Loss, rather than an item-wide process.')

def normalize_seasoning_scope(inputs,config,approved,paths):
    """Re-home old All-grades Seasoning without changing Packing or formula meaning."""
    result=copy.deepcopy(inputs);before=copy.deepcopy(result.get('ProcessLosses') or [])
    if not before:return result
    ids=seasoning_ids(config);moved=[];changed=False
    for stage in result['ProcessLosses']:
        if stage.get('Codes') is None:continue
        codes=[];ratios=[]
        for code,ratio in zip(stage['Codes'],stage['Ratios']):
            if code.get('MasterID') in ids:
                if stage['Path']=='0':moved.append((code,ratio));changed=True;continue
                if not allows_seasoning(approved,stage['Path']):changed=True;continue
                code['Shared']=False
            codes.append(code);ratios.append(ratio)
        stage.update(Codes=codes,Ratios=ratios)
    for path in paths:
        if not allows_seasoning(approved,path):continue
        stage=next((r for r in result['ProcessLosses'] if r['Path']==path),None)
        if stage is None and moved:
            stage=dict(Path=path,Codes=[],Ratios=[],Formula='');result['ProcessLosses'].append(stage)
        for code,ratio in moved:
            if any(c.get('MasterID')==code.get('MasterID') for c in stage['Codes'] or []):continue
            stage['Codes'].append({**code,'Shared':False});stage['Ratios'].append(ratio)
    if not changed:return result
    legacy=result.get('ProcessLossMode')!='GradePath'
    if legacy:result.update(ProcessLossMode='GradePath',ProcessLossLayout='Aligned')
    def projected(rows,path):
        offsets={}
        for r in sorted((r for r in rows if r['Path']!='0'),key=lambda r:len(r['Path'].split('/')),reverse=True):
            offsets[r['Path']]=max((offsets[c['Path']]+len(c['Ratios']) for c in rows if c['Path'].startswith(r['Path']+'/')),default=0)
        offsets['0']=max((offsets[r['Path']]+len(r['Ratios']) for r in rows if r['Path']!='0'),default=0)
        refs={};index=0
        for r in sorted((r for r in rows if r['Path']=='0' or path==r['Path'] or path.startswith(r['Path']+'/')),key=lambda r:len(r['Path'].split('/')),reverse=True):
            for i,code in enumerate(r.get('Codes') or []):
                slot=offsets[r['Path']]+i if result.get('ProcessLossLayout')=='Aligned' else index
                refs[slot+1]=(r['Path'],code.get('MasterID') or code['ProcessName']);index+=1
        return refs
    if legacy:
        formulas={}
        candidates=set(paths)|{r['Path'] for r in before if r['Path']!='0'}
        for path in (p for p in candidates if not any(c.startswith(p+'/') for c in candidates)):
            refs=projected(before,path);parts=[]
            for stage in sorted((r for r in before if r['Path']=='0' or path==r['Path'] or path.startswith(r['Path']+'/')),key=lambda r:len(r['Path'].split('/')),reverse=True):
                slots=[n for n,source in refs.items() if source[0]==stage['Path']]
                if not slots:continue
                formula=stage.get('Formula') or '1-'+'*'.join('(1-L'+str(i+1)+')' for i in range(len(slots)))
                parts.append(re.sub(r'\bL(\d+)\b',lambda m:'L'+str(slots[int(m[1])-1]) if int(m[1])<=len(slots) else m[0],formula))
            formulas[path]=parts[0] if len(parts)==1 else '1-'+'*'.join('(1-('+part+'))' for part in parts) if parts else ''
        result['ProcessLossFormulas']=formulas
    result.pop('ProcessLossResults',None)
    for path,formula in (result.get('ProcessLossFormulas') or {}).items():
        old=projected(before,path);new=projected(result['ProcessLosses'],path)
        def replace(match):
            source=old.get(int(match[1]))
            slots=[n for n,value in new.items() if value==source]
            if not slots and source and source[0]=='0':slots=[n for n,value in new.items() if value[1]==source[1]]
            return 'L'+str(slots[0]) if len(slots)==1 else '0'
        result['ProcessLossFormulas'][path]=re.sub(r'\bL(\d+)\b',replace,formula or '')
    return result
