#!/usr/bin/env python3
"""Fixed-project, GET-only inventory. No deployments, scans of player docs or credential exports."""
import argparse, datetime, hashlib, json, os, re, shutil, subprocess, urllib.error, urllib.parse, urllib.request
from pathlib import Path
PROJECT = 'homebasedb'
PROJECT_NUMBER = '476832900272'
REGIONS = ('asia-east1', 'asia-southeast1')
PARAMETERS = ('NEXUS_PRIVATE_IDENTITY_ENABLED', 'NEXUS_FARM_BACKEND_ENABLED', 'NEXUS_REFINEMENT_RELEASE_CONTROL_ENABLED')
CALLABLES = ('nexusIdentity','photoSession','liveSession','growthForest','gameOpsAdmin','gameOpsAnnouncements','gameOpsFarmTransaction','gameOpsGuardDog','gameOpsDailyChallenges','gameOpsRedeem')
CANDIDATE_RULE_HASHES = {'firestore':'7a11f36306c195c659426b8e01641dc984ebbcb4c6c994710f80bae9cd693a3b','storage':'88537bf4dbb31bef2c4ced5643867777911ea5fd4837024469bf02fbd0566733','database':'4f74ce8928556e3527bf61cc705189782e284645a48d8ef4754d5aab252fb8f8'}
REQUIRED_INDEXES = [
 {'collectionGroup':'ops_refinement_records','queryScope':'COLLECTION','fields':[{'fieldPath':'filterTokens','arrayConfig':'CONTAINS'},{'fieldPath':'createdAt','order':'DESCENDING'}]},
 {'collectionGroup':'ops_refinement_farm_snapshots','queryScope':'COLLECTION','fields':[{'fieldPath':'date','order':'ASCENDING'},{'fieldPath':'occurredAt','order':'ASCENDING'}]}]
CONFIG_POINTERS = {'refining':('ops_game_config/refinement','ops_refinement_versions'), 'reset':('ops_game_config/refinement-reset','ops_refinement_reset_versions'), 'stones':('ops_game_config/refinement-stones','ops_refinement_stone_versions')}
CANDIDATE_DATABASE_CANONICAL_SHA256 = 'fab4967858646cb3a48dee72e4c88490305d4ff72cbe37d302b1b337e3461de2'
MAX_RESPONSE = 2 * 1024 * 1024

def sha(data): return hashlib.sha256(data).hexdigest()
def field_value(v):
    for key in ('stringValue','booleanValue','timestampValue','referenceValue'):
        if key in v: return v[key]
    if 'integerValue' in v: return int(v['integerValue'])
    if 'doubleValue' in v: return v['doubleValue']
    if 'mapValue' in v: return {k:field_value(x) for k,x in v['mapValue'].get('fields',{}).items()}
    if 'arrayValue' in v: return [field_value(x) for x in v['arrayValue'].get('values',[])]
    return None

def safe_config(value, key=None):
    allowed = {'schemaVersion','version','effectiveAt','levels','level','bonus','attack','criticalRate','chainCriticalRate','successRateBp','coins','stones','enabled','pity','guaranteeAttempt','coinsRefundBp','stonesRefundBp','checkin','mission','chests','gift','days','chanceBp','min','max','cycle','claimLimit','extensions','weekly','encyclopedia','implemented','wolf','tiger','gorilla','mole','dragon','eagle','cobra','giant','hornet','contentHash',*[str(i) for i in range(1,8)]}
    if isinstance(value,dict):return {k:safe_config(v,k) for k,v in value.items() if k in allowed}
    if isinstance(value,list):return [safe_config(v,key) for v in value]
    if value is None or type(value) in (bool,int,float):return value
    if isinstance(value,str) and key in ('version','cycle','contentHash') and re.fullmatch('[A-Za-z0-9_-]{1,80}',value):return value
    return 'UNVERIFIED_FORMAT'

def allowed_url(url):
    u = urllib.parse.urlsplit(url)
    if u.scheme != 'https' or u.username or u.password or u.port not in (None,443): return False
    p = u.path; project = r'(?:homebasedb|476832900272)'
    routes = {
      'cloudresourcemanager.googleapis.com':r'/v3/projects/homebasedb',
      'cloudfunctions.googleapis.com':r'/v2/projects/homebasedb/locations/(?:asia-east1|asia-southeast1)/functions',
      'firebaserules.googleapis.com':r'/v1/projects/'+project+r'/(?:releases|rulesets/[A-Za-z0-9_-]+)',
      'firebasehosting.googleapis.com':r'/v1beta1/projects/homebasedb/sites',
      'firebasedatabase.googleapis.com':r'/v1beta/projects/homebasedb/locations/-/instances',
      'firestore.googleapis.com':r'/v1/projects/homebasedb/databases/\(default\)(?:/collectionGroups/-/indexes|/collectionGroups/(?:boxes|users)/fields/(?:openedAt|farm\.stolenEggs20261123|farm\.monsterKills20261123)|/documents/(?:ops_identity_state/global|ops_refinement_release/current|ops_game_config/(?:refinement|refinement-reset|refinement-stones)|ops_refinement_(?:versions|reset_versions|stone_versions)/[A-Za-z0-9_-]{1,80}))?'
    }
    if u.hostname in ('homebasedb-default-rtdb.asia-southeast1.firebasedatabase.app','homebasedb-default-rtdb.firebaseio.com','homebasedb.firebaseio.com'):
        valid = p == '/.settings/rules.json'
    else: valid = bool(u.hostname in routes and re.fullmatch(routes[u.hostname],p))
    return valid and all(k in ('pageSize','pageToken','mask.fieldPaths') for k,_ in urllib.parse.parse_qsl(u.query))

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl): return None

class Client:
    def __init__(self, token): self._token=token; self.requests=[]; self.opener=urllib.request.build_opener(NoRedirect())
    def get(self,url):
        if not allowed_url(url): raise ValueError('Refusing non-inventory URL')
        self.requests.append({'method':'GET','observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'host':urllib.parse.urlsplit(url).hostname,'path':urllib.parse.urlsplit(url).path})
        request=urllib.request.Request(url,headers={'Authorization':'Bearer '+self._token,'Accept':'application/json'},method='GET')
        try:
            with self.opener.open(request,timeout=30) as response:
                raw=response.read(MAX_RESPONSE+1)
                if len(raw)>MAX_RESPONSE: return 0,{'error':{'status':'RESPONSE_TOO_LARGE'}}
                return response.status,json.loads(raw)
        except urllib.error.HTTPError as e:
            try: data=json.loads(e.read(MAX_RESPONSE))
            except Exception: data={}
            return e.code,{'error':{'status':data.get('error',{}).get('status','HTTP_ERROR')}}
        except Exception: return 0,{'error':{'status':'CONNECTION_OR_RESPONSE_ERROR'}}

class Inventory:
    def __init__(self, client, output):
        self.client=client; self.output=output; self.errors=[]; self.sections={}; self.config_reads=0; self.doc_status={}
    def get(self,section,url,optional=False):
        code,data=self.client.get(url)
        if code==200: return data
        if optional and code==404: return None
        reason=data.get('error',{}).get('status','HTTP_ERROR')
        if not re.fullmatch('[A-Z_]+',str(reason)): reason='HTTP_ERROR'
        self.errors.append({'section':section,'httpStatus':code,'reason':reason}); return None
    def pages(self,section,url,key):
        rows=[]; seen=set(); current=url
        for _ in range(100):
            data=self.get(section,current)
            if data is None: return rows,False
            rows.extend(data.get(key,[])); token=data.get('nextPageToken')
            if not token: return rows,True
            if token in seen: break
            seen.add(token); current=url+('&' if '?' in url else '?')+urllib.parse.urlencode({'pageToken':token})
        self.errors.append({'section':section,'reason':'PAGINATION_INCOMPLETE','httpStatus':0}); return rows,False
    def save(self,name,value):
        target=self.output/name; target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        target.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n');target.chmod(0o600)
    def doc(self,name):
        self.config_reads+=1
        before=len(self.errors)
        data=self.get('parameters:'+name,'https://firestore.googleapis.com/v1/projects/'+PROJECT+'/databases/(default)/documents/'+name,optional=True)
        self.doc_status[name]='ERROR' if len(self.errors)>before else 'ABSENT' if data is None else 'READ'
        return None if data is None else {k:field_value(v) for k,v in data.get('fields',{}).items()}
    def functions(self):
        by_region={}
        for region in REGIONS:
            rows,complete=self.pages('functions:'+region,'https://cloudfunctions.googleapis.com/v2/projects/'+PROJECT+'/locations/'+region+'/functions?pageSize=100','functions')
            safe=[]
            for row in rows:
                service=row.get('serviceConfig',{}); env=service.get('environmentVariables',{})
                parameters={k:(env[k]=='true' if env.get(k) in ('true','false') else 'UNVERIFIED_FORMAT') if k in env else 'UNSPECIFIED' for k in PARAMETERS}
                safe.append({'name':row.get('name'),'state':row.get('state'),'environment':row.get('environment'),'runtime':row.get('buildConfig',{}).get('runtime'),'updateTime':row.get('updateTime'),'service':{k:service.get(k) for k in ('uri','serviceAccountEmail','availableMemory','availableCpu','timeoutSeconds','minInstanceCount','maxInstanceCount','maxInstanceRequestConcurrency')},'parameters':parameters})
            by_region[region]={'complete':complete,'functions':safe}
        self.save('services.json',by_region)
        return {region:{'complete':v['complete'],'count':len(v['functions']),'missingExistingCallables':sorted(set(CALLABLES)-{x['name'].split('/')[-1] for x in v['functions']}) if v['complete'] else None,'notActive':[x['name'].split('/')[-1] for x in v['functions'] if x['state']!='ACTIVE'],'parameters':{x['name'].split('/')[-1]:x['parameters'] for x in v['functions'] if x['name'].split('/')[-1] in CALLABLES}} for region,v in by_region.items()}
    def indexes(self):
        parent='https://firestore.googleapis.com/v1/projects/'+PROJECT+'/databases/(default)/collectionGroups/'
        rows,complete=self.pages('indexes',parent+'-/indexes?pageSize=100','indexes')
        self.save('indexes.json',{'complete':complete,'indexes':rows})
        checks=[]
        for expected in REQUIRED_INDEXES:
            def matches(row):
                fields=[{k:v for k,v in x.items() if k in ('fieldPath','order','arrayConfig')} for x in row.get('fields',[]) if x.get('fieldPath')!='__name__']
                return '/collectionGroups/'+expected['collectionGroup']+'/' in row.get('name','') and row.get('queryScope')==expected['queryScope'] and fields==expected['fields']
            found=[x for x in rows if matches(x)]
            checks.append({'collectionGroup':expected['collectionGroup'],'status':'READY' if any(x.get('state')=='READY' for x in found) else 'NOT_READY' if found else 'MISSING' if complete else 'UNKNOWN','states':[x.get('state') for x in found]})
        fields=[]
        for group,field,order in [('boxes','openedAt','ASCENDING'),('users','farm.stolenEggs20261123','DESCENDING'),('users','farm.monsterKills20261123','DESCENDING')]:
            data=self.get('field-index:'+field,parent+group+'/fields/'+field,optional=True)
            found=[] if data is None else [x for x in data.get('indexConfig',{}).get('indexes',[]) if x.get('queryScope')=='COLLECTION_GROUP' and any(y.get('fieldPath')==field and y.get('order')==order for y in x.get('fields',[]))]
            fields.append({'collectionGroup':group,'fieldPath':field,'status':'READY' if any(x.get('state')=='READY' for x in found) else 'NOT_READY' if found else 'UNVERIFIED' if data is None else 'MISSING','states':[x.get('state') for x in found]})
            if data is not None:self.save('field-index-'+field+'.json',data)
        return {'composite':checks,'collectionGroupFields':fields}
    def rules(self):
        releases,complete=self.pages('rules-releases','https://firebaserules.googleapis.com/v1/projects/'+PROJECT+'/releases?pageSize=100','releases');result=[]
        for release in releases:
            name=release.get('name','');kind='firestore' if name.endswith('/releases/cloud.firestore') else 'storage' if '/releases/firebase.storage/' in name else None
            if not kind:continue
            ruleset=release.get('rulesetName','')
            if not re.fullmatch(r'projects/(homebasedb|476832900272)/rulesets/[A-Za-z0-9_-]+',ruleset):
                self.errors.append({'section':'rules','httpStatus':0,'reason':'UNEXPECTED_RULESET_TARGET'});continue
            data=self.get('ruleset:'+kind,'https://firebaserules.googleapis.com/v1/'+ruleset)
            if data is None:continue
            files=data.get('source',{}).get('files',[]);hashes=[]
            for i,file in enumerate(files):
                content=file.get('content','').encode();digest=sha(content);hashes.append(digest)
                target=self.output/'rules'/f'{kind}-{digest}.rules';target.parent.mkdir(exist_ok=True,mode=0o700);target.write_bytes(content);target.chmod(0o600)
            result.append({'kind':kind,'release':name,'ruleset':ruleset,'updateTime':release.get('updateTime'),'fileHashes':hashes,'exactCandidateMatch':len(hashes)==1 and hashes[0]==CANDIDATE_RULE_HASHES[kind]})
        return {'releaseListComplete':complete,'releases':result,'unverifiedKinds':sorted({'firestore','storage'}-{x['kind'] for x in result})}
    def parameters(self):
        result={}
        ready=self.doc('ops_identity_state/global');result['privateBackendReady']=None if ready is None else {k:ready.get(k) if type(ready.get(k)) is bool else 'UNVERIFIED_FORMAT' for k in ('ready','farmReady')}
        release=self.doc('ops_refinement_release/current')
        result['releaseControl']=None if release is None else {'schemaVersion':release.get('schemaVersion') if type(release.get('schemaVersion')) is int else 'UNVERIFIED_FORMAT','revision':release.get('revision') if type(release.get('revision')) is int else 'UNVERIFIED_FORMAT','version':safe_config(release.get('version'),'version'),'flags':{k:v if isinstance(v,bool) else 'UNVERIFIED_FORMAT' for k,v in (release.get('flags') if isinstance(release.get('flags'),dict) else {}).items() if k in ('instances','refinement','combat','reset','stoneSources')},'allowlistCount':len(release['allowlist']) if isinstance(release.get('allowlist'),list) else 'UNVERIFIED_FORMAT'}
        for channel,(pointer,collection) in CONFIG_POINTERS.items():
            p=self.doc(pointer)
            if p is None:result[channel]={'configured':None if self.doc_status[pointer]=='ERROR' else False,'readStatus':self.doc_status[pointer]};continue
            version=p.get('activeVersion');result[channel]={'configured':True,'activeVersion':version if isinstance(version,str) and re.fullmatch('[A-Za-z0-9_-]{1,80}',version) else 'UNVERIFIED_FORMAT','revision':p.get('revision') if type(p.get('revision')) is int else 'UNVERIFIED_FORMAT'}
            if not isinstance(version,str) or not re.fullmatch('[A-Za-z0-9_-]{1,80}',version):
                self.errors.append({'section':'parameters:'+channel,'httpStatus':0,'reason':'INVALID_VERSION_ID'});continue
            v=self.doc(collection+'/'+version)
            if v is None:result[channel]['versionAvailable']=None if self.doc_status[collection+'/'+version]=='ERROR' else False;continue
            allowed={'refining':('schemaVersion','version','effectiveAt','levels'),'reset':('schemaVersion','version','effectiveAt','enabled','coinsRefundBp','stonesRefundBp'),'stones':('schemaVersion','version','effectiveAt','checkin','mission','chests','gift','extensions')}[channel]
            safe=safe_config({k:v.get(k) for k in allowed});safe['contentHash']=safe_config(v.get('contentHash'),'contentHash');result[channel]['versionAvailable']=True;result[channel]['configuration']=safe
            self.save('parameters-'+channel+'.json',safe)
        result['readStatuses']=self.doc_status;self.save('parameters.json',result);return result
    def database(self):
        rows,complete=self.pages('database-instances','https://firebasedatabase.googleapis.com/v1beta/projects/'+PROJECT+'/locations/-/instances?pageSize=100','instances');result=[]
        for row in rows:
            item={k:row.get(k) for k in ('name','project','state','type','databaseUrl')};url=row.get('databaseUrl','').rstrip('/')+'/.settings/rules.json'
            if not allowed_url(url):item['rulesStatus']='UNSUPPORTED_TARGET';result.append(item);continue
            rules=self.get('database-rules',url)
            if rules is not None:
                digest=sha(json.dumps(rules,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode());item['rulesCanonicalSha256']=digest;item['exactCandidateJsonMatch']=digest==CANDIDATE_DATABASE_CANONICAL_SHA256;self.save('rules/database-'+digest+'.json',rules)
            result.append(item)
        return {'complete':complete,'instances':result}
    def run(self):
        project=self.get('project','https://cloudresourcemanager.googleapis.com/v3/projects/'+PROJECT)
        if project and (project.get('projectId')!=PROJECT or project.get('name')!='projects/'+PROJECT_NUMBER):raise ValueError('Project identity mismatch; inventory stopped')
        database=self.get('firestore-database','https://firestore.googleapis.com/v1/projects/'+PROJECT+'/databases/(default)')
        self.sections={'project':None if project is None else {k:project.get(k) for k in ('name','projectId','state')},'firestore':None if database is None else {k:database.get(k) for k in ('name','locationId','type','concurrencyMode','pointInTimeRecoveryEnablement')},'functions':self.functions(),'indexes':self.indexes(),'rules':self.rules(),'parameters':self.parameters(),'database':self.database()}
        sites,complete=self.pages('hosting-sites','https://firebasehosting.googleapis.com/v1beta1/projects/'+PROJECT+'/sites?pageSize=100','sites')
        self.sections['hosting']={'complete':complete,'sites':[{k:x.get(k) for k in ('name','defaultUrl','type')} for x in sites],'localTargetBindings':local_hosting_targets()}
        return self.sections

def local_hosting_targets():
    result=[]
    for p in {Path.home()/'kids-checkin/.firebaserc',Path.cwd()/'.firebaserc'}:
        if not p.is_file():continue
        try:
            data=json.loads(p.read_text());sites=data.get('targets',{}).get(PROJECT,{}).get('hosting',{}).get('nexus-game-admin')
            result.append({'file':str(p),'target':'nexus-game-admin','sites':[s for s in sites if isinstance(s,str) and re.fullmatch('[a-z0-9-]{1,63}',s)] if isinstance(sites,list) else 'UNVERIFIED'})
        except Exception:result.append({'file':str(p),'target':'nexus-game-admin','sites':'UNVERIFIED'})
    return result

def findings(sections):
    result=[]
    if (sections.get('firestore') or {}).get('locationId')!='asia-east1':result.append('Firestore位置尚未確認符合asia-east1')
    for region,info in sections.get('functions',{}).items():
        if info.get('missingExistingCallables'):result.append(region+'缺少既有callable：'+','.join(info['missingExistingCallables']))
        if info.get('notActive'):result.append(region+'有非ACTIVE函式，需逐支確認')
        for name,params in info.get('parameters',{}).items():
            needed=['NEXUS_PRIVATE_IDENTITY_ENABLED']+(['NEXUS_FARM_BACKEND_ENABLED'] if name.startswith('gameOps') else [])
            if any(params.get(k) is not True for k in needed):result.append(region+'/'+name+'既有身分／農場參數未確認為true')
            if params.get('NEXUS_REFINEMENT_RELEASE_CONTROL_ENABLED') is True:result.append(region+'/'+name+'正式精煉發布主開關已為true，需核對目前准入')
    for group in ('composite','collectionGroupFields'):
        for row in sections.get('indexes',{}).get(group,[]):
            if row['status']!='READY':result.append('索引未確認READY：'+row['collectionGroup']+'/'+row.get('fieldPath','composite'))
    for row in sections.get('rules',{}).get('releases',[]):
        if row.get('exactCandidateMatch') is not True:result.append(row['kind']+' Rules與候選檔不完全相同，需審閱差異')
    for kind in sections.get('rules',{}).get('unverifiedKinds',[]):result.append(kind+'已發布Rules尚未取得')
    for row in sections.get('database',{}).get('instances',[]):
        if row.get('exactCandidateJsonMatch') is not True:result.append('RTDB Rules尚未確認與候選JSON相同：'+str(row.get('name','unknown')))
    hosting=sections.get('hosting',{})
    if hosting.get('complete') and not any(x.get('name','').endswith('/sites/homebasedb') for x in hosting.get('sites',[])):result.append('尚未找到預期Hosting site homebasedb')
    return result

def access_token():
    if not shutil.which('gcloud'):raise RuntimeError('GCLOUD_NOT_AVAILABLE; run in authenticated Cloud Shell')
    r=subprocess.run(['gcloud','auth','print-access-token','--quiet'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=45)
    token=r.stdout.strip()
    if r.returncode or not token or '\n' in token or '\r' in token:raise RuntimeError('GCLOUD_AUTH_UNAVAILABLE; existing login could not supply a token')
    return token

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',required=True);args=parser.parse_args(argv)
    output=Path(args.output).expanduser().resolve();output.mkdir(parents=True,exist_ok=True,mode=0o700)
    if any(output.iterdir()):raise RuntimeError('Output must be an empty directory; previous evidence is preserved')
    output.chmod(0o700);client=None;inventory=None
    report={'schema':1,'toolSha256':sha(Path(__file__).read_bytes()),'project':PROJECT,'expectedProjectNumber':PROJECT_NUMBER,'mode':'READ_ONLY','collectedAt':datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat(),'productionWrites':False,'playerDocumentReads':0,'releaseApproval':False}
    try:
        client=Client(access_token());inventory=Inventory(client,output);report['sections']=inventory.run();report['findings']=findings(report['sections']);report['errors']=inventory.errors;report['status']='READ_ONLY_METADATA_COLLECTED' if not inventory.errors else 'INCOMPLETE_METADATA'
    except Exception as e:report['status']='BLOCKED';report['error']=str(e) if isinstance(e,(RuntimeError,ValueError)) else 'Inventory unavailable; no credentials were printed'
    report['completedAt']=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat();report['requests']=[] if client is None else client.requests;report['configurationDocumentReads']=0 if inventory is None else inventory.config_reads
    path=output/'summary.json';path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');path.chmod(0o600)
    print(json.dumps({'status':report['status'],'project':PROJECT,'report':str(path),'requests':len(report['requests']),'configurationDocumentReads':report['configurationDocumentReads'],'error':report.get('error')},ensure_ascii=False))
    return 0 if report['status']=='READ_ONLY_METADATA_COLLECTED' else 2
if __name__=='__main__':raise SystemExit(main())
