import type { Page } from '@playwright/test'

export async function selectValue(page: Page, label: string, value: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click()
  await page.locator(`[data-slot="select-item"][data-value="${value}"]`).click()
}
