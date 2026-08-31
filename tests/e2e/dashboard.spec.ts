import { expect, type Page, test } from "@playwright/test";

async function openPreviewDashboard(page: Page) {
  await page.goto("/?preview=setup");
  await expect(page.getByRole("heading", { name: "広告準備" })).toBeVisible();

  await page
    .getByRole("navigation", { name: "メインナビゲーション" })
    .getByRole("button", { name: "ダッシュボード", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "ダッシュボード" })).toBeVisible();

  const mobileFilterToggle = page.locator('button[aria-controls="dashboard-filter-content"]');
  if (await mobileFilterToggle.isVisible()) {
    await expect(mobileFilterToggle).toHaveAttribute("aria-expanded", "false");
    if ((page.viewportSize()?.width ?? 0) >= 900) {
      const headerBox = await page.locator(".dashboard-page-header").boundingBox();
      expect(headerBox?.height).toBeLessThanOrEqual(104);
    }
    await mobileFilterToggle.click();
    await expect(mobileFilterToggle).toHaveAttribute("aria-expanded", "true");
  }

  const mockButton = page.getByRole("button", { name: "モックダッシュボードを見る", exact: true }).first();
  await expect(mockButton).toBeVisible();
  await mockButton.click();
  await expect(page.getByText(/社内ユーザーテスト用のmock広告データ/)).toBeVisible();
}

function sectionContainingHeading(page: Page, headingName: RegExp) {
  return page
    .getByRole("heading", { name: headingName })
    .locator("xpath=ancestor::section[1]");
}

test("setup previewから意思決定ダッシュボードを確認できる", async ({ page }) => {
  await openPreviewDashboard(page);

  await expect(page.getByRole("heading", { name: /トレンド/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /主要指標/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /補助指標/ })).toBeVisible();
  await expect(page.locator(".dashboard-filter-toggle")).toHaveClass(/md3-outlined-button/);
  await expect(page.getByRole("button", { name: "実データ表示に戻る", exact: true })).toHaveClass(/md3-outlined-button/);
  await expect(page.getByRole("button", { name: "AIに相談する", exact: true })).toHaveClass(/md3-filled-button/);

  const actions = sectionContainingHeading(page, /ちょこっとくん推奨アクション/);
  await expect(actions).toBeVisible();
  await expect(actions.locator("article")).toHaveCount(4);

  const alerts = sectionContainingHeading(page, /注意アラート/);
  await expect(alerts.locator("tbody tr").first()).toBeVisible();
  await expect(page.getByText(/重要\s*\d+|重要/).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "AI推奨アクション", exact: true })).toHaveCount(0);
});

test("ダッシュボード上部のAI相談は毎回新しいチャットを開始する", async ({ page }) => {
  await openPreviewDashboard(page);
  const filterToggle = page.locator('button[aria-controls="dashboard-filter-content"]');
  if (await filterToggle.getAttribute("aria-expanded") === "true") {
    await filterToggle.click();
  }

  await page.getByRole("button", { name: "AIチャットパネルを開く" }).click();
  const sessionSelect = page.getByRole("combobox", { name: "会話セッション" });
  await expect(sessionSelect).toBeVisible();
  const initialThreadId = await sessionSelect.inputValue();
  await page.getByRole("button", { name: "AIチャットを閉じる" }).click();

  await page.getByRole("button", { name: "AIに相談する", exact: true }).click();
  await expect(sessionSelect).toBeVisible();
  await expect(page.locator("#ai-chat-input")).toBeFocused();
  await expect(page.locator("#ai-chat-input")).not.toHaveValue("");
  await expect(page.locator("#ai-sidebar .message.user")).toHaveCount(0);
  const firstNewThreadId = await sessionSelect.inputValue();
  expect(firstNewThreadId).not.toBe(initialThreadId);

  await page.getByRole("button", { name: "AIチャットを閉じる" }).click();
  await page.getByRole("button", { name: "AIに相談する", exact: true }).click();
  await expect.poll(() => sessionSelect.inputValue()).not.toBe(firstNewThreadId);
});

test("AIチャットは新規相談でも案内と操作可能なコンポーザーを表示する", async ({ page }) => {
  await openPreviewDashboard(page);
  const filterToggle = page.locator('button[aria-controls="dashboard-filter-content"]');
  if (await filterToggle.getAttribute("aria-expanded") === "true") {
    await filterToggle.click();
  }

  await page.getByRole("button", { name: "AIチャットパネルを開く" }).click();
  const drawer = page.locator("#ai-sidebar");
  const input = drawer.locator("#ai-chat-input");
  const sendButton = drawer.getByRole("button", { name: "送信" });

  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("気になる数字や変化を教えてください。原因と、次に確認する順番を整理します。")).toBeVisible();
  await expect(drawer.getByRole("button", { name: "CPA悪化の原因を確認" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "新規", exact: true })).toBeVisible();
  await expect(sendButton).toBeDisabled();

  await drawer.getByRole("button", { name: "CPA悪化の原因を確認" }).click();
  await expect(input).toHaveValue(/CPAが悪化した原因/);
  await expect(sendButton).toBeEnabled();

  const composerBox = await drawer.locator(".composer").boundingBox();
  const modeBox = await drawer.getByRole("combobox", { name: "AI回答モード" }).boundingBox();
  const sendBox = await sendButton.boundingBox();
  expect(composerBox).not.toBeNull();
  expect(modeBox).not.toBeNull();
  expect(sendBox).not.toBeNull();
  expect((modeBox?.x ?? 0) + (modeBox?.width ?? 0)).toBeLessThan(sendBox?.x ?? 0);
  expect((sendBox?.x ?? 0) + (sendBox?.width ?? 0)).toBeLessThanOrEqual(
    (composerBox?.x ?? 0) + (composerBox?.width ?? 0) + 1,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});

test("AIチャットの幅をドラッグで変更して保持できる", async ({ page }) => {
  await openPreviewDashboard(page);
  await page.getByRole("button", { name: "AIチャットパネルを開く" }).click();

  const drawer = page.locator("#ai-sidebar");
  const resizeHandle = drawer.getByRole("separator", { name: "AIチャットの幅を変更" });
  const viewportWidth = page.viewportSize()?.width ?? 0;

  if (viewportWidth <= 600) {
    await expect(resizeHandle).toBeHidden();
    const mobileDrawerBox = await drawer.boundingBox();
    expect(Math.round(mobileDrawerBox?.width ?? 0)).toBe(viewportWidth);
    return;
  }

  await expect(resizeHandle).toBeVisible();
  const initialDrawerBox = await drawer.boundingBox();
  const handleBox = await resizeHandle.boundingBox();
  expect(initialDrawerBox).not.toBeNull();
  expect(handleBox).not.toBeNull();

  await page.mouse.move(
    (handleBox?.x ?? 0) + (handleBox?.width ?? 0) / 2,
    (handleBox?.y ?? 0) + (handleBox?.height ?? 0) / 2,
  );
  await page.mouse.down();
  await page.mouse.move((handleBox?.x ?? 0) - 120, (handleBox?.y ?? 0) + (handleBox?.height ?? 0) / 2, { steps: 5 });
  await page.mouse.up();

  await expect.poll(async () => Math.round((await drawer.boundingBox())?.width ?? 0)).toBeGreaterThan(
    Math.round(initialDrawerBox?.width ?? 0) + 100,
  );
  const resizedWidth = Math.round((await drawer.boundingBox())?.width ?? 0);

  await drawer.getByRole("button", { name: "AIチャットを閉じる" }).click();
  await page.getByRole("button", { name: "AIチャットパネルを開く" }).click();
  await expect.poll(async () => Math.round((await drawer.boundingBox())?.width ?? 0)).toBe(resizedWidth);
});

test("注意アラートから既存AIドロワーへ文脈だけを引き継ぐ", async ({ page }) => {
  await openPreviewDashboard(page);

  const alerts = sectionContainingHeading(page, /注意アラート/);
  const askButton = alerts.getByRole("button", { name: /AIに聞く|AIに相談/ }).first();

  if (await askButton.count()) {
    await askButton.click();
  } else {
    await alerts.locator("tbody tr").first().click();
  }

  const drawer = page.locator("#ai-sidebar");
  const composer = page.locator("#ai-chat-input");
  await expect(drawer).toBeVisible();
  await expect(composer).toBeFocused();
  await expect(composer).not.toHaveValue("");
  await expect(drawer.locator(".message.user")).toHaveCount(0);
  await expect(drawer.locator(".thinking-message")).toHaveCount(0);
});

test("階層・指定期間・指標の主従を画面操作で確認できる", async ({ page }) => {
  await openPreviewDashboard(page);

  const hierarchy = page.getByRole("group", { name: "広告対象の絞り込み" });
  const hierarchySelects = hierarchy.getByRole("combobox");
  await expect(hierarchySelects).toHaveCount(4);
  await expect(hierarchySelects.nth(0)).toBeEnabled();

  await hierarchySelects.nth(0).selectOption({ index: 1 });
  await expect(hierarchySelects.nth(0)).not.toHaveValue("");
  await expect(hierarchySelects.nth(1)).toBeEnabled();
  await hierarchySelects.nth(1).selectOption({ index: 1 });
  await expect(hierarchySelects.nth(1)).not.toHaveValue("");

  const dateGroup = page.getByRole("group", { name: "日付範囲" });
  const dateInputs = dateGroup.locator('input[type="date"]');
  await dateInputs.nth(0).fill("2026-04-20");
  await dateInputs.nth(1).fill("2026-04-26");
  await expect(page.getByRole("combobox", { name: "期間プリセット" })).toHaveValue("custom");
  await expect(dateInputs.nth(0)).toHaveValue("2026-04-20");
  await expect(dateInputs.nth(1)).toHaveValue("2026-04-26");

  const metricPicker = page.getByLabel("表示する指標");
  await expect(metricPicker.getByRole("button", { name: "ROAS", exact: true })).toHaveCount(0);
  await expect(page.getByText("コンバージョン率", { exact: true }).first()).toBeVisible();
});

test("ヘルプへ遷移し記事一覧を操作できる", async ({ page }) => {
  await page.goto("/?preview=setup");
  await page
    .getByRole("navigation", { name: "メインナビゲーション" })
    .getByRole("button", { name: "ヘルプ", exact: true })
    .click();

  await expect(page.getByRole("heading", { name: "ヘルプ" })).toBeVisible();
  await expect(page.getByText("基本ヘルプを表示中")).toBeVisible();
  const firstArticle = page.locator(".article-card").first();
  await expect(firstArticle).toBeVisible();
  await firstArticle.getByRole("button", { name: /詳しく見る|読む/ }).click();
  await expect(page.getByRole("button", { name: "ヘルプ一覧へ戻る" })).toBeVisible();
});

test("広告準備はチャットではなく一問一答の質問票として進む", async ({ page }) => {
  await page.goto("/?preview=setup");

  await expect(page.getByRole("heading", { name: "広告準備" })).toBeVisible();
  const questionnaire = page.getByRole("region", { name: "広告準備の質問票" });
  await expect(questionnaire).toBeVisible();
  await expect(page.getByRole("heading", { name: "集客したいターゲットを教えてください。（複数選択可）" })).toBeVisible();
  await expect(questionnaire.locator(".setup-question-progress").getByRole("button")).toHaveCount(12);
  await expect(page.locator(".setup-intake-messages")).toHaveCount(0);
  await expect(page.locator(".setup-intake-composer")).toHaveCount(0);
  await expect(page.locator(".setup-readiness-panel")).toHaveCount(0);
  await expect(questionnaire.locator(".message")).toHaveCount(0);

  const saveButton = page.getByRole("button", { name: "保存して次へ" });
  await expect(saveButton).toBeDisabled();
  await page.getByRole("group", { name: "年齢" }).getByRole("checkbox", { name: "30代" }).check();
  await page.getByRole("group", { name: "家族構成" }).getByRole("checkbox", { name: "夫婦＋子ども" }).check();
  await page.getByRole("group", { name: "住宅検討状況" }).getByRole("checkbox", { name: "工務店比較中" }).check();
  await expect(saveButton).toBeEnabled();
  await saveButton.click();

  await expect(page.getByRole("heading", { name: "過去の広告運用経験を教えてください。" })).toBeVisible();
  await expect(page.getByRole("button", { name: "回答一覧 11/12" })).toBeVisible();
  await expect(page.getByRole("button", { name: "戻る" })).toBeEnabled();
  const note = page.locator("details.setup-question-note");
  const sessionMenu = page.locator("details.setup-session-menu");
  await expect(note).not.toHaveAttribute("open", "");
  await expect(sessionMenu).not.toHaveAttribute("open", "");

  const experienceQuestion = page.getByRole("group", { name: "過去の広告運用経験を教えてください。" });
  await experienceQuestion.getByRole("radio", { name: "両方運用している" }).check();
  await page.getByRole("button", { name: "保存して回答を確認" }).click();
  await expect(page.getByRole("heading", { name: "回答を確認" })).toBeVisible();
  await page.getByRole("button", { name: "出稿案と手順を確認" }).click();

  const campaignDraft = page.getByRole("region", { name: "キャンペーン作成案" });
  await expect(campaignDraft).toBeVisible();
  await expect(campaignDraft.getByText("提案のみ・未実行")).toBeVisible();
  await expect(page.getByRole("region", { name: "媒体管理画面で人が確認する手順" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("広告マネージャー操作手順")).toHaveCount(0);
  await expect(campaignDraft.locator("textarea")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});

test("データ連携は接続に必要な情報だけを表示する", async ({ page }) => {
  await page.goto("/?preview=setup");
  await page
    .getByRole("navigation", { name: "メインナビゲーション" })
    .getByRole("button", { name: "データ連携", exact: true })
    .click();

  await expect(page.getByRole("heading", { name: "データ連携" })).toBeVisible();
  const connectors = page.getByRole("region", { name: "広告媒体の接続状態" });
  const rows = connectors.locator(".connection-row");
  await expect(rows).toHaveCount(3);
  await expect(connectors.locator(".card")).toHaveCount(0);
  await expect(connectors.getByRole("heading", { name: "Google Ads", exact: true })).toBeVisible();
  await expect(connectors.getByRole("heading", { name: "Meta Ads", exact: true })).toBeVisible();
  await expect(connectors.getByRole("heading", { name: "Yahoo Ads", exact: true })).toBeVisible();
  const googleConnectButton = connectors.locator(".platform-google .md3-filled-button");
  await expect(googleConnectButton).toHaveText(/再連携|Google Adsと連携/);
  await expect(connectors.getByRole("button", { name: "広告アカウントを選ぶ", exact: true })).toHaveClass(/md3-outlined-button/);
  const rowTops = await rows.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().top));
  expect(rowTops[1]).toBeGreaterThan(rowTops[0] + 10);
  expect(rowTops[2]).toBeGreaterThan(rowTops[1] + 10);
  await expect(page.locator(".connection-safety-bar")).toHaveCount(0);
  await expect(page.getByText("APIキー入力不要・tokenは暗号化保存・AI単体の自動変更なし")).toHaveCount(0);
  await expect(page.getByText("連携前にAIへ相談")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

  const safetyDetails = page.locator("details.connection-disclosure");
  await expect(safetyDetails).not.toHaveAttribute("open", "");
  await expect(page.locator("details.google-write-audit-card")).toHaveCount(0);
  await expect(page.getByText("承認付き変更の確認")).toHaveCount(0);
  await expect(page.getByText("最近のGoogle Ads監査ログ")).toHaveCount(0);

  await safetyDetails.locator("summary").click();
  await expect(safetyDetails).toHaveAttribute("open", "");
  await expect(safetyDetails.getByText(/tokenはサーバー側で暗号化保存/)).toBeVisible();
});

test("設定はカード一覧ではなく項目別タブで管理できる", async ({ page }) => {
  await page.goto("/?preview=setup");
  await page.getByRole("button", { name: "設定", exact: true }).click();

  await expect(page.getByRole("heading", { name: "設定", exact: true })).toBeVisible();
  const settingsMenu = page.getByRole("navigation", { name: "設定メニュー" });
  await expect(settingsMenu.getByRole("tab")).toHaveCount(4);
  await expect(settingsMenu.getByRole("tab", { name: "アカウント" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "アカウント" })).toBeVisible();
  await expect(page.locator(".settings-card")).toHaveCount(0);

  await settingsMenu.getByRole("tab", { name: "通知" }).click();
  await expect(page.getByRole("tabpanel", { name: "通知" }).getByRole("switch")).toBeVisible();

  await settingsMenu.getByRole("tab", { name: "契約・請求" }).click();
  const billingPanel = page.getByRole("tabpanel", { name: "契約・請求" });
  await expect(billingPanel.getByText("月額料金", { exact: true })).toBeVisible();
  await expect(billingPanel.getByRole("progressbar", { name: "今月のAI相談利用率" })).toBeVisible();
  await expect(billingPanel.getByRole("button", { name: "プラン変更・解約" })).toBeVisible();

  await settingsMenu.getByRole("tab", { name: "メンバー" }).click();
  const membersPanel = page.getByRole("tabpanel", { name: "メンバー" });
  await expect(membersPanel.getByRole("textbox", { name: "メンバーを招待" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});
