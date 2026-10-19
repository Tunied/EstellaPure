// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1160, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:62109/output/design/rm044-reflection/index.html');
  await page.getByText('Planar Reflection', { exact: true }).waitFor();
  await page.screenshot({ path: 'output/design/rm044-reflection/project-quality.png', fullPage: true });
  const select = async (label, option) => {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
  };
  await select('质量来源', '自定义');
  await select('更新方式', '指定频率');
  assert.equal(await page.getByText('每秒更新次数', { exact: true }).count(), 1);
  await select('平面法线', '本地 Z 轴');
  await page.getByText('诊断与预览', { exact: true }).click();
  await page.screenshot({ path: 'output/design/rm044-reflection/custom-quality.png', fullPage: true });
  await select('更新方式', '按需');
  assert.equal(await page.getByText('每秒更新次数', { exact: true }).count(), 0);
  await page.getByRole('checkbox', { name: '启用平面反射' }).click();
  assert.equal(await page.locator('fieldset').evaluate(el => el.disabled && el.inert), true);
  await page.getByRole('checkbox', { name: '启用平面反射' }).click();
  await select('质量来源', '跟随项目画质');
  assert.equal(await page.getByText('分辨率比例', { exact: true }).count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.body.scrollWidth > innerWidth), false);
  await page.screenshot({ path: 'output/design/rm044-reflection/narrow.png', fullPage: true });
  assert.deepEqual(errors, []);
  await writeFile('output/design/rm044-reflection/verification.json', JSON.stringify({
    status: 'design-awaiting-approval', errors,
    checks: ['project-controls-and-scene', 'project-custom-quality', 'update-policy-fields', 'plane-axis', 'component-disable', 'narrow-layout'],
    runtimeImplemented: false, formalUiModified: false,
  }, null, 2));
  console.log('Design interaction and layout checks passed; runtime acceptance pending.');
} finally { await browser.close(); }
