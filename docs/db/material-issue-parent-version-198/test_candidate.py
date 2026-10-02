"""Offline source/profile controls; server/race acceptance is separate."""
import copy
import json
import unittest
from unittest.mock import patch
from derivation import ROOT, SIGNATURE, function, BASE, CANDIDATE, replacement, fingerprint
from verify_candidate import verify
from verify_readback import check

class CandidateTests(unittest.TestCase):
    def snapshot(self):
        package=json.loads((ROOT / 'docs/db/material-issue-release/MIGRATION_PACKAGE.json').read_text())
        rows=copy.deepcopy(package['catalog_readback']['functions'])
        for row in rows:
            row['owner']='postgres'
            for acl in row['acl']:
                for key in ('grantee','grantor'):
                    if acl[key]=='$migration_owner': acl[key]='postgres'
            if row['signature']==SIGNATURE: row['prosrc_md5']=verify()['after_prosrc_md5']
        return dict(format_version=1,transaction_read_only='on',server_version_num=170011,functions=rows)
    def test_exact_derivation_and_profile(self):
        self.assertEqual(function(CANDIDATE.read_text()),replacement())
        self.assertEqual(fingerprint(function(BASE.read_text())),verify()['before_prosrc_sha256'])
        self.assertEqual(check(self.snapshot(),'postgres'),[])
    def test_source_sha256_mismatch_is_refused(self):
        for key in ('before_prosrc_sha256','after_prosrc_sha256'):
            manifest=copy.deepcopy(verify()); manifest[key]='0'*64
            with patch('verify_candidate.json.loads',return_value=manifest):
                with self.assertRaisesRegex(ValueError,'M198_FINGERPRINT_DRIFT'):
                    verify()
    def test_catalog_md5_guard_mismatch_is_refused(self):
        for key in ('before_prosrc_md5','after_prosrc_md5'):
            manifest=copy.deepcopy(verify()); manifest[key]='0'*32
            with patch('verify_candidate.json.loads',return_value=manifest):
                with self.assertRaisesRegex(ValueError,'M198_FINGERPRINT_GUARD_DRIFT'):
                    verify()
    def test_pre198_body_is_refused(self):
        snapshot=self.snapshot()
        next(r for r in snapshot['functions'] if r['signature']==SIGNATURE)['prosrc_md5']=verify()['before_prosrc_md5']
        self.assertIn('M198_INSTALLED_BODY_DRIFT',check(snapshot,'postgres'))
    def test_missing_or_duplicate_function_is_refused(self):
        for duplicate in (False,True):
            snapshot=self.snapshot(); row=next(r for r in snapshot['functions'] if r['signature']==SIGNATURE)
            if duplicate: snapshot['functions'].append(copy.deepcopy(row))
            else: snapshot['functions'].remove(row)
            self.assertIn('M198_INSTALLED_BODY_DRIFT',check(snapshot,'postgres'))
    def test_owner_acl_settings_and_other_bodies_are_still_checked(self):
        for key,value in [('owner','authenticated'),('acl',[]),('config',[]),('security_definer',False)]:
            snapshot=self.snapshot(); next(r for r in snapshot['functions'] if r['signature']==SIGNATURE)[key]=value
            self.assertTrue(check(snapshot,'postgres'))
        snapshot=self.snapshot(); next(r for r in snapshot['functions'] if r['signature']!=SIGNATURE)['prosrc_md5']='bad'
        self.assertTrue(check(snapshot,'postgres'))
    def test_read_only_and_pg17_are_required(self):
        for key,value in [('transaction_read_only','off'),('server_version_num',160011)]:
            snapshot=self.snapshot(); snapshot[key]=value
            self.assertTrue(check(snapshot,'postgres'))

if __name__=='__main__':
    unittest.main()
