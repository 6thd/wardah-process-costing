"""Offline reconciliation triage; never clears IndexedDB or calls a database."""
import argparse
import json
import sys
from datetime import datetime, timezone
from uuid import UUID

OPERATIONS = {'create_order', 'set_order_status', 'create_work_order', 'set_work_order_status',
              'open_stage_wip', 'reserve', 'resize_reservation', 'release_reservation'}


def instant(value):
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('TIMEZONE_REQUIRED')
    return parsed.astimezone(timezone.utc)


def uuid(value):
    return str(UUID(value))


def monitor(document, now, shift_hours=8, freshness_minutes=15):
    server, inventory = document['server'], document['inventory']
    if server.get('format_version') != 1 or server.get('transaction_read_only') != 'on' or server.get('owner_verified') is not True:
        raise ValueError('OWNER_READ_ONLY_EXPORT_REQUIRED')
    expected_sources = inventory['expected_sources']
    if (not expected_sources or any(not isinstance(source, str) or not source.strip() for source in expected_sources)
            or len(set(expected_sources)) != len(expected_sources)):
        raise ValueError('EXPLICIT_UNIQUE_SOURCE_ROSTER_REQUIRED')
    problems, events, counts = [], {}, {}
    if not 0 <= (now - instant(server['captured_at'])).total_seconds() <= freshness_minutes * 60:
        problems.append('SERVER_SNAPSHOT_STALE_OR_FUTURE')
    for event in server['events']:
        key = (uuid(event['org_id']), uuid(event['event_id']))
        uuid(event['actor_id'])
        if key in events or event['state'] not in {'applied', 'closed'}:
            raise ValueError('SERVER_EVENT_DUPLICATE_OR_INVALID_STATE')
        events[key] = event
        counts.setdefault(key[0], {'applied': 0, 'closed': 0})[event['state']] += 1
    sources = inventory['sources']
    actual_sources = [source['source_id'] for source in sources]
    if any(not isinstance(source, str) or not source.strip() for source in actual_sources):
        raise ValueError('INVALID_INVENTORY_SOURCE_ID')
    if len(set(actual_sources)) != len(actual_sources):
        raise ValueError('DUPLICATE_INVENTORY_SOURCE')
    if set(actual_sources) != set(expected_sources):
        problems.append('SOURCE_ROSTER_INCOMPLETE_OR_UNEXPECTED')
    pending = []
    for source in sources:
        org, actor = uuid(source['org_id']), uuid(source['actor_id'])
        observed = instant(source['observed_at'])
        if source.get('read_succeeded') is not True:
            problems.append('INVENTORY_READ_FAILED: ' + source['source_id'])
        if not 0 <= (now - observed).total_seconds() <= freshness_minutes * 60:
            problems.append('INVENTORY_STALE_OR_FUTURE: ' + source['source_id'])
        seen = set()
        for record in source['pending']:
            event_id = uuid(record['event_id'])
            if event_id in seen or record['operation'] not in OPERATIONS:
                raise ValueError('PENDING_EVENT_DUPLICATE_OR_INVALID_OPERATION')
            seen.add(event_id)
            event = events.get((org, event_id))
            status = 'server_unobserved'
            if event:
                if uuid(event['actor_id']) != actor or event['operation'] != record['operation']:
                    status = 'identity_or_operation_mismatch'
                else:
                    status = 'applied_acknowledgement_needed' if event['state'] == 'applied' else 'closed_acknowledgement_needed'
            first = record.get('first_observed_at')
            age = None
            if first is not None:
                first_time = instant(first)
                if first_time > observed:
                    raise ValueError('FIRST_OBSERVATION_AFTER_INVENTORY')
                age = (now - first_time).total_seconds()
            pending.append({'source_id': source['source_id'], 'org_id': org, 'event_id': event_id,
                            'status': status, 'age_lower_bound_seconds': age,
                            'alert': 'age_unknown' if age is None else 'over_shift' if age >= shift_hours * 3600 else 'pending'})
    report = {'release_ready': False, 'coverage': 'declared_sources_only',
              'coverage_problems': problems, 'terminal_counts_by_org': counts, 'pending': pending,
              'pending_count': len(pending), 'shift_hours': shift_hours,
              'read_only_triage': True, 'receipt_or_fence_verified': False}
    # Zero unresolved in the SERVER alone is never evidence of a clear workstation.
    return report, 2 if problems else 1 if pending else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--shift-hours', type=float, default=8)
    parser.add_argument('--freshness-minutes', type=float, default=15)
    args = parser.parse_args()
    try:
        if not 0 < args.shift_hours <= 168 or not 0 < args.freshness_minutes <= 60:
            raise ValueError('INVALID_MONITORING_INTERVAL')
        report, code = monitor(json.load(sys.stdin), datetime.now(timezone.utc), args.shift_hours, args.freshness_minutes)
    except (ValueError, KeyError, TypeError, AttributeError) as error:
        print('RECONCILIATION_MONITOR_INVALID: ' + str(error), file=sys.stderr)
        return 2
    print(json.dumps(report, indent=2))
    return code


if __name__ == '__main__':
    raise SystemExit(main())
