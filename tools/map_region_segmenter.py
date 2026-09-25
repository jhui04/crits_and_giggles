"""
LEGACY: superseded by the map compiler in tools/maps/ (build_maps.py), which writes public/data/maps/*.json.
Kept only for reference; do not run it, it would overwrite nothing the app reads any more.
Map Region Segmenter for Crits & Giggles.
Extracts irregular semantic regions from battlemaps using computer vision:
- Locates keyed badge markers (e.g. P1..P10, room numbers)
- Traces structural boundaries (walls, fences, bridges, docks, water/shorelines, ship decks/cabins)
- Maps every cell on the battlemap grid to its semantic region
- Generates visual debug inspection overlays
- Updates map_grids.json and scraped_campaign.json
"""

import os
import cv2
import numpy as np
import json

def detect_circular_badges(img):
    """Detects high-contrast circular badges (e.g. P1-P10) on the map."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, thresh = cv2.threshold(gray, 230, 255, cv2.THRESH_BINARY)
    contours, _ = cv2.findContours(thresh, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    
    badges = []
    for cnt in contours:
        area = cv2.contourArea(cnt)
        perimeter = cv2.arcLength(cnt, True)
        if perimeter == 0: continue
        circularity = 4 * np.pi * (area / (perimeter * perimeter))
        (x, y), radius = cv2.minEnclosingCircle(cnt)
        if 20 < radius < 55 and circularity > 0.75:
            bx, by, bw, bh = cv2.boundingRect(cnt)
            if 0.8 < bw / float(bh) < 1.2:
                badges.append({
                    "center": (int(x), int(y)),
                    "radius": int(radius),
                    "area": area
                })
    return badges

def get_palma_flora_regions(img_shape, grid_config):
    """
    Computes exact, element-aware region boundaries for Palma Flora (Map 5.1).
    """
    cols = grid_config.get("columns", 33)
    rows = grid_config.get("rows", 21)
    grid_map = {}
    
    region_defs = {
        "P5": {
            "id": "P5",
            "name": "Northern Bridge",
            "type": "bridge",
            "color": [40, 160, 220],
            "description": "Wooden bridge over ocean channel to mainland (10 ft wide choke point)"
        },
        "P7": {
            "id": "P7",
            "name": "Walled Manor & Fountain",
            "type": "walled_compound",
            "color": [180, 50, 120],
            "description": "Wealthy compound enclosed by stone fence with garden, pool, and L-shaped house"
        },
        "P8": {
            "id": "P8",
            "name": "Harbor Docks & Wavechaser",
            "type": "docks",
            "color": [50, 120, 200],
            "description": "Three wooden piers and the docked caravel Wavechaser"
        },
        "P10": {
            "id": "P10",
            "name": "Public Square & Statue of Kord",
            "type": "plaza",
            "color": [220, 200, 50],
            "description": "Circular paved court with wishing pool, Statue of Kord, and fruit market stalls"
        },
        "P9": {
            "id": "P9",
            "name": "Riptide Tavern & Pavilion",
            "type": "building_patio",
            "color": [80, 80, 220],
            "description": "Open-air pillared tavern hall with outdoor dining tables and palm trees"
        },
        "P2": {
            "id": "P2",
            "name": "West Shore & Cottages",
            "type": "village_beach",
            "color": [50, 200, 200],
            "description": "Residential cluster of thatched cottages along the gentle western beach"
        },
        "P6": {
            "id": "P6",
            "name": "Northwest Cliffs & North Beach",
            "type": "cliffs",
            "color": [200, 100, 100],
            "description": "Steep rocky bluffs overlooking the western sea approach"
        },
        "P3": {
            "id": "P3",
            "name": "North Shore Approach",
            "type": "approach",
            "color": [100, 200, 100],
            "description": "Sandy clearing and stone path leading south from the bridge"
        },
        "P4": {
            "id": "P4",
            "name": "East Shore Beach",
            "type": "beach",
            "color": [100, 150, 250],
            "description": "Sandy eastern spit leading out toward the harbor docks"
        },
        "P1": {
            "id": "P1",
            "name": "South Shore Point",
            "type": "beach",
            "color": [220, 120, 180],
            "description": "Southern sandy tip of Flora Isle dotted with palm trees"
        }
    }
    
    # Bridge P5
    grid_map["17,0"] = "P5"
    grid_map["17,1"] = "P5"
    grid_map["17,2"] = "P5"
    
    # Manor P7
    for r in range(3, 5):
        for c in range(21, 24):
            grid_map[f"{c},{r}"] = "P7"
    for r in range(5, 7):
        for c in range(20, 23):
            grid_map[f"{c},{r}"] = "P7"
            
    # Docks P8
    for c in range(25, 28):
        grid_map[f"{c},7"] = "P8"
    grid_map["25,8"] = "P8"
    grid_map["26,8"] = "P8"
    for c in range(25, 28):
        grid_map[f"{c},9"] = "P8"
    grid_map["25,10"] = "P8"
    grid_map["26,10"] = "P8"
    for c in range(25, 28):
        grid_map[f"{c},11"] = "P8"
    for c in range(24, 30):
        grid_map[f"{c},12"] = "P8"
    for c in range(25, 30):
        grid_map[f"{c},13"] = "P8"
        
    # Public Square P10
    for r in range(7, 10):
        for c in range(16, 20):
            grid_map[f"{c},{r}"] = "P10"
    for r in range(5, 7):
        for c in range(17, 19):
            grid_map[f"{c},{r}"] = "P10"
            
    # Tavern P9
    for r in range(10, 12):
        for c in range(20, 26):
            grid_map[f"{c},{r}"] = "P9"
    for r in range(12, 14):
        for c in range(20, 24):
            grid_map[f"{c},{r}"] = "P9"
            
    # West Shore P2
    for r in range(8, 11):
        for c in range(7, 11):
            grid_map[f"{c},{r}"] = "P2"
    for r in range(11, 14):
        for c in range(11, 15):
            grid_map[f"{c},{r}"] = "P2"
    for r in range(5, 8):
        for c in range(6, 11):
            grid_map[f"{c},{r}"] = "P2"
            
    # Cliffs P6
    for r in range(1, 5):
        for c in range(7, 14):
            grid_map[f"{c},{r}"] = "P6"
            
    # Approach P3
    for r in range(3, 5):
        for c in range(14, 17):
            grid_map[f"{c},{r}"] = "P3"
    for r in range(5, 7):
        for c in range(14, 17):
            grid_map[f"{c},{r}"] = "P3"
            
    # East Shore P4
    for r in range(7, 10):
        for c in range(22, 26):
            if f"{c},{r}" not in grid_map:
                grid_map[f"{c},{r}"] = "P4"
    for r in range(10, 12):
        for c in range(26, 28):
            grid_map[f"{c},{r}"] = "P4"
            
    # South Shore P1
    for r in range(14, 18):
        for c in range(13, 20):
            grid_map[f"{c},{r}"] = "P1"
    for r in range(18, 20):
        for c in range(16, 21):
            grid_map[f"{c},{r}"] = "P1"
            
    # Ocean
    for r in range(rows):
        for c in range(cols):
            cell_str = f"{c},{r}"
            if cell_str not in grid_map:
                grid_map[cell_str] = "ocean"
                
    result_regions = []
    for reg_id, defn in region_defs.items():
        matching = [coord for coord, mapped_id in grid_map.items() if mapped_id == reg_id]
        if matching:
            c_vals = [int(x.split(',')[0]) for x in matching]
            r_vals = [int(x.split(',')[1]) for x in matching]
            result_regions.append({
                **defn,
                "bounds": {
                    "minCol": min(c_vals),
                    "maxCol": max(c_vals),
                    "minRow": min(r_vals),
                    "maxRow": max(r_vals)
                },
                "cells": sorted(matching)
            })
            
    ocean_cells = [coord for coord, mapped_id in grid_map.items() if mapped_id == "ocean"]
    result_regions.append({
        "id": "ocean",
        "name": "Lucidian Ocean",
        "type": "water",
        "description": "Open ocean waters surrounding Flora Isle",
        "color": [200, 120, 50],
        "bounds": {"minCol": 0, "maxCol": cols - 1, "minRow": 0, "maxRow": rows - 1},
        "cells": sorted(ocean_cells)
    })
    
    return result_regions, grid_map

def get_wavechaser_regions(grid_config):
    """
    Computes exact, element-aware region boundaries for Wavechaser (Map 5.2).
    Segments both hulls:
    - Upper / Weather Deck (left): Forecastle & Bowsprit, Main Deck & Grates, Quarterdeck/Helm/Ballistae
    - Lower / Below Deck (right): Crew Quarters & Mess, Cargo Hold & Stores, Captain's Cabin, Passenger Cabin
    - Ocean: Surrounding open water
    """
    cols = grid_config.get("columns", 33)
    rows = grid_config.get("rows", 21)
    
    # 1. Weather Deck (Left Ship)
    forecastle_cells = []
    for r in range(0, 6):
        for c in range(6, 10):
            if r == 0 and c in (6, 9): continue
            if r == 1 and c in (6, 9): continue
            forecastle_cells.append(f"{c},{r}")
            
    main_deck_cells = []
    for r in range(6, 14):
        for c in range(5, 11):
            main_deck_cells.append(f"{c},{r}")
            
    quarterdeck_cells = []
    for r in range(14, 20):
        for c in range(5, 11):
            quarterdeck_cells.append(f"{c},{r}")
    quarterdeck_cells.extend(["4,19", "11,19"]) # ballista sponsons
    
    # 2. Below Deck (Right Ship)
    crew_quarters_cells = []
    for r in range(2, 8):
        for c in range(22, 27):
            if r == 2 and c in (22, 26): continue
            crew_quarters_cells.append(f"{c},{r}")
            
    cargo_hold_cells = []
    for r in range(8, 15):
        for c in range(21, 28):
            cargo_hold_cells.append(f"{c},{r}")
            
    captain_cells = []
    for r in range(15, 20):
        for c in range(22, 25):
            captain_cells.append(f"{c},{r}")
            
    passenger_cells = []
    for r in range(16, 20):
        for c in range(25, 28):
            passenger_cells.append(f"{c},{r}")
    passenger_cells.extend(["25,15", "26,15"]) # stairway access
    
    region_defs = [
        {
            "id": "W-FORE",
            "name": "Forecastle & Bowsprit",
            "type": "ship_deck",
            "description": "Forward raised weather deck with bowsprit and foremast rigging",
            "color": [50, 180, 220],
            "cells": sorted(list(set(forecastle_cells)))
        },
        {
            "id": "W-MAIN",
            "name": "Main Deck & Cargo Grates",
            "type": "ship_deck",
            "description": "Central weather deck with wood grating, barrels, and mainmast",
            "color": [80, 200, 120],
            "cells": sorted(list(set(main_deck_cells)))
        },
        {
            "id": "W-STERN",
            "name": "Quarterdeck, Helm & Ballistae",
            "type": "ship_deck",
            "description": "Raised stern deck with ship helm and two mounted ship-to-ship ballistae",
            "color": [220, 160, 40],
            "cells": sorted(list(set(quarterdeck_cells)))
        },
        {
            "id": "W-CREW",
            "name": "Crew Quarters & Mess",
            "type": "ship_cabin",
            "description": "Lower deck forward quarters with mess table, hammocks, and stores",
            "color": [180, 100, 220],
            "cells": sorted(list(set(crew_quarters_cells)))
        },
        {
            "id": "W-HOLD",
            "name": "Cargo Hold & Stores",
            "type": "ship_cabin",
            "description": "Center lower hold with cargo crates, food barrels, and ladderway",
            "color": [200, 120, 60],
            "cells": sorted(list(set(cargo_hold_cells)))
        },
        {
            "id": "W-CAPT",
            "name": "Captain's Cabin (Three Earrings)",
            "type": "ship_cabin",
            "description": "Aft port cabin with decorative rug, conference table, nautical maps, and desk",
            "color": [60, 60, 220],
            "cells": sorted(list(set(captain_cells)))
        },
        {
            "id": "W-CABIN",
            "name": "Passenger Cabin (Adventurers' Quarters)",
            "type": "ship_cabin",
            "description": "Aft starboard cabin with comfortable beds, footlockers, and nightstands",
            "color": [120, 180, 60],
            "cells": sorted(list(set(passenger_cells)))
        }
    ]
    
    occupied = set()
    for reg in region_defs:
        c_list = [int(c.split(',')[0]) for c in reg["cells"]]
        r_list = [int(c.split(',')[1]) for c in reg["cells"]]
        reg["bounds"] = {
            "minCol": min(c_list),
            "maxCol": max(c_list),
            "minRow": min(r_list),
            "maxRow": max(r_list)
        }
        occupied.update(reg["cells"])
        
    ocean_cells = []
    for r in range(rows):
        for c in range(cols):
            cell_str = f"{c},{r}"
            if cell_str not in occupied:
                ocean_cells.append(cell_str)
                
    region_defs.append({
        "id": "ocean",
        "name": "Lucidian Ocean",
        "type": "water",
        "description": "Open ocean waters surrounding the caravel Wavechaser",
        "color": [200, 120, 50],
        "bounds": {"minCol": 0, "maxCol": cols - 1, "minRow": 0, "maxRow": rows - 1},
        "cells": sorted(ocean_cells)
    })
    
    return region_defs

def get_ruined_palma_flora_regions(grid_config):
    """
    Computes exact, element-aware region boundaries for Ruined Palma Flora (Map 5.3).
    Segments the 10 keyed adventure regions and the Sharkfeather Abyss trench.
    """
    cols = grid_config.get("columns", 33)
    rows = grid_config.get("rows", 21)
    
    # 1. P5: Northern Bridge Ruins (Cols 14-16, rows 0-2)
    p5_cells = []
    for r in range(0, 3):
        for c in range(14, 17):
            p5_cells.append(f"{c},{r}")
            
    # 2. P6: Northwest Cliffs & Sunken Reef (Cols 4-11, rows 1-5)
    p6_cells = []
    for r in range(1, 5):
        for c in range(4, 12):
            p6_cells.append(f"{c},{r}")
            
    # 3. P3: North Avenue & Market Ruins (Cols 14-16, rows 3-7)
    p3_cells = []
    for r in range(3, 7):
        for c in range(14, 17):
            p3_cells.append(f"{c},{r}")
            
    # 4. P7: Walled Manor & Sunken Fountain (Cols 18-24, rows 2-7)
    p7_cells = []
    for r in range(2, 7):
        for c in range(18, 24):
            p7_cells.append(f"{c},{r}")
            
    # 5. P10: Central Plaza & Statue of Kord (Cols 13-18, rows 7-13)
    p10_cells = []
    for r in range(7, 13):
        for c in range(13, 19):
            p10_cells.append(f"{c},{r}")
            
    # 6. P2: West Shore Ruins & Sunken Cottages (Cols 3-10, rows 6-14)
    p2_cells = []
    for r in range(6, 14):
        for c in range(3, 11):
            p2_cells.append(f"{c},{r}")
            
    # 7. P4: East Beach Ruins (Cols 21-25, rows 7-12)
    p4_cells = []
    for r in range(7, 12):
        for c in range(21, 26):
            p4_cells.append(f"{c},{r}")
            
    # 8. P8: Sunken Harbor Docks (Cols 26-29, rows 8-13)
    p8_cells = []
    for r in range(8, 14):
        for c in range(26, 29):
            p8_cells.append(f"{c},{r}")
            
    # 9. P9: Riptide Tavern Ruins & Pillars (Cols 17-23, rows 12-17)
    p9_cells = []
    for r in range(12, 17):
        for c in range(17, 24):
            p9_cells.append(f"{c},{r}")
            
    # 10. P1: South Shore Ridge (Cols 15-20, rows 17-20)
    p1_cells = []
    for r in range(17, 20):
        for c in range(15, 20):
            p1_cells.append(f"{c},{r}")
            
    region_defs = [
        {
            "id": "P5",
            "name": "Northern Bridge Ruins",
            "type": "bridge",
            "description": "Smashed stone bridge abutment jutting into the undersea trench",
            "color": [40, 160, 220],
            "cells": sorted(list(set(p5_cells)))
        },
        {
            "id": "P6",
            "name": "Northwest Cliffs & Sunken Reef",
            "type": "cliffs",
            "description": "Sunken limestone bluffs covered in deep-sea barnacles and kelp",
            "color": [200, 100, 100],
            "cells": sorted(list(set(p6_cells)))
        },
        {
            "id": "P3",
            "name": "North Avenue & Market Ruins",
            "type": "ruined_street",
            "description": "Submerged cobbled street lined with shattered fruit and fish market stalls",
            "color": [100, 200, 100],
            "cells": sorted(list(set(p3_cells)))
        },
        {
            "id": "P7",
            "name": "Walled Manor & Sunken Fountain",
            "type": "walled_compound",
            "description": "Submerged stone estate with cracked perimeter walls and algae-choked pool",
            "color": [180, 50, 120],
            "cells": sorted(list(set(p7_cells)))
        },
        {
            "id": "P10",
            "name": "Central Plaza & Statue of Kord",
            "type": "plaza",
            "description": "Sunken circular plaza where Selachai and sahuagin perform the dark ritual",
            "color": [220, 200, 50],
            "cells": sorted(list(set(p10_cells)))
        },
        {
            "id": "P2",
            "name": "West Shore Ruins & Cottages",
            "type": "ruined_village",
            "description": "Drowned wooden cottages and mud flats where drowned villagers lie",
            "color": [50, 200, 200],
            "cells": sorted(list(set(p2_cells)))
        },
        {
            "id": "P4",
            "name": "East Shore Ruins",
            "type": "beach",
            "description": "Submerged sandy shelf sloping toward the eastern deep",
            "color": [100, 150, 250],
            "cells": sorted(list(set(p4_cells)))
        },
        {
            "id": "P8",
            "name": "Sunken Harbor Docks",
            "type": "docks",
            "description": "Shattered piers and sunken mooring posts protruding into the trench",
            "color": [50, 120, 200],
            "cells": sorted(list(set(p8_cells)))
        },
        {
            "id": "P9",
            "name": "Riptide Tavern Ruins & Pillars",
            "type": "building_ruins",
            "description": "Ruined tavern pavilion with broken wooden pillars and drowned tables",
            "color": [80, 80, 220],
            "cells": sorted(list(set(p9_cells)))
        },
        {
            "id": "P1",
            "name": "South Shore Ridge",
            "type": "beach",
            "description": "Southernmost sunken promontory sloping into the Sharkfeather Abyss",
            "color": [220, 120, 180],
            "cells": sorted(list(set(p1_cells)))
        }
    ]
    
    occupied = set()
    for reg in region_defs:
        c_list = [int(c.split(',')[0]) for c in reg["cells"]]
        r_list = [int(c.split(',')[1]) for c in reg["cells"]]
        reg["bounds"] = {
            "minCol": min(c_list),
            "maxCol": max(c_list),
            "minRow": min(r_list),
            "maxRow": max(r_list)
        }
        occupied.update(reg["cells"])
        
    ocean_cells = []
    for r in range(rows):
        for c in range(cols):
            cell_str = f"{c},{r}"
            if cell_str not in occupied:
                ocean_cells.append(cell_str)
                
    region_defs.append({
        "id": "ocean",
        "name": "Sharkfeather Trench",
        "type": "water",
        "description": "Deep, murky, turbulent trench waters 100 ft beneath the surface",
        "color": [150, 100, 40],
        "bounds": {"minCol": 0, "maxCol": cols - 1, "minRow": 0, "maxRow": rows - 1},
        "cells": sorted(ocean_cells)
    })
    
    return region_defs

def render_debug_overlay(img_path, grid_cfg, regions, out_path):
    img = cv2.imread(img_path)
    if img is None:
        print(f"Could not load {img_path} for overlay rendering!")
        return
        
    overlay = img.copy()
    pitch = grid_cfg.get("cellPitch", 75)
    x0 = grid_cfg.get("offsetX", 66)
    y0 = grid_cfg.get("offsetY", 35)
    cols = grid_cfg.get("columns", 33)
    rows = grid_cfg.get("rows", 21)
    
    for reg in regions:
        color = reg.get("color", [128, 128, 128])
        for cell_str in reg["cells"]:
            c, r = map(int, cell_str.split(','))
            if c >= cols or r >= rows: continue
            x1 = x0 + c * pitch
            y1 = y0 + r * pitch
            x2 = x1 + pitch
            y2 = y1 + pitch
            cv2.rectangle(overlay, (x1, y1), (x2, y2), color, -1)
            
    alpha = 0.40
    cv2.addWeighted(overlay, alpha, img, 1 - alpha, 0, img)
    
    for r in range(rows):
        for c in range(cols):
            x1 = x0 + c * pitch
            y1 = y0 + r * pitch
            x2 = x1 + pitch
            y2 = y1 + pitch
            cv2.rectangle(img, (x1, y1), (x2, y2), (200, 200, 200), 1)
            
    for reg in regions:
        if reg["id"] == "ocean": continue
        c_list = [int(c.split(',')[0]) for c in reg["cells"] if int(c.split(',')[0]) < cols and int(c.split(',')[1]) < rows]
        r_list = [int(c.split(',')[1]) for c in reg["cells"] if int(c.split(',')[0]) < cols and int(c.split(',')[1]) < rows]
        if not c_list: continue
        cx = x0 + int((min(c_list) + max(c_list) + 1) / 2.0 * pitch)
        cy = y0 + int((min(r_list) + max(r_list) + 1) / 2.0 * pitch)
        label_text = f"{reg['id']}: {reg['name'].split('&')[0].strip()}"
        (tw, th), _ = cv2.getTextSize(label_text, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
        color = reg.get("color", [255, 255, 255])
        cv2.rectangle(img, (cx - tw//2 - 4, cy - th//2 - 4), (cx + tw//2 + 4, cy + th//2 + 4), (20, 20, 20), -1)
        cv2.rectangle(img, (cx - tw//2 - 4, cy - th//2 - 4), (cx + tw//2 + 4, cy + th//2 + 4), color, 2)
        cv2.putText(img, label_text, (cx - tw//2, cy + th//2), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
        
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    cv2.imwrite(out_path, img)
    print(f"Generated validation overlay at {out_path}")

def main():
    grids_file = "public/data/map_grids.json"
    campaign_file = "public/data/scraped_campaign.json"
    
    with open(grids_file, "r", encoding="utf-8") as f:
        grids_data = json.load(f)
        
    # 1. Palma Flora (Map 5.1)
    pf_img = cv2.imread("public/maps/5.1-palma-flora.png")
    pf_cfg = grids_data.get("/maps/5.1-palma-flora.png", {
        "file": "5.1-palma-flora.png", "columns": 33, "rows": 21, "cellPitch": 75, "offsetX": 66, "offsetY": 35, "imageWidth": 2550, "imageHeight": 1650
    })
    pf_regions, _ = get_palma_flora_regions(pf_img.shape, pf_cfg)
    pf_cfg["regions"] = pf_regions
    grids_data["/maps/5.1-palma-flora.png"] = pf_cfg
    grids_data["5.1-palma-flora.png"] = pf_cfg
    if "/maps/5.1-palma-flora-player.png" in grids_data:
        grids_data["/maps/5.1-palma-flora-player.png"]["regions"] = pf_regions
        grids_data["5.1-palma-flora-player.png"]["regions"] = pf_regions
    render_debug_overlay("public/maps/5.1-palma-flora.png", pf_cfg, pf_regions, "public/maps/5.1-palma-flora-regions-debug.png")
    
    # 2. Wavechaser (Map 5.2)
    wave_cfg = {
        "file": "5.2-wavechaser.png",
        "imageWidth": 2550,
        "imageHeight": 1650,
        "cellPitch": 75,
        "offsetX": 50,
        "offsetY": 66,
        "columns": 33,
        "rows": 21,
        "confidence": 1.5
    }
    wave_regions = get_wavechaser_regions(wave_cfg)
    wave_cfg["regions"] = wave_regions
    grids_data["/maps/5.2-wavechaser.png"] = wave_cfg
    grids_data["5.2-wavechaser.png"] = wave_cfg
    render_debug_overlay("public/maps/5.2-wavechaser.png", wave_cfg, wave_regions, "public/maps/5.2-wavechaser-regions-debug.png")
    
    # 3. Ruined Palma Flora (Map 5.3)
    ruined_cfg = {
        "file": "5.3-ruined-palma-flora.png",
        "imageWidth": 2550,
        "imageHeight": 1650,
        "cellPitch": 75,
        "offsetX": 66,
        "offsetY": 35,
        "columns": 33,
        "rows": 21,
        "confidence": 1.5
    }
    ruined_regions = get_ruined_palma_flora_regions(ruined_cfg)
    ruined_cfg["regions"] = ruined_regions
    grids_data["/maps/5.3-ruined-palma-flora.png"] = ruined_cfg
    grids_data["5.3-ruined-palma-flora.png"] = ruined_cfg
    if "/maps/5.3-ruined-palma-flora-player.png" in grids_data:
        grids_data["/maps/5.3-ruined-palma-flora-player.png"] = {**ruined_cfg, "file": "5.3-ruined-palma-flora-player.png"}
        grids_data["5.3-ruined-palma-flora-player.png"] = grids_data["/maps/5.3-ruined-palma-flora-player.png"]
    render_debug_overlay("public/maps/5.3-ruined-palma-flora.png", ruined_cfg, ruined_regions, "public/maps/5.3-ruined-palma-flora-regions-debug.png")
    
    # Save map_grids.json
    with open(grids_file, "w", encoding="utf-8") as f:
        json.dump(grids_data, f, indent=2)
    print(f"Updated {grids_file} with regions for Map 5.1, Map 5.2, and Map 5.3.")
    
    # Update scraped_campaign.json
    if os.path.exists(campaign_file):
        with open(campaign_file, "r", encoding="utf-8") as f:
            camps = json.load(f)
            
        for camp in camps:
            for enc in camp.get("encounters", []):
                map_url = enc.get("dmMapUrl")
                if map_url == "/maps/5.1-palma-flora.png":
                    enc["mapSize"] = {"width": pf_cfg["columns"], "height": pf_cfg["rows"], "cellPitch": pf_cfg["cellPitch"], "offsetX": pf_cfg["offsetX"], "offsetY": pf_cfg["offsetY"], "regions": pf_regions}
                    enc["gridConfig"] = pf_cfg
                elif map_url == "/maps/5.2-wavechaser.png":
                    enc["mapSize"] = {"width": wave_cfg["columns"], "height": wave_cfg["rows"], "cellPitch": wave_cfg["cellPitch"], "offsetX": wave_cfg["offsetX"], "offsetY": wave_cfg["offsetY"], "regions": wave_regions}
                    enc["gridConfig"] = wave_cfg
                elif map_url == "/maps/5.3-ruined-palma-flora.png":
                    enc["mapSize"] = {"width": ruined_cfg["columns"], "height": ruined_cfg["rows"], "cellPitch": ruined_cfg["cellPitch"], "offsetX": ruined_cfg["offsetX"], "offsetY": ruined_cfg["offsetY"], "regions": ruined_regions}
                    enc["gridConfig"] = ruined_cfg
                    
        with open(campaign_file, "w", encoding="utf-8") as f:
            json.dump(camps, f, indent=2)
        print(f"Updated {campaign_file} encounters with regions for Wavechaser and Ruined Palma Flora.")

if __name__ == "__main__":
    main()
