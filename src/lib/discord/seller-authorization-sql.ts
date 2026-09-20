/** SQL predicates use the canonical approval decision made in the owner UI. */
export function ownerApprovedSellerSql(sellerStatusExpression: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(sellerStatusExpression)) {
    throw new Error("Unsafe seller-status SQL expression.");
  }
  return `(${sellerStatusExpression} = 'approved_seller')`;
}

export function discordDesiredSellerStatusSql(sellerStatusExpression: string) {
  return `case
    when ${ownerApprovedSellerSql(sellerStatusExpression)} then 'approved'
    when ${sellerStatusExpression} = 'pending_seller_approval' then 'pending'
    when ${sellerStatusExpression} = 'suspended' then 'suspended'
    else 'none'
  end`;
}
