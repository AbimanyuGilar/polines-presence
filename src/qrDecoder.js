import jsQR from 'jsqr';
import { Jimp } from 'jimp';

export async function extractQrFromBuffer(buffer) {
  try {
    const image = await Jimp.read(buffer);
    const width = image.bitmap.width;
    const height = image.bitmap.height;
    const bufferData = image.bitmap.data;

    const qrCode = jsQR(new Uint8ClampedArray(bufferData), width, height);
    if (qrCode && qrCode.data) {
      return qrCode.data;
    }
    return null;
  } catch (err) {
    console.error('Error decoding QR code:', err);
    return null;
  }
}
