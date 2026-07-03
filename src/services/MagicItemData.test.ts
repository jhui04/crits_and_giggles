import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import type { MagicItem } from '../types';

describe('Magic Item Data Integrity', () => {
  const dataPath = path.join(__dirname, '../../public/data/magic_items.json');
  const rawData = fs.readFileSync(dataPath, 'utf-8');
  const items: MagicItem[] = JSON.parse(rawData);

  it('should load magic items successfully', () => {
    expect(items.length).toBeGreaterThan(0);
  });

  describe('Structural integrity of all magic items', () => {
    items.forEach((item) => {
      it(`should have required fields present for ${item.name}`, () => {
        expect(typeof item.id).toBe('string');
        expect(typeof item.name).toBe('string');
        expect(typeof item.type).toBe('string');
        expect(typeof item.rarity).toBe('string');
        expect(typeof item.requires_attunement).toBe('boolean');
        expect(typeof item.source).toBe('string');
        expect(Array.isArray(item.description)).toBe(true);
      });
    });
  });

  describe('Scraper coverage validation', () => {
    const itemCacheDir = path.join(__dirname, '../../dnd_beyond/magic_items');
    const statePath = path.join(__dirname, '../../tools/magic_item_scraper_state.json');

    it('should have no duplicate magic item IDs in the dataset', () => {
      const idCounts = new Map<string, number>();
      items.forEach(i => {
        idCounts.set(i.id, (idCounts.get(i.id) || 0) + 1);
      });
      const duplicates = Array.from(idCounts.entries()).filter(([, count]) => count > 1);
      expect(duplicates.length, `Duplicate magic item IDs found: ${JSON.stringify(duplicates)}`).toBe(0);
    });

    it('should include all owned magic items and contain no extra/unowned items', () => {
      // 1. Gather all unique magic item URLs and IDs from cached list pages
      const uniqueUrls = new Set<string>();
      const listPageIds = new Set<string>();
      
      if (!fs.existsSync(itemCacheDir)) {
        return; // Skip if cache is not present locally
      }
      
      const files = fs.readdirSync(itemCacheDir);
      const listPages = files.filter(f => f.startsWith('page') && f.endsWith('.html'));
      
      // Regex matches: href="/magic-items/12345-slug"
      const urlRegex = /\/magic-items\/(\d+)-([^"\s>]+)/g;
      
      listPages.forEach(file => {
        const filePath = path.join(itemCacheDir, file);
        const html = fs.readFileSync(filePath, 'utf-8');
        
        let match;
        urlRegex.lastIndex = 0;
        while ((match = urlRegex.exec(html)) !== null) {
          const absoluteUrl = `https://www.dndbeyond.com${match[0]}`;
          uniqueUrls.add(absoluteUrl);
          listPageIds.add(match[1]);
        }
      });
      
      expect(uniqueUrls.size).toBeGreaterThan(0);
      
      // 2. Load unowned URLs from the magic items scraper state
      let unownedUrls: string[] = [];
      if (fs.existsSync(statePath)) {
        const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
        unownedUrls = state.unowned_urls || [];
      }
      
      const unownedUrlsSet = new Set<string>(unownedUrls);
      
      // 3. Filter candidate list to only include owned magic item URLs
      const ownedUrls = Array.from(uniqueUrls).filter(url => !unownedUrlsSet.has(url));
      
      // 4. Map existing magic items database IDs and URLs
      const databaseIds = new Set<string>(items.map(i => i.id));
      
      // --- CHECK A: Detect missing magic items ---
      const missingItems: { id: string; url: string }[] = [];
      ownedUrls.forEach(url => {
        const idMatch = url.match(/\/magic-items\/(\d+)-/);
        if (idMatch) {
          const itemId = idMatch[1];
          if (!databaseIds.has(itemId)) {
            missingItems.push({ id: itemId, url });
          }
        }
      });
      
      if (missingItems.length > 0) {
        console.error('Missing Magic Items Details:', missingItems);
      }
      expect(missingItems.length, `Scraper missed ${missingItems.length} owned magic items`).toBe(0);

      // --- CHECK B: Detect extra/orphaned/unowned magic items ---
      const extraItems: { id: string; name: string; url: string; reason: string }[] = [];
      items.forEach(i => {
        // Reason 1: Magic item is marked as unowned/locked in the state file
        if (unownedUrlsSet.has(i.url)) {
          extraItems.push({ id: i.id, name: i.name, url: i.url, reason: 'Marked as unowned in state' });
        }
        // Reason 2: Magic item ID is not present in cached list pages
        else if (!listPageIds.has(i.id)) {
          extraItems.push({ id: i.id, name: i.name, url: i.url, reason: 'Not found in cached list pages' });
        }
      });

      if (extraItems.length > 0) {
        console.error('Extra Magic Items Details:', extraItems);
      }
      expect(extraItems.length, `Database has ${extraItems.length} extra/unowned magic items`).toBe(0);
    });
  });
});
