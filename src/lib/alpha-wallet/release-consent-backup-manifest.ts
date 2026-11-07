import "server-only";

import { z } from "zod";
import { walletDigest } from "./commands";
import { parsePaymentMarketplaceWalletBackup, type PaymentMarketplaceWalletBackupEnvelope } from "./payment-marketplace-backup-manifest";
import { appendReleaseConsent, createReleaseConsentArchive, createReleaseConsentBackup, releaseConsentCurrentBasisFromHistory,
  verifyReleaseConsentArchive, verifyReleaseConsentBackup, type ReleaseConsentArchive, type ReleaseConsentBackup } from "./release-consent-model";
import { releaseConsentCheck as check } from "./release-consent-transaction";
import { assertSimulationRuntime } from "./runtime";

export const RELEASE_CONSENT_MARKETPLACE_BACKUP_FORMAT = "alpha-wallet-release-consent-marketplace-backup" as const;
export const MAX_RELEASE_CONSENT_MARKETPLACE_BACKUP_BYTES = 64 * 1_048_576;
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const schema = z.strictObject({ kind: z.literal(RELEASE_CONSENT_MARKETPLACE_BACKUP_FORMAT), formatVersion: z.literal(1),
  mode: z.literal("simulation-only"), sourceStopped: z.literal(true), executionAuthority: z.literal(false), releaseAuthority: z.literal(false),
  requestId: id, ownerId: id, sourceStoreId: id, sourcePhysicalStoreId: id,
  exportedAtMs: z.number().int().positive().max(8_640_000_000_000_000), payment: z.unknown(), overlay: z.unknown(), checksum: hash });
export type ReleaseConsentMarketplaceBackupEnvelope = Omit<z.infer<typeof schema>, "payment" | "overlay"> & {
  payment: PaymentMarketplaceWalletBackupEnvelope; overlay: ReleaseConsentBackup;
};

/** Source journal, consent and all original financial/canonical bytes form one portable stopped bundle. */
export function parseReleaseConsentMarketplaceWalletBackup(serialized: string, expectedChecksum?: string): ReleaseConsentMarketplaceBackupEnvelope {
  assertSimulationRuntime("simulation-only");
  check(typeof serialized === "string" && Buffer.byteLength(serialized, "utf8") <= MAX_RELEASE_CONSENT_MARKETPLACE_BACKUP_BYTES,
    "RESOURCE_LIMIT", "Complete release-consent backup exceeds its bounded development format");
  let decoded: unknown;
  try { decoded = JSON.parse(serialized); } catch { check(false, "INVALID_INPUT", "Complete release-consent backup must be JSON"); }
  const parsed = schema.safeParse(decoded);
  check(parsed.success, "INVALID_INPUT", "Complete release-consent backup has unsupported fields or format");
  const { checksum, ...body } = parsed.data;
  check(walletDigest(body) === checksum && (expectedChecksum === undefined || hash.safeParse(expectedChecksum).success && checksum === expectedChecksum),
    "INTEGRITY", "Complete release-consent backup checksum differs from the separately retained expected value");
  const payment = parsePaymentMarketplaceWalletBackup(JSON.stringify(body.payment));
  const overlay = verifyReleaseConsentBackup(body.overlay), archive = overlay.archive;
  check(body.sourceStoreId === archive.bootstrap.sourceStoreId && body.requestId === payment.requestId
    && body.ownerId === payment.ownerId && body.requestId === archive.bootstrap.initialPrepared.walletContext.platformRequestId
    && body.exportedAtMs === payment.exportedAtMs && body.exportedAtMs === overlay.exportedAtMs,
  "BINDING_MISMATCH", "Complete recovery components must belong to one original request, source and export decision");
  const histories = [archive.bootstrap.initialPrepared.walletHistory,
    ...archive.records.flatMap(row => row.command.type === "observe" ? [row.command.prepared.walletHistory] : [])];
  for (const history of histories) check(history.length <= payment.wallet.commands.length
    && walletDigest(history) === walletDigest(payment.wallet.commands.slice(0, history.length)),
  "BINDING_MISMATCH", "Source evidence must retain an exact prefix of the backed-up financial history");
  const verified = new Map<number, ReturnType<typeof releaseConsentCurrentBasisFromHistory>>();
  for (const record of archive.records) {
    const revision = record.currentBasis.walletCheckpoint.revision;
    check(revision <= payment.wallet.commands.length && record.occurredAtMs <= body.exportedAtMs,
      "INTEGRITY", "Consent evidence cannot outrun the complete original backup");
    let derived = verified.get(revision);
    if (!derived) {
      derived = releaseConsentCurrentBasisFromHistory({ requestId: body.requestId,
        walletHistory: payment.wallet.commands.slice(0, revision), canonicalBasisSha256: record.currentBasis.canonicalBasisSha256 });
      verified.set(revision, derived);
    }
    check(walletDigest({ ...derived, canonicalBasisSha256: record.currentBasis.canonicalBasisSha256 }) === walletDigest(record.currentBasis),
      "INTEGRITY", "A retained consent decision changed its original financial checkpoint or reservation");
  }
  assertSimulationRuntime("simulation-only");
  return { ...parsed.data, payment, overlay };
}

export function serializeReleaseConsentMarketplaceWalletBackup(options: {
  paymentBackup: string; overlay: ReleaseConsentBackup; sourcePhysicalStoreId: string;
}): string {
  const payment = parsePaymentMarketplaceWalletBackup(options.paymentBackup), overlay = verifyReleaseConsentBackup(options.overlay);
  const body = { kind: RELEASE_CONSENT_MARKETPLACE_BACKUP_FORMAT, formatVersion: 1, mode: "simulation-only", sourceStopped: true,
    executionAuthority: false, releaseAuthority: false, requestId: payment.requestId, ownerId: payment.ownerId,
    sourceStoreId: overlay.archive.bootstrap.sourceStoreId, sourcePhysicalStoreId: id.parse(options.sourcePhysicalStoreId),
    exportedAtMs: payment.exportedAtMs, payment, overlay };
  const serialized = JSON.stringify({ ...body, checksum: walletDigest(body) });
  parseReleaseConsentMarketplaceWalletBackup(serialized); return serialized;
}

export function inspectReleaseConsentMarketplaceWalletBackup(serialized: string, options: { expectedChecksum?: string } = {}) {
  const envelope = parseReleaseConsentMarketplaceWalletBackup(serialized, options.expectedChecksum);
  return { kind: RELEASE_CONSENT_MARKETPLACE_BACKUP_FORMAT, formatVersion: 1, mode: "simulation-only" as const,
    checksum: envelope.checksum, sourceStoreId: envelope.sourceStoreId, sourcePhysicalStoreId: envelope.sourcePhysicalStoreId,
    requestId: envelope.requestId, exportedAtMs: envelope.exportedAtMs,
    sourceWallet: envelope.payment.wallet.checkpoint, sourceOverlay: envelope.overlay.archive.checkpoint,
    sourceStopped: true as const, executionAuthority: false as const, releaseAuthority: false as const };
}

/** Reconstruct the exact stopped source from a permanent restored copy, without trusting a cached projection. */
export function releaseConsentOriginalBackupFromRestoredArchive(value: unknown): ReleaseConsentBackup {
  const restored = verifyReleaseConsentArchive(value), last = restored.records.at(-1)!;
  check(last.command.type === "quarantine-restore" && restored.state.restoredTargetStoreId !== null,
    "INTEGRITY", "A complete restored archive must end in its unique permanent quarantine");
  const bootstrap = restored.bootstrap;
  let original: ReleaseConsentArchive = createReleaseConsentArchive({ mode: "simulation-only", manifest: bootstrap.manifest,
    sourceStoreId: bootstrap.sourceStoreId, enrollingOwnerId: bootstrap.enrollingOwnerId, enrollmentOperationId: bootstrap.enrollmentOperationId,
    prepared: bootstrap.initialPrepared, currentBasis: bootstrap.initialBasis, atMs: bootstrap.createdAtMs });
  for (const record of restored.records.slice(1, -1)) {
    check(record.command.type !== "enroll" && record.command.type !== "quarantine-restore", "INTEGRITY", "Restored source history contains an extra bootstrap");
    original = appendReleaseConsent(original, record.command, record.currentBasis, record.occurredAtMs).archive;
  }
  check(walletDigest(original.records) === walletDigest(restored.records.slice(0, -1))
    && original.archiveSha256 === last.command.sourceArchiveSha256, "INTEGRITY", "Restored source prefix changed");
  const backup = createReleaseConsentBackup(original, last.command.exportedAtMs);
  check(backup.backupSha256 === last.command.backupSha256, "INTEGRITY", "Restored source no longer reproduces its original portable checksum");
  return backup;
}
