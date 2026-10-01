"""Check an actual disposable server export with a simulated workstation roster."""
import json
import sys
from datetime import datetime, timezone

from monitor_reconciliation import monitor

server = json.load(sys.stdin)
now = datetime.now(timezone.utc)
org = '00000000-0000-4000-8000-000000000001'
document = {'server': server, 'inventory': {'expected_sources': ['CI-simulated-station'], 'sources': [
    {'source_id': 'CI-simulated-station', 'org_id': org,
     'actor_id': '00000000-0000-4000-8000-000000000002', 'observed_at': now.isoformat(),
     'read_succeeded': True, 'pending': []},
]}}
report, code = monitor(document, now)
assert code == 0 and report['release_ready'] is False
# Server absence is only an observation; it can never clear a client intent.
document['inventory']['sources'][0]['pending'] = [{
    'event_id': '00000000-0000-4000-8000-000000000003', 'operation': 'reserve',
    'first_observed_at': None,
}]
report, code = monitor(document, now)
assert code == 1 and report['pending'][0]['status'] == 'server_unobserved'
assert report['pending'][0]['alert'] == 'age_unknown'
print('MATERIAL_ISSUE_RECONCILIATION_READBACK_PASS — real server export; simulated workstation inventory; not deployment monitoring')
