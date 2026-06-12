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

  it('PUT /api/campaigns/:id should update campaign', async () => {
    const updated = { ...testCampaign, name: 'Updated Name' };
    const res = await request(app)
      .put(`/api/campaigns/${testCampaign.id}`)
      .send(updated);
    
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Name');
  });

  it('DELETE /api/campaigns/:id should delete campaign', async () => {
    const res = await request(app).delete(`/api/campaigns/${testCampaign.id}`);
    expect(res.status).toBe(204);

    const check = await request(app).get(`/api/campaigns/${testCampaign.id}`);
    expect(check.status).toBe(404);
  });
});
