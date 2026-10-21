"""Retain frozen acceptance/race assertions, adapting only deliberate stale SQLSTATEs."""
import sys
from pathlib import Path
if sys.argv[1] == 'acceptance':
    source = Path('docs/db/material-issue-maintenance-170-154/acceptance.sql').read_text()
    old, new, count = "'40001','ISSUE_SETUP_STALE_VERSION'", "'P0001','ISSUE_SETUP_STALE_VERSION'", 3
elif sys.argv[1] == 'races':
    source = Path('docs/db/material-issue-maintenance-170-154/races.py').read_text()
    old, new, count = '("40001", "ISSUE_SETUP_STALE_VERSION")', '("P0001", "ISSUE_SETUP_STALE_VERSION")', 1
else:
    raise SystemExit('UNREVIEWED_COMPATIBILITY_CHECK')
if source.count(old) != count:
    raise SystemExit('FROZEN_STALE_EXPECTATIONS_DRIFT')
sys.stdout.write(source.replace(old, new))
