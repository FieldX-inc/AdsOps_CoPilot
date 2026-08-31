import { expect, test } from "@playwright/test";

test("承認済みの月額と初期費用を表示し、選択プランを再読み込み後も保持する", async ({ page }) => {
  await page.goto("/?preview=auth");
  await expect(page.getByRole("img", { name: "ちょこっとインハウス" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "プランを選択" })).toBeVisible();
  await expect(page.getByText("月額料金 ＋ 初期費用")).toBeVisible();
  await expect(page.getByRole("heading", { name: "ログイン" })).toBeVisible();
  await expect(page.getByRole("button", { name: "メールアドレスで続ける" })).toBeVisible();
  await expect(page.getByText("次のステップ")).toHaveCount(0);
  await expect(page.getByText("ログイン後の決済画面まで引き継がれます。")).toHaveCount(0);
  await expect(page.getByText("￥9,800 / 月", { exact: true })).toBeVisible();
  await expect(page.getByText("￥49,800 / 月", { exact: true })).toBeVisible();
  await expect(page.getByText("￥69,800 / 月", { exact: true })).toBeVisible();
  await expect(page.getByText("初期費用 ￥50,000", { exact: true })).toBeVisible();
  await expect(page.getByText("初期費用 ￥70,000", { exact: true })).toHaveCount(2);
  await expect(page.getByText("広告アカウント 1件まで", { exact: true })).toBeVisible();
  await expect(page.getByText("広告アカウント 3件まで", { exact: true })).toBeVisible();
  await expect(page.getByText("広告アカウント 10件まで", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "年払い", exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const premiumPlan = page.getByRole("radio", { name: /プレミアム/ });
  await expect(premiumPlan).toBeVisible();
  await premiumPlan.click();
  await expect(premiumPlan).toBeChecked();

  await page.reload();
  await expect(page.getByRole("radio", { name: /プレミアム/ })).toBeChecked();
});
