"""Exercise both UUID sort orders and reject each old request-construction bug."""
import os
from pathlib import Path
import psycopg

ROOT = Path(__file__).resolve().parents[3]


def expand(path):
    lines = []
    for line in path.read_text().splitlines():
        if line.startswith('\\ir '):
            lines.append(expand((path.parent / line[4:]).resolve()))
        elif not line.startswith('\\set '):
            lines.append(line)
    return '\n'.join(lines)


def ordered(source, sort):
    anchor = 'CREATE FUNCTION pg_temp.shared_state()'
    if source.count(anchor) != 1:
        raise SystemExit('QC_REPLAY_CONTROL_ANCHOR_DRIFT')
    # Owner-only fixture adjustment before any consumption/reference is recorded.
    setup = {
        'before': "UPDATE public.material_reservations SET id='00000000-0000-0000-0000-000000000000'::uuid\nWHERE mo_id=(SELECT v FROM wardah_internal.issue_scope_test_ids WHERE k='mo');\n",
        'after': "UPDATE public.material_reservations SET id='ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid\nWHERE mo_id=(SELECT v FROM wardah_internal.issue_scope_test_ids WHERE k='mo');\n",
    }[sort]
    return source.replace(anchor, setup + anchor)


def main():
    port = os.environ.get('PGPORT', '')
    if (os.environ.get('PGHOST') != '127.0.0.1' or not port.isdigit() or int(port) < 55000
        or not os.environ.get('PGDATABASE', '').startswith('wardah_issue_parent_198_canonical_qc_')
        or any(os.environ.get(k) for k in ['DATABASE_URL', 'SUPABASE_DB_URL', 'PGSERVICE', 'PGHOSTADDR'])):
        raise SystemExit('LOCAL_QC_REPLAY_DATABASE_REQUIRED')
    source = expand(Path(__file__).with_name('acceptance.sql'))
    notices = []
    with psycopg.connect(autocommit=True) as conn:
        if conn.execute('SHOW server_version_num').fetchone()[0][:2] != '17':
            raise SystemExit('PG17_REQUIRED')
        conn.add_notice_handler(lambda diagnostic: notices.append(diagnostic.message_primary))
        for sort in ['before', 'after']:
            for _ in range(30):
                notices.clear()
                conn.execute(ordered(source, sort))
                if sum(n.startswith('QC_MATERIAL_SHARED_OK ') for n in notices) != 11:
                    raise SystemExit('QC_REPLAY_ASSERTION_COUNT_DRIFT')
            print(f'QC_REPLAY_FIXED_ORDER_PASS initial={sort} runs=30', flush=True)
        replay = "replay:=pg_temp.as_user(pg_temp.consumer(),issue_command);\n PERFORM pg_temp.shared_ok(replay=receipt AND pg_temp.shared_state()=state_before,'recorded material event replays after return and reserve');"
        mutants = [
            ('replay', replay, replay.replace('issue_command', 'pg_temp.issue_193(mo,event)'), 'MATERIAL_ISSUE_EVENT_CONFLICT'),
            ('final_event', 'answer:=pg_temp.as_user(pg_temp.consumer(),replace(issue_command,event::text,gen_random_uuid()::text));',
             'answer:=pg_temp.as_user(pg_temp.consumer(),pg_temp.issue_193(mo,gen_random_uuid()));', 'CONSUMPTION_EXCEEDS_RESERVATION'),
        ]
        for name, anchor, bad, expected in mutants:
            if source.count(anchor) != 1:
                raise SystemExit('QC_REPLAY_MUTANT_ANCHOR_DRIFT: ' + name)
            try:
                conn.execute(ordered(source.replace(anchor, bad), 'after'))
            except psycopg.Error as error:
                if error.sqlstate != 'P0001' or expected not in str(error):
                    raise SystemExit('QC_REPLAY_UNEXPECTED_REFUSAL: ' + name) from error
            else:
                raise SystemExit('QC_REPLAY_MUTANT_FALSE_GREEN: ' + name)
            finally:
                conn.execute('ROLLBACK')
            print(f'QC_REPLAY_MUTANT_REFUSED case={name} diagnostic={expected}', flush=True)
    print('QC_REPLAY_DETERMINISM_PASS runs=60 mutants=2', flush=True)


if __name__ == '__main__':
    main()
