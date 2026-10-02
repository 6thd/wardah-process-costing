"""Adapt only the pinned M196 reconciliation input to the final M198 contract."""
import argparse
import hashlib
from pathlib import Path

SOURCE = 'docs/db/material-issue-maintenance-170-154/reconciliation_acceptance.sql'
SHA256 = '19ab6325cebd936ef490c1c26d78c12f75bbb0eaeffeb32ef943c64b0338489e'
INCLUDE = r'\ir ../posted-history-193/_fixture.sql'
COMMAND = "'uom_id',(SELECT base_uom_id FROM public.products WHERE id=pg_temp.raw()),'quantity',1);"
VERSIONED = COMMAND[:-2] + ",\n  'expected_version',(SELECT maintenance_version FROM public.manufacturing_orders WHERE id=mo));"


def prepare(source: bytes, harness: Path) -> str:
    if hashlib.sha256(source).hexdigest() != SHA256:
        raise ValueError('RECONCILIATION_REVIEWED_SOURCE_DRIFT')
    text = source.decode('utf-8')
    fixture = str(harness.resolve() / 'docs/db/posted-history-193/_fixture.sql')
    if any(character in fixture for character in ('\n', '\r')):
        raise ValueError('RECONCILIATION_FIXTURE_PATH_INVALID')
    include = "\\ir '" + fixture.replace('\\', '\\\\').replace("'", "\\'") + "'"
    if text.count(INCLUDE) != 1 or text.count(COMMAND) != 1:
        raise ValueError('RECONCILIATION_ADAPTER_ANCHOR_DRIFT')
    return text.replace(INCLUDE, include, 1).replace(COMMAND, VERSIONED, 1)


def selftest(source: bytes, harness: Path) -> None:
    adapted = prepare(source, harness)
    # Restore only the include and input change: all assertions must be identical.
    restored = '\n'.join(INCLUDE if line.startswith('\\ir ') else line
                         for line in adapted.split('\n')).replace(VERSIONED, COMMAND, 1)
    if restored.encode('utf-8') != source:
        raise AssertionError('RECONCILIATION_ASSERTIONS_CHANGED')
    for original in (b'APPLIED_RECONCILIATION_DIVERGED', b'RECONCILE_DENIAL_HAS_EFFECTS',
                     b'ISSUE_SETUP_EVENT_CLOSED', b'ROLLBACK;'):
        drifted = source.replace(original, original + b'_changed', 1)
        try:
            prepare(drifted, harness)
        except ValueError as error:
            if str(error) != 'RECONCILIATION_REVIEWED_SOURCE_DRIFT':
                raise
        else:
            raise AssertionError('RECONCILIATION_SOURCE_DRIFT_ACCEPTED')
    print('RECONCILIATION_ADAPTER_CONTROLS_PASS unchanged_assertions=1 drift_controls=4')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--harness', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    source = (args.harness / SOURCE).read_bytes()
    selftest(source, args.harness)
    args.output.write_text(prepare(source, args.harness), encoding='utf-8')
    print('RECONCILIATION_M198_INPUT_PREPARED')
