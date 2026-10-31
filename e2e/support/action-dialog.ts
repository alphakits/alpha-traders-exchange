import { expect, type Locator, type Page } from "@playwright/test";

/** Confirm only the dialogs explicitly expected for this user action. */
export async function clickConfirmedTradeAction(page: Page, button: Locator, expectedMessages: Array<RegExp | undefined> = [undefined]) {
  await button.click();
  const messages: string[] = [];
  for (const expectedMessage of expectedMessages) {
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const heading = dialog.getByRole("heading");
    if (expectedMessage) await expect(heading).toContainText(expectedMessage);
    messages.push(await heading.innerText());
    await dialog.getByRole("button", { name: /^(Confirm|تأكيد)$/ }).click();
  }
  return messages;
}
