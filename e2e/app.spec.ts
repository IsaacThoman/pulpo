import { expect, test } from '@playwright/test';
import path from 'node:path';

const fixturesDir = path.join(process.cwd(), 'e2e', 'fixtures');

test('admin flow covers setup, keys, models, OCR, usage, and playground', async ({ page }) => {
  const runId = Date.now().toString().slice(-6);
  const keyName = `Primary client ${runId}`;
  const modelName = `demo-proxy-model-${runId}`;

  await page.goto('/');

  if (await page.getByRole('heading', { name: 'Create the admin account' }).isVisible()) {
    await page.getByLabel('Username', { exact: true }).fill('admin');
    await page.getByLabel('Password', { exact: true }).fill('password123');
    await page.getByLabel('Confirm password', { exact: true }).fill('password123');
    await page.getByRole('button', { name: 'Create admin' }).click();
  } else {
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await page.getByLabel('Username', { exact: true }).fill('admin');
    await page.getByLabel('Password', { exact: true }).fill('password123');
    await page.getByRole('button', { name: 'Sign in' }).click();
  }

  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

  await page.getByRole('button', { name: 'Keys Client auth' }).click();
  await page.getByLabel('Name', { exact: true }).fill(keyName);
  await page.getByRole('button', { name: 'Create key' }).click();
  await expect(page.locator('code').filter({ hasText: 'llmpx_' }).first()).toBeVisible();

  const keyRow = page.locator('.list-row', { hasText: keyName }).first();
  await keyRow.getByRole('button', { name: 'Rotate' }).click();
  await keyRow.getByRole('button', { name: 'Disable' }).click();
  await keyRow.getByRole('button', { name: 'Enable' }).click();

  await page.getByRole('button', { name: 'Models Proxy mappings' }).click();
  await page.getByLabel('Exposed model name').fill(modelName);
  await page.getByLabel('Description').fill('Mock upstream echo model');
  await page.getByLabel('Provider base /v1 URL').fill('http://127.0.0.1:4010/v1');
  await page.getByLabel('Provider API key').fill('test-key');
  await page.getByLabel('Upstream model').fill('mock-upstream-model');
  await page.getByLabel('Input cost / 1M').fill('2');
  await page.getByLabel('Cached input / 1M').fill('1');
  await page.getByLabel('Output cost / 1M').fill('8');
  await page.getByLabel('Intercept images and inject OCR text').check();
  await page.getByRole('button', { name: 'Fetch models' }).click();
  await expect(page.getByText('Loaded 2 upstream models.')).toBeVisible();
  await page.getByRole('button', { name: 'Create model' }).click();
  await expect(page.getByText(modelName)).toBeVisible();

  await page.getByRole('button', { name: 'OCR Image interception' }).click();
  await page.getByLabel('Enable OCR pipeline').check();
  await page.getByLabel('OCR provider base /v1 URL').fill('http://127.0.0.1:4010/v1');
  await page.getByLabel('OCR API key').fill('test-key');
  await page.getByLabel('Vision/OCR model').fill('mock-ocr-model');
  await page.getByLabel('System prompt').fill('Read this image into markdown.');
  await page.getByRole('button', { name: 'Save OCR settings' }).click();
  await expect(page.getByText('OCR settings saved.')).toBeVisible();

  await page.getByRole('button', { name: 'Usage Logs and costs' }).click();
  await page.getByLabel('Log prompts/responses').check();
  await page.getByRole('button', { name: 'Save logging' }).click();
  await expect(page.getByText('Logging settings saved.')).toBeVisible();

  await page.getByRole('button', { name: 'Playground Chat test bench' }).click();
  await page.getByLabel('Model').selectOption({ label: modelName });
  await page.getByLabel('System prompt').fill('Be concise.');
  await page.getByLabel('Message').fill('Summarize the attachment and image.');
  await page
    .locator('input[type="file"]')
    .setInputFiles([
      path.join(fixturesDir, 'notes.txt'),
      path.join(fixturesDir, 'test-image.svg'),
    ]);
  await page.getByRole('button', { name: 'Send' }).click();

  await expect(page.getByText('Echoed from upstream:', { exact: false })).toBeVisible();
  await expect(page.getByText('MOCK OCR OUTPUT', { exact: false })).toBeVisible();

  await page.getByRole('button', { name: 'Usage Logs and costs' }).click();
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByText('Daily usage')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'playground' }).first()).toBeVisible();
});
