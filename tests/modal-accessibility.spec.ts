import { test, expect, Page } from '@playwright/test';
import { checkA11y } from './utils/axe-helper';
import fs from 'fs';
import path from 'path';

// Seed data
// ... (rest of seedState same)
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

test.describe('Modal Accessibility Deterministic Fuzzer', () => {

  test.beforeEach(async ({ page }) => {
    page.on('dialog', dialog => dialog.dismiss());
  });

  const setupPage = async (page: Page, viewFunction: () => Promise<void>) => {
    await page.addInitScript((seededData) => {
      localStorage.setItem('crits_campaigns', JSON.stringify([seededData]));
      localStorage.setItem('crits_active_campaign', seededData.id);
    }, seedState);
    await page.goto('/');
    await viewFunction();
  };

  const getContainer = async (page: Page) => {
    const dialogs = page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible');
    const dialogCount = await dialogs.count();
    if (dialogCount > 0) return dialogs.last();
    return page.locator('body');
  };

  const executePath = async (page: Page, pathIndices: number[]) => {
    let currentContainer = await getContainer(page);
    for (const idx of pathIndices) {
      const btns = currentContainer.locator('button:visible, [role="button"]:visible').filter({ hasNot: page.locator('[disabled]') });
      if (idx >= await btns.count()) return false; // Path invalid due to dynamic DOM
      await btns.nth(idx).click({ force: true });
      await page.waitForTimeout(150); // wait for animations/modals
      currentContainer = await getContainer(page);
    }
    return true;
  };

  const fuzzView = async (page: Page, setupFn: () => Promise<void>, maxDepth = 3) => {
    const pathsToExplore: number[][] = [ [] ];
    const scannedSignatures = new Set<string>();
    const visitedStateSignatures = new Set<string>();

    const getSignature = async () => {
      const dialogs = page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible');
      const isDialog = await dialogs.count() > 0;
      const container = isDialog ? dialogs.last() : page.locator('main');
      
      const heading = await container.locator('h1, h2, h3, h4, h5, h6').first().textContent().catch(() => 'no-heading');
      
      // Add buttons context to distinguish states with same heading (like different combat phases)
      const buttons = container.locator('button[data-fuzzer-category]');
      const categories = await buttons.evaluateAll(nodes => 
        Array.from(new Set(nodes.map(n => n.getAttribute('data-fuzzer-category')))).sort()
      );

      return `${isDialog ? 'dialog' : 'body'}-${heading?.trim()}-${categories.join(',')}`;
    };

    while (pathsToExplore.length > 0) {
      const currentPath = pathsToExplore.shift()!;
      
      // 1. Setup page and navigate to state
      await setupPage(page, setupFn);
      const valid = await executePath(page, currentPath);
      if (!valid) continue;

      const landingSig = await getSignature();
      visitedStateSignatures.add(landingSig); // Mark current state as visited

      // Accessibility Scan for this landing view
      if (!scannedSignatures.has(landingSig)) {
        await checkA11y(page, `Fuzzer landing: ${landingSig}`);
        scannedSignatures.add(landingSig);
      }

      let container = await getContainer(page);
      const btns = container.locator('button:visible, [role="button"]:visible').filter({ hasNot: page.locator('[disabled]') });
      const btnsCount = await btns.count();

      // ... (rest of enforcement check and indicesToTest logic remains similar)
      // Enforcement Check: Lists with > 3 buttons MUST use data-fuzzer-category
      const lists = container.locator('ul, ol');
      const listCount = await lists.count();
      for (let j = 0; j < listCount; j++) {
        const list = lists.nth(j);
        const listBtns = list.locator('button:visible');
        if (await listBtns.count() > 3) {
          const untaggedCount = await list.locator('button:visible:not([data-fuzzer-category])').count();
          expect(untaggedCount, 'Lists with >3 buttons must have data-fuzzer-category for fuzzer sampling').toBe(0);
        }
      }

      const indicesToTest = new Set<number>();
      const categoryMap = new Map<string, number[]>();
      for (let i = 0; i < btnsCount; i++) {
        const cat = await btns.nth(i).getAttribute('data-fuzzer-category') || 'default';
        if (!categoryMap.has(cat)) categoryMap.set(cat, []);
        categoryMap.get(cat)!.push(i);
      }

      for (const indices of categoryMap.values()) {
        if (indices.length <= 3) {
          for (const idx of indices) indicesToTest.add(idx);
        } else {
          indicesToTest.add(indices[0]);
          indicesToTest.add(indices[Math.floor(indices.length / 2)]);
          indicesToTest.add(indices[indices.length - 1]);
        }
      }

      // 2. Test selected buttons sequentially with full state resets
      for (const i of Array.from(indicesToTest).sort((a, b) => a - b)) {
        await setupPage(page, setupFn);
        await executePath(page, currentPath);
        
        container = await getContainer(page);
        const btns = container.locator('button:visible, [role="button"]:visible').filter({ hasNot: page.locator('[disabled]') });
        if (i >= await btns.count()) continue; // Safety check
        
        const btnToClick = btns.nth(i);
        const btnText = await btnToClick.textContent() || `Button ${i}`;

        await btnToClick.scrollIntoViewIfNeeded().catch(() => {});

        const originalId = await btnToClick.evaluate((node: HTMLElement, idStr: string) => {
          if (!node.id) node.id = idStr;
          return node.id;
        }, `fuzz-btn-${Date.now()}-${currentPath.join('-')}-${i}`);

        // Record state BEFORE click
        const sigBefore = await getSignature();
        const dialogsBefore = page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible');
        const dialogCountBefore = await dialogsBefore.count();
        const isDialogBefore = dialogCountBefore > 0;

        // Click!
        try {
          await btnToClick.click({ force: true, timeout: 500 });
        } catch {
          await btnToClick.evaluate(node => node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
        }
        await page.waitForTimeout(400);

        // Record state AFTER click
        const sigAfter = await getSignature();
        const dialogsAfter = page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible');
        const dialogCountAfter = await dialogsAfter.count();
        const isDialogAfter = dialogCountAfter > 0;
        const newContainer = isDialogAfter ? dialogsAfter.last() : page.locator('body');

        // Detect if view changed
        if (sigBefore !== sigAfter) {
          console.log(`Discovered view change via [${btnText.trim()}]. Path: [${currentPath.join(', ')}, ${i}]`);
          console.log(`  From: ${sigBefore}`);
          console.log(`  To:   ${sigAfter}`);

          // Accessibility Scan for the newly discovered view
          if (!scannedSignatures.has(sigAfter)) {
            await checkA11y(page, `Fuzzer discovered: ${sigAfter}`);
            scannedSignatures.add(sigAfter);
          }

          const isNewModal = !isDialogBefore && isDialogAfter;
          const isDialogViewSwap = isDialogBefore && isDialogAfter; // sigBefore !== sigAfter already checked

          if (isNewModal || isDialogViewSwap) {
              // Verification 1: Focus lands on heading
              await page.waitForFunction(() => {
                const el = document.activeElement;
                return el && /^h[1-6]$/i.test(el.tagName);
              }, { timeout: 200 }).catch(() => {});

              const activeElementTagName = await page.evaluate(() => document.activeElement?.tagName.toLowerCase());
              const activeElementInfo = await page.evaluate(() => {
                const el = document.activeElement as HTMLElement;
                return el ? `${el.tagName.toLowerCase()}#${el.id} (text: ${el.textContent?.trim().substring(0, 30)})` : 'none';
              });
              const activeElementInDialog = await newContainer.evaluate((node: HTMLElement) => node.contains(document.activeElement));
              const isHeading = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(activeElementTagName || '');
              
              expect(activeElementInDialog, `Focus should be inside dialog after opening.`).toBeTruthy();
              expect(isHeading, `Focus must land on a heading (h1-h6). Found: ${activeElementInfo}.`).toBeTruthy();

              // Verification 2: Escape to close
              await page.keyboard.press('Escape');
              await page.waitForTimeout(150);

              const checkDialogs = page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible');
              const checkDialogCount = await checkDialogs.count();

              if (isNewModal) {
                  expect(checkDialogCount).toBeLessThan(dialogCountAfter);
              } else if (isDialogViewSwap) {
                  if (checkDialogCount === dialogCountAfter) {
                      const revertedSig = await getSignature();
                      expect(revertedSig).toBe(sigBefore);
                  }
              }

              // Verification 3: Focus restoration
              const restoredId = await page.evaluate(() => document.activeElement?.id);
              if (isNewModal || checkDialogCount === dialogCountAfter) {
                  expect(restoredId, `Focus should return to the button that opened it.`).toBe(originalId);
              }
          }

          // Queue path for deeper exploration IF it's a new state
          if (currentPath.length < maxDepth && !visitedStateSignatures.has(sigAfter)) {
            pathsToExplore.push([...currentPath, i]);
            // Note: We don't mark as visited here because we want to fully explore it 
            // when it comes off the pathsToExplore queue.
          }
        }
      }
    }
  };

  test('Fuzz View 1: Create Mode', async ({ page }) => {
    await fuzzView(page, async () => {
        await page.waitForSelector('main');
    });
  });

  test('Fuzz View 2: Run Mode -> Story Tab', async ({ page }) => {
    await fuzzView(page, async () => {
        await page.click('text=Switch to Run Mode');
        await page.click('text=Story');
    });
  });

  test('Fuzz View 3: Run Mode -> Combat Tab', async ({ page }) => {
    await fuzzView(page, async () => {
        await page.click('text=Switch to Run Mode');
        await page.click('text=Combat');
    });
  });

  test('Fuzz View 4: Main Menu Focus Management', async ({ page }) => {
    await fuzzView(page, async () => {
        await page.click('text=Crits & Giggles'); // Open main menu
        await page.waitForSelector('#main-menu-title');
    }, 1); // Only explore 1 level deep to avoid timing out when opening the massive Oracle
  });
});