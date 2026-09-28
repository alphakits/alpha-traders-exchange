type NotificationLike = {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
};

function toEpoch(value?: string) {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sortNotificationsNewestFirst<T extends NotificationLike>(items: readonly T[]) {
  return [...items].sort((left, right) => {
    const rightCreated = toEpoch(right.createdAt);
    const leftCreated = toEpoch(left.createdAt);
    if (rightCreated !== leftCreated) return rightCreated - leftCreated;

    const rightUpdated = toEpoch(right.updatedAt);
    const leftUpdated = toEpoch(left.updatedAt);
    if (rightUpdated !== leftUpdated) return rightUpdated - leftUpdated;

    const rightId = String(right.id ?? "");
    const leftId = String(left.id ?? "");
    return rightId.localeCompare(leftId);
  });
}
