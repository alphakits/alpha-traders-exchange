/** Shared by the listing store, final database check and seller-facing notices. */
export function listingCommissionRequiredMessage(isAr = false) {
  return isAr
    ? "يجب دفع جميع العمولات المستحقة أولاً قبل إضافة عرض أو إعادة نشره أو تجديده. يمكنك إضافة العروض مجدداً بعد تأكيد الدفع."
    : "Pay all outstanding commission first before adding, relisting or renewing a listing. You can list again once payment is confirmed.";
}

export function isListingCommissionRequiredMessage(message: string) {
  return message === listingCommissionRequiredMessage() || message === listingCommissionRequiredMessage(true);
}
