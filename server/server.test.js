import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from './index.js';
import { db } from './db.js';

describe('Campaign API', () => {
  const testCampaign = {
    id: 'test-api-campaign',
    name: 'API Test Campaign',
    description: 'Testing the API',
    chapters: [{ id: 'ch1', title: 'Chapter 1', content: 'Content', order: 0 }],
    assets: [{ id: 'as1', type: 'NPC', name: 'Test NPC', description: 'Desc' }],
    players: [{ id: 'pl1', name: 'Test Player', description: 'Class' }],
    encounters: [
      {
        id: 'enc1',
        name: 'Test Encounter',
        units: [
          {
            instanceId: 'u1',
            name: 'Monster 1',
            dexMod: 2,
            isPlayer: false,
            currentHp: 10,
            maxHp: 10
          }
        ]
      }
    ]
  };

  it('POST /api/campaigns should create a new campaign', async () => {
    const res = await request(app)
      .post('/api/campaigns')
      .send(testCampaign);
    
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(testCampaign.id);
    expect(res.body.name).toBe(testCampaign.name);
    expect(res.body.chapters).toHaveLength(1);
    expect(res.body.encounters[0].units).toHaveLength(1);
  });

  it('GET /api/campaigns should list campaigns', async () => {
    const res = await request(app).get('/api/campaigns');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some(c => c.id === testCampaign.id)).toBe(true);
  });

  it('GET /api/campaigns/:id should return full campaign', async () => {
    const res = await request(app).get(`/api/campaigns/${testCampaign.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(testCampaign.id);
    expect(res.body.chapters[0].title).toBe('Chapter 1');
  });

  it('PUT /api/campaigns/:id should update campaign and persist encounter runningState', async () => {
    const runningState = {
      isCombatStarted: true,
      round: 2,
      turnIndex: 1,
      combatants: [
        { instanceId: 'u1', name: 'Monster 1', dexMod: 2, isPlayer: false, currentHp: 5, maxHp: 10, initiative: 14 }
      ]
    };
    const updated = {
      ...testCampaign,
      name: 'Updated Name',
      encounters: [
        {
          ...testCampaign.encounters[0],
          runningState
        }
      ]
    };
    const res = await request(app)
      .put(`/api/campaigns/${testCampaign.id}`)
      .send(updated);
    
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Name');
    expect(res.body.encounters[0].runningState).toEqual(runningState);

    const getRes = await request(app).get(`/api/campaigns/${testCampaign.id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.encounters[0].runningState).toEqual(runningState);
  });

  it('DELETE /api/campaigns/:id should delete campaign', async () => {
    const res = await request(app).delete(`/api/campaigns/${testCampaign.id}`);
    expect(res.status).toBe(204);

    const check = await request(app).get(`/api/campaigns/${testCampaign.id}`);
    expect(check.status).toBe(404);
  });
});

describe('World API', () => {
  const testWorld = {
    id: 'test-api-world',
    name: 'API Test World',
    description: 'Testing the World API',
    assets: [
      {
        id: 'wa1',
        type: 'Location',
        name: 'Test Location',
        description: 'A test location',
        tags: ['capital', 'city'],
        connections: []
      },
      {
        id: 'wa2',
        type: 'NPC',
        name: 'Test NPC',
        description: 'A character',
        tags: ['ruler'],
        connections: [
          {
            id: 'conn1',
            targetId: 'wa1',
            relationship: 'rules'
          }
        ]
      }
    ]
  };

  it('POST /api/worlds should create a new world', async () => {
    const res = await request(app)
      .post('/api/worlds')
      .send(testWorld);
    
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(testWorld.id);
    expect(res.body.name).toBe(testWorld.name);
    expect(res.body.assets).toHaveLength(2);
    expect(res.body.assets[1].connections).toHaveLength(1);
    expect(res.body.assets[1].connections[0].relationship).toBe('rules');
  });

  it('GET /api/worlds should list worlds', async () => {
    const res = await request(app).get('/api/worlds');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some(w => w.id === testWorld.id)).toBe(true);
  });

  it('GET /api/worlds/:id should return full world', async () => {
    const res = await request(app).get(`/api/worlds/${testWorld.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(testWorld.id);
    expect(res.body.assets[0].name).toBe('Test Location');
  });

  it('PUT /api/worlds/:id should update world', async () => {
    const updated = {
      ...testWorld,
      name: 'Updated World Name',
      assets: [
        {
          id: 'wa1',
          type: 'Location',
          name: 'Updated Location Name',
          description: 'A test location',
          tags: ['capital', 'city'],
          connections: []
        }
      ]
    };
    const res = await request(app)
      .put(`/api/worlds/${testWorld.id}`)
      .send(updated);
    
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated World Name');
    expect(res.body.assets).toHaveLength(1);
    expect(res.body.assets[0].name).toBe('Updated Location Name');
  });

  it('DELETE /api/worlds/:id should delete world', async () => {
    const res = await request(app).delete(`/api/worlds/${testWorld.id}`);
    expect(res.status).toBe(204);

    const check = await request(app).get(`/api/worlds/${testWorld.id}`);
    expect(check.status).toBe(404);
  });
});

describe('API robustness fixes', () => {
  it('PUT /api/campaigns/:id returns 404 for a nonexistent campaign', async () => {
    const res = await request(app).put('/api/campaigns/does-not-exist').send({ name: 'x', description: 'y' });
    expect(res.status).toBe(404);
  });

  it('PUT /api/worlds/:id returns 404 for a nonexistent world', async () => {
    const res = await request(app).put('/api/worlds/does-not-exist').send({ name: 'x', description: 'y' });
    expect(res.status).toBe(404);
  });

  it('POST /api/campaigns accepts units without dexMod', async () => {
    const res = await request(app).post('/api/campaigns').send({
      id: 'no-dexmod-campaign',
      name: 'n',
      description: 'd',
      encounters: [{ id: 'e-nd', name: 'E', units: [{ instanceId: 'nd-u1', name: 'U', isPlayer: false }] }],
    });
    expect(res.status).toBe(201);
    expect(res.body.encounters[0].units[0].dexMod).toBe(0);
    await request(app).delete('/api/campaigns/no-dexmod-campaign');
  });

  it('DELETE /api/campaigns/:id removes only that campaign vector_chunks', async () => {
    const mk = (id) => request(app).post('/api/campaigns').send({ id, name: id, description: 'd' });
    expect((await mk('vec-del-a')).status).toBe(201);
    expect((await mk('vec-del-b')).status).toBe(201);
    db.prepare("DELETE FROM vector_chunks WHERE id LIKE 'vec-del-%'").run();
    const ins = db.prepare(
      "INSERT INTO vector_chunks (id, source, campaign_id, entity_id, title, content, embedding) VALUES (?, 'lore', ?, ?, 't', 'c', '[]')"
    );
    ins.run('vec-del-a1', 'vec-del-a', 'e1');
    ins.run('vec-del-a2', 'vec-del-a', 'e2');
    ins.run('vec-del-b1', 'vec-del-b', 'e1');

    const res = await request(app).delete('/api/campaigns/vec-del-a');
    expect(res.status).toBe(204);
    const count = (cid) => db.prepare('SELECT COUNT(*) AS n FROM vector_chunks WHERE campaign_id = ?').get(cid).n;
    expect(count('vec-del-a')).toBe(0);
    expect(count('vec-del-b')).toBe(1);

    await request(app).delete('/api/campaigns/vec-del-b');
    expect(count('vec-del-b')).toBe(0);
  });

  it('metrics and search tolerate a non-numeric limit', async () => {
    const m = await request(app).get('/api/assistant/metrics?limit=abc');
    expect(m.status).toBe(200);
    const m2 = await request(app).get('/api/assistant/metrics?limit=-5');
    expect(m2.status).toBe(200);
  });
});
