import { describe, it, expect, vi, afterEach } from 'vitest';
import { executeTool, WRITE_TOOLS_REGISTRY } from './toolController.js';
import { validateAgainstSchema } from './schemaValidator.js';

describe('validateAgainstSchema', () => {
  const schema = {
    type: 'object',
    properties: {
      n: { type: 'integer', minimum: 1 },
      flag: { type: 'boolean' },
      kind: { type: 'string', enum: ['damage', 'healing'] },
      list: { type: 'array', items: { type: 'object', properties: { amount: { type: 'number' } }, required: ['amount'] } },
    },
    required: ['n'],
  };

  it('passes valid args through and keeps unknown properties', () => {
    const r = validateAgainstSchema(schema, { n: 2, extra: 'x' });
    expect(r.valid).toBe(true);
    expect(r.args).toEqual({ n: 2, extra: 'x' });
  });

  it('coerces numeric strings, booleans and enum case', () => {
    const r = validateAgainstSchema(schema, { n: '3', flag: 'true', kind: 'Damage' });
    expect(r.valid).toBe(true);
    expect(r.args).toMatchObject({ n: 3, flag: true, kind: 'damage' });
  });

  it('reports missing, wrong type, enum, and nested errors', () => {
    const r = validateAgainstSchema(schema, { kind: 'poison', list: [{}] });
    expect(r.valid).toBe(false);
    expect(r.errors.join('|')).toContain('"n" is required');
    expect(r.errors.join('|')).toContain('"kind" must be one of');
    expect(r.errors.join('|')).toContain('"list[0].amount" is required');
    expect(validateAgainstSchema(schema, { n: 1.5 }).valid).toBe(false);
  });

  it('treats null optionals as absent', () => {
    const r = validateAgainstSchema(schema, { n: 1, kind: null });
    expect(r.valid).toBe(true);
    expect(r.args.kind).toBeUndefined();
  });
});

describe('executeTool argument validation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('accepts valid args', async () => {
    const r = await executeTool('lookup_spell', { name: 'Fireball' });
    expect(r).toBeTruthy();
  });

  it('accepts valid JSON string args', async () => {
    const r = await executeTool('lookup_spell', JSON.stringify({ name: 'Fireball' }));
    expect(r).toBeTruthy();
  });

  it('rejects wrong type with a clear message', async () => {
    await expect(executeTool('lookup_spell', { name: 42 })).rejects.toThrow(
      'Invalid arguments for tool "lookup_spell": "name" must be a string (got number)'
    );
  });

  it('rejects missing required args', async () => {
    await expect(executeTool('search_assets_and_lore', {})).rejects.toThrow('"query" is required');
  });

  it('rejects enum violations', async () => {
    await expect(executeTool('search_assets_and_lore', { query: 'x', category: 'bogus' })).rejects.toThrow(
      '"category" must be one of'
    );
  });

  it('reports unparseable JSON explicitly', async () => {
    await expect(executeTool('lookup_spell', '{name: Fireball')).rejects.toThrow('not valid JSON');
  });

  it('rejects malformed write-tool args before stageProposal runs', async () => {
    const tool = WRITE_TOOLS_REGISTRY.get('apply_combat_damage');
    const spy = vi.spyOn(tool, 'stageProposal');
    await expect(executeTool('apply_combat_damage', { targets: 'goblin' })).rejects.toThrow(
      '"targets" must be an array (got string)'
    );
    await expect(executeTool('move_combatant', {})).rejects.toThrow('"destination" is required');
    expect(spy).not.toHaveBeenCalled();
  });
});
