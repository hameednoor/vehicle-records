/**
 * Invoice analysis using Google Gemini API.
 * Uses gemini-2.5-flash for best balance of quality and free-tier quota.
 * Free tier: 10 RPM, 250 requests/day.
 */
const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

let ai = null;

function getAI() {
  if (!ai) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is not set');
    }
    ai = new GoogleGenAI({ apiKey });
  }
  return ai;
}

const SUPPORTED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.bmp', '.tiff', '.gif'];
const SUPPORTED_PDF_EXTENSIONS = ['.pdf'];

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.heic': 'image/heic',
    '.bmp': 'image/bmp',
    '.tiff': 'image/tiff',
    '.gif': 'image/gif',
    '.pdf': 'application/pdf',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

/**
 * Analyze an invoice file using Gemini Vision.
 * Sends the image/PDF to Gemini and gets structured invoice data back.
 *
 * @param {string} filePath - path to the uploaded file
 * @returns {{ cost: number|null, currency: string|null, provider: string|null, rawText: string|null }}
 */
async function analyzeInvoice(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const isImage = SUPPORTED_IMAGE_EXTENSIONS.includes(ext);
  const isPdf = SUPPORTED_PDF_EXTENSIONS.includes(ext);

  if (!isImage && !isPdf) {
    console.log(`[Gemini OCR] Skipping unsupported file type: ${ext}`);
    return { cost: null, currency: null, provider: null, rawText: null };
  }

  try {
    const genai = getAI();
    const fileBuffer = fs.readFileSync(filePath);
    const base64Data = fileBuffer.toString('base64');
    const mimeType = getMimeType(filePath);

    console.log(`[Gemini OCR] Analyzing ${path.basename(filePath)} (${mimeType}, ${Math.round(fileBuffer.length / 1024)} KB)`);

    const response = await genai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: mimeType,
                data: base64Data,
              },
            },
            {
              text: `You are an invoice/receipt data extractor. Analyze this image and extract the following information. Return ONLY valid JSON, no markdown, no code fences.

{
  "total_amount": <number or null - the grand total / final amount to pay>,
  "currency": "<3-letter ISO currency code like AED, USD, EUR, or null>",
  "provider": "<name of the service provider/vendor/company, or null>",
  "date": "<invoice date in YYYY-MM-DD format, or null>",
  "description": "<brief summary of what the invoice is for, or null>",
  "raw_text": "<all readable text from the invoice, preserving line breaks>"
}

Rules:
- For total_amount, prefer "Grand Total", "Total Amount Due", "Total incl. VAT" over subtotals
- If multiple totals exist, pick the largest one (the final amount the customer pays)
- For currency, look for currency codes (AED, USD, EUR) or symbols (Dhs, $, €, £, ₹)
- If currency is ambiguous and the invoice seems from UAE, default to AED
- Return null for any field you cannot determine
- total_amount must be a number (not a string), e.g. 1234.56 not "1,234.56"`,
            },
          ],
        },
      ],
    });

    const responseText = response.text || '';
    console.log('[Gemini OCR] Response length:', responseText.length);

    // Parse the JSON response
    let parsed;
    try {
      // Strip markdown code fences if present
      let jsonStr = responseText.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }
      parsed = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.error('[Gemini OCR] Failed to parse JSON response:', parseErr.message);
      console.error('[Gemini OCR] Raw response:', responseText.substring(0, 500));
      return { cost: null, currency: null, provider: null, rawText: responseText };
    }

    const cost = typeof parsed.total_amount === 'number' ? Math.round(parsed.total_amount * 100) / 100 : null;
    const currency = parsed.currency || null;
    const provider = parsed.provider || null;
    const rawText = parsed.raw_text || responseText;

    console.log(`[Gemini OCR] Extracted — cost: ${cost}, currency: ${currency}, provider: ${provider}`);

    return { cost, currency, provider, rawText };
  } catch (error) {
    console.error('[Gemini OCR] Analysis failed:', error.message);
    return { cost: null, currency: null, provider: null, rawText: null };
  }
}

/**
 * Process an invoice file (compatibility wrapper).
 * Returns the raw text extracted from the invoice.
 */
async function processInvoice(filePath) {
  const result = await analyzeInvoice(filePath);
  return result.rawText;
}

/**
 * Parse invoice text to extract cost and currency.
 * This is now a simple passthrough since Gemini does the extraction,
 * but kept for backward compatibility with code that calls it directly.
 */
function parseInvoiceText(text) {
  if (!text || text.trim().length === 0) {
    return { cost: null, currency: null };
  }

  // Simple fallback parsing for cases where raw text is passed directly
  // (e.g., from old OCR data stored in DB)
  let detectedCurrency = null;
  const codeMatch = text.match(
    /\b(AED|USD|EUR|GBP|INR|SAR|KWD|BHD|OMR|QAR|PKR|EGP|JPY|CNY|CAD|AUD|CHF|SGD|MYR|PHP)\b/i
  );
  if (codeMatch) {
    detectedCurrency = codeMatch[1].toUpperCase();
  }

  // Find the largest number as a rough cost estimate
  const numbers = text.match(/\d[\d,]*\.?\d*/g) || [];
  let maxAmount = null;
  for (const numStr of numbers) {
    const cleaned = numStr.replace(/,/g, '');
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num > 0 && num < 10000000) {
      if (maxAmount === null || num > maxAmount) {
        maxAmount = num;
      }
    }
  }

  return { cost: maxAmount ? Math.round(maxAmount * 100) / 100 : null, currency: detectedCurrency };
}

/**
 * Analyze an odometer image using Gemini Vision.
 * Returns { reading: number|null, candidates: number[] }
 */
async function analyzeOdometer(filePath, currentKms) {
  const ext = path.extname(filePath).toLowerCase();
  const isImage = SUPPORTED_IMAGE_EXTENSIONS.includes(ext);

  if (!isImage) {
    console.log(`[Gemini OCR] Skipping non-image file for odometer: ${ext}`);
    return { reading: null, candidates: [] };
  }

  try {
    const genai = getAI();
    const fileBuffer = fs.readFileSync(filePath);
    const base64Data = fileBuffer.toString('base64');
    const mimeType = getMimeType(filePath);

    console.log(`[Gemini OCR] Analyzing odometer image: ${path.basename(filePath)} (${Math.round(fileBuffer.length / 1024)} KB)`);

    const response = await genai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: mimeType,
                data: base64Data,
              },
            },
            {
              text: `You are an odometer reading extractor. Look at this image of a vehicle's odometer/dashboard and extract the odometer reading (total kilometers or miles driven).

Return ONLY valid JSON, no markdown, no code fences:
{
  "reading": <the most likely odometer reading as a number, or null if not found>,
  "candidates": [<array of all numbers that could be odometer readings, sorted by likelihood>],
  "unit": "<km or miles>"
}

Rules:
- The odometer typically shows total distance driven (not trip distance)
- Odometer readings are usually 3-7 digits (e.g., 52341, 128000)
- Ignore trip meters, fuel gauges, RPM, speed, temperature
- The current odometer should be around ${currentKms || 0} km, so prefer readings near or above that value
- If you see multiple numbers, the largest multi-digit number is usually the odometer
- Return null if you cannot determine the reading`,
            },
          ],
        },
      ],
    });

    const responseText = response.text || '';

    let parsed;
    try {
      let jsonStr = responseText.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }
      parsed = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.error('[Gemini OCR] Failed to parse odometer response:', parseErr.message);
      return { reading: null, candidates: [] };
    }

    const reading = typeof parsed.reading === 'number' ? parsed.reading : null;
    const candidates = Array.isArray(parsed.candidates) ? parsed.candidates.filter(n => typeof n === 'number') : [];

    console.log(`[Gemini OCR] Odometer — reading: ${reading}, candidates: [${candidates.join(', ')}]`);

    return { reading, candidates };
  } catch (error) {
    console.error('[Gemini OCR] Odometer analysis failed:', error.message);
    return { reading: null, candidates: [] };
  }
}

module.exports = { processInvoice, analyzeInvoice, parseInvoiceText, analyzeOdometer };
