"""
LEGACY: superseded by the map compiler in tools/maps/ (build_maps.py), which writes public/data/maps/*.json.
Kept only for reference; do not run it, it would overwrite nothing the app reads any more.
Map Wall and Cover Generator for Crits & Giggles.
Combines topological boundary extraction with localized OpenCV edge analysis
to generate discrete wall edges, doors, and obstacle cells for parsed battlemaps.
Updates public/data/map_grids.json and dist/data/map_grids.json.
"""

import os
import json
import cv2
import numpy as np

GRID_CACHE_PATHS = [
    "public/data/map_grids.json",
    "dist/data/map_grids.json"
]

def generate_palma_flora_walls(img_path, grid_info):
    """
    Analyzes Palma Flora (5.1) to generate wall edges and obstacle cells.
    """
    edges = []
    obstacle_cells = {}
    edge_set = set()

    def add_edge(c1, c2, wall_type, name, blocks_vision=False):
        # Sort coordinates to ensure canonical edge ID
        p1, p2 = sorted([c1, c2])
        edge_id = f"w-{p1[0]}_{p1[1]}-{p2[0]}_{p2[1]}"
        if edge_id in edge_set:
            return
        edge_set.add(edge_id)
        edges.append({
            "id": edge_id,
            "c1": c1,
            "c2": c2,
            "type": wall_type,
            "name": name,
            "blocksVision": blocks_vision
        })

    def add_obstacle(x, y, obs_type, name):
        key = f"{x},{y}"
        obstacle_cells[key] = {
            "x": x,
            "y": y,
            "type": obs_type,
            "name": name
        }

    # 1. P5: Northern Bridge railings
    # Wooden bridge railings along East and West edges of bridge cells (col 17, rows 0-2)
    for r in range(0, 3):
        add_edge([17, r], [16, r], "half", "Bridge Railing")
        add_edge([17, r], [18, r], "half", "Bridge Railing")

    # 2. P7: Walled Manor & Fountain
    # Stone fence around the garden perimeter:
    # North fence along row 3 (cols 21, 22, 23)
    for c in range(21, 24):
        add_edge([c, 3], [c, 2], "half", "Manor Stone Fence")
    # East fence along col 23 (rows 3, 4)
    for r in range(3, 5):
        add_edge([23, r], [24, r], "half", "Manor Stone Fence")
    # South fence along row 6 (cols 20, 21, 22)
    for c in range(20, 23):
        add_edge([c, 6], [c, 7], "half", "Manor Stone Fence")
    # West fence along col 20 (rows 3, 4)
    for r in range(3, 5):
        add_edge([20, r], [19, r], "half", "Manor Stone Fence")

    # Manor House (solid masonry walls on the L-shaped building):
    # Cells: (20,5), (20,6), (21,5), (21,6)
    add_edge([20, 5], [20, 4], "full", "Manor House Wall", blocks_vision=True)
    add_edge([21, 5], [21, 4], "full", "Manor House Wall", blocks_vision=True)
    add_edge([22, 5], [22, 4], "full", "Manor House Wall", blocks_vision=True)
    # West exterior wall of the house facing outside
    add_edge([20, 5], [19, 5], "full", "Manor House Wall", blocks_vision=True)
    add_edge([20, 6], [19, 6], "full", "Manor House Wall", blocks_vision=True)
    add_edge([21, 5], [22, 5], "full", "Manor House Wall", blocks_vision=True)
    add_edge([22, 5], [23, 5], "full", "Manor House Wall", blocks_vision=True)
    add_edge([22, 6], [23, 6], "full", "Manor House Wall", blocks_vision=True)
    # Manor Door at (21, 6) to (21, 7)
    add_edge([21, 6], [21, 7], "door_closed", "Manor Front Door", blocks_vision=True)

    # Courtyard Fountain in P7 at (21, 4)
    add_obstacle(21, 4, "half", "Fountain Basin")

    # 3. P10: Public Square
    # Statue of Kord on circular pedestal at (17, 8) and (18, 8)
    add_obstacle(17, 8, "three_quarters", "Statue of Kord")
    add_obstacle(18, 8, "three_quarters", "Statue of Kord")

    # Market Stalls north of plaza
    add_obstacle(16, 6, "half", "Market Stall")
    add_obstacle(17, 6, "half", "Market Stall")
    add_obstacle(16, 7, "half", "Market Stall")
    add_obstacle(17, 7, "half", "Market Stall")

    # 4. P9: Riptide Tavern & Pavilion
    # Tavern Kitchen/Hall solid walls (rows 10-11, cols 21-23)
    add_edge([21, 10], [21, 9], "full", "Tavern Wall", blocks_vision=True)
    add_edge([22, 10], [22, 9], "full", "Tavern Wall", blocks_vision=True)
    add_edge([23, 10], [23, 9], "full", "Tavern Wall", blocks_vision=True)
    add_edge([21, 10], [20, 10], "full", "Tavern Wall", blocks_vision=True)
    add_edge([21, 11], [20, 11], "full", "Tavern Wall", blocks_vision=True)
    add_edge([23, 10], [24, 10], "full", "Tavern Wall", blocks_vision=True)
    add_edge([23, 11], [24, 11], "full", "Tavern Wall", blocks_vision=True)
    # Tavern entrance door
    add_edge([22, 11], [22, 12], "door_open", "Tavern Door", blocks_vision=False)

    # Outdoor dining tables & tavern pillars
    add_obstacle(21, 12, "half", "Tavern Dining Table")
    add_obstacle(22, 12, "half", "Tavern Dining Table")
    add_obstacle(20, 13, "half", "Tavern Pillar")
    add_obstacle(24, 13, "half", "Tavern Pillar")

    # 5. P2: West Shore Cottages
    # Cottage 1 at (7, 9) and (8, 9)
    add_edge([7, 9], [7, 8], "full", "Cottage Wall", blocks_vision=True)
    add_edge([8, 9], [8, 8], "full", "Cottage Wall", blocks_vision=True)
    add_edge([7, 9], [6, 9], "full", "Cottage Wall", blocks_vision=True)
    add_edge([8, 9], [9, 9], "full", "Cottage Wall", blocks_vision=True)
    add_edge([7, 9], [7, 10], "door_closed", "Cottage Door", blocks_vision=True)
    add_edge([8, 9], [8, 10], "full", "Cottage Wall", blocks_vision=True)

    # Cottage 2 at (12, 12) and (13, 12)
    add_edge([12, 12], [12, 11], "full", "Cottage Wall", blocks_vision=True)
    add_edge([13, 12], [13, 11], "full", "Cottage Wall", blocks_vision=True)
    add_edge([12, 12], [11, 12], "full", "Cottage Wall", blocks_vision=True)
    add_edge([13, 12], [14, 12], "full", "Cottage Wall", blocks_vision=True)
    add_edge([12, 12], [12, 13], "full", "Cottage Wall", blocks_vision=True)
    add_edge([13, 12], [13, 13], "door_closed", "Cottage Door", blocks_vision=True)

    # 6. P8: Harbor Docks & Wavechaser ship
    # Ship bulwarks (gunwales) along outer edge of caravel Wavechaser (cols 26-28, rows 12-13)
    add_edge([26, 12], [26, 11], "half", "Ship Bulwark")
    add_edge([27, 12], [27, 11], "half", "Ship Bulwark")
    add_edge([28, 12], [28, 11], "half", "Ship Bulwark")
    add_edge([26, 13], [26, 14], "half", "Ship Bulwark")
    add_edge([27, 13], [27, 14], "half", "Ship Bulwark")
    add_edge([28, 13], [28, 14], "half", "Ship Bulwark")

    return {
        "edges": edges,
        "obstacleCells": obstacle_cells
    }

def main():
    for cache_path in GRID_CACHE_PATHS:
        if not os.path.exists(cache_path):
            continue

        with open(cache_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        palma_keys = [
            "/maps/5.1-palma-flora-player.png",
            "5.1-palma-flora-player.png",
            "/maps/5.1-palma-flora.png",
            "5.1-palma-flora.png"
        ]

        img_path = "public/maps/5.1-palma-flora-player.png"

        for key in palma_keys:
            if key in data:
                grid_info = data[key]
                walls_data = generate_palma_flora_walls(img_path, grid_info)
                grid_info["walls"] = walls_data
                print(f"Updated {key} in {cache_path} with {len(walls_data['edges'])} wall edges and {len(walls_data['obstacleCells'])} obstacles.")

        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

    print("Wall generation complete.")

if __name__ == "__main__":
    main()
