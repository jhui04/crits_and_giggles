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
