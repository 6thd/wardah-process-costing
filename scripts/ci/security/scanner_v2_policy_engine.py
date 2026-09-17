#!/usr/bin/env python3
"""Scanner v2 Slice 3 fail-closed policy decision core.

This layer consumes already-produced Slice 2 binding/runtime evidence and inert
guard evidence. It does not parse SQL, inspect PL/pgSQL, call PostgreSQL, replay
ACL statements, or classify guard bodies.

Runtime reachability remains authoritative. Guard evidence may justify
PASS_GUARDED for a runtime-OPEN target, but it can never rewrite OPEN to CLOSED.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

BINDING_SCANNER = "wardah-scanner-v2-discovery-binding"
GUARD_SCANNER = "wardah-scanner-v2-guard-evidence-v1"
POLICY_SCANNER = "wardah-scanner-v2-policy"

BINDING_DOCUMENT_KEYS = {
    "scanner",
    "status",
    "candidate_count",
    "binding_count",
    "bindings",
}
BINDING_KEYS = {
    "statement_index",
    "source_kind",
    "source_schema",
    "source_name",
    "source_arguments",
    "catalog_oid",
    "catalog_identity",
    "catalog_prokind",
    "discovery_status",
    "client_callable",
    "runtime_verdict",
    "runtime_evidence",
}
RUNTIME_EVIDENCE_KEYS = {
    "public_execute",
    "anon_role_exists",
    "anon_execute",
    "authenticated_role_exists",
    "authenticated_execute",
    "proacl",
    "proconfig",
}
GUARD_DOCUMENT_KEYS = {"scanner", "guard_records"}
GUARD_RECORD_KEYS = {
    "catalog_oid",
    "catalog_identity",
    "guard_status",
    "guard_mechanism",
    "evidence_location",
    "proof_class",
}
PROOF_FIELDS = ("guard_mechanism", "evidence_location", "proof_class")


class EvidenceError(RuntimeError):
    """Raised when policy input evidence is malformed or contradictory."""


def _require_exact_keys(value: dict[str, Any], expected: set[str], context: str) -> None:
    actual = set(value)
    if actual != expected:
        missing = sorted(expected - actual)
        extra = sorted(actual - expected)
        raise EvidenceError(
            f"{context} keys mismatch: missing={missing}, extra={extra}"
        )


def _require_object(value: Any, context: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise EvidenceError(f"{context} must be an object")
    return value


def _require_list(value: Any, context: str) -> list[Any]:
    if not isinstance(value, list):
        raise EvidenceError(f"{context} must be an array")
    return value


def _require_string(value: Any, context: str, *, nonempty: bool = False) -> str:
    if not isinstance(value, str):
        raise EvidenceError(f"{context} must be a string")
    if nonempty and not value.strip():
        raise EvidenceError(f"{context} must be a non-empty string")
    return value


def _require_int(value: Any, context: str, *, positive: bool = False) -> int:
    if type(value) is not int:
        raise EvidenceError(f"{context} must be an integer")
    if positive and value <= 0:
        raise EvidenceError(f"{context} must be positive")
    return value


def _require_bool(value: Any, context: str) -> bool:
    if type(value) is not bool:
        raise EvidenceError(f"{context} must be boolean")
    return value


def _require_nullable_bool(value: Any, context: str) -> bool | None:
    if value is None:
        return None
    return _require_bool(value, context)


def _require_nullable_string_list(value: Any, context: str) -> list[str] | None:
    if value is None:
        return None
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise EvidenceError(f"{context} must be null or an array of strings")
    return value


def _load_json(path: Path, context: str) -> dict[str, Any]:
    try:
        raw = path.read_text(encoding="utf-8")
        payload = json.loads(raw)
    except (OSError, json.JSONDecodeError) as exc:
        raise EvidenceError(f"{context} cannot be read as JSON: {exc}") from exc
    return _require_object(payload, context)


def _validate_runtime_evidence(value: Any, context: str) -> dict[str, Any]:
    evidence = _require_object(value, context)
    _require_exact_keys(evidence, RUNTIME_EVIDENCE_KEYS, context)

    public_execute = _require_bool(
        evidence["public_execute"], f"{context}.public_execute"
    )
    anon_role_exists = _require_bool(
        evidence["anon_role_exists"], f"{context}.anon_role_exists"
    )
    anon_execute = _require_nullable_bool(
        evidence["anon_execute"], f"{context}.anon_execute"
    )
    authenticated_role_exists = _require_bool(
        evidence["authenticated_role_exists"],
        f"{context}.authenticated_role_exists",
    )
    authenticated_execute = _require_nullable_bool(
        evidence["authenticated_execute"],
        f"{context}.authenticated_execute",
    )
    _require_nullable_string_list(evidence["proacl"], f"{context}.proacl")
    _require_nullable_string_list(evidence["proconfig"], f"{context}.proconfig")

    derived_client_callable = bool(
        public_execute
        or (anon_role_exists and anon_execute is True)
        or (authenticated_role_exists and authenticated_execute is True)
    )
    return {
        "public_execute": public_execute,
        "anon_role_exists": anon_role_exists,
        "anon_execute": anon_execute,
        "authenticated_role_exists": authenticated_role_exists,
        "authenticated_execute": authenticated_execute,
        "derived_client_callable": derived_client_callable,
    }


def _validate_binding_document(payload: dict[str, Any]) -> list[dict[str, Any]]:
    _require_exact_keys(payload, BINDING_DOCUMENT_KEYS, "binding document")
    if payload["scanner"] != BINDING_SCANNER:
        raise EvidenceError("binding document has invalid scanner identity")
    if payload["status"] != "RESOLVED":
        raise EvidenceError("binding document status must be RESOLVED")

    candidate_count = _require_int(
        payload["candidate_count"], "binding document.candidate_count"
    )
    binding_count = _require_int(
        payload["binding_count"], "binding document.binding_count"
    )
    bindings = _require_list(payload["bindings"], "binding document.bindings")
    if candidate_count != binding_count or binding_count != len(bindings):
        raise EvidenceError(
            "binding document counts are inconsistent with the binding array"
        )

    validated: list[dict[str, Any]] = []
    seen_oids: set[int] = set()
    for index, raw_binding in enumerate(bindings):
        context = f"binding[{index}]"
        binding = _require_object(raw_binding, context)
        _require_exact_keys(binding, BINDING_KEYS, context)

        _require_int(binding["statement_index"], f"{context}.statement_index")
        source_kind = _require_string(
            binding["source_kind"], f"{context}.source_kind", nonempty=True
        )
        source_schema = _require_string(
            binding["source_schema"], f"{context}.source_schema", nonempty=True
        )
        source_name = _require_string(
            binding["source_name"], f"{context}.source_name", nonempty=True
        )
        source_arguments = _require_string(
            binding["source_arguments"], f"{context}.source_arguments"
        )
        oid = _require_int(
            binding["catalog_oid"], f"{context}.catalog_oid", positive=True
        )
        identity = _require_string(
            binding["catalog_identity"],
            f"{context}.catalog_identity",
            nonempty=True,
        )
        prokind = _require_string(
            binding["catalog_prokind"], f"{context}.catalog_prokind", nonempty=True
        )
        discovery_status = _require_string(
            binding["discovery_status"],
            f"{context}.discovery_status",
            nonempty=True,
        )
        if discovery_status != "RESOLVED":
            raise EvidenceError(f"{context}.discovery_status must be RESOLVED")

        client_callable = _require_bool(
            binding["client_callable"], f"{context}.client_callable"
        )
        runtime_verdict = _require_string(
            binding["runtime_verdict"], f"{context}.runtime_verdict", nonempty=True
        )
        if runtime_verdict not in {"OPEN", "CLOSED"}:
            raise EvidenceError(f"{context}.runtime_verdict must be OPEN or CLOSED")

        runtime = _validate_runtime_evidence(
            binding["runtime_evidence"], f"{context}.runtime_evidence"
        )
        derived_client_callable = runtime["derived_client_callable"]
        derived_runtime_verdict = "OPEN" if derived_client_callable else "CLOSED"
        if client_callable != derived_client_callable:
            raise EvidenceError(
                f"{context}.client_callable contradicts runtime evidence"
            )
        if runtime_verdict != derived_runtime_verdict:
            raise EvidenceError(
                f"{context}.runtime_verdict contradicts runtime evidence"
            )

        if oid in seen_oids:
            raise EvidenceError(f"duplicate binding catalog_oid={oid}")
        seen_oids.add(oid)

        if source_kind == "FUNCTION" and prokind != "f":
            raise EvidenceError(f"{context} function/prokind identity is inconsistent")
        if source_kind == "PROCEDURE" and prokind != "p":
            raise EvidenceError(f"{context} procedure/prokind identity is inconsistent")

        validated.append(
            {
                "statement_index": binding["statement_index"],
                "source_kind": source_kind,
                "source_schema": source_schema,
                "source_name": source_name,
                "source_arguments": source_arguments,
                "catalog_oid": oid,
                "catalog_identity": identity,
                "catalog_prokind": prokind,
                "discovery_status": discovery_status,
                "client_callable": client_callable,
                "runtime_verdict": runtime_verdict,
            }
        )

    return validated


def _validate_guard_document(payload: dict[str, Any]) -> dict[int, dict[str, Any]]:
    _require_exact_keys(payload, GUARD_DOCUMENT_KEYS, "guard document")
    if payload["scanner"] != GUARD_SCANNER:
        raise EvidenceError("guard document has invalid scanner identity")

    records = _require_list(payload["guard_records"], "guard document.guard_records")
    by_oid: dict[int, dict[str, Any]] = {}
    for index, raw_record in enumerate(records):
        context = f"guard_record[{index}]"
        record = _require_object(raw_record, context)
        _require_exact_keys(record, GUARD_RECORD_KEYS, context)

        oid = _require_int(
            record["catalog_oid"], f"{context}.catalog_oid", positive=True
        )
        if oid in by_oid:
            raise EvidenceError(f"duplicate guard catalog_oid={oid}")

        identity = _require_string(
            record["catalog_identity"],
            f"{context}.catalog_identity",
            nonempty=True,
        )
        status = _require_string(
            record["guard_status"], f"{context}.guard_status", nonempty=True
        )

        if status == "PROVEN":
            for field in PROOF_FIELDS:
                _require_string(record[field], f"{context}.{field}", nonempty=True)
        else:
            for field in PROOF_FIELDS:
                if record[field] is not None:
                    raise EvidenceError(
                        f"{context}.{field} must be null when guard_status is not PROVEN"
                    )

        by_oid[oid] = {
            "catalog_oid": oid,
            "catalog_identity": identity,
            "guard_status": status,
            "guard_mechanism": record["guard_mechanism"],
            "evidence_location": record["evidence_location"],
            "proof_class": record["proof_class"],
        }

    return by_oid


def _policy_target(
    binding: dict[str, Any], guard: dict[str, Any] | None
) -> dict[str, Any]:
    oid = binding["catalog_oid"]
    identity = binding["catalog_identity"]

    if guard is not None and guard["catalog_identity"] != identity:
        raise EvidenceError(
            f"guard catalog_identity contradicts binding for catalog_oid={oid}"
        )

    runtime_verdict = binding["runtime_verdict"]
    guard_status = guard["guard_status"] if guard is not None else None

    if runtime_verdict == "CLOSED":
        policy_status = "PASS_CLOSED"
    elif guard is None:
        policy_status = "FAIL_UNKNOWN"
    elif guard_status == "PROVEN":
        policy_status = "PASS_GUARDED"
    elif guard_status == "ABSENT":
        policy_status = "FAIL_OPEN_UNGUARDED"
    elif guard_status == "AMBIGUOUS":
        policy_status = "FAIL_AMBIGUOUS"
    else:
        policy_status = "FAIL_UNKNOWN"

    return {
        "catalog_oid": oid,
        "catalog_identity": identity,
        "catalog_prokind": binding["catalog_prokind"],
        "runtime_verdict": runtime_verdict,
        "client_callable": binding["client_callable"],
        "guard_status": guard_status,
        "policy_status": policy_status,
    }


def _emit_policy(bindings: list[dict[str, Any]], guards: dict[int, dict[str, Any]]) -> int:
    if not bindings:
        print(
            json.dumps(
                {
                    "scanner": POLICY_SCANNER,
                    "overall_status": "FAIL",
                    "overall_reason": "NO_RELEVANT_TARGETS",
                    "target_count": 0,
                    "targets": [],
                },
                sort_keys=True,
                indent=2,
            )
        )
        return 2

    targets = [
        _policy_target(binding, guards.get(binding["catalog_oid"]))
        for binding in bindings
    ]
    targets.sort(key=lambda item: (item["catalog_identity"], item["catalog_oid"]))

    overall_pass = all(
        target["policy_status"] in {"PASS_CLOSED", "PASS_GUARDED"}
        for target in targets
    )
    payload = {
        "scanner": POLICY_SCANNER,
        "overall_status": "PASS" if overall_pass else "FAIL",
        "overall_reason": (
            "ALL_TARGETS_ACCEPTED" if overall_pass else "ONE_OR_MORE_TARGETS_FAILED"
        ),
        "target_count": len(targets),
        "targets": targets,
    }
    print(json.dumps(payload, sort_keys=True, indent=2))
    return 0 if overall_pass else 2


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bindings", required=True, type=Path)
    parser.add_argument("--guard-evidence", required=True, type=Path)
    args = parser.parse_args(argv)

    try:
        binding_payload = _load_json(args.bindings, "binding document")
        guard_payload = _load_json(args.guard_evidence, "guard document")
        bindings = _validate_binding_document(binding_payload)
        guards = _validate_guard_document(guard_payload)
        return _emit_policy(bindings, guards)
    except EvidenceError as exc:
        print(f"SCANNER_V2_POLICY_EVIDENCE_ERROR: {exc}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
