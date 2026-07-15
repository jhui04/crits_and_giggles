import fs from 'fs';
import path from 'path';

const monstersData = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public/data/monsters.json'), 'utf-8'));
const mockMonster = monstersData[0];

export const getSeedState = (id: string = 'test-campaign') => ({
  id,
  name: id === 'test-campaign' ? 'Test Campaign' : `Test Campaign ${id}`,
  description: 'Test Description',
  chapters: [
    {
      id: `${id}-chap-1`,
      title: 'Chapter 1',
      content: 'Hello world',
      order: 0
    }
  ],
  assets: [
    {
       id: `${id}-asset-1`,
       type: 'Location',
       name: 'Test Asset',
       description: 'A test location',
       chapterIds: [`${id}-chap-1`]
    }
  ],
  players: [
    {
       id: `${id}-player-1`,
       name: 'Player 1',
       description: 'A test player'
    }
  ],
  encounters: [
    {
      id: `${id}-enc-1`,
      name: 'Test Encounter',
      chapterIds: [`${id}-chap-1`],
      units: [
        {
          instanceId: `${id}-unit-1`,
          monsterId: mockMonster.id,
          name: mockMonster.name,
          maxHp: 10,
          currentHp: 10,
          hpDice: '2d6',
          dexMod: 2,
          initiative: 15,
          passivePerception: 12,
          isPlayer: false
        },
        {
          instanceId: `${id}-player-unit-1`,
          playerId: `${id}-player-1`,
          name: 'Player 1',
          dexMod: 3,
          initiative: 18,
          passivePerception: 15,
          isPlayer: true
        }
      ]
    }
  ]
});

const aartukMonster = monstersData.find((m: any) => m.name === 'Aartuk Starhorror') || monstersData[0];

export const seedState = getSeedState('test-campaign');

export const seedStateSaves = {
  id: 'test-campaign-saves',
  name: 'Test Campaign Saves',
  description: 'Test Description',
  chapters: [
    { id: 'chap-save-1', title: 'Chapter 1', content: 'Save test chapter', order: 0 }
  ],
  assets: [],
  players: [],
  encounters: [
    {
      id: 'test-encounter-saves',
      name: 'Test Encounter',
      chapterIds: ['chap-save-1'],
      units: [
        {
          instanceId: 'unit-save-1',
          monsterId: aartukMonster.id, // Aartuk Starhorror
          name: 'Save Test Monster',
          maxHp: 10,
          currentHp: 10,
          hpDice: '2d6',
          dexMod: 2,
          initiative: 15,
          passivePerception: 12,
          isPlayer: false
        }
      ]
    }
  ]
};
