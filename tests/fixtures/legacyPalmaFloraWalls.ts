// Walls and obstacles hand-coded for Map 5.1 on the OLD 33 x 21 detected grid, copied from
// tools/state/legacy_map_grids.json. Tests seed these directly (with no map image) so they exercise
// wall, cover, and movement behaviour without depending on the compiled production map data.
import type { MapWallsData } from '../../src/types';

export const legacyPalmaFloraWalls: MapWallsData = {
  "edges": [
    {
      "id": "w-16_0-17_0",
      "c1": [
        17,
        0
      ],
      "c2": [
        16,
        0
      ],
      "type": "half",
      "name": "Bridge Railing",
      "blocksVision": false
    },
    {
      "id": "w-17_0-18_0",
      "c1": [
        17,
        0
      ],
      "c2": [
        18,
        0
      ],
      "type": "half",
      "name": "Bridge Railing",
      "blocksVision": false
    },
    {
      "id": "w-16_1-17_1",
      "c1": [
        17,
        1
      ],
      "c2": [
        16,
        1
      ],
      "type": "half",
      "name": "Bridge Railing",
      "blocksVision": false
    },
    {
      "id": "w-17_1-18_1",
      "c1": [
        17,
        1
      ],
      "c2": [
        18,
        1
      ],
      "type": "half",
      "name": "Bridge Railing",
      "blocksVision": false
    },
    {
      "id": "w-16_2-17_2",
      "c1": [
        17,
        2
      ],
      "c2": [
        16,
        2
      ],
      "type": "half",
      "name": "Bridge Railing",
      "blocksVision": false
    },
    {
      "id": "w-17_2-18_2",
      "c1": [
        17,
        2
      ],
      "c2": [
        18,
        2
      ],
      "type": "half",
      "name": "Bridge Railing",
      "blocksVision": false
    },
    {
      "id": "w-21_2-21_3",
      "c1": [
        21,
        3
      ],
      "c2": [
        21,
        2
      ],
      "type": "half",
      "name": "Manor Stone Fence",
      "blocksVision": false
    },
    {
      "id": "w-22_2-22_3",
      "c1": [
        22,
        3
      ],
      "c2": [
        22,
        2
      ],
      "type": "half",
      "name": "Manor Stone Fence",
      "blocksVision": false
    },
    {
      "id": "w-23_2-23_3",
      "c1": [
        23,
        3
      ],
      "c2": [
        23,
        2
      ],
      "type": "half",
      "name": "Manor Stone Fence",
      "blocksVision": false
    },
    {
      "id": "w-23_3-24_3",
      "c1": [
        23,
        3
      ],
      "c2": [
        24,
        3
      ],
      "type": "half",
      "name": "Manor Stone Fence",
      "blocksVision": false
    },
    {
      "id": "w-23_4-24_4",
      "c1": [
        23,
        4
      ],
      "c2": [
        24,
        4
      ],
      "type": "half",
      "name": "Manor Stone Fence",
      "blocksVision": false
    },
    {
      "id": "w-20_6-20_7",
      "c1": [
        20,
        6
      ],
      "c2": [
        20,
        7
      ],
      "type": "half",
      "name": "Manor Stone Fence",
      "blocksVision": false
    },
    {
      "id": "w-21_6-21_7",
      "c1": [
        21,
        6
      ],
      "c2": [
        21,
        7
      ],
      "type": "half",
      "name": "Manor Stone Fence",
      "blocksVision": false
    },
    {
      "id": "w-22_6-22_7",
      "c1": [
        22,
        6
      ],
      "c2": [
        22,
        7
      ],
      "type": "half",
      "name": "Manor Stone Fence",
      "blocksVision": false
    },
    {
      "id": "w-19_3-20_3",
      "c1": [
        20,
        3
      ],
      "c2": [
        19,
        3
      ],
      "type": "half",
      "name": "Manor Stone Fence",
      "blocksVision": false
    },
    {
      "id": "w-19_4-20_4",
      "c1": [
        20,
        4
      ],
      "c2": [
        19,
        4
      ],
      "type": "half",
      "name": "Manor Stone Fence",
      "blocksVision": false
    },
    {
      "id": "w-20_4-20_5",
      "c1": [
        20,
        5
      ],
      "c2": [
        20,
        4
      ],
      "type": "full",
      "name": "Manor House Wall",
      "blocksVision": true
    },
    {
      "id": "w-21_4-21_5",
      "c1": [
        21,
        5
      ],
      "c2": [
        21,
        4
      ],
      "type": "full",
      "name": "Manor House Wall",
      "blocksVision": true
    },
    {
      "id": "w-22_4-22_5",
      "c1": [
        22,
        5
      ],
      "c2": [
        22,
        4
      ],
      "type": "full",
      "name": "Manor House Wall",
      "blocksVision": true
    },
    {
      "id": "w-19_5-20_5",
      "c1": [
        20,
        5
      ],
      "c2": [
        19,
        5
      ],
      "type": "full",
      "name": "Manor House Wall",
      "blocksVision": true
    },
    {
      "id": "w-19_6-20_6",
      "c1": [
        20,
        6
      ],
      "c2": [
        19,
        6
      ],
      "type": "full",
      "name": "Manor House Wall",
      "blocksVision": true
    },
    {
      "id": "w-21_5-22_5",
      "c1": [
        21,
        5
      ],
      "c2": [
        22,
        5
      ],
      "type": "full",
      "name": "Manor House Wall",
      "blocksVision": true
    },
    {
      "id": "w-22_5-23_5",
      "c1": [
        22,
        5
      ],
      "c2": [
        23,
        5
      ],
      "type": "full",
      "name": "Manor House Wall",
      "blocksVision": true
    },
    {
      "id": "w-22_6-23_6",
      "c1": [
        22,
        6
      ],
      "c2": [
        23,
        6
      ],
      "type": "full",
      "name": "Manor House Wall",
      "blocksVision": true
    },
    {
      "id": "w-21_9-21_10",
      "c1": [
        21,
        10
      ],
      "c2": [
        21,
        9
      ],
      "type": "full",
      "name": "Tavern Wall",
      "blocksVision": true
    },
    {
      "id": "w-22_9-22_10",
      "c1": [
        22,
        10
      ],
      "c2": [
        22,
        9
      ],
      "type": "full",
      "name": "Tavern Wall",
      "blocksVision": true
    },
    {
      "id": "w-23_9-23_10",
      "c1": [
        23,
        10
      ],
      "c2": [
        23,
        9
      ],
      "type": "full",
      "name": "Tavern Wall",
      "blocksVision": true
    },
    {
      "id": "w-20_10-21_10",
      "c1": [
        21,
        10
      ],
      "c2": [
        20,
        10
      ],
      "type": "full",
      "name": "Tavern Wall",
      "blocksVision": true
    },
    {
      "id": "w-20_11-21_11",
      "c1": [
        21,
        11
      ],
      "c2": [
        20,
        11
      ],
      "type": "full",
      "name": "Tavern Wall",
      "blocksVision": true
    },
    {
      "id": "w-23_10-24_10",
      "c1": [
        23,
        10
      ],
      "c2": [
        24,
        10
      ],
      "type": "full",
      "name": "Tavern Wall",
      "blocksVision": true
    },
    {
      "id": "w-23_11-24_11",
      "c1": [
        23,
        11
      ],
      "c2": [
        24,
        11
      ],
      "type": "full",
      "name": "Tavern Wall",
      "blocksVision": true
    },
    {
      "id": "w-22_11-22_12",
      "c1": [
        22,
        11
      ],
      "c2": [
        22,
        12
      ],
      "type": "door_open",
      "name": "Tavern Door",
      "blocksVision": false
    },
    {
      "id": "w-7_8-7_9",
      "c1": [
        7,
        9
      ],
      "c2": [
        7,
        8
      ],
      "type": "full",
      "name": "Cottage Wall",
      "blocksVision": true
    },
    {
      "id": "w-8_8-8_9",
      "c1": [
        8,
        9
      ],
      "c2": [
        8,
        8
      ],
      "type": "full",
      "name": "Cottage Wall",
      "blocksVision": true
    },
    {
      "id": "w-6_9-7_9",
      "c1": [
        7,
        9
      ],
      "c2": [
        6,
        9
      ],
      "type": "full",
      "name": "Cottage Wall",
      "blocksVision": true
    },
    {
      "id": "w-8_9-9_9",
      "c1": [
        8,
        9
      ],
      "c2": [
        9,
        9
      ],
      "type": "full",
      "name": "Cottage Wall",
      "blocksVision": true
    },
    {
      "id": "w-7_9-7_10",
      "c1": [
        7,
        9
      ],
      "c2": [
        7,
        10
      ],
      "type": "door_closed",
      "name": "Cottage Door",
      "blocksVision": true
    },
    {
      "id": "w-8_9-8_10",
      "c1": [
        8,
        9
      ],
      "c2": [
        8,
        10
      ],
      "type": "full",
      "name": "Cottage Wall",
      "blocksVision": true
    },
    {
      "id": "w-12_11-12_12",
      "c1": [
        12,
        12
      ],
      "c2": [
        12,
        11
      ],
      "type": "full",
      "name": "Cottage Wall",
      "blocksVision": true
    },
    {
      "id": "w-13_11-13_12",
      "c1": [
        13,
        12
      ],
      "c2": [
        13,
        11
      ],
      "type": "full",
      "name": "Cottage Wall",
      "blocksVision": true
    },
    {
      "id": "w-11_12-12_12",
      "c1": [
        12,
        12
      ],
      "c2": [
        11,
        12
      ],
      "type": "full",
      "name": "Cottage Wall",
      "blocksVision": true
    },
    {
      "id": "w-13_12-14_12",
      "c1": [
        13,
        12
      ],
      "c2": [
        14,
        12
      ],
      "type": "full",
      "name": "Cottage Wall",
      "blocksVision": true
    },
    {
      "id": "w-12_12-12_13",
      "c1": [
        12,
        12
      ],
      "c2": [
        12,
        13
      ],
      "type": "full",
      "name": "Cottage Wall",
      "blocksVision": true
    },
    {
      "id": "w-13_12-13_13",
      "c1": [
        13,
        12
      ],
      "c2": [
        13,
        13
      ],
      "type": "door_closed",
      "name": "Cottage Door",
      "blocksVision": true
    },
    {
      "id": "w-26_11-26_12",
      "c1": [
        26,
        12
      ],
      "c2": [
        26,
        11
      ],
      "type": "half",
      "name": "Ship Bulwark",
      "blocksVision": false
    },
    {
      "id": "w-27_11-27_12",
      "c1": [
        27,
        12
      ],
      "c2": [
        27,
        11
      ],
      "type": "half",
      "name": "Ship Bulwark",
      "blocksVision": false
    },
    {
      "id": "w-28_11-28_12",
      "c1": [
        28,
        12
      ],
      "c2": [
        28,
        11
      ],
      "type": "half",
      "name": "Ship Bulwark",
      "blocksVision": false
    },
    {
      "id": "w-26_13-26_14",
      "c1": [
        26,
        13
      ],
      "c2": [
        26,
        14
      ],
      "type": "half",
      "name": "Ship Bulwark",
      "blocksVision": false
    },
    {
      "id": "w-27_13-27_14",
      "c1": [
        27,
        13
      ],
      "c2": [
        27,
        14
      ],
      "type": "half",
      "name": "Ship Bulwark",
      "blocksVision": false
    },
    {
      "id": "w-28_13-28_14",
      "c1": [
        28,
        13
      ],
      "c2": [
        28,
        14
      ],
      "type": "half",
      "name": "Ship Bulwark",
      "blocksVision": false
    }
  ],
  "obstacleCells": {
    "21,4": {
      "x": 21,
      "y": 4,
      "type": "half",
      "name": "Fountain Basin"
    },
    "17,8": {
      "x": 17,
      "y": 8,
      "type": "three_quarters",
      "name": "Statue of Kord"
    },
    "18,8": {
      "x": 18,
      "y": 8,
      "type": "three_quarters",
      "name": "Statue of Kord"
    },
    "16,6": {
      "x": 16,
      "y": 6,
      "type": "half",
      "name": "Market Stall"
    },
    "17,6": {
      "x": 17,
      "y": 6,
      "type": "half",
      "name": "Market Stall"
    },
    "16,7": {
      "x": 16,
      "y": 7,
      "type": "half",
      "name": "Market Stall"
    },
    "17,7": {
      "x": 17,
      "y": 7,
      "type": "half",
      "name": "Market Stall"
    },
    "21,12": {
      "x": 21,
      "y": 12,
      "type": "half",
      "name": "Tavern Dining Table"
    },
    "22,12": {
      "x": 22,
      "y": 12,
      "type": "half",
      "name": "Tavern Dining Table"
    },
    "20,13": {
      "x": 20,
      "y": 13,
      "type": "half",
      "name": "Tavern Pillar"
    },
    "24,13": {
      "x": 24,
      "y": 13,
      "type": "half",
      "name": "Tavern Pillar"
    }
  }
};
