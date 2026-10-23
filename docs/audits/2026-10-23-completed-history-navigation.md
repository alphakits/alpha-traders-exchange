# Completed-trade history opens the history workspace

Read-only owner acceptance on production `570b0e34` opened an existing completed
trade from Profile → My trades → View trade. The first click correctly reached
that Trade Room. Its View Trade History button then navigated to the general
`/en/usdt-exchange` page, without selecting a history section. Source inspection
confirmed the button hardcoded `/usdt-exchange`.

Participants now reach `/trades`, the existing private workspace with completed
sales and purchases. An owner overseeing someone else's trade instead reaches
the purchase-request history with the exact request selected. The locale-aware
router preserves English or Arabic. Return home retains its existing behavior.

Eight component regressions cover English and Arabic buyers, sellers, a
participating owner, and an overseeing owner. They assert the exact destination
and that clicking history performs no trade mutation. Hosted release and final
production checks remain required; no customer trade or commission was changed
during the read-only reproduction.
