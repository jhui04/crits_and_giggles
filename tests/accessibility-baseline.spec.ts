import { test } from '@playwright/test';
import { checkA11y } from './utils/axe-helper';
import fs from 'fs';
import path from 'path';

// Seed data to ensure we have a consistent environment
const monstersData = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public/data/monsters.json'), 'utf-8'));
const mockMonster = monstersData[0]; 

const seedState = {
  id: 'test-campaign',
  name: 'Test Campaign',
  description: 'Test',
  chapters: [
    {
      id: 'chap-1',
      title: 'Chapter 1',
      content: 'Hello world',
      order: 0
    }
  ],
  assets: [],
  encounters: [
    {
      id: 'test-encounter',
      name: 'Test Encounter',
      units: [
        {
          instanceId: 'unit-1',
          monsterId: mockMonster.id,
          name: mockMonster.name,
          maxHp: 10,
          currentHp: 10,
          hpDice: '2d6',
          dexMod: 2,
          initiative: 15,
          passivePerception: 12,
          isPlayer: false,
          fullData: mockMonster
        }
      ]
    }
  ]
};

test.describe('Accessibility Baseline Scans', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((seededData) => {
      localStorage.setItem('crits_campaigns', JSON.stringify([seededData]));
      localStorage.setItem('crits_active_campaign', seededData.id);
    }, seedState);
    await page.goto('/');
  });

  test('Create Mode Baseline', async ({ page }) => {
    await page.waitForSelector('main');
    await checkA11y(page, 'Create Mode Initial Load');
  });

  test('Run Mode - Story Tab Baseline', async ({ page }) => {
    await page.click('text=Switch to Run Mode');
    await page.click('text=Story');
    await checkA11y(page, 'Run Mode - Story Tab');
  });

  test('Run Mode - Combat Tab Baseline', async ({ page }) => {
    await page.click('text=Switch to Run Mode');
    await page.click('text=Combat');
    await checkA11y(page, 'Run Mode - Combat Tab');
  });

  test('Oracle Baseline', async ({ page }) => {
    // Open Main Menu
    await page.click('button[aria-label="Open Main Menu"]');
    await page.waitForSelector('#main-menu-title');
    
    // Open Oracle from menu
    await page.click('text=The Oracle (Alt+O)');
    await page.waitForSelector('.oracle-overlay');
    await checkA11y(page, 'Oracle Modal');
  });
});
