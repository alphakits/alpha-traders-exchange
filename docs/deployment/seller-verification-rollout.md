# Seller approval: preserve the existing WhatsApp workflow

Owner direction on 2026-09-20 supersedes the additional attestation rollout
previously proposed for PR #173. Preserve the existing workflow:

1. The applicant submits a seller application on the website.
2. The owner reviews the identity document and identity video through WhatsApp.
3. The authorized owner or administrator approves or rejects the application on
   the website. The existing decision and reason audit trail remains.

No additional on-site identity checklist, identity upload, or retrospective
verification entry is required. Existing approved sellers retain their access.
Do not manufacture verification metadata or copy identity documents or videos
into the website, source repository, logs, or review notes.

## Authorization and compatibility

The canonical `sellerStatus` controls seller access. Pending, rejected, and
suspended sellers remain ineligible; stale role labels or client flags cannot
override that status. Suspension and reactivation retain their existing admin
controls. Generic role management cannot grant seller approval or owner access.

The `sellerApprovalVerified` response field remains for existing mobile clients
and reflects the canonical approval decision. It does not assert the existence
of a separate four-part verification record. Historical optional metadata is
preserved, but is not a prerequisite for approval or seller operations.

Discord follows the same approval status. The proposed attestation-enforcement
migration is removed from this release; there is no verification backfill or
new verification migration to apply.

## Release checks

Verify existing approved sellers retain access without additional metadata,
new applications require an authorized admin decision, rejected/pending/
suspended sellers stay restricted, and ordinary approval creates no fabricated
identity-review record. Retain the other Exchange hardening and privacy work.

Publish the matching backend before validating the final signed mobile build.
A TestFlight upload is not proof that the backend was deployed or that Apple
approved the submission. The existing signed native shell is preserved. Its root layout renders the
canonical website for every route, so the deployed website supplies the visible
approval screen. Backend compatibility fields keep the delivered build working
without a new identity-record requirement.
