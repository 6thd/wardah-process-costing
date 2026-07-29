#!/usr/bin/env python3
"""Validate repository migration naming and the live Supabase migration ledger.

The guard is intentionally read-only. Historical anomalies are allowed only when
listed explicitly in migration_ledger_exceptions.json with exact versions/names.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

CANONICAL_RE = re.compile(r"^(?P<number>\d{3,})_(?P<name>[a-z0-9]+(?:_[a-z0-9]+)*)\.sql$")
PREFIX_RE = re.compile(r"^(?P<number>\d+)")


class ValidationError(RuntimeError):
    pass


@dataclass(frozen=True)
class MigrationFile:
    number: int
    path: Path

    @property
    def filename(self) -> str:
        return self.path.name

    @property
    def stem(self) -> str:
        return self.path.stem


def _load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ValidationError(f"Missing JSON file: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ValidationError(f"Invalid JSON in {path}: {exc}") from exc


def load_exceptions(path: Path) -> dict[str, Any]:
    data = _load_json(path)
    if not isinstance(data, dict):
        raise ValidationError("Exceptions file must contain a JSON object")

    duplicates = data.get("allowed_duplicate_names", {})
    aliases = data.get("version_name_aliases", {})
    if not isinstance(duplicates, dict) or not isinstance(aliases, dict):
        raise ValidationError(
            "allowed_duplicate_names and version_name_aliases must be JSON objects"
        )

    for name, versions in duplicates.items():
        if not isinstance(name, str) or not name:
            raise ValidationError("Duplicate migration names must be non-empty strings")
        if not isinstance(versions, list) or len(versions) < 2:
            raise ValidationError(
                f"Duplicate allowlist for {name!r} must contain at least two versions"
            )
        normalized = [str(version) for version in versions]
        if len(set(normalized)) != len(normalized):
            raise ValidationError(f"Duplicate versions repeated in allowlist for {name!r}")
        duplicates[name] = normalized

    seen_alias_targets: set[str] = set()
    for version, alias in aliases.items():
        if not str(version).isdigit():
            raise ValidationError(f"Alias version must be numeric: {version!r}")
        if not isinstance(alias, dict):
            raise ValidationError(f"Alias {version} must be a JSON object")
        live_name = alias.get("live_name")
        canonical_file = alias.get("canonical_file")
        if not isinstance(live_name, str) or not live_name:
            raise ValidationError(f"Alias {version} has invalid live_name")
        if not isinstance(canonical_file, str) or not canonical_file.endswith(".sql"):
            raise ValidationError(f"Alias {version} has invalid canonical_file")
        target_key = f"{version}:{live_name}"
        if target_key in seen_alias_targets:
            raise ValidationError(f"Duplicate alias declaration: {target_key}")
        seen_alias_targets.add(target_key)

    return {
        "allowed_duplicate_names": duplicates,
        "version_name_aliases": aliases,
    }


def discover_repo_migrations(migrations_dir: Path, minimum_number: int) -> list[MigrationFile]:
    if not migrations_dir.is_dir():
        raise ValidationError(f"Migration directory does not exist: {migrations_dir}")

    migrations: list[MigrationFile] = []
    invalid: list[str] = []
    for path in sorted(migrations_dir.glob("*.sql")):
        prefix = PREFIX_RE.match(path.name)
        if not prefix:
            continue
        number = int(prefix.group("number"))
        if number < minimum_number:
            continue
        match = CANONICAL_RE.fullmatch(path.name)
        if not match:
            invalid.append(path.name)
            continue
        migrations.append(MigrationFile(number=number, path=path))

    if invalid:
        raise ValidationError(
            "Non-canonical migration filename(s) at or above "
            f"{minimum_number}: {', '.join(invalid)}. Expected NNN_snake_case.sql"
        )
    if not migrations:
        raise ValidationError(
            f"No canonical migrations found at or above {minimum_number} in {migrations_dir}"
        )

    by_number: dict[int, list[str]] = defaultdict(list)
    by_stem: dict[str, list[str]] = defaultdict(list)
    for migration in migrations:
        by_number[migration.number].append(migration.filename)
        by_stem[migration.stem].append(migration.filename)

    duplicate_numbers = {
        number: files for number, files in by_number.items() if len(files) > 1
    }
    duplicate_stems = {stem: files for stem, files in by_stem.items() if len(files) > 1}
    if duplicate_numbers:
        details = "; ".join(
            f"{number}: {', '.join(files)}"
            for number, files in sorted(duplicate_numbers.items())
        )
        raise ValidationError(f"Duplicate migration number(s): {details}")
    if duplicate_stems:
        details = "; ".join(
            f"{stem}: {', '.join(files)}" for stem, files in sorted(duplicate_stems.items())
        )
        raise ValidationError(f"Duplicate migration stem(s): {details}")

    return migrations


def validate_exception_targets(
    migrations: list[MigrationFile], exceptions: dict[str, Any]
) -> None:
    filenames = {migration.filename for migration in migrations}
    stems = {migration.stem for migration in migrations}

    for duplicate_name in exceptions["allowed_duplicate_names"]:
        if duplicate_name not in stems:
            raise ValidationError(
                f"Duplicate exception {duplicate_name!r} has no canonical repository file"
            )

    for version, alias in exceptions["version_name_aliases"].items():
        canonical_file = alias["canonical_file"]
        if canonical_file not in filenames:
            raise ValidationError(
                f"Alias {version} points to missing repository file {canonical_file!r}"
            )


def load_ledger(path: Path) -> list[dict[str, str]]:
    data = _load_json(path)
    if isinstance(data, dict) and "migrations" in data:
        data = data["migrations"]
    if not isinstance(data, list):
        raise ValidationError("Ledger JSON must be an array or an object with migrations[]")

    records: list[dict[str, str]] = []
    seen_versions: set[str] = set()
    for index, item in enumerate(data):
        if not isinstance(item, dict):
            raise ValidationError(f"Ledger item {index} is not an object")
        version = str(item.get("version", "")).strip()
        name = str(item.get("name", "")).strip()
        if not version.isdigit() or not name:
            raise ValidationError(f"Ledger item {index} has invalid version/name")
        if version in seen_versions:
            raise ValidationError(f"Duplicate ledger version: {version}")
        seen_versions.add(version)
        records.append({"version": version, "name": name})

    if not records:
        raise ValidationError("Live migration ledger is empty")
    return sorted(records, key=lambda record: record["version"])


def validate_ledger(
    migrations: list[MigrationFile],
    records: list[dict[str, str]],
    exceptions: dict[str, Any],
) -> dict[str, Any]:
    by_filename = {migration.filename: migration for migration in migrations}
    by_stem = {migration.stem: migration for migration in migrations}
    aliases = exceptions["version_name_aliases"]

    mapped: list[tuple[dict[str, str], MigrationFile]] = []
    used_alias_versions: set[str] = set()
    for record in records:
        version = record["version"]
        name = record["name"]
        alias = aliases.get(version)
        if alias is not None:
            if name != alias["live_name"]:
                raise ValidationError(
                    f"Alias {version} expected live name {alias['live_name']!r}, got {name!r}"
                )
            migration = by_filename.get(alias["canonical_file"])
            if migration is None:
                raise ValidationError(
                    f"Alias {version} maps to missing file {alias['canonical_file']!r}"
                )
            used_alias_versions.add(version)
        else:
            migration = by_stem.get(name)
            if migration is None:
                raise ValidationError(
                    f"Live migration {version}/{name} has no exact repository file {name}.sql "
                    "and no documented alias"
                )
        mapped.append((record, migration))

    unused_aliases = sorted(set(aliases) - used_alias_versions)
    if unused_aliases:
        raise ValidationError(
            "Documented version aliases were not found in the live ledger: "
            + ", ".join(unused_aliases)
        )

    grouped_versions: dict[str, list[str]] = defaultdict(list)
    for record in records:
        grouped_versions[record["name"]].append(record["version"])

    actual_duplicates = {
        name: sorted(versions)
        for name, versions in grouped_versions.items()
        if len(versions) > 1
    }
    allowed_duplicates = {
        name: sorted(versions)
        for name, versions in exceptions["allowed_duplicate_names"].items()
    }
    unexpected_names = sorted(set(actual_duplicates) - set(allowed_duplicates))
    missing_names = sorted(set(allowed_duplicates) - set(actual_duplicates))
    mismatched_names = sorted(
        name
        for name in set(actual_duplicates) & set(allowed_duplicates)
        if actual_duplicates[name] != allowed_duplicates[name]
    )
    if unexpected_names or missing_names or mismatched_names:
        parts: list[str] = []
        if unexpected_names:
            parts.append("unexpected duplicates=" + ", ".join(unexpected_names))
        if missing_names:
            parts.append("stale duplicate exceptions=" + ", ".join(missing_names))
        if mismatched_names:
            parts.append("version mismatch=" + ", ".join(mismatched_names))
        raise ValidationError("Live duplicate migration contract failed: " + "; ".join(parts))

    repo_max = max(migration.number for migration in migrations)
    latest_record, latest_migration = mapped[-1]
    live_cutoff = latest_migration.number
    if live_cutoff > repo_max:
        raise ValidationError(
            f"Production migration {latest_record['name']} maps to {live_cutoff}, "
            f"which is ahead of repository max {repo_max}"
        )

    pending = [
        migration.filename for migration in migrations if migration.number > live_cutoff
    ]
    return {
        "status": "ok",
        "ledger_entries": len(records),
        "repository_migrations_checked": len(migrations),
        "repo_max": repo_max,
        "live_cutoff": live_cutoff,
        "live_version": latest_record["version"],
        "live_name": latest_record["name"],
        "live_file": latest_migration.filename,
        "repository_ahead_by": repo_max - live_cutoff,
        "pending_repository_files": pending,
        "documented_duplicate_names": sorted(actual_duplicates),
        "documented_alias_versions": sorted(used_alias_versions),
    }


def write_github_output(path: Path, summary: dict[str, Any]) -> None:
    values = {
        "live_cutoff": summary["live_cutoff"],
        "live_version": summary["live_version"],
        "live_name": summary["live_name"],
        "live_file": summary["live_file"],
        "repo_max": summary["repo_max"],
        "repository_ahead_by": summary["repository_ahead_by"],
    }
    with path.open("a", encoding="utf-8") as handle:
        for key, value in values.items():
            handle.write(f"{key}={value}\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--migrations-dir", type=Path, default=Path("sql/migrations"))
    parser.add_argument(
        "--exceptions",
        type=Path,
        default=Path("sql/migrations/migration_ledger_exceptions.json"),
    )
    parser.add_argument("--minimum-number", type=int, default=101)
    parser.add_argument("--ledger-json", type=Path)
    parser.add_argument("--summary-json", type=Path)
    parser.add_argument("--github-output", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        exceptions = load_exceptions(args.exceptions)
        migrations = discover_repo_migrations(args.migrations_dir, args.minimum_number)
        validate_exception_targets(migrations, exceptions)
        summary: dict[str, Any] = {
            "status": "ok",
            "repository_migrations_checked": len(migrations),
            "repo_max": max(migration.number for migration in migrations),
        }
        if args.ledger_json:
            summary = validate_ledger(
                migrations, load_ledger(args.ledger_json), exceptions
            )
        if args.summary_json:
            args.summary_json.parent.mkdir(parents=True, exist_ok=True)
            args.summary_json.write_text(
                json.dumps(summary, indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
        if args.github_output:
            if not args.ledger_json:
                raise ValidationError("--github-output requires --ledger-json")
            write_github_output(args.github_output, summary)
        print(json.dumps(summary, indent=2, ensure_ascii=False))
        return 0
    except ValidationError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
