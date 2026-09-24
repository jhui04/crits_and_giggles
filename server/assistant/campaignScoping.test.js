import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import '../index.js';
import { db } from '../db.js';
import hitlManager, { clearProposals } from './hitlManager.js';
import {
  executeTool,
  registerBuiltInWriteTools,
  clearWriteTools,
  computeEncounterStateHash,
} from './toolController.js';
import { getAuthoritativeGameState } from './contextBuilder.js';

// encounter_units is keyed by (instanceId, campaign_id) and encounters by
// (id, campaign_id), so two campaigns can hold identically-id'd rows. These
// tests seed exactly that and assert every assistant read/write stays inside
// the campaign it was scoped to.
const CAMP_A = 'scope-camp-a';
const CAMP_B = 'scope-camp-b';
const ENC = 'scope-enc';
const UNIT = 'scope-unit-1';

function seed({ withRunningState }) {
  for (const cid of [CAMP_A, CAMP_B]) {
    db.prepare('DELETE FROM encounter_units WHERE campaign_id = ?').run(cid);
    db.prepare('DELETE FROM encounters WHERE campaign_id = ?').run(cid);
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(cid);
    db.prepare('INSERT INTO campaigns (id, name, description) VALUES (?, ?, ?)').run(cid, `Camp ${cid}`, 'scoping');

    const hp = cid === CAMP_A ? 30 : 12;
    const name = cid === CAMP_A ? 'Alpha Ogre' : 'Beta Goblin';
    const rs = withRunningState
      ? JSON.stringify({
          isCombatStarted: true,
          round: 1,
          turnIndex: 0,
          combatants: [
            { instanceId: UNIT, name, currentHp: hp, maxHp: hp, initiative: 10, isPlayer: false, faction: 'enemy', position: { x: 1, y: 1 } },
          ],
        })
      : null;
    db.prepare('INSERT INTO encounters (id, campaign_id, name, running_state) VALUES (?, ?, ?, ?)').run(ENC, cid, `Enc ${cid}`, rs);
    db.prepare(
      'INSERT INTO encounter_units (instanceId, encounter_id, campaign_id, name, maxHp, currentHp, dexMod, initiative, isPlayer, faction, position_x, position_y) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(UNIT, ENC, cid, name, hp, hp, 0, 10, 0, 'enemy', 1, 1);
  }
}

const unit = (cid) =>
  db.prepare('SELECT * FROM encounter_units WHERE instanceId = ? AND campaign_id = ?').get(UNIT, cid);
const rsOf = (cid) =>
  JSON.parse(db.prepare('SELECT running_state FROM encounters WHERE id = ? AND campaign_id = ?').get(ENC, cid).running_state);

async function stageAndApprove(tool, args, cid) {
  const staged = await executeTool(tool, args, { campaignId: cid, encounterId: ENC });
  expect(staged.status).toBe('proposal_staged');
  return hitlManager.resolveProposal(staged.proposal.proposalId, 'approve');
}

afterAll(() => {
  for (const cid of [CAMP_A, CAMP_B]) {
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(cid);
  }
});

describe('assistant read tools are scoped by campaign (encounter_units fallback)', () => {
  beforeEach(() => {
    clearProposals();
    seed({ withRunningState: false });
  });

  it('get_monster_hp returns the unit from the requested campaign only', async () => {
    const a = await executeTool('get_monster_hp', { name_or_id: UNIT }, { campaignId: CAMP_A });
    const b = await executeTool('get_monster_hp', { name_or_id: UNIT }, { campaignId: CAMP_B });
    expect(a.result?.name ?? a.name).toBe('Alpha Ogre');
    expect(b.result?.name ?? b.name).toBe('Beta Goblin');
  });

  it('get_entity_position and get_initiative_order do not leak across campaigns', async () => {
    const pos = await executeTool('get_entity_position', { name_or_id: UNIT }, { campaignId: CAMP_B, encounterId: ENC });
    expect(JSON.stringify(pos)).toContain('Beta Goblin');
    expect(JSON.stringify(pos)).not.toContain('Alpha Ogre');

    const order = await executeTool('get_initiative_order', {}, { campaignId: CAMP_A, encounterId: ENC });
    const text = JSON.stringify(order);
    expect(text).toContain('Alpha Ogre');
    expect(text).not.toContain('Beta Goblin');
  });

  it('getAuthoritativeGameState only lists the scoped campaign\'s units', () => {
    const state = getAuthoritativeGameState({ campaignId: CAMP_B, encounterId: ENC });
    const names = JSON.stringify(state);
    expect(names).toContain('Beta Goblin');
    expect(names).not.toContain('Alpha Ogre');
  });

  it('computeEncounterStateHash differs per campaign and ignores the other campaign\'s changes', () => {
    const before = computeEncounterStateHash(ENC, CAMP_A);
    expect(before).not.toBe(computeEncounterStateHash(ENC, CAMP_B));
    db.prepare('UPDATE encounter_units SET currentHp = 1 WHERE instanceId = ? AND campaign_id = ?').run(UNIT, CAMP_B);
    expect(computeEncounterStateHash(ENC, CAMP_A)).toBe(before);
  });
});

describe('assistant write handlers only touch the target campaign', () => {
  beforeEach(() => {
    clearProposals();
    clearWriteTools();
    registerBuiltInWriteTools();
    seed({ withRunningState: true });
  });

  it('apply_combat_damage', async () => {
    await stageAndApprove('apply_combat_damage', { targets: [{ combatantId: UNIT, amount: 5, actionType: 'damage' }] }, CAMP_A);
    expect(unit(CAMP_A).currentHp).toBe(25);
    expect(unit(CAMP_B).currentHp).toBe(12);
    expect(rsOf(CAMP_A).combatants[0].currentHp).toBe(25);
    expect(rsOf(CAMP_B).combatants[0].currentHp).toBe(12);
  });

  it('move_combatant', async () => {
    await stageAndApprove('move_combatant', { combatantId: UNIT, destination: 'D4' }, CAMP_A);
    expect(unit(CAMP_A)).toMatchObject({ position_x: 3, position_y: 3 });
    expect(unit(CAMP_B)).toMatchObject({ position_x: 1, position_y: 1 });
    expect(rsOf(CAMP_A).combatants[0].position).toEqual({ x: 3, y: 3 });
    expect(rsOf(CAMP_B).combatants[0].position).toEqual({ x: 1, y: 1 });
  });

  it('update_combatant', async () => {
    await stageAndApprove('update_combatant', { combatantId: UNIT, newName: 'Renamed', faction: 'ally' }, CAMP_B);
    expect(unit(CAMP_B)).toMatchObject({ name: 'Renamed', faction: 'ally' });
    expect(unit(CAMP_A)).toMatchObject({ name: 'Alpha Ogre', faction: 'enemy' });
    expect(rsOf(CAMP_B).combatants[0].name).toBe('Renamed');
    expect(rsOf(CAMP_A).combatants[0].name).toBe('Alpha Ogre');
  });

  it('remove_combatant', async () => {
    await stageAndApprove('remove_combatant', { combatantId: UNIT }, CAMP_A);
    expect(unit(CAMP_A)).toBeUndefined();
    expect(unit(CAMP_B)).toBeTruthy();
    expect(rsOf(CAMP_A).combatants).toHaveLength(0);
    expect(rsOf(CAMP_B).combatants).toHaveLength(1);
  });

  it('configure_encounter_combatants', async () => {
    const countUnits = (cid) =>
      db.prepare('SELECT COUNT(*) AS n FROM encounter_units WHERE encounter_id = ? AND campaign_id = ?').get(ENC, cid).n;
    await stageAndApprove(
      'configure_encounter_combatants',
      { combatants: [{ name: 'Bandit', coordinates: 'F6', faction: 'enemy' }] },
      CAMP_A
    );
    expect(countUnits(CAMP_A)).toBe(2);
    expect(countUnits(CAMP_B)).toBe(1);
    expect(rsOf(CAMP_A).combatants).toHaveLength(2);
    expect(rsOf(CAMP_B).combatants).toHaveLength(1);
  });

  it('staging with another campaign encounter id is rejected and mutates nothing', async () => {
    db.prepare('INSERT INTO encounters (id, campaign_id, name) VALUES (?, ?, ?)').run('scope-only-b', CAMP_B, 'Only B');
    await expect(
      executeTool('remove_combatant', { combatantId: UNIT, encounterId: 'scope-only-b' }, { campaignId: CAMP_A })
    ).rejects.toThrow(/does not belong to the active campaign/);
    expect(unit(CAMP_A)).toBeTruthy();
    expect(unit(CAMP_B)).toBeTruthy();
  });
});
