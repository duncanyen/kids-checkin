import contextlib, hashlib, importlib.util, io, json, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
import sys
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('inventory',ROOT/'scripts/collect-refinement-production-metadata.py');M=importlib.util.module_from_spec(spec);spec.loader.exec_module(M)
class FakeClient:
    def __init__(self,reply):self.reply=reply;self.requests=[]
    def get(self,url):
        assert M.allowed_url(url),url
        self.requests.append({'method':'GET','url':url});return self.reply(url)
class Tests(unittest.TestCase):
    def test_metadata_routes_never_allow_player_reads_or_mutations(self):
        for url in ['https://firestore.googleapis.com/v1/projects/homebasedb/databases/(default)','https://firestore.googleapis.com/v1/projects/homebasedb/databases/(default)/documents/ops_game_config/refinement','https://cloudfunctions.googleapis.com/v2/projects/homebasedb/locations/asia-east1/functions','https://homebasedb-default-rtdb.asia-southeast1.firebasedatabase.app/.settings/rules.json']:
            self.assertTrue(M.allowed_url(url))
        for url in ['https://firestore.googleapis.com/v1/projects/homebasedb/databases/(default)/documents/groups/A/users/alice','https://firestore.googleapis.com/v1/projects/homebasedb/databases/(default)/documents/users','https://firestore.googleapis.com/v1/projects/other/databases/(default)','https://homebasedb-default-rtdb.asia-southeast1.firebasedatabase.app/.json','https://firestore.googleapis.com/v1/projects/homebasedb/databases/(default)/documents:commit','https://evil.example/v1/projects/homebasedb','https://x@firestore.googleapis.com/v1/projects/homebasedb/databases/(default)','https://firestore.googleapis.com/v1/projects/homebasedb/databases/(default)?access_token=fake']:
            self.assertFalse(M.allowed_url(url),url)
    def test_invalid_url_is_rejected_before_network(self):
        c=M.Client('fixture-token')
        with self.assertRaises(ValueError):c.get('https://example.test/secrets')
        self.assertEqual(c.requests,[])
    def test_client_is_get_only_and_does_not_log_authorization(self):
        class Response(io.BytesIO):
            status=200
        class Opener:
            def open(self,req,timeout):
                self.method=req.get_method();return Response(b'{"ok":true}')
        c=M.Client('fixture-token');opener=Opener();c.opener=opener
        self.assertEqual(c.get('https://cloudresourcemanager.googleapis.com/v3/projects/homebasedb')[0],200)
        self.assertEqual(opener.method,'GET');self.assertNotIn('fixture-token',json.dumps(c.requests))
        self.assertIsNone(M.NoRedirect().redirect_request(None,None,302,'',None,'https://other.example'))
    def test_function_parameters_drop_secret_values(self):
        raw={'functions':[{'name':'projects/homebasedb/locations/asia-east1/functions/gameOpsAdmin','state':'ACTIVE','serviceConfig':{'environmentVariables':{'SECRET_KEY':'sensitive-value','NEXUS_PRIVATE_IDENTITY_ENABLED':'true','NEXUS_FARM_BACKEND_ENABLED':'false','NEXUS_REFINEMENT_RELEASE_CONTROL_ENABLED':'not-boolean-secret'}}}]}
        with tempfile.TemporaryDirectory() as t:
            inv=M.Inventory(FakeClient(lambda u:(200,raw)),Path(t));r=inv.functions();saved=(Path(t)/'services.json').read_text()
            self.assertNotIn('sensitive-value',saved);self.assertNotIn('not-boolean-secret',saved)
            self.assertTrue(r['asia-east1']['parameters']['gameOpsAdmin']['NEXUS_PRIVATE_IDENTITY_ENABLED'])
    def test_config_privacy_and_absent_is_not_permission_denied(self):
        def reply(url):
            if url.endswith('/ops_refinement_release/current'):
                return 200,{'fields':{'flags':{'mapValue':{'fields':{'instances':{'booleanValue':False}}}},'allowlist':{'arrayValue':{'values':[{'mapValue':{'fields':{'uid':{'stringValue':'private-player-id'}}}}]}}}}
            if url.endswith('/refinement-reset'):return 403,{'error':{'status':'PERMISSION_DENIED'}}
            return 404,{}
        with tempfile.TemporaryDirectory() as t:
            inv=M.Inventory(FakeClient(reply),Path(t));r=inv.parameters()
            self.assertEqual(r['releaseControl']['allowlistCount'],1);self.assertNotIn('private-player-id',json.dumps(r));self.assertIsNone(r['reset']['configured']);self.assertFalse(r['refining']['configured']);self.assertLessEqual(inv.config_reads,8)
    def test_malformed_version_cannot_redirect_to_assets(self):
        def reply(url):return (200,{'fields':{'activeVersion':{'stringValue':'../../groups/private'}}}) if url.endswith('/refinement') else (404,{})
        with tempfile.TemporaryDirectory() as t:
            client=FakeClient(reply);r=M.Inventory(client,Path(t)).parameters();self.assertEqual(r['refining']['activeVersion'],'UNVERIFIED_FORMAT');self.assertTrue(all('/groups/' not in x['url'] for x in client.requests))
    def test_index_permission_failure_never_becomes_missing_or_ready(self):
        with tempfile.TemporaryDirectory() as t:
            r=M.Inventory(FakeClient(lambda u:(403,{'error':{'status':'PERMISSION_DENIED'}})),Path(t)).indexes();self.assertTrue(all(x['status']=='UNKNOWN' for x in r['composite']));self.assertTrue(all(x['status']=='UNVERIFIED' for x in r['collectionGroupFields']))
    def test_missing_auth_writes_blocked_report_without_requests(self):
        with tempfile.TemporaryDirectory() as t,patch.object(M,'access_token',side_effect=RuntimeError('GCLOUD_AUTH_UNAVAILABLE')),contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(M.main(['--output',t]),2);r=json.loads((Path(t)/'summary.json').read_text());self.assertEqual(r['status'],'BLOCKED');self.assertEqual(r['requests'],[]);self.assertFalse(r['productionWrites']);self.assertEqual(r['playerDocumentReads'],0)
    def test_candidate_hashes_and_nested_config_redaction(self):
        for kind,file in [('firestore','firestore.private-farm.candidate.rules'),('storage','storage.private-farm.candidate.rules'),('database','database.private-farm.candidate.json')]:self.assertEqual(hashlib.sha256((ROOT/'rules'/file).read_bytes()).hexdigest(),M.CANDIDATE_RULE_HASHES[kind])
        raw=json.loads((ROOT/'rules/database.private-farm.candidate.json').read_text());self.assertEqual(M.sha(json.dumps(raw,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()),M.CANDIDATE_DATABASE_CANONICAL_SHA256)
        safe=M.safe_config({'levels':[{'level':1,'coins':1000,'password':'private','bonus':{'attack':300,'token':'private'}}],'publishedBy':'private'});self.assertNotIn('private',json.dumps(safe));self.assertEqual(safe['levels'][0]['coins'],1000)
    def test_pagination_cannot_silently_accept_incomplete_or_cyclic_lists(self):
        with tempfile.TemporaryDirectory() as t:
            inv=M.Inventory(FakeClient(lambda u:(200,{'functions':[{'name':'x'}],'nextPageToken':'same-token'})),Path(t));rows,complete=inv.pages('functions','https://cloudfunctions.googleapis.com/v2/projects/homebasedb/locations/asia-east1/functions','functions');self.assertFalse(complete);self.assertEqual(len(rows),2);self.assertEqual(inv.errors[-1]['reason'],'PAGINATION_INCOMPLETE')
if __name__=='__main__':unittest.main()
