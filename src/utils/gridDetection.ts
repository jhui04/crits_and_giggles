import type { MapGridConfig } from '../types';

/**
 * Browser-compatible computer vision module for detecting square battlemap grids
 * in images using directional gradients and 1D autocorrelation.
 *
 * Designed to quickly find grids even when they do not cover the entire image
 * (e.g. rooms/caves surrounded by ocean, black borders, or parchment margins).
 */
export async function detectGridFromImage(
  imageSource: HTMLImageElement | ImageBitmap | ImageData
): Promise<MapGridConfig> {
  let width: number;
  let height: number;
  let rgbaData: Uint8ClampedArray;

  if ('data' in imageSource && imageSource.data instanceof Uint8ClampedArray) {
    width = imageSource.width;
    height = imageSource.height;
    rgbaData = imageSource.data;
  } else {
    width = ('naturalWidth' in imageSource && imageSource.naturalWidth) ? imageSource.naturalWidth : imageSource.width;
    height = ('naturalHeight' in imageSource && imageSource.naturalHeight) ? imageSource.naturalHeight : imageSource.height;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return fallbackGrid(width, height);
    }
    ctx.drawImage(imageSource as CanvasImageSource, 0, 0);
    const imgData = ctx.getImageData(0, 0, width, height);
    rgbaData = imgData.data;
  }

  return detectGridFromImageData(rgbaData, width, height);
}

/**
 * Pure image processing algorithm on raw RGBA pixel data.
 */
export function detectGridFromImageData(
  rgbaData: Uint8ClampedArray,
  width: number,
  height: number
): MapGridConfig {
  if (width <= 0 || height <= 0) {
    return fallbackGrid(width, height);
  }

  // Convert to grayscale
  const gray = new Float32Array(width * height);
  for (let i = 0, j = 0; i < rgbaData.length; i += 4, j++) {
    // Standard perceptual luminance
    gray[j] = 0.299 * rgbaData[i] + 0.587 * rgbaData[i + 1] + 0.114 * rgbaData[i + 2];
  }

  // Compute directional horizontal and vertical gradients (Sobel 3x3 approx or central diff)
  const gx = new Float32Array(width * height);
  const gy = new Float32Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    const rowAbove = (y - 1) * width;
    const rowCurrent = y * width;
    const rowBelow = (y + 1) * width;

    for (let x = 1; x < width - 1; x++) {
      // Sobel X: vertical lines produce large gx
      const valX =
        -gray[rowAbove + x - 1] + gray[rowAbove + x + 1] +
        -2 * gray[rowCurrent + x - 1] + 2 * gray[rowCurrent + x + 1] +
        -gray[rowBelow + x - 1] + gray[rowBelow + x + 1];

      // Sobel Y: horizontal lines produce large gy
      const valY =
        -gray[rowAbove + x - 1] - 2 * gray[rowAbove + x] - gray[rowAbove + x + 1] +
        gray[rowBelow + x - 1] + 2 * gray[rowBelow + x] + gray[rowBelow + x + 1];

      const idx = rowCurrent + x;
      gx[idx] = Math.abs(valX);
      gy[idx] = Math.abs(valY);
    }
  }

  // Patch-based spatial search to locate the gridded sub-region of the map
  const patchSize = Math.min(512, Math.min(width, height));
  const step = Math.max(128, Math.floor(patchSize / 2));
  const minPitch = 25;
  const maxPitch = Math.min(140, Math.floor(patchSize / 3));

  let bestPitch = 50;
  let bestScore = -1;

  for (let py = 0; py <= height - patchSize; py += step) {
    for (let px = 0; px <= width - patchSize; px += step) {
      // Line projections across the patch
      const vProf = new Float32Array(patchSize);
      const hProf = new Float32Array(patchSize);

      for (let y = 0; y < patchSize; y++) {
        const rowOffset = (py + y) * width + px;
        for (let x = 0; x < patchSize; x++) {
          vProf[x] += gx[rowOffset + x];
          hProf[y] += gy[rowOffset + x];
        }
      }

      // Mean subtraction
      let vMean = 0;
      let hMean = 0;
      for (let i = 0; i < patchSize; i++) {
        vMean += vProf[i];
        hMean += hProf[i];
      }
      vMean /= patchSize;
      hMean /= patchSize;

      for (let i = 0; i < patchSize; i++) {
        vProf[i] -= vMean;
        hProf[i] -= hMean;
      }

      // Autocorrelation for candidate lags
      const cv0 = autoCorrLag(vProf, 0);
      const ch0 = autoCorrLag(hProf, 0);

      if (cv0 < 1e-4 || ch0 < 1e-4) continue;

      for (let s = minPitch; s < maxPitch; s++) {
        const cv = autoCorrLag(vProf, s);
        const cvPrev = autoCorrLag(vProf, s - 1);
        const cvNext = autoCorrLag(vProf, s + 1);

        const ch = autoCorrLag(hProf, s);
        const chPrev = autoCorrLag(hProf, s - 1);
        const chNext = autoCorrLag(hProf, s + 1);

        // Check if both axes have a peak at lag s
        if (cv > cvPrev && cv > cvNext && ch > chPrev && ch > chNext) {
          let score = (cv / cv0) + (ch / ch0);
          if (2 * s < patchSize - 1) {
            const cv2 = autoCorrLag(vProf, 2 * s);
            const ch2 = autoCorrLag(hProf, 2 * s);
            score += 0.5 * ((cv2 / cv0) + (ch2 / ch0));
          }
          if (score > bestScore) {
            bestScore = score;
            bestPitch = s;
          }
        }
      }
    }
  }

  const pitch = bestPitch;

  // Global offset / phase estimation
  // Accumulate full-image directional gradients along columns and rows
  const fullV = new Float32Array(width);
  const fullH = new Float32Array(height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      fullV[x] += gx[rowOffset + x];
      fullH[y] += gy[rowOffset + x];
    }
  }

  let bestX0 = 0;
  let maxScoreX = -1;
  for (let x0 = 0; x0 < pitch; x0++) {
    let sum = 0;
    let count = 0;
    for (let x = x0; x < width; x += pitch) {
      sum += fullV[x];
      count++;
    }
    const score = count > 0 ? sum / count : 0;
    if (score > maxScoreX) {
      maxScoreX = score;
      bestX0 = x0;
    }
  }

  let bestY0 = 0;
  let maxScoreY = -1;
  for (let y0 = 0; y0 < pitch; y0++) {
    let sum = 0;
    let count = 0;
    for (let y = y0; y < height; y += pitch) {
      sum += fullH[y];
      count++;
    }
    const score = count > 0 ? sum / count : 0;
    if (score > maxScoreY) {
      maxScoreY = score;
      bestY0 = y0;
    }
  }

  const columns = Math.max(1, Math.floor((width - bestX0) / pitch));
  const rows = Math.max(1, Math.floor((height - bestY0) / pitch));

  return {
    columns,
    rows,
    cellPitch: pitch,
    offsetX: bestX0,
    offsetY: bestY0,
    imageWidth: width,
    imageHeight: height,
    confidence: bestScore > 0 ? Math.round(bestScore * 1000) / 1000 : 0.5
  };
}

function autoCorrLag(arr: Float32Array, lag: number): number {
  let sum = 0;
  const n = arr.length - lag;
  for (let i = 0; i < n; i++) {
    sum += arr[i] * arr[i + lag];
  }
  return sum;
}

function fallbackGrid(width: number, height: number): MapGridConfig {
  const pitch = 50;
  return {
    columns: width > 0 ? Math.max(1, Math.floor(width / pitch)) : 20,
    rows: height > 0 ? Math.max(1, Math.floor(height / pitch)) : 20,
    cellPitch: pitch,
    offsetX: 0,
    offsetY: 0,
    imageWidth: width,
    imageHeight: height,
    confidence: 0
  };
}
