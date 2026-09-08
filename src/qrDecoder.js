import jsQR from 'jsqr';
import { Jimp } from 'jimp';

/**
 * Helper to attempt decoding a Jimp image with jsQR
 */
function tryDecode(image) {
  const width = image.bitmap.width;
  const height = image.bitmap.height;
  const bufferData = image.bitmap.data;
  const qrCode = jsQR(new Uint8ClampedArray(bufferData), width, height, {
    inversionAttempts: 'attemptBoth'
  });
  return qrCode && qrCode.data ? qrCode.data : null;
}

export async function extractQrFromBuffer(buffer) {
  try {
    const originalImage = await Jimp.read(buffer);

    // Attempt 1: Raw image
    let result = tryDecode(originalImage);
    if (result) return result;

    // Normalize size if the image is huge (reduces noise & speeds up processing)
    const maxDim = 1200;
    if (originalImage.bitmap.width > maxDim || originalImage.bitmap.height > maxDim) {
      originalImage.scaleToFit({ w: maxDim, h: maxDim });
      result = tryDecode(originalImage);
      if (result) return result;
    }

    // Attempt 2: Grayscale & Contrast adjustments
    const grayImage = originalImage.clone().greyscale().contrast(0.5);
    result = tryDecode(grayImage);
    if (result) return result;

    // Attempt 3: High contrast & brightness boost for dim / dark photos
    const brightImage = originalImage.clone().greyscale().brightness(0.2).contrast(0.8);
    result = tryDecode(brightImage);
    if (result) return result;

    // Attempt 4: Threshold / Binarization (B&W filter)
    const thresholdImage = originalImage.clone().greyscale().threshold({ max: 150 });
    result = tryDecode(thresholdImage);
    if (result) return result;

    // Attempt 5: Multi-angle rotation (for tilted/skewed photos: 15, -15, 30, -30, 45, -45, 90, 180, 270 deg)
    const angles = [15, -15, 30, -30, 45, -45, 90, 180, 270];
    for (const angle of angles) {
      const rotatedOriginal = originalImage.clone().rotate(angle);
      result = tryDecode(rotatedOriginal);
      if (result) return result;

      const rotatedGray = grayImage.clone().rotate(angle);
      result = tryDecode(rotatedGray);
      if (result) return result;
    }

    return null;
  } catch (err) {
    console.error('Error decoding QR code:', err);
    return null;
  }
}

