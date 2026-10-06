"""Explicit checks for scripts/ops/pre_m202_validate_mo_transition_crlf.sql.

The database only needs the function, the three roles, and plpgsql. It does
not apply migration 202. Refusal must leave pg_proc unchanged.
"""
from __future__ import annotations

import os
import sys
import threading
import time
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "scripts" / "ops" / "pre_m202_validate_mo_transition_crlf.sql"
LF_MD5 = "22789ca9c175eb3476b5c33648b92d1a"
CRLF_MD5 = "4169a0696bbcc28b39a922dcf1df23fe"
ACL = "authenticated=EXECUTE/postgres,postgres=EXECUTE/postgres,service_role=EXECUTE/postgres"


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
            """
            CREATE OR REPLACE FUNCTION public.validate_mo_transition(p_from text, p_to text)
            RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $canonical$"""
            + src
            + """$canonical$"""
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


def run_script_raw(extra: list[str] | None = None) -> tuple[int, str]:
    import subprocess
    result = subprocess.run(
        ["psql", "-X", "-v", "ON_ERROR_STOP=1", *(extra or []), "-f", str(SCRIPT)],
        env=os.environ.copy(),
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


def main() -> None:
    with connect() as conn:
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
        lf = None
        # Load the canonical body from the script's own pin by installing CRLF
        # only after reading the LF constant out of a successful LF install.
        # The LF bytes are the migration-78 body embedded in the script.
        text = SCRIPT.read_text(encoding="utf-8")
        start = text.index("$canonical$\n") + len("$canonical$")
        # The assignment is `:= $canonical$` followed by the body and a closing tag.
        # Take the first opening tag that is the v_lf assignment.
        marker = "v_lf pg_catalog.text := $canonical$"
        start = text.index(marker) + len(marker)
        end = text.index("$canonical$;", start)
        lf = text[start:end]
        if __import__("hashlib").md5(lf.encode("utf-8")).hexdigest() != LF_MD5:
            raise SystemExit("embedded LF pin drifted")
        crlf = lf.replace("\n", "\r\n")
        if __import__("hashlib").md5(crlf.encode("utf-8")).hexdigest() != CRLF_MD5:
            raise SystemExit("approved CRLF variant drifted")

        install(conn, lf)
        before = snapshot(conn)
        notes = run_script()
        after = snapshot(conn)
        if "PRE_M202_CRLF_NOOP" not in notes:
            raise SystemExit(f"LF no-op missing marker: {notes}")
        if after[0] != LF_MD5 or after[6] != before[6]:
            raise SystemExit(f"LF no-op mutated the row: {before} -> {after}")
        print("PRE_M202_CRLF_NOOP")

        install(conn, crlf)
        notes = run_script()
        after = snapshot(conn)
        if "PRE_M202_CRLF_REPLACED" not in notes or after[0] != LF_MD5 or after[5] != "search_path=public":
            raise SystemExit(f"CRLF replace failed: {notes} {after}")
        if after[3] != "postgres" or after[4] != "false" or after[7] != ACL:
            raise SystemExit(f"attributes not preserved: {after}")
        print("PRE_M202_CRLF_REPLACED")

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

        install(conn, lf)
        with conn.cursor() as cur:
            cur.execute("CREATE ROLE pre_m202_other_owner NOLOGIN")
            cur.execute(
                "GRANT pre_m202_other_owner TO postgres WITH SET TRUE, INHERIT FALSE"
            )
            cur.execute("GRANT CREATE ON SCHEMA public TO pre_m202_other_owner")
            cur.execute("ALTER FUNCTION public.validate_mo_transition(text, text) OWNER TO pre_m202_other_owner")
        expect_owner = snapshot(conn)
        try:
            run_script()
        except psycopg.Error as exc:
            message = str(exc)
            if "PRE_M202_CRLF_ATTRIBUTE_REFUSED" not in message:
                raise
        else:
            raise SystemExit("unexpected owner was accepted")
        conn.rollback()
        if snapshot(conn) != expect_owner:
            raise SystemExit("owner refusal changed the catalog")
        with conn.cursor() as cur:
            cur.execute("SET ROLE pre_m202_other_owner")
            cur.execute("DROP FUNCTION public.validate_mo_transition(text, text)")
            cur.execute("RESET ROLE")
            cur.execute("REVOKE CREATE ON SCHEMA public FROM pre_m202_other_owner")
            cur.execute("DROP ROLE pre_m202_other_owner")
        install(conn, lf)
        print("REFUSED|unexpected_owner")

        install(conn, lf)
        with conn.cursor() as cur:
            cur.execute("CREATE ROLE pre_m202_extra NOLOGIN")
            cur.execute("GRANT EXECUTE ON FUNCTION public.validate_mo_transition(text, text) TO pre_m202_extra")
        before = snapshot(conn)
        try:
            run_script()
        except psycopg.Error as exc:
            if "PRE_M202_CRLF_ATTRIBUTE_REFUSED" not in str(exc):
                raise
        else:
            raise SystemExit("unexpected ACL was accepted")
        conn.rollback()
        if snapshot(conn) != before:
            raise SystemExit("ACL refusal changed the catalog")
        with conn.cursor() as cur:
            cur.execute("REVOKE ALL ON FUNCTION public.validate_mo_transition(text, text) FROM pre_m202_extra")
            cur.execute("DROP ROLE pre_m202_extra")
        print("REFUSED|unexpected_acl")

        install(conn, lf)
        with conn.cursor() as cur:
            cur.execute("ALTER FUNCTION public.validate_mo_transition(text, text) SET search_path = public, pg_temp")
        before = snapshot(conn)
        try:
            run_script()
        except psycopg.Error as exc:
            if "PRE_M202_CRLF_ATTRIBUTE_REFUSED" not in str(exc):
                raise
        else:
            raise SystemExit("unexpected search_path was accepted")
        conn.rollback()
        if snapshot(conn) != before:
            raise SystemExit("attribute refusal changed the catalog")
        print("REFUSED|unexpected_search_path")

        install(conn, crlf)
        with conn.cursor() as cur:
            cur.execute(
                "ALTER FUNCTION public.validate_mo_transition(text, text) SET search_path = public, pg_temp"
            )
        before = snapshot(conn)
        try:
            run_script()
        except psycopg.Error as exc:
            if "PRE_M202_CRLF_ATTRIBUTE_REFUSED" not in str(exc):
                raise
        else:
            raise SystemExit("CRLF with an unexpected search_path was replaced")
        conn.rollback()
        if snapshot(conn) != before:
            raise SystemExit("CRLF unexpected search_path changed the catalog")
        print("REFUSED|crlf_unexpected_search_path")

        install(conn, lf)
        with conn.cursor() as cur:
            cur.execute("ALTER FUNCTION public.validate_mo_transition(text, text) COST 200")
        before = snapshot(conn)
        try:
            run_script()
        except psycopg.Error as exc:
            if "PRE_M202_CRLF_ATTRIBUTE_REFUSED" not in str(exc):
                raise
        else:
            raise SystemExit("unexpected cost was accepted")
        conn.rollback()
        if snapshot(conn) != before:
            raise SystemExit("unexpected cost changed the catalog")
        print("REFUSED|unexpected_cost")

        def hold_then(change_sql: str, commit: bool, script_extra: list[str] | None = None):
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

        # A committed settings change must stay visible. The script refuses it
        # and must not write search_path back to public.
        _before, holder, code, output = hold_then(
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

        bad = crlf + "\n"
        bad_md5 = __import__("hashlib").md5(bad.encode("utf-8")).hexdigest()
        _before, holder, code, output = hold_then(
            "CREATE OR REPLACE FUNCTION public.validate_mo_transition(p_from text, p_to text) "
            "RETURNS void LANGUAGE plpgsql SECURITY INVOKER "
            "SET search_path = public AS $canonical$" + bad + "$canonical$",
            True,
        )
        holder.close()
        if code == 0 or "PRE_M202_CRLF_BODY_REFUSED" not in output:
            raise SystemExit(f"concurrent body change was not refused: {code} {output}")
        seen = snapshot(conn)
        if seen[0] != bad_md5 or "PRE_M202_CRLF_REPLACED" in output:
            raise SystemExit(f"concurrent body change was replaced: {seen} {output}")
        print("REFUSED|concurrent_body")

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
        print("PRE_M202_CRLF_CHECKS_PASS")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:
        print(f"PRE_M202_CRLF_CHECKS_FAILED {exc}", file=sys.stderr)
        raise
