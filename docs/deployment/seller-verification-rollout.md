# Seller verification rollout

The full Exchange hardening release in PR #173 requires a server-recorded
seller verification attestation. Existing approved sellers must be reconciled
before that requirement and its Discord migration are deployed.

## Preparation release

This prerequisite adds an authenticated administrator action to record a prior
review for an already approved seller application. It stores the same minimal
verification object on the application and user and creates an audit entry.
The reviewer and timestamp come from the server. Raw identity documents and
videos are not accepted by this action.

The preparation release does not activate the new seller authorization checks
or the Discord reconciliation migration. Reading an old approved record never
creates an attestation. Recording a review preserves the existing seller status
and roles, including suspension. Pending and rejected applications cannot be
approved through this action.

## Reconcile retained evidence

In Owner Control Center > Seller Applications, filter to Approved. For each
seller whose previous review can be confirmed, use **Record Verification** and
enter a meaningful reason. The authorized reviewer must personally confirm all
four checks:

- government identity document reviewed;
- applicant matched in a live identity video;
- ownership of the application contact confirmed;
- marketplace rules accepted.

Do not infer these checks from the old approval label, fill missing evidence
with a blanket attestation, or store the raw identity material in the reason.
Resolve incomplete reviews through the ordinary seller review process. Keep a
private record of unresolved sellers and the planned operational treatment.

## Enforcement release

Reconcile both user and application attestations before merging PR #173.
Deploy its matching web/backend code and apply the verified-seller Discord
migration only after this prerequisite is complete. Confirm suspended users
remain suspended and approved, attested sellers retain their intended access.
Then validate the production review accounts and signed iPhone build against
the deployed backend. TestFlight upload alone does not deploy that backend.

The preparation step is complete only when its production release and visible
admin controls have been verified. The enforcement and App Review steps remain
separate until their evidence is available.
