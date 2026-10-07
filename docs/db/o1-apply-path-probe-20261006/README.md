# O1 apply-path probe — evidence package (2026-10-06)

Review text and observation record. It authorizes nothing and is **not** Production or Staging evidence. Write target: Supabase project `kfzwgldukqmcvzhzysrx` (`Wardah-O1-Apply-Migration-Probe-20261006`, empty, PG 17.11) only; the single Production contact is one read-only identity `SELECT` (`raw/10`). Analysis and decisions: `../APPLY_PATH_O1_RESULTS_AND_DECISION_20261006.md`.

| Path | Content |
|---|---|
| `o1_probes_APPROVED.sql` | The reviewed and approved probe text (with the `-- <GUARD>` placeholder). |
| `sent/sent_*.sql` | The **expanded** text actually sent per step: the placeholder replaced byte-for-byte by the GUARD block; UTF-8, LF, one trailing LF. P1–P5 and E34 went through `apply_migration`; P0, R and C through `execute_sql` (C was cancelled by the tool layer and not run). `sent_E34.sql` is the 84,278-byte multibyte file. |
| `o1_sent_bytes_manifest.txt` | Length, SHA-256 and MD5 of P0–P5, R and C, computed **before** sending. The E34 values are recorded in `raw/11` (and are the file's own SHA-256 in `SHA256SUMS.txt`). |
| `raw/00…15` | The tool responses as received and the readback after each step. Only `organization_id`/`organization_slug` in `00` are redacted; `created_by` was never selected. `10` is the Production read-only identity query; `11` is E3/E4; `12…14` are E1/E2 (preflight and install, E1, E2); `15` records that the E1/E2 cleanup did **not** run (permission prompt) and the resulting state. |
| `proposed/e1_e2_ledger_failure_PROPOSED.sql` | The E1/E2 text as first reviewed (install, verify, two tests, readback, removal, fingerprint). It was run **with the reviewer's changes** (install and removal each in one transaction, preconditions checked first): the texts actually sent are in `sent/e1e2/` with `e12_sent_manifest.txt`. |
| `sent/e1e2/*.sql` | The exact E1/E2 texts sent (fingerprint, preconditions, transactional install, trigger check, E1, E2, readbacks, transactional cleanup **not executed**, cleanup verification) and `e12_sent_manifest.txt` (SHA-256 computed before sending). |
| `SHA256SUMS.txt` | SHA-256 of every other file in this folder (`sha256sum -c SHA256SUMS.txt` from this folder). |

Byte exactness: for P1, P5 and E34 the ledger row's `statements` holds one element whose SHA-256 equals the sent file (P1 `4066` bytes `f28c5e33…edd`; P5 `913` bytes `2254a827…4a9`; E34 `84278` bytes `090dcecd…9668`); the comparison queries are in `raw/03`, `raw/07` and `raw/11`.

State left on O1 (owner instruction, and a cleanup that stopped at a permission prompt): schema `o1_probe` (tables `identity`, `fail_after_commit_a`, `commit_ok_d`, `utf8_large`, `e1_after_own_commit`; functions `owner_probe()` and `ledger_refuse_e1e2()`), the trigger `o1_probe_ledger_refuse_e1e2` on `supabase_migrations.schema_migrations` (it raises only for two literal names) and three ledger rows (`o1_probe_01_identity`, `o1_probe_05_own_commit_success`, `o1_probe_06_utf8_large_success`). The cleanup (`sent_C.sql`) was **cancelled by the tool layer and not repeated** (`raw/08`).
