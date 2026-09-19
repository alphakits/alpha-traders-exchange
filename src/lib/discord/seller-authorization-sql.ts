/**
 * Fail-closed SQL equivalent of `isSellerApprovalVerificationComplete`.
 *
 * The payload expression is supplied only by trusted application code. Keeping
 * this predicate centralized prevents Discord roles, commands, and public
 * market summaries from drifting back to a status-only authorization check.
 */
export function sellerApprovalVerificationSql(payloadExpression: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(payloadExpression)) {
    throw new Error("Unsafe seller verification SQL payload expression.");
  }
  return `(
    jsonb_typeof(${payloadExpression} -> 'sellerApprovalVerification') = 'object'
    and ${payloadExpression} #>> '{sellerApprovalVerification,method}' = 'manual_authorized_reviewer_v1'
    and ${payloadExpression} #> '{sellerApprovalVerification,identityDocumentReviewed}' = 'true'::jsonb
    and ${payloadExpression} #> '{sellerApprovalVerification,liveIdentityVideoReviewed}' = 'true'::jsonb
    and ${payloadExpression} #> '{sellerApprovalVerification,contactOwnershipConfirmed}' = 'true'::jsonb
    and ${payloadExpression} #> '{sellerApprovalVerification,marketplaceRulesAccepted}' = 'true'::jsonb
    and ${payloadExpression} #>> '{sellerApprovalVerification,verifiedAt}'
      ~ '^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\\.[0-9]{3})?Z$'
    and nullif(btrim(${payloadExpression} #>> '{sellerApprovalVerification,verifiedByUserId}'), '') is not null
  )`;
}

export function discordDesiredSellerStatusSql(
  sellerStatusExpression: string,
  payloadExpression: string,
) {
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(sellerStatusExpression)) {
    throw new Error("Unsafe Discord seller-status SQL expression.");
  }
  return `case
    when ${sellerStatusExpression} = 'approved_seller'
      and ${sellerApprovalVerificationSql(payloadExpression)} then 'approved'
    when ${sellerStatusExpression} = 'pending_seller_approval' then 'pending'
    when ${sellerStatusExpression} = 'suspended' then 'suspended'
    else 'none'
  end`;
}
