"""Pin the candidate's bytes and its entire permitted M197 derivation."""
import hashlib
import json
from pathlib import Path
from derivation import ROOT, BASE, CANDIDATE, replacement, function, fingerprint

def verify():
    manifest = json.loads((ROOT / 'docs/db/material-issue-parent-version-198/CANDIDATE.json').read_text())
    text = CANDIDATE.read_text()
    if (manifest['state'] != 'candidate_not_allocated_or_applied' or manifest['release_ready'] is not False
            or manifest['lease'] is not False or manifest['requires_order'] != list(range(190,199))):
        raise ValueError('M198_ALLOCATION_OR_RELEASE_CLAIM')
    if (hashlib.sha256(text.encode()).hexdigest() != manifest['candidate_sha256']
            or hashlib.sha256((ROOT / 'docs/db/material-issue-release/MIGRATION_PACKAGE.json').read_bytes()).hexdigest() != manifest['frozen_package_sha256']
            or function(text) != replacement()):
        raise ValueError('M198_SOURCE_DRIFT')
    before, after = fingerprint(function(BASE.read_text())), fingerprint(replacement())
    if before != manifest['before_prosrc_md5'] or after != manifest['after_prosrc_md5']:
        raise ValueError('M198_FINGERPRINT_DRIFT')
    for value, error in [(before,'M198_FROZEN_M197_FUNCTION_DRIFT'),(after,'M198_REPLACEMENT_FINGERPRINT_MISMATCH')]:
        if "IS DISTINCT FROM '%s' THEN\n  RAISE EXCEPTION '%s'" % (value,error) not in text:
            raise ValueError('M198_FINGERPRINT_GUARD_DRIFT')
    return manifest

if __name__ == '__main__':
    verify()
    print('M198_EXACT_M197_DERIVATION_PASS')
