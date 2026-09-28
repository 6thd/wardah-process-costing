# M191 — Production application and readback (2026-09-28)

**Project:** Production `uutfztmqvajmsxnrqeiv`; server PostgreSQL 17.6.  
**Source:** `main@76689dc076ca50f1765603bf7fb17439e4d0af39`, file `sql/migrations/191_f2_stock_write_concurrency_closure.sql`; SHA-256 `637a81caeaebea60693476222611b373dc1e738cd6b10c634bf4c236227f3f40`; Git blob `3e1736285ec245e619238e6c082f75009de33791`.  
**Live ledger:** name `191_f2_stock_write_concurrency_closure`, version `20260928074428` (2026-09-28 07:44:28 UTC / 10:44:28 Asia/Riyadh).  
**Boundary:** M192 was not submitted; Staging was not accessed or changed during this application. The historical cutoff-189 generated block in `CLAUDE.md` is left unchanged.

## Recovery point: owner/local-agent report

The owner supplied a local-agent report of a **new post-M190, pre-M191** private custom-format archive, `wardah-production-uutfztmqvajmsxnrqeiv-after-m190-before-m191.dump`: 2,646,977 bytes, SHA-256 `4ec065129bcf5f522caea8936991f43befcb5a744d58c2d614d56366696e5688`. The reported PG 17.11 `pg_dump -Fc` exited 0 on 2026-09-28 06:48:34 UTC; `pg_restore --list` exited 0 with 3,595 entries. The local agent verified the archive checksum after the run.

The first restoration to ordinary `postgres:17` was **not complete**: it exited 1 with five dependent errors from missing `pg_net` and `supabase_vault` extension files. The agent then restored the **unchanged archive** into a new clean database created from `template0` under `supabase/postgres:17.6.1.175` (local PostgreSQL 17.6), creating two missing Supabase roles locally before the successful attempt. The final `pg_restore --exit-on-error` exited **0**, with no reported errors or warnings. The local readback found the Production extension versions (`pg_net` 0.20.4, `supabase_vault` 0.3.1), `net`, `vault.secrets`, 133 `public` tables, the 12 predecessor functions, M190 once, and no M191/M192. The prior pre-M190 archive was reportedly untouched. A local `m191-function-preimage.txt` captures the 12 definitions, owners, security modes, search paths and grants.

**Evidence limit:** these archive, checksum, restore, extension and local-preimage facts are **owner/local-agent reported**. The archive and complete logs were not uploaded to the repository or independently inspected in this session. A database restore is not proof of recovery of every surrounding Supabase service. Keep the archive, local logs and preimage private; the archive contains `vault.secrets`.

## Executor-run read-only Production preflight

The executor independently queried Production on 2026-09-28; a final readback at 07:43:51–07:43:55 UTC immediately preceded submission. All required M191 relations, 12 predecessor signatures and three canonical helpers existed. The exact M190 permission existed once, and `rpc_consume_reserved_materials_v2` included its key. The new M191 helper was absent. The 12 normalized function-definition MD5s were unchanged from the executor's earlier readback; the earlier independent M191 review had reported 11/12 pre-M191 definitions byte-equal to Fresh DB at 190 and the remaining `release_expired_reservations` equal after CRLF normalization.

| Before-apply check | Observed |
|---|---|
| Ledger | M190 once at `20260927082227`; M191/M192 absent; newest version `20260927082227` |
| Projection (`products` quantity/value vs same-org `bins`) | 0 mismatch rows |
| `validate_stock_balance` across the single organization | 0 mismatch rows |
| Stock | 0 active SLE, 5 cancelled SLE; 0 nonzero products or bins; 0 `material_consumption` rows |
| Other client sessions at the snapshot | 0 active; 0 idle in transaction |
| M191 function/security snapshot | 12/12 resolved; preflight definitions and ACL hashes captured |

The owner authorized M191 after reviewing the independent technical readiness and the reported approximately **31.4% throughput reduction** for the hot-SKU/multiple-warehouse workload in [PR #258](https://github.com/6thd/wardah-process-costing/pull/258). That benchmark is disposable-test evidence; no live throughput threshold or Production load test was established.

## Application

The executor submitted the exact canonical file above through Supabase `apply_migration` with name `191_f2_stock_write_concurrency_closure`. The call returned `success=true`. M191's own `BEGIN … COMMIT` includes its prerequisite preflight, the pre-replacement security/ACL capture (Slice 11/A), all 13 function objects, and the comparison postflight (Slice 11/B). The migration does not mutate business rows; the live readbacks below separately checked observable stock effects.

## Executor-run post-commit Production readback

Read-only SQL and `list_migrations` on 2026-09-28, starting 07:45 UTC, returned:

| Check | Observed |
|---|---|
| Ledger | 84 total entries; M190 once; M191 **once** as `20260928074428`; M192 absent |
| Functions | All 12 predecessor signatures remain present and their normalized body hashes changed; the new helper exists once |
| Predecessor ACL | 12/12 effective ACL text hashes equal to the immediately preceding executor snapshot |
| Helper `wardah_lock_products_for_stock_write(uuid,uuid[])` | Owner `postgres`, `SECURITY INVOKER`, `search_path=public, pg_temp`; EXECUTE denied to `PUBLIC`, `anon`, `authenticated` |
| Projection / stock balance | 0 mismatch rows for both checks |
| Business counts | 0 active SLE, 5 cancelled SLE, 0 material-consumption rows, and 0 nonzero products/bins |

Normalized `pg_get_functiondef` MD5 readbacks (strip `\r` before hashing) are identifiers for later drift comparison, **not** a new Fresh DB acceptance run:

| Signature | Before M191 | After M191 |
|---|---|---|
| `public.release_expired_reservations(uuid)` | `7cb82de15e2c99408c74cf4973680f67` | `7b461d5cf3a6cefd079b0287c288aa3c` |
| `public.rpc_cancel_stock_adjustment(uuid,text)` | `115722f677d0b5b4107a9651425c58df` | `57990460d3bac398ce1ee0f63d1acb66` |
| `public.rpc_consume_reserved_materials_v2(uuid,uuid,jsonb)` | `c75ee677250d5f418920e4ef33a0ff1e` | `5ac7f28e83d33c2d511ba4d99250ecf0` |
| `public.rpc_create_mo_with_reservation(jsonb,jsonb,uuid)` | `f199452d547e22faf07bc540317f5aca` | `8e1e2650cd1da8158215e88ae05a06d4` |
| `public.rpc_manual_stock_movement_v2(jsonb)` | `f86342a483d6f732e948b9a65ce7f172` | `99220d83be7d2401ec5c4651ad8a1735` |
| `public.rpc_post_delivery_note(jsonb)` | `602ceb9d52f84c10ed0d69307261a409` | `7f1463000a663b8161a632b0a25f0638` |
| `public.rpc_post_goods_receipt(jsonb)` | `16b46b36cce63d5f0c8d31c4813f75c7` | `61f41f891bccaa7854d27f5a69ce6092` |
| `public.rpc_submit_stock_adjustment(uuid)` | `8b7a147668215115fe7dd0dfe6860516` | `702056fd4104a5a97b606393c8548e66` |
| `public.wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date,uuid)` | `5c5075a48b8affdc6567d82b2b07c11e` | `2cb244884334ce07e2d69081ab04b339` |
| `public.wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date)` | `a480c59fcc183f645401e3e41ee94957` | `e604756a52fef570f24866f462430d91` |
| `public.wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date,uuid)` | `da356998522eaa3603ffac2a6a285158` | `3a54ba2e17f6cbdbb442615dc00657b2` |
| `public.wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date)` | `23f7ea2ee6f21b915014e12b8abf5d54` | `632c36dccc0a8dd5de9bf92abdf87634` |

Supabase Advisor was queried only **after** application. It returned security `WARN` categories `function_search_path_mutable` (2), `anon_security_definer_function_executable` (1), `authenticated_security_definer_function_executable` (88), and `auth_leaked_password_protection` (1); performance `WARN` categories `auth_rls_initplan` (50) and `multiple_permissive_policies` (2), plus `INFO` entries. There is **no before-apply Advisor snapshot in this session**, so none of these counts is attributed to M191. Review them separately; see the [Supabase database lint reference](https://supabase.com/docs/guides/database/database-linter).

## Limits and next decision

No Production fixture, ordinary-user material-consumption exercise, multi-user race, or hot-SKU load test ran. The zero stock-balance result is limited by the absence of active SLE/business movements. The PostgreSQL 17.11 RED/GREEN concurrency and rollback proof is disposable-test evidence from the independent readiness review, not this Production transaction.

M192 remains in `main` but **unapplied** to Production; #229 requires a separate review and authorization. Before considering M192, verify the live M190/M191 ledger and M191 catalog/Fix E again, review dependent views and client signatures, make a **fresh post-M191/pre-M192 recovery point and restore it**, and run M192 on an isolated restored copy. Staging drift remains unresolved. #230 (completion), #260 (costing), #259 (physical counts) and the #268 MO/WO lock-order note remain separate workstreams; M191's application does not close them.
