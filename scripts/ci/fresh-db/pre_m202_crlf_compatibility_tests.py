"""Explicit checks for scripts/ops/pre_m202_validate_mo_transition_crlf.sql.

The database only needs the function, the three roles, and plpgsql. It does
not apply migration 202. Refusal must leave pg_proc unchanged.
"""
from __future__ import annotations

import os
import shutil
# Only the argv built in _psql_command() is run: shell=False, fixed arguments, allowlisted environment.
import subprocess  # nosec B404
import sys
import tempfile
import threading
import time
from collections.abc import Mapping
from pathlib import Path

import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "scripts" / "ops" / "pre_m202_validate_mo_transition_crlf.sql"
LF_MD5 = "22789ca9c175eb3476b5c33648b92d1a"
CRLF_MD5 = "4169a0696bbcc28b39a922dcf1df23fe"
ACL = "authenticated=EXECUTE/postgres,postgres=EXECUTE/postgres,service_role=EXECUTE/postgres"

# psql is run only against one local disposable server. The environment variables it receives and the extra
# arguments it may be given are fixed here.
LOOPBACK_HOSTS = ("localhost", "127.0.0.1", "::1")
# Settings that can redirect the connection or change the session; refused outright (also for psycopg).
FORBIDDEN_ENV = ("DATABASE_URL", "SUPABASE_DB_URL", "PGSERVICE", "PGSERVICEFILE", "PGHOSTADDR", "PGOPTIONS")
# Passed through when set. None of them selects a server: the target comes from PGHOST/PGPORT only, which are
# validated first. PGPASSFILE, PGSSLMODE and PGCONNECT_TIMEOUT serve wrapper setups; SYSTEMROOT and APPDATA are what
# a Windows caller needs for sockets and the password file. Windows was NOT exercised here (Linux only): a runner that
# needs another variable must add it to this tuple explicitly; do not go back to copying the whole environment.
PSQL_ENV = (
    "PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE",
    "PGPASSFILE", "PGSSLMODE", "PGCONNECT_TIMEOUT", "SYSTEMROOT", "APPDATA",
)
LOCK_TIMEOUT_ARGS = ["-v", "pre_m202_lock_timeout=400ms"]


def connect():
    return psycopg.connect(
        host=os.environ["PGHOST"],
        port=os.environ["PGPORT"],
        user=os.environ.get("PGUSER", "postgres"),
        dbname=os.environ.get("PGDATABASE", "postgres"),
        autocommit=True,
    )


def canon(conn) -> str:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT pg_get_functiondef('public.validate_mo_transition(text,text)'::regprocedure)
            """
        )
        # The approved LF body is the prosrc pin, not pg_get_functiondef.
        cur.execute(
            """
            SELECT prosrc FROM pg_proc
            WHERE oid = 'public.validate_mo_transition(text,text)'::regprocedure
            """
        )
        src = cur.fetchone()[0]
    return src


def install(conn, src: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            sql.Composed(
                [
                    sql.SQL(
                        "CREATE OR REPLACE FUNCTION public.validate_mo_transition(p_from text, p_to text) "
                        "RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS "
                    ),
                    sql.Literal(src),
                ]
            )
        )
        cur.execute("ALTER FUNCTION public.validate_mo_transition(text, text) OWNER TO postgres")
        cur.execute("ALTER FUNCTION public.validate_mo_transition(text, text) SECURITY INVOKER")
        cur.execute("ALTER FUNCTION public.validate_mo_transition(text, text) SET search_path = public")
        cur.execute(
            "REVOKE ALL ON FUNCTION public.validate_mo_transition(text, text) FROM PUBLIC, anon, authenticated, service_role"
        )
        cur.execute(
            "GRANT EXECUTE ON FUNCTION public.validate_mo_transition(text, text) TO postgres, authenticated, service_role"
        )


def snapshot(conn) -> tuple:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT md5(p.prosrc), octet_length(p.prosrc), p.prosrc,
                   pg_get_userbyid(p.proowner), p.prosecdef::text,
                   COALESCE(array_to_string(p.proconfig, ','), ''),
                   p.xmin::text,
                   COALESCE((
                     SELECT string_agg(format('%s=%s/%s', gr.rolname, a.privilege_type, gtor.rolname),
                                       ',' ORDER BY gr.rolname, a.privilege_type)
                     FROM aclexplode(p.proacl) a
                     JOIN pg_roles gr ON gr.oid = a.grantee
                     JOIN pg_roles gtor ON gtor.oid = a.grantor
                   ), '')
            FROM pg_proc p
            WHERE p.oid = 'public.validate_mo_transition(text,text)'::regprocedure
            """
        )
        return cur.fetchone()


def validate_target(env: Mapping[str, str]) -> None:
    """Accept exactly one local server: one loopback host or one existing absolute socket directory, one port."""
    host = env.get("PGHOST", "")
    if not host or "," in host or any(ch.isspace() for ch in host):
        raise SystemExit(f"REFUSED: PGHOST {host!r} must be a single value: not empty, no comma, no whitespace")
    if host not in LOOPBACK_HOSTS and not (os.path.isabs(host) and os.path.isdir(host)):
        raise SystemExit(f"REFUSED: PGHOST {host!r} is neither a loopback host nor an existing absolute socket directory")
    port = env.get("PGPORT", "")
    if not (port.isascii() and port.isdigit() and 1 <= int(port) <= 65535):
        raise SystemExit(f"REFUSED: PGPORT {port!r} must be one number in 1..65535")
    present = [name for name in FORBIDDEN_ENV if env.get(name)]
    if present:
        raise SystemExit(f"REFUSED: connection settings that can redirect the connection are set: {present}")


def require_local_target() -> None:
    validate_target(os.environ)


def selftest_target_guard() -> None:
    """The guard must refuse these before any subprocess or connection exists (pure checks, nothing is run)."""
    socket_dir = tempfile.gettempdir()
    refused = [
        {"PGHOST": f"{socket_dir},remote.example", "PGPORT": "5432"},
        {"PGHOST": f"{socket_dir} remote.example", "PGPORT": "5432"},
        {"PGHOST": "localhost,remote.example", "PGPORT": "5432"},
        {"PGHOST": "remote.example", "PGPORT": "5432"},
        {"PGHOST": "", "PGPORT": "5432"},
        {"PGHOST": "relative/dir", "PGPORT": "5432"},
        {"PGHOST": f"{socket_dir}/no-such-directory-for-the-guard", "PGPORT": "5432"},
        {"PGHOST": "localhost", "PGPORT": "0"},
        {"PGHOST": "localhost", "PGPORT": "65536"},
        {"PGHOST": "localhost", "PGPORT": "5432,5433"},
        {"PGHOST": "localhost", "PGPORT": "5432 "},
        {"PGHOST": "localhost", "PGPORT": "port"},
        {"PGHOST": "localhost"},
        {"PGHOST": "localhost", "PGPORT": "5432", "PGSERVICE": "any"},
        {"PGHOST": "localhost", "PGPORT": "5432", "PGOPTIONS": "-c search_path=x"},
    ]
    for env in refused:
        try:
            validate_target(env)
        except SystemExit:
            continue
        raise AssertionError(f"target guard accepted {env!r}")
    for env in ({"PGHOST": "localhost", "PGPORT": "5432"}, {"PGHOST": "::1", "PGPORT": "65535"},
                {"PGHOST": socket_dir, "PGPORT": "1"}):
        validate_target(env)
    print("PRE_M202_CRLF_TARGET_GUARD_OK")


def _psql_command(extra: list[str] | None) -> tuple[str, list[str], dict[str, str]]:
    if extra not in (None, [], LOCK_TIMEOUT_ARGS):
        raise ValueError(f"psql arguments outside the reviewed set: {extra!r}")
    require_local_target()
    # Trust boundary: the executable is resolved to an absolute path from the operator-controlled PATH. Its identity
    # and integrity are not verified here; the checkout, the PATH and the environment are trusted as the operator's.
    exe = shutil.which("psql")
    if exe is None or not os.path.isabs(exe):
        raise SystemExit("REFUSED: psql was not found as an absolute path on PATH")
    env = {name: os.environ[name] for name in PSQL_ENV if name in os.environ}
    env["LC_MESSAGES"] = "C"
    return exe, (LOCK_TIMEOUT_ARGS if extra else []), env


def run_script_raw(extra: list[str] | None = None) -> tuple[int, str]:
    # psql is required, not psycopg: the script under test uses the psql meta-commands \if and \gset.
    # The fixed arguments are written out here; `executable` is the absolute path checked in _psql_command(), the
    # environment is the allowlist, and the target was validated as one local server. shell=False.
    exe, lock_args, env = _psql_command(extra)
    result = subprocess.run(  # nosec B603 B607
        ["psql", "-X", "-v", "ON_ERROR_STOP=1", *lock_args, "-f", str(SCRIPT)],
        executable=exe,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    return result.returncode, (result.stdout or "") + (result.stderr or "")


def run_script(extra: list[str] | None = None) -> str:
    code, output = run_script_raw(extra)
    if code != 0:
        raise psycopg.Error(output)
    return output


def expect_refuse(conn, src: str, label: str) -> None:
    install(conn, src)
    before = snapshot(conn)
    try:
        run_script()
    except psycopg.Error as exc:
        message = str(exc)
        if "PRE_M202_CRLF_BODY_REFUSED" not in message and "PRE_M202_CRLF_ATTRIBUTE_REFUSED" not in message:
            raise SystemExit(f"{label}: unexpected refusal {message}") from exc
    else:
        raise SystemExit(f"{label}: script did not refuse")
    after = snapshot(conn)
    if after != before:
        raise SystemExit(f"{label}: catalog changed after refusal\n{before}\n{after}")
    print(f"REFUSED|{label}")


def md5_hex(conn, text: str) -> str:
    # The same md5(text) that the pins and snapshot() read from pg_proc.prosrc,
    # computed by the server, so CR and LF bytes are hashed exactly as sent.
    with conn.cursor() as cur:
        cur.execute("SELECT md5(%s::text)", (text,))
        return cur.fetchone()[0]


def expect_attribute_refusal(conn, before: tuple, accepted_message: str, changed_message: str) -> None:
    try:
        run_script()
    except psycopg.Error as exc:
        if "PRE_M202_CRLF_ATTRIBUTE_REFUSED" not in str(exc):
            raise
    else:
        raise SystemExit(accepted_message)
    conn.rollback()
    if snapshot(conn) != before:
        raise SystemExit(changed_message)


def hold_then(conn, crlf: str, change_sql, commit: bool, script_extra: list[str] | None = None):
    install(conn, crlf)
    before_hold = snapshot(conn)
    holder = connect()
    holder.autocommit = False
    with holder.cursor() as cur:
        cur.execute(change_sql)
    box: dict[str, object] = {}

    def target() -> None:
        box["result"] = run_script_raw(script_extra)

    worker = threading.Thread(target=target)
    worker.start()
    time.sleep(0.4)
    if commit:
        holder.commit()
    worker.join(timeout=20)
    if worker.is_alive():
        holder.rollback()
        holder.close()
        raise SystemExit("compatibility script did not finish while a lock was held")
    code, output = box["result"]
    return before_hold, holder, code, output


def prepare_database(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            DO $roles$
            BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
                CREATE ROLE authenticated;
              END IF;
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
                CREATE ROLE anon;
              END IF;
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
                CREATE ROLE service_role;
              END IF;
            END
            $roles$
            """
        )
        cur.execute(
            """
            DO $cleanup$
            BEGIN
              IF to_regprocedure('public.validate_mo_transition(text,text)') IS NOT NULL THEN
                ALTER FUNCTION public.validate_mo_transition(text, text) OWNER TO postgres;
              END IF;
            END
            $cleanup$
            """
        )
        cur.execute("DROP ROLE IF EXISTS pre_m202_other_owner")
        cur.execute("DROP ROLE IF EXISTS pre_m202_extra")


def load_canonical_bodies(conn) -> tuple[str, str]:
    # The LF bytes are the migration-78 body embedded in the script's own pin,
    # taken from the v_lf assignment up to its closing tag.
    text = SCRIPT.read_text(encoding="utf-8")
    marker = "v_lf pg_catalog.text := $canonical$"
    start = text.index(marker) + len(marker)
    end = text.index("$canonical$;", start)
    lf = text[start:end]
    if md5_hex(conn, lf) != LF_MD5:
        raise SystemExit("embedded LF pin drifted")
    crlf = lf.replace("\n", "\r\n")
    if md5_hex(conn, crlf) != CRLF_MD5:
        raise SystemExit("approved CRLF variant drifted")
    return lf, crlf


def phase_lf_noop(conn, lf: str) -> None:
    install(conn, lf)
    before = snapshot(conn)
    notes = run_script()
    after = snapshot(conn)
    if "PRE_M202_CRLF_NOOP" not in notes:
        raise SystemExit(f"LF no-op missing marker: {notes}")
    if after[0] != LF_MD5 or after[6] != before[6]:
        raise SystemExit(f"LF no-op mutated the row: {before} -> {after}")
    print("PRE_M202_CRLF_NOOP")


def phase_crlf_replaced(conn, crlf: str) -> None:
    install(conn, crlf)
    notes = run_script()
    after = snapshot(conn)
    if "PRE_M202_CRLF_REPLACED" not in notes or after[0] != LF_MD5 or after[5] != "search_path=public":
        raise SystemExit(f"CRLF replace failed: {notes} {after}")
    if after[3] != "postgres" or after[4] != "false" or after[7] != ACL:
        raise SystemExit(f"attributes not preserved: {after}")
    print("PRE_M202_CRLF_REPLACED")


def phase_byte_refusals(conn, lf: str) -> None:
    expect_refuse(conn, lf + "\r", "trailing_cr")
    expect_refuse(conn, lf.replace("\n", "\r", 1), "standalone_cr")
    expect_refuse(conn, lf.replace("\n", "\r\r\n", 1), "cr_cr")
    expect_refuse(conn, lf + "\n", "added_lf")
    expect_refuse(conn, lf.replace("\n", "", 1), "removed_lf")
    expect_refuse(conn, lf.replace("'draft'", "'drafx'", 1), "business_rule")
    literal = lf.replace("'done'", "'do\rne'", 1)
    expect_refuse(conn, literal, "cr_inside_literal")
    literal_crlf = lf.replace("'done'", "'do\r\nne'", 1)
    expect_refuse(conn, literal_crlf, "crlf_inside_literal")


def phase_unexpected_owner(conn, lf: str) -> None:
    install(conn, lf)
    with conn.cursor() as cur:
        cur.execute("CREATE ROLE pre_m202_other_owner NOLOGIN")
        cur.execute(
            "GRANT pre_m202_other_owner TO postgres WITH SET TRUE, INHERIT FALSE"
        )
        cur.execute("GRANT CREATE ON SCHEMA public TO pre_m202_other_owner")
        cur.execute("ALTER FUNCTION public.validate_mo_transition(text, text) OWNER TO pre_m202_other_owner")
    expect_owner = snapshot(conn)
    expect_attribute_refusal(
        conn, expect_owner, "unexpected owner was accepted", "owner refusal changed the catalog"
    )
    with conn.cursor() as cur:
        cur.execute("SET ROLE pre_m202_other_owner")
        cur.execute("DROP FUNCTION public.validate_mo_transition(text, text)")
        cur.execute("RESET ROLE")
        cur.execute("REVOKE CREATE ON SCHEMA public FROM pre_m202_other_owner")
        cur.execute("DROP ROLE pre_m202_other_owner")
    install(conn, lf)
    print("REFUSED|unexpected_owner")


def phase_unexpected_acl(conn, lf: str) -> None:
    install(conn, lf)
    with conn.cursor() as cur:
        cur.execute("CREATE ROLE pre_m202_extra NOLOGIN")
        cur.execute("GRANT EXECUTE ON FUNCTION public.validate_mo_transition(text, text) TO pre_m202_extra")
    before = snapshot(conn)
    expect_attribute_refusal(conn, before, "unexpected ACL was accepted", "ACL refusal changed the catalog")
    with conn.cursor() as cur:
        cur.execute("REVOKE ALL ON FUNCTION public.validate_mo_transition(text, text) FROM pre_m202_extra")
        cur.execute("DROP ROLE pre_m202_extra")
    print("REFUSED|unexpected_acl")


def phase_unexpected_search_path(conn, lf: str) -> None:
    install(conn, lf)
    with conn.cursor() as cur:
        cur.execute("ALTER FUNCTION public.validate_mo_transition(text, text) SET search_path = public, pg_temp")
    before = snapshot(conn)
    expect_attribute_refusal(
        conn, before, "unexpected search_path was accepted", "attribute refusal changed the catalog"
    )
    print("REFUSED|unexpected_search_path")


def phase_crlf_unexpected_search_path(conn, crlf: str) -> None:
    install(conn, crlf)
    with conn.cursor() as cur:
        cur.execute(
            "ALTER FUNCTION public.validate_mo_transition(text, text) SET search_path = public, pg_temp"
        )
    before = snapshot(conn)
    expect_attribute_refusal(
        conn,
        before,
        "CRLF with an unexpected search_path was replaced",
        "CRLF unexpected search_path changed the catalog",
    )
    print("REFUSED|crlf_unexpected_search_path")


def phase_unexpected_cost(conn, lf: str) -> None:
    install(conn, lf)
    with conn.cursor() as cur:
        cur.execute("ALTER FUNCTION public.validate_mo_transition(text, text) COST 200")
    before = snapshot(conn)
    expect_attribute_refusal(conn, before, "unexpected cost was accepted", "unexpected cost changed the catalog")
    print("REFUSED|unexpected_cost")


def phase_concurrent_search_path(conn, crlf: str) -> None:
    # A committed settings change must stay visible. The script refuses it
    # and must not write search_path back to public.
    _before, holder, code, output = hold_then(
        conn,
        crlf,
        "ALTER FUNCTION public.validate_mo_transition(text, text) SET search_path = public, pg_temp",
        True,
    )
    holder.close()
    if code == 0 or "PRE_M202_CRLF_ATTRIBUTE_REFUSED" not in output:
        raise SystemExit(f"concurrent settings change was not refused: {code} {output}")
    seen = snapshot(conn)
    if seen[0] != CRLF_MD5 or seen[5] != "search_path=public, pg_temp":
        raise SystemExit(f"concurrent settings change was masked: {seen}")
    print("REFUSED|concurrent_search_path")


def phase_concurrent_body(conn, crlf: str) -> None:
    bad = crlf + "\n"
    bad_md5 = md5_hex(conn, bad)
    change_body = sql.Composed(
        [
            sql.SQL(
                "CREATE OR REPLACE FUNCTION public.validate_mo_transition(p_from text, p_to text) "
                "RETURNS void LANGUAGE plpgsql SECURITY INVOKER "
                "SET search_path = public AS "
            ),
            sql.Literal(bad),
        ]
    )
    _before, holder, code, output = hold_then(conn, crlf, change_body, True)
    holder.close()
    if code == 0 or "PRE_M202_CRLF_BODY_REFUSED" not in output:
        raise SystemExit(f"concurrent body change was not refused: {code} {output}")
    seen = snapshot(conn)
    if seen[0] != bad_md5 or "PRE_M202_CRLF_REPLACED" in output:
        raise SystemExit(f"concurrent body change was replaced: {seen} {output}")
    print("REFUSED|concurrent_body")


def phase_owner_lock_timeout(conn, crlf: str) -> None:
    install(conn, crlf)
    before = snapshot(conn)
    holder = connect()
    holder.autocommit = False
    with holder.cursor() as cur:
        cur.execute(
            "ALTER FUNCTION public.validate_mo_transition(text, text) "
            "SET search_path = public, pg_temp"
        )
    code, output = run_script_raw(["-v", "pre_m202_lock_timeout=400ms"])
    holder.rollback()
    holder.close()
    if code == 0 or "lock timeout" not in output:
        raise SystemExit(f"script did not wait on the owner lock: {code} {output}")
    if snapshot(conn) != before:
        raise SystemExit("lock timeout changed the catalog")
    print("PRE_M202_CRLF_OWNER_LOCK_TIMEOUT_OK")


def main() -> None:
    selftest_target_guard()
    require_local_target()
    with connect() as conn:
        prepare_database(conn)
        lf, crlf = load_canonical_bodies(conn)
        phase_lf_noop(conn, lf)
        phase_crlf_replaced(conn, crlf)
        phase_byte_refusals(conn, lf)
        phase_unexpected_owner(conn, lf)
        phase_unexpected_acl(conn, lf)
        phase_unexpected_search_path(conn, lf)
        phase_crlf_unexpected_search_path(conn, crlf)
        phase_unexpected_cost(conn, lf)
        phase_concurrent_search_path(conn, crlf)
        phase_concurrent_body(conn, crlf)
        phase_owner_lock_timeout(conn, crlf)
        print("PRE_M202_CRLF_CHECKS_PASS")

if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:
        print(f"PRE_M202_CRLF_CHECKS_FAILED {exc}", file=sys.stderr)
        raise
