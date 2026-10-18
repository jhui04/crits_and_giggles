import { describe, it, expect } from 'vitest';
import { parseMultiattack, isMultiattackAction, optionLabel } from './multiattack';
import type { MultiattackActionLike } from './multiattack';

const atk = (name: string, extra: Partial<MultiattackActionLike> = {}): MultiattackActionLike => ({
  name, content: `Melee Weapon Attack: +5 to hit. Hit: 5 (1d6+2) slashing damage.`, is_attack: true, attack_bonus: 5, damage: [{ dice: '1d6+2', type: 'slashing' }], ...extra,
});
const labels = (text: string, actions: MultiattackActionLike[], extra: MultiattackActionLike[] = []) =>
  parseMultiattack(text, actions, extra).options.map(o => o.label);

describe('parseMultiattack', () => {
  const dragon = [atk('Bite'), atk('Claw'), atk('Tail'), { name: 'Frightful Presence', content: 'Each creature within 120 feet must make a Wisdom saving throw.' }];

  it('handles count words and digits with plural/possessive names', () => {
    expect(labels('The dragon makes three attacks: one with its bite and two with its claws.', dragon)).toEqual(['Bite x1, Claw x2']);
    expect(labels('The beast makes 2 claw attacks.', dragon)).toEqual(['Claw x2']);
    expect(labels("The dragon makes one attack with its Bite and two with its Claw.", dragon)).toEqual(['Bite x1, Claw x2']);
  });

  it('lists non-attack segments as no roll and keeps them first', () => {
    const p = parseMultiattack('The dragon can use its Frightful Presence. It then makes three attacks: one with its bite and two with its claws.', dragon);
    expect(p.status).toBe('parsed');
    expect(p.options[0].label).toBe('Frightful Presence (no roll), Bite x1, Claw x2');
    expect(p.options[0].segments[0].kind).toBe('other');
  });

  it('splits "or" alternatives into separate options', () => {
    const labelsOut = labels('The captain makes three melee attacks: two with its scimitar and one with its dagger. Or the captain makes two ranged attacks with its daggers.', [atk('Scimitar'), atk('Dagger'), { name: 'Parry', content: 'x' }]);
    expect(labelsOut).toEqual(['Scimitar x2, Dagger x1', 'Dagger x2']);
  });

  it('expands "in any combination" into mixes', () => {
    const out = labels('The lich makes two attacks using Handaxe or Spear in any combination.', [atk('Handaxe'), atk('Spear')]);
    expect(out).toContain('Handaxe x2');
    expect(out).toContain('Spear x2');
    expect(out).toContain('Handaxe x1, Spear x1');
  });

  it('matches melee/ranged categories through the action text', () => {
    const acts = [
      atk('Slam', { content: 'Melee Weapon Attack: +4 to hit, reach 5 ft.' }),
      atk('Rock', { content: 'Ranged Weapon Attack: +4 to hit, range 60 ft.' }),
    ];
    expect(labels('The golem makes two melee attacks.', acts)).toEqual(['Slam x2']);
    expect(labels('The golem makes two ranged attacks.', acts)).toEqual(['Rock x2']);
  });

  it('puts replacement rules in notes without inventing options', () => {
    const p = parseMultiattack('The turtle makes three attacks: one with its bite and two with its claws. It can make one tail attack in place of its two claw attacks.', dragon);
    expect(p.options.map(o => o.label)).toEqual(['Bite x1, Claw x2']);
    expect(p.notes.join(' ')).toMatch(/tail attack/i);
  });

  it('separates form-specific multiattacks with a condition', () => {
    const p = parseMultiattack('In bear form, the werebear makes two claw attacks. In humanoid form, it makes two greataxe attacks.', [atk('Claw'), atk('Greataxe')]);
    expect(p.options.map(o => [o.condition, o.label])).toEqual([['Bear form', 'Claw x2'], ['Humanoid form', 'Greataxe x2']]);
  });

  it('carries a dice count to run time', () => {
    const p = parseMultiattack('The fungus makes 1d4 Rotting Touch attacks.', [atk('Rotting Touch')]);
    expect(p.options[0].segments[0].countDice).toBe('1d4');
    expect(p.options[0].label).toBe('1d4 Rotting Touch');
  });

  it('reports an all-unmatched multiattack as unparsed, and a mixed one as partial', () => {
    const none = parseMultiattack('The thing makes two attacks with its Warhammer.', [atk('Bite'), atk('Claw'), atk('Tail'), atk('Slam'), atk('Gore'), atk('Horn')]);
    expect(none.status).toBe('unparsed');
    const mixed = parseMultiattack('The thing makes one attack with its bite and one with its Warhammer.', [atk('Bite'), atk('Claw'), atk('Tail'), atk('Slam'), atk('Gore'), atk('Horn')]);
    expect(mixed.status).toBe('partial');
    expect(mixed.unresolved.length).toBeGreaterThan(0);
  });

  it('degrades gracefully on empty, garbage, and non-string input', () => {
    for (const t of ['', '   ', 'asdf qwer zxcv', 'Makes. Attacks! ??? 12345', '\u0000\u0001', '(((((', 'x'.repeat(5000)]) {
      const p = parseMultiattack(t, dragon);
      expect(['parsed', 'partial', 'unparsed']).toContain(p.status);
    }
    expect(parseMultiattack('', dragon).status).toBe('unparsed');
    expect(parseMultiattack(undefined as unknown as string, dragon).status).toBe('unparsed');
    expect(parseMultiattack('makes two claw attacks', null as unknown as MultiattackActionLike[]).status).toBe('unparsed');
  });

  it('recognises Multiattack action names', () => {
    expect(isMultiattackAction({ name: 'Multiattack' })).toBe(true);
    expect(isMultiattackAction({ name: 'Multiattack (Humanoid or Hybrid Form Only)' })).toBe(true);
    expect(isMultiattackAction({ name: 'Bite' })).toBe(false);
  });

  it('treats "A twice, B twice, or one of each" as alternatives, not one sequence', () => {
    const acts = [atk('Branch'), atk('Radiant Pellet')];
    expect(labels('The aartuk makes two Branch attacks, two Radiant Pellet attacks, or one of each.', acts))
      .toEqual(['Branch x2', 'Radiant Pellet x2', 'Branch x1, Radiant Pellet x1']);
    expect(labels('The seer uses Branch twice, Radiant Pellet twice, or each one once.', acts))
      .toEqual(['Branch x2', 'Radiant Pellet x2', 'Branch x1, Radiant Pellet x1']);
  });

  it('expands "or a combination thereof" into alternatives and splits', () => {
    const out = labels('The githyanki makes three Staff attacks, three Telekinetic Bolt attacks, or a combination thereof.', [atk('Staff'), atk('Telekinetic Bolt')]);
    expect(out).toContain('Staff x3');
    expect(out).toContain('Telekinetic Bolt x3');
    expect(out).toContain('Staff x1, Telekinetic Bolt x2');
    expect(out).not.toContain('Staff x3, Telekinetic Bolt x3');
  });

  it('"weapon attacks" only offers weapon attacks', () => {
    const acts = [atk('Greataxe'), atk('Hurl Rock', { content: 'Ranged Weapon Attack: +10 to hit' }), atk('Freezing Stare', { content: 'The zombie targets one creature.' })];
    expect(labels('The zombie makes two weapon attacks.', acts)).toEqual(['Greataxe x2', 'Hurl Rock x2']);
  });

  it('builds labels from segments', () => {
    const p = parseMultiattack('The dragon makes two claw attacks.', dragon);
    expect(optionLabel(p.options[0].segments)).toBe('Claw x2');
  });
});
