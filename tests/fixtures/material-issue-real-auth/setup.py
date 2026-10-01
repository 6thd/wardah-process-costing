"""Disposable Auth setup. All URLs, credentials and identities are local test fixtures."""
import base64
import hashlib
import hmac
import json
import sys
import time
import urllib.request
from pathlib import Path

SECRET = 'wardah-disposable-auth-test-secret-minimum-32-characters'
IDS = ['ed000000-0000-4000-8000-0000000000a1', 'ed000000-0000-4000-8000-0000000000a2', 'ed000000-0000-4000-8000-0000000000a3']
EMAILS = ['mfg-red-admin@example.test', 'mfg-red-consumer@example.test', 'mfg-red-reader@example.test']
PASSWORD = 'Disposable-Wardah-Acceptance-Only-2026'


def token(role):
    def encode(value):
        return base64.urlsafe_b64encode(json.dumps(value, separators=(',', ':')).encode()).rstrip(b'=')
    content = encode({'alg': 'HS256', 'typ': 'JWT'}) + b'.' + encode({'role': role, 'aud': 'authenticated', 'iss': 'supabase', 'iat': int(time.time()), 'exp': int(time.time()) + 3600})
    return (content + b'.' + base64.urlsafe_b64encode(hmac.new(SECRET.encode(), content, hashlib.sha256).digest()).rstrip(b'=')).decode()


if sys.argv[1] == 'shim':
    source = Path('scripts/ci/fresh-db/supabase_shim.sql').read_text()
    start, end = source.index('CREATE TABLE auth.users ('), source.index('CREATE FUNCTION auth.uid()')
    # The vendor Auth migrations create their real users/identities/session schema.
    Path('/tmp/wardah-auth-bootstrap.sql').write_text(source[:start] + source[end:])
    Path('/tmp/wardah-auth-anon.txt').write_text(token('anon'))
elif sys.argv[1] == 'accounts':
    for identity, email in zip(IDS, EMAILS):
        request = urllib.request.Request('http://127.0.0.1:55999/admin/users', data=json.dumps({'id': identity,
            'email': email, 'password': PASSWORD, 'email_confirm': True}).encode(),
            headers={'Authorization': 'Bearer ' + token('service_role'), 'Content-Type': 'application/json'}, method='POST')
        with urllib.request.urlopen(request, timeout=20) as response:
            if json.load(response)['id'] != identity:
                raise SystemExit('LOCAL_AUTH_ACCOUNT_ID_MISMATCH')
    print('LOCAL_VENDOR_AUTH_ACCOUNTS_CREATED=3')
elif sys.argv[1] == 'fixture':
    source = Path('docs/db/manufacturing-inventory-red-20260925/00_fixture.sql').read_text()
    start = source.index('INSERT INTO auth.users (id, email) VALUES')
    end = source.index(';', start) + 1
    Path('/tmp/wardah-auth-business-fixture.sql').write_text(source[:start] + '-- Real vendor Auth accounts already created.\n' + source[end:])
else:
    raise SystemExit('UNREVIEWED_LOCAL_AUTH_SETUP_OPERATION')
