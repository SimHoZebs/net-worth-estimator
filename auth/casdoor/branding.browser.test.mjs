import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { startBrandingFixture } from './branding.fixture.mjs';
import { brandingPlan, brandingTarget, applyBranding } from './apply-branding.mjs';
import { brandingFields } from './branding.mjs';
import { casdoorSession } from './provision.mjs';

const enabled = !!process.env.CASDOOR_BRANDING_TEST_SERVER && !!process.env.CASDOOR_BRANDING_TEST_BUILD;

test('pinned provider sparse update and native branded login/signup at desktop/mobile sizes', { skip: !enabled, timeout: 120_000 }, async () => {
  const fixture = await startBrandingFixture(process.env.CASDOOR_BRANDING_TEST_SERVER, process.env.CASDOOR_BRANDING_TEST_BUILD);
  const { root, settings } = fixture;
  let browser;
  try {
    const target = brandingTarget({ CASDOOR_PUBLIC_URL: settings.publicUrl, AUTH_CLIENT_ID: settings.clientId });
    const plan = brandingPlan(target);
    const admin = casdoorSession(settings.publicUrl);
    await admin('/api/login', { method: 'POST', body: { type: 'login', signinMethod: 'Password',
      organization: 'built-in', application: 'app-built-in', username: 'admin', password: settings.adminPassword } });
    const appPath = '/api/get-application?id=admin%2Fwaypoint';
    const before = (await admin(appPath)).data;
    assert.equal(before.title, 'Before Waypoint branding');
    assert.deepEqual(await applyBranding(plan, { stateDir: root, backupFile: resolve(root, 'branding-before.json'), adminPassword: settings.adminPassword }), { changed: true });
    const after = (await admin(appPath)).data;
    for (const key of Object.keys(before).filter((key) => !brandingFields.includes(key))) {
      assert.deepEqual(after[key], before[key], `${key} must survive sparse MustCols updates`);
    }
    assert.equal(after.formBackgroundUrl, '', 'MustCols clears the old nonempty background');
    assert.equal(after.clientSecret, before.clientSecret);
    assert.deepEqual(await applyBranding(plan, { stateDir: root, backupFile: resolve(root, 'not-needed.json'), adminPassword: settings.adminPassword }), { changed: false });
    await admin('/api/logout', { method: 'POST' });

    const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
    const { chromium, expect } = require('@playwright/test');
    browser = await chromium.launch({ headless: true });
    for (const viewport of [{ width: 1280, height: 900 }, { width: 768, height: 900 }, { width: 375, height: 812 }, { width: 320, height: 640 }]) {
      for (const colorScheme of ['light', 'dark']) {
        const context = await browser.newContext({ viewport, colorScheme });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        // External initial Casdoor icons are outside this application's control.
        // All branding assets themselves must stay on data: URLs.
        await page.route('**/*', (route) => {
          const url = new URL(route.request().url());
          return url.origin === settings.publicUrl || url.protocol === 'data:' ? route.continue() : route.abort();
        });
        await page.goto(`${settings.publicUrl}/login/waypoint`);
        await expect(page.locator('.login-logo-box img')).toBeVisible();
        await expect(page).toHaveTitle('Waypoint account');
        await expect(page.locator('#username')).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        assert.equal(await page.evaluate(() => document.fonts.check('16px "Manrope Variable"')), true);
        assert.equal(await page.evaluate(() => [...document.fonts].some((font) => font.family.replaceAll('"', '') === 'Manrope Variable' && font.status === 'loaded')), true);
        assert.equal(await page.locator('.login-logo-box img').evaluate((img) => img.complete && img.naturalWidth > 0), true);
        assert.equal(await page.locator('.login-background').evaluate((el) => getComputedStyle(el).fontFamily.includes('Manrope Variable')), true);
        const logo = await page.locator('.login-logo-box img').getAttribute('src');
        assert.equal(logo, colorScheme === 'dark' ? plan.fields.logoDark : plan.fields.logo);
        await expect(page.getByRole('checkbox', { name: 'Auto sign in' })).toBeChecked();
        const borderContrast = await page.locator('#password').evaluate((input) => {
          const style = getComputedStyle(input);
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          const luminance = (color) => {
            context.fillStyle = color;
            context.fillRect(0, 0, 1, 1);
            const channels = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map((byte) => {
              const value = byte / 255;
              return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
            });
            return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
          };
          const values = [luminance(style.borderTopColor), luminance(style.backgroundColor)].sort((a, b) => b - a);
          return (values[0] + 0.05) / (values[1] + 0.05);
        });
        assert.ok(borderContrast >= 3, `Input border contrast ${borderContrast} must reach 3:1`);
        await expect(page.locator('.waypoint-footer')).toHaveText('Your Waypoint account. Identity by Casdoor.');
        const side = page.getByRole('complementary', { name: 'About Waypoint' });
        if (viewport.width >= 1024) await expect(side).toBeVisible();
        else await expect(side).toBeHidden();
        await page.getByRole('tab', { name: 'Passkey', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Sign in with WebAuthn' })).toBeVisible();
        await page.getByRole('tab', { name: 'Password', exact: true }).click();
        await page.locator('#username').focus();
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'solid');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.getByRole('link', { name: 'sign up now' }).click();
        await expect(page.getByRole('button', { name: 'Sign Up', exact: true })).toBeVisible();
        for (const label of ['Username', 'Display name', 'Password', 'Confirm']) {
          await expect(page.getByLabel(new RegExp(`^${label}`))).toBeVisible();
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.deepEqual(errors, []);
        await context.close();
      }
    }
  } finally {
    await browser?.close();
    await fixture.stop();
  }
});
