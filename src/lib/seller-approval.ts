/**
 * Identity documents and videos are reviewed by the operator through WhatsApp.
 * The site's canonical approval decision grants seller access. An additional
 * on-site identity checklist is not required and is never inferred or created.
 */
export function isOwnerApprovedSeller(user: { sellerStatus?: string }) {
  return user.sellerStatus === "approved_seller";
}
