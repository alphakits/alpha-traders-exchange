# Age confirmation and delayed session rejection

## Deployed observation

On candidate `34a3b562947e65dc6c88b923f8a69180ca5160af`, the owner signed in
and reached the age-confirmation screen. At 20:04:32Z and 20:04:38Z on
17 October 2026, the deployed `/api/auth/age-eligibility` handler rejected
the owner's manual save attempts as unauthenticated. The generic UI said
"Unable to save confirmation. Please try again." and invited ineffective
retries. The request did not reach the age-record mutation.

A read-only database check found one unexpired owner session, created at
20:01:15.820Z, with matching token/index and account/index fields. The age
record was absent. No credential, session-token value, email, or phone was
recorded in this evidence. The database session surviving does not prove
why the browser request lost authentication.

## Reproduced defects and repair

- Passive `/api/auth/me` responses and API denials expired the shared auth
  cookie. A response carrying an older session can finish after a newer login
  and erase the replacement cookie. Both paths now revoke only the token
  presented by their request. Explicit logout still expires cookies, and
  every protected operation still checks the canonical session and role.
- An unauthorized age save now performs one canonical session read. It does
  not replay the declaration. If the session recovers, the user can deliberately
  retry; otherwise the screen provides sign-in recovery and disables futile
  repeat saves. The intended destination survives verification and sign-in.
- Permission-denial logs record only whether a session cookie was present,
  allowing the next deployed failure to distinguish a missing cookie from an
  invalid presented token without logging any credential.

The cookie race is a reproduced code defect and a possible contributor to
the incident; the available historical logs cannot establish that it caused
this particular browser session loss. Cookie replacement races are described
in [RFC 6265 section 4.1.1](https://www.rfc-editor.org/rfc/rfc6265#section-4.1.1).

## Verification

- Before the repair: five new regression checks failed; 38 existing checks passed.
- After the repair: 109 checks across nine test files passed, including English
  and Arabic recovery, no automatic declaration replay, delayed rejection,
  canonical session recovery, explicit logout, disabled-account rejection,
  account confirmation persistence, and concurrent account restrictions.
- Production release and deployed owner completion remain subject to the new
  candidate's required CI checks and authenticated browser verification.
- No production account, eligibility record, session, or permission was changed
  directly during diagnosis.
