import "server-only";

import { captureInboxData, canonicalInboxJson, digestInboxValue, inboxCheck, inboxRuntime } from "./deposit-inbox-data";
import { DEPOSIT_INBOX_LIMITS, DEPOSIT_INBOX_PROFILE, type DepositInboxArchive } from "./deposit-inbox-protocol";

export const DEPOSIT_INBOX_BACKUP_FORMAT = "alpha-wallet-development-deposit-inbox" as const;
export const DEPOSIT_INBOX_CONTROL_RESERVE_NODES = 2048;
export const MAX_DEPOSIT_INBOX_PORTABLE_NODES = 100_000;

export interface DepositInboxBackupBodyV1 {
  readonly format: typeof DEPOSIT_INBOX_BACKUP_FORMAT;
  readonly formatVersion: 1;
  readonly mode: "simulation-only";
  readonly creditAuthority: false;
  readonly profile: typeof DEPOSIT_INBOX_PROFILE;
  readonly sourcePaused: true;
  readonly exportedAtMs: number;
  readonly archive: DepositInboxArchive;
}

/** A portable representation template; only the backup API authorizes paused export. */
export function depositInboxBackupBody(archive: DepositInboxArchive, exportedAtMs: number): DepositInboxBackupBodyV1 {
  inboxRuntime("simulation-only");
  inboxCheck(typeof exportedAtMs === "number" && Number.isSafeInteger(exportedAtMs) && exportedAtMs >= 0 && !Object.is(exportedAtMs, -0),
    "INVALID_INPUT", "Deposit portable export clock must be an exact nonnegative integer");
  return captureInboxData({ format: DEPOSIT_INBOX_BACKUP_FORMAT, formatVersion: 1,
    mode: "simulation-only", creditAuthority: false, profile: DEPOSIT_INBOX_PROFILE,
    sourcePaused: true, exportedAtMs, archive });
}

/** Canonical encoding is shared by recorder preflight, export, inspection and recovery. */
export function serializeDepositInboxPortable(archive: DepositInboxArchive, exportedAtMs: number): string {
  const body = depositInboxBackupBody(archive, exportedAtMs);
  const serialized = canonicalInboxJson({ ...body, checksum: digestInboxValue("deposit-inbox-backup", body) });
  inboxCheck(Buffer.byteLength(serialized, "utf8") <= DEPOSIT_INBOX_LIMITS.backupBytes,
    "RESOURCE_LIMIT", "Deposit archive exceeds its exact portable UTF-8 bound");
  return serialized;
}

/** Exact envelope footprint, including the maximum-width export clock and complete checksum. */
export function measureDepositInboxPortable(archive: DepositInboxArchive): Readonly<{ bytes: number; nodes: number }> {
  const envelope = captureInboxData({ ...depositInboxBackupBody(archive, Number.MAX_SAFE_INTEGER), checksum: "0".repeat(64) });
  let nodes = 0;
  const count = (value: unknown) => {
    nodes += 1;
    if (value !== null && typeof value === "object") for (const child of Object.values(value)) count(child);
  };
  count(envelope);
  return Object.freeze({ bytes: Buffer.byteLength(canonicalInboxJson(envelope), "utf8"), nodes });
}

export function assertDepositInboxPortableCapacity(archive: DepositInboxArchive, phase: "ordinary" | "terminal" | "restore"): void {
  inboxRuntime("simulation-only");
  inboxCheck(phase === "ordinary" || phase === "terminal" || phase === "restore",
    "INVALID_INPUT", "Deposit portable reserve requires an explicit closed phase");
  const slots = phase === "ordinary" ? 2 : phase === "terminal" ? 1 : 0;
  const footprint = measureDepositInboxPortable(archive);
  inboxCheck(archive.checkpoint.revision + slots <= DEPOSIT_INBOX_LIMITS.commands
    && footprint.bytes + slots * DEPOSIT_INBOX_LIMITS.controlReserveBytes <= DEPOSIT_INBOX_LIMITS.backupBytes
    && footprint.nodes + slots * DEPOSIT_INBOX_CONTROL_RESERVE_NODES <= MAX_DEPOSIT_INBOX_PORTABLE_NODES,
  "RESOURCE_LIMIT", "Deposit archive cannot retain all portable evidence and its mandatory control reserve");
}

/** Enforced in addition to phase capacity: a control cannot consume more than its reserved slot. */
export function assertDepositInboxPortableControlGrowth(before: DepositInboxArchive, after: DepositInboxArchive): void {
  const previous = measureDepositInboxPortable(before), next = measureDepositInboxPortable(after);
  inboxCheck(next.bytes - previous.bytes <= DEPOSIT_INBOX_LIMITS.controlReserveBytes
    && next.nodes - previous.nodes <= DEPOSIT_INBOX_CONTROL_RESERVE_NODES,
  "RESOURCE_LIMIT", "Deposit terminal control exceeds its reserved portable byte or node capacity");
}
