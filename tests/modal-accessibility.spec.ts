import { test, expect, Page } from '@playwright/test';
import { checkA11y } from './utils/axe-helper';
import fs from 'fs';
import path from 'path';

const monstersData = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public/data/monsters.json'), 'utf-8'));
const mockMonster = monstersData[0];

const seedState = {
  id: 'test-campaign',
  name: 'Test Campaign',
  description: 'Test Description',
  chapters: [
    {
      id: 'chap-1',
      title: 'Chapter 1',
      content: 'Hello world content',
      order: 0
    }
  ],
  assets: [
    {
      id: 'asset-1',
      name: 'Test Asset',
      type: 'markdown',
      content: '# Test Asset Content',
      description: '',
      category: 'General'
    }
  ],
  players: [
    {
      id: 'player-1',
      name: 'Player 1',
      dexMod: 3,
      initiative: 0,
      passivePerception: 15,
      isPlayer: true
    }
  ],
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
        },
        {
          instanceId: 'player-1',
          name: 'Player 1',
          dexMod: 3,
          initiative: 18,
          passivePerception: 15,
          isPlayer: true
        }
      ]
    }
  ]
};

const setupApp = async (page: Page) => {
  await page.addInitScript((data) => {
    window.localStorage.setItem('crits_campaigns', JSON.stringify([data]));
    window.localStorage.setItem('crits_active_campaign', data.id);
  }, seedState);
  await page.goto('/');
  await page.waitForSelector('main');
};

const verifyModalOpen = async (page: Page, titleText: string | RegExp) => {
  const heading = page.locator('h1, h2, h3, h4, h5, h6').filter({ hasText: titleText }).first();
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
};

const verifyModalClosed = async (page: Page, trigger: any, titleToClose?: string | RegExp) => {
  await page.keyboard.press('Escape');
  if (titleToClose) {
    await expect(page.locator('h1, h2, h3, h4, h5, h6').filter({ hasText: titleToClose })).not.toBeVisible();
  }
  await expect(trigger).toBeFocused();
};

test.describe('Global / App Level Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await setupApp(page);
  });

  test('Main Menu Modal', async ({ page }) => {
    const trigger = page.getByRole('button', { name: 'Open Main Menu' });
    await trigger.click();
    await verifyModalOpen(page, 'Main Menu');
    await checkA11y(page, 'Main Menu');
    await verifyModalClosed(page, trigger);
  });

  test('Campaign Switcher Modal', async ({ page }) => {
    const mainMenuTrigger = page.getByRole('button', { name: 'Open Main Menu' });
    await mainMenuTrigger.click();
    await page.getByRole('button', { name: /Switch Campaign/ }).click();
    await verifyModalOpen(page, 'Select Campaign');
    await checkA11y(page, 'Select Campaign');
    await verifyModalClosed(page, mainMenuTrigger);
  });

  test('New Campaign Modal', async ({ page }) => {
    const mainMenuTrigger = page.getByRole('button', { name: 'Open Main Menu' });
    await mainMenuTrigger.click();
    await page.getByRole('button', { name: /Switch Campaign/ }).click();
    await page.getByRole('button', { name: '+ Create New Campaign' }).click();
    await verifyModalOpen(page, 'New Campaign');
    await checkA11y(page, 'New Campaign');
    await verifyModalClosed(page, mainMenuTrigger);
  });

  test('The Oracle (Default)', async ({ page }) => {
    const mainMenuTrigger = page.getByRole('button', { name: 'Open Main Menu' });
    await mainMenuTrigger.click();
    await page.getByRole('button', { name: /The Oracle/ }).click();
    const searchInput = page.getByLabel('Search Name:');
    await expect(searchInput).toBeFocused();
    await checkA11y(page, 'The Oracle');
    await verifyModalClosed(page, mainMenuTrigger);
  });

  test('Keyboard Shortcuts Modal', async ({ page }) => {
    const mainMenuTrigger = page.getByRole('button', { name: 'Open Main Menu' });
    await mainMenuTrigger.click();
    await page.getByRole('button', { name: /Keyboard Shortcuts/ }).click();
    await verifyModalOpen(page, 'Keyboard Shortcuts');
    await checkA11y(page, 'Keyboard Shortcuts');
    await verifyModalClosed(page, mainMenuTrigger);
  });
});

test.describe('Create Mode Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await setupApp(page);
  });

  test('Campaign Builder (Default/Expanded)', async ({ page }) => {
    await page.getByRole('button', { name: 'Chapter 1', exact: false }).click();
    await page.getByRole('button', { name: 'Test Asset (markdown)', exact: false }).click();
    await checkA11y(page, 'Campaign Builder Expanded');
  });

  test('Campaign Settings Modal', async ({ page }) => {
    const trigger = page.getByRole('button', { name: 'Campaign Settings' });
    await trigger.click();
    await verifyModalOpen(page, 'Campaign Settings');
    await checkA11y(page, 'Campaign Settings');
    await verifyModalClosed(page, trigger);
  });

  test('Player Form Modal', async ({ page }) => {
    await page.getByRole('button', { name: 'Campaign Settings' }).click();
    const trigger = page.getByRole('button', { name: '+ Add Player' });
    await trigger.click();
    await verifyModalOpen(page, /Add New Player/);
    await checkA11y(page, 'Player Form');
    await verifyModalClosed(page, trigger);
  });

  test('Chapter Form Modal', async ({ page }) => {
    await page.getByRole('button', { name: 'Chapter 1', exact: false }).click();
    const trigger = page.getByRole('button', { name: 'Edit Chapter' });
    await trigger.click();
    await verifyModalOpen(page, 'Edit Chapter');
    await checkA11y(page, 'Chapter Form');
    await verifyModalClosed(page, trigger);
  });

  test('Asset Form Modal', async ({ page }) => {
    const trigger = page.getByRole('button', { name: '+ Add Asset' });
    await trigger.click();
    await verifyModalOpen(page, /Add New Asset/);
    await checkA11y(page, 'Asset Form');
    await verifyModalClosed(page, trigger);
  });

  test('Asset Details Modal', async ({ page }) => {
    await page.getByRole('button', { name: 'Test Asset (markdown)', exact: false }).click();
    const trigger = page.getByRole('button', { name: 'View Details' });
    await trigger.click();
    await verifyModalOpen(page, 'Test Asset');
    await checkA11y(page, 'Asset Details');
    await verifyModalClosed(page, trigger);
  });

  test('Encounter Builder Base', async ({ page }) => {
    await page.getByRole('button', { name: 'Edit' }).click();
    await verifyModalOpen(page, 'Encounter Builder');
    await checkA11y(page, 'Encounter Builder');
  });

  test('Monster Search/Add Modal', async ({ page }) => {
    await page.getByRole('button', { name: 'Edit' }).click();
    await verifyModalOpen(page, 'Encounter Builder');
    const trigger = page.getByRole('button', { name: 'Add Monster...' });
    await trigger.click();
    await verifyModalOpen(page, /Select Monster/);
    await checkA11y(page, 'Monster Search Modal');
    await verifyModalClosed(page, trigger);
  });
});

test.describe('Run Mode Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await setupApp(page);
    await page.getByRole('button', { name: 'Switch to Run Mode' }).click();
  });

  test('Story Tab Base', async ({ page }) => {
    await page.getByRole('button', { name: 'Story' }).click();
    await expect(page.getByRole('heading', { name: 'Story Chapters' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Chapter 1' })).toBeVisible();
    await checkA11y(page, 'Story Tab');
  });

  test('Load Encounter View', async ({ page }) => {
    await page.getByRole('button', { name: 'Combat' }).click();
    await verifyModalOpen(page, 'Load Encounter');
    await checkA11y(page, 'Load Encounter View');
  });

  test('Initiative Setup View', async ({ page }) => {
    await page.getByRole('button', { name: 'Combat' }).click();
    await page.getByRole('button', { name: /Load "Test Encounter"/ }).click();
    await expect(page.getByText('Initiative Setup')).toBeVisible();
    await checkA11y(page, 'Initiative Setup View');
  });

  test('Active Combat View', async ({ page }) => {
    await page.getByRole('button', { name: 'Combat' }).click();
    await page.getByRole('button', { name: /Load "Test Encounter"/ }).click();
    await page.getByRole('button', { name: 'Start Combat' }).click();
    await expect(page.getByRole('heading', { name: 'Running: Test Encounter' })).toBeVisible();
    await checkA11y(page, 'Active Combat View');
  });

  test('Monster Operations Modal (Main)', async ({ page }) => {
    await page.getByRole('button', { name: 'Combat' }).click();
    await page.getByRole('button', { name: /Load "Test Encounter"/ }).click();
    await page.getByRole('button', { name: 'Start Combat' }).click();
    const trigger = page.getByRole('button', { name: 'Options' }).first();
    await trigger.click();
    await verifyModalOpen(page, /Actions$/); 
    await checkA11y(page, 'Monster Operations Main');
    await verifyModalClosed(page, trigger);
  });

  test('Monster Operations Modal (Damage/Heal)', async ({ page }) => {
    await page.getByRole('button', { name: 'Combat' }).click();
    await page.getByRole('button', { name: /Load "Test Encounter"/ }).click();
    await page.getByRole('button', { name: 'Start Combat' }).click();
    const trigger = page.getByRole('button', { name: 'Options' }).first();
    await trigger.click();
    await page.getByRole('button', { name: 'Damage' }).click();
    await expect(page.getByLabel('Damage Amount:')).toBeFocused();
    await checkA11y(page, 'Monster Operations Damage');
    await verifyModalClosed(page, trigger);
  });

  test('Monster Operations Modal (Actions/Skills/Saves)', async ({ page }) => {
    await page.getByRole('button', { name: 'Combat' }).click();
    await page.getByRole('button', { name: /Load "Test Encounter"/ }).click();
    await page.getByRole('button', { name: 'Start Combat' }).click();
    const trigger = page.getByRole('button', { name: 'Options' }).first();
    await trigger.click();
    await page.getByRole('button', { name: 'Actions' }).click();
    await expect(page.locator('[role="dialog"] button').first()).toBeFocused();
    await checkA11y(page, 'Monster Operations Actions List');
    await verifyModalClosed(page, trigger);
  });

  test('Combat Roll Result Modal', async ({ page }) => {
    await page.getByRole('button', { name: 'Combat' }).click();
    await page.getByRole('button', { name: /Load "Test Encounter"/ }).click();
    await page.getByRole('button', { name: 'Start Combat' }).click();
    const optionsTrigger = page.getByRole('button', { name: 'Options' }).first();
    await optionsTrigger.click();
    await page.getByRole('button', { name: 'Actions' }).click();
    const actionTrigger = page.locator('[role="dialog"] button').first();
    const actionName = await actionTrigger.innerText();
    await actionTrigger.click();
    await verifyModalOpen(page, new RegExp(actionName));
    await checkA11y(page, 'Roll Result Modal');
    // Esc now closes both roll result and operations modal, focus returns to the original Options trigger
    await verifyModalClosed(page, optionsTrigger);
  });

  test('Combatant Details Modal (Player)', async ({ page }) => {
    await page.getByRole('button', { name: 'Combat' }).click();
    await page.getByRole('button', { name: /Load "Test Encounter"/ }).click();
    await page.getByRole('button', { name: 'Start Combat' }).click();
    const trigger = page.getByRole('button', { name: 'Player 1 (Player)' });
    await trigger.click();
    await verifyModalOpen(page, 'Player 1');
    await checkA11y(page, 'Player Details');
    await verifyModalClosed(page, trigger);
  });

  test('Combatant Details Modal (Monster)', async ({ page }) => {
    await page.getByRole('button', { name: 'Combat' }).click();
    await page.getByRole('button', { name: /Load "Test Encounter"/ }).click();
    await page.getByRole('button', { name: 'Start Combat' }).click();
    const trigger = page.getByRole('button', { name: new RegExp(mockMonster.name) }).first();
    await trigger.click();
    await verifyModalOpen(page, mockMonster.name);
    await checkA11y(page, 'Monster Details Modal');
    await verifyModalClosed(page, trigger);
  });
});
