/**
 * Invoice analysis via server-side Gemini AI.
 * Sends the file to the server API which uses Google Gemini to extract
 * cost, currency, and provider from invoice images.
 */
import { analyzeInvoice } from '../api';

/**
 * Analyze an invoice file by sending it to the server for Gemini AI processing.
 * Returns { cost, currency, provider, rawText }
 */
export async function analyzeInvoiceBrowser(file) {
  // Support images and PDFs
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

  console.log('[OCR] Sending to Gemini AI:', file.name, 'size:', file.size);

  try {
    const result = await analyzeInvoice(file);

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
