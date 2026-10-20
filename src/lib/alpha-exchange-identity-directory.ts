import "server-only";
import { isAlphaExchangeOwnerEmail } from "@/lib/alpha-exchange-identity";

export type SnapshotIdentity = {
  id: string;
  fullName?: string;
  buyerDisplayName?: string;
  role?: string;
  roles?: readonly string[];
  disabled?: boolean;
};

// Canonical names needed for historical free-text masking are not authority
// rows. Keep this request-local directory out of persisted/serialized snapshots.
const directories = new WeakMap<object, readonly SnapshotIdentity[]>();

export function compactSnapshotIdentities(users: readonly (SnapshotIdentity & { email?: string })[]): SnapshotIdentity[] {
  return users.map(user => ({
    id: user.id, fullName: user.fullName, buyerDisplayName: user.buyerDisplayName,
    role: isAlphaExchangeOwnerEmail(user.email ?? "") ? "owner" : user.role,
    roles: user.roles ? [...user.roles] : undefined, disabled: user.disabled,
  }));
}

export function setSnapshotIdentityDirectory(snapshot: object, identities: readonly SnapshotIdentity[]) {
  directories.set(snapshot, identities);
}

export function preserveSnapshotIdentityDirectory(source: object, target: object) {
  const identities = directories.get(source);
  if (identities) directories.set(target, identities);
}

export function getSnapshotIdentityUsers(snapshot: { users: readonly SnapshotIdentity[] }): readonly SnapshotIdentity[] {
  const identities = directories.get(snapshot);
  if (!identities) return snapshot.users;
  // Prefer current authority identities without feeding these compact rows
  // back into authorization. Some direct read paths skip store normalization,
  // so preserve the canonical legacy owner-email rule here as well.
  const authority = new Map(compactSnapshotIdentities(snapshot.users).map(user => [user.id, user]));
  return identities.map(identity => authority.get(identity.id) ?? identity);
}
