import os
import time
import json
import cv2
import numpy as np

CACHE_FILE = "public/data/map_grids.json"

def detect_map_grid(img_path, patch_size=512, step=256, min_pitch=25, max_pitch=140):
    """
    Detects the square battlemap grid in an image using multi-patch spatial frequency
    and directional line gradient autocorrelation.
    
    Returns a dict with:
      - cellPitch: detected size of a grid square in pixels
      - offsetX: pixel offset in X where the grid begins
      - offsetY: pixel offset in Y where the grid begins
      - columns: total playable columns on the map
      - rows: total playable rows on the map
      - imageWidth: image pixel width
      - imageHeight: image pixel height
      - confidence: detection score
    """
    t0 = time.time()
    img = cv2.imread(img_path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        return None
    H, W = img.shape
    
    # Directional Sobel derivatives:
    # Vertical grid lines produce strong horizontal gradients (gx)
    # Horizontal grid lines produce strong vertical gradients (gy)
    gx = cv2.Sobel(img, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(img, cv2.CV_32F, 0, 1, ksize=3)
    
    best_pitch = None
    best_score = -1.0
    best_patch_coords = (0, 0)
    
    # Overlapping candidate patches
    for py in range(0, H - patch_size + 1, step):
        for px in range(0, W - patch_size + 1, step):
            patch_gx = np.abs(gx[py:py+patch_size, px:px+patch_size])
            patch_gy = np.abs(gy[py:py+patch_size, px:px+patch_size])
            
            # 1D line projections across the patch
            v_prof = np.mean(patch_gx, axis=0) # sum down columns (vertical lines)
            h_prof = np.mean(patch_gy, axis=1) # sum across rows (horizontal lines)
            
            # Zero-mean for autocorrelation
            v_prof = v_prof - np.mean(v_prof)
            h_prof = h_prof - np.mean(h_prof)
            
            # Autocorrelation
            cv = np.correlate(v_prof, v_prof, mode='full')[patch_size-1:]
            ch = np.correlate(h_prof, h_prof, mode='full')[patch_size-1:]
            
            if cv[0] < 1e-6 or ch[0] < 1e-6:
                continue
                
            # Search candidate pitch range
            for s in range(min_pitch, max_pitch):
                if s >= patch_size // 2 - 2:
                    continue
                # Both vertical and horizontal line profiles must exhibit local maxima at pitch s
                if (cv[s] > cv[s-1] and cv[s] > cv[s+1] and
                    ch[s] > ch[s-1] and ch[s] > ch[s+1]):
                    score = (cv[s] / cv[0]) + (ch[s] / ch[0])
                    # Check first harmonic (2*s) if within patch
                    if 2 * s < patch_size - 1:
                        score += 0.5 * ((cv[2*s] / cv[0]) + (ch[2*s] / ch[0]))
                    if score > best_score:
                        best_score = score
                        best_pitch = s
                        best_patch_coords = (px, py)
                        
    if best_pitch is None:
        best_pitch = 50 # Standard fallback
        
    pitch = best_pitch
    
    # Global phase & offset estimation:
    # Maximize line energy along comb coordinates across full image
    full_v = np.mean(np.abs(gx), axis=0)
    full_h = np.mean(np.abs(gy), axis=1)
    
    x_scores = [np.mean(full_v[x0::pitch]) for x0 in range(pitch)]
    best_x0 = int(np.argmax(x_scores))
    
    y_scores = [np.mean(full_h[y0::pitch]) for y0 in range(pitch)]
    best_y0 = int(np.argmax(y_scores))
    
    cols = int((W - best_x0) // pitch)
    rows = int((H - best_y0) // pitch)
    
    t_elapsed = (time.time() - t0) * 1000
    fname = os.path.basename(img_path)
    
    return {
        'file': fname,
        'imageWidth': W,
        'imageHeight': H,
        'cellPitch': pitch,
        'offsetX': best_x0,
        'offsetY': best_y0,
        'columns': cols,
        'rows': rows,
        'detectionTimeMs': round(t_elapsed, 1),
        'confidence': round(float(best_score), 3)
    }

def get_or_create_grid_cache(maps_dir="public/maps", cache_file=CACHE_FILE):
    cache = {}
    if os.path.exists(cache_file):
        try:
            with open(cache_file, 'r', encoding='utf-8') as f:
                cache = json.load(f)
        except Exception as e:
            print(f"Warning reading cache: {e}")
            cache = {}
            
    updated = False
    if os.path.exists(maps_dir):
        for f in sorted(os.listdir(maps_dir)):
            if not (f.endswith('.png') or f.endswith('.jpg') or f.endswith('.jpeg')):
                continue
            key = f"/maps/{f}"
            if key not in cache:
                img_path = os.path.join(maps_dir, f)
                print(f"Parsing grid for {f}...")
                info = detect_map_grid(img_path)
                if info:
                    cache[key] = info
                    # Also store by bare filename
                    cache[f] = info
                    updated = True
                    print(f"  -> {info['columns']}x{info['rows']} cells, pitch={info['cellPitch']}px, offset=({info['offsetX']},{info['offsetY']}) in {info['detectionTimeMs']}ms")
                    
    if updated or not os.path.exists(cache_file):
        os.makedirs(os.path.dirname(cache_file), exist_ok=True)
        with open(cache_file, 'w', encoding='utf-8') as f:
            json.dump(cache, f, indent=2)
        print(f"Saved {len(cache)} map grid entries to {cache_file}")
        
    return cache

if __name__ == '__main__':
    get_or_create_grid_cache()
