# Owner listing review revision repair

The c97519a full unit run failed one relisting-after-payment case: the owner
approval returned, but the replacement listing remained a pending draft and
could not be renewed. Its other 5,511 unit/integration cases and all 298 browser
cases passed. The release gate correctly remained failed.

A cached targeted listing creation retains the caller snapshot's older runtime
version. The next owner review therefore enters the repository's record merge.
That merge deliberately preserves canonical records when timestamps are equal.
When creation and review occurred within the same millisecond, the approved
record had the draft's timestamp and the merge kept the draft.

A deterministic regression freezes Date, creates two successive listings, and
checks the second approval in canonical storage before renewing it. It failed
before the repair with `approvalStatus: pending` and `status: draft`. Owner
review now uses the existing monotonic revision helper, so its timestamp is
strictly newer than the prior listing revision even within one clock tick.
The stale-record protection, approval checks and renewal assertion are retained.

This change does not resolve the independently recorded database performance
failure or authorize a production release.
