/**
 * Invoice analysis via server-side Gemini AI.
 * Images are compressed client-side before upload for speed.
 */
import { analyzeInvoice } from '../api';
import { compressImage } from './imageCompress';

/**
 * Analyze an invoice file by sending it to the server for Gemini AI processing.
 * Images are compressed first for faster upload.
 * Returns { cost, currency, provider, rawText }
 */
export async function analyzeInvoiceBrowser(file) {
  const isImage =
    file.type?.startsWith('image/') ||
    /\.(jpg|jpeg|png|webp|heic|bmp|tiff|gif)$/i.test(file.name);
  const isPdf =
    file.type === 'application/pdf' ||
    /\.pdf$/i.test(file.name);

  if (!isImage && !isPdf) {
    console.log('[OCR] Skipping unsupported file:', file.name, file.type);
    return { cost: null, currency: null, provider: null, rawText: null };
  }

  try {
    const fileToSend = isImage ? await compressImage(file) : file;

    console.log('[OCR] Sending to Gemini AI:', fileToSend.name, 'size:', Math.round(fileToSend.size / 1024), 'KB');

    const result = await analyzeInvoice(fileToSend);

    console.log('[OCR] Gemini result — cost:', result.cost, 'currency:', result.currency, 'provider:', result.provider);

    return {
      cost: result.cost || null,
      currency: result.currency || null,
      provider: result.provider || null,
      rawText: result.rawText || null,
    };
  } catch (err) {
    console.error('[OCR] Gemini analysis failed:', err.message);
    return { cost: null, currency: null, provider: null, rawText: null };
  }
}
