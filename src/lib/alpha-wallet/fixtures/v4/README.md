# Frozen V4 compatibility evidence

The accepted and cancelled histories, states, and paused backups were captured once from commit `26ac313212071c3ca600ad19dfb72cac234c0ef0`, before the V5 implementation. The capture verified 101 transitive source, schema, and manifest files against that Git object.

Both histories retain the original `submission_unknown` withdrawal with one dispatch. The accepted history holds the full initial principal in its trade account; the cancelled history records the original V4 full-principal return and immutable receipt. Their backups include their own durable source pause.

These are synthetic wallet-only fixtures. Unpaused history is compatibility evidence and grants no recovery, canonical, account, or release authority. Restoring a paused backup still requires the original V4 quarantine contract.

Tests consume these bytes. Never regenerate them to accommodate V5 or a later engine. The capture script refuses existing evidence and changed pinned source. `provenance.json` records exact hashes, checkpoints, and limitations.
