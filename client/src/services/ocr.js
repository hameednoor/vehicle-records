/**
 * Client-side invoice OCR using Tesseract.js in the browser.
 * Replaces server-side OCR to avoid Vercel 30s function timeout.
 */

// Currency patterns for detection
const CURRENCY_MAP = {
  'AED': 'AED', 'Dhs': 'AED', 'DHS': 'AED', 'Dh': 'AED',
  'USD': 'USD', 'US$': 'USD', '$': 'USD',
  'EUR': 'EUR', '\u20ac': 'EUR',
  'GBP': 'GBP', '\u00a3': 'GBP',
  'INR': 'INR', '\u20b9': 'INR', 'Rs': 'INR',
  'SAR': 'SAR', 'SR': 'SAR',
  'KWD': 'KWD', 'KD': 'KWD',
  'BHD': 'BHD', 'BD': 'BHD',
  'OMR': 'OMR', 'OR': 'OMR',
  'QAR': 'QAR', 'QR': 'QAR',
  'PKR': 'PKR',
  'EGP': 'EGP',
  'JPY': 'JPY', '\u00a5': 'JPY',
  'CNY': 'CNY',
  'CAD': 'CAD', 'C$': 'CAD',
  'AUD': 'AUD', 'A$': 'AUD',
  'CHF': 'CHF',
  'SGD': 'SGD', 'S$': 'SGD',
  'MYR': 'MYR', 'RM': 'MYR',
  'PHP': 'PHP',
};

const TOTAL_KEYWORDS = [
  'grand total',
  'total amount due',
  'total amount payable',
  'total incl vat',
  'total inc vat',
  'total inclusive of vat',
  'total including vat',
  'vat inclusive total',
  'amount to pay',
  'pay this amount',
  'total amount',
  'amount due',
  'balance due',
  'total due',
  'net total',
  'total payable',
  'amount payable',
  'invoice total',
  'total cost',
  'final total',
  'total price',
  'gross total',
  'total charges',
  'total fees',
  'you owe',
  'please pay',
  'total',
  'net amount',
  'sub total',
  'subtotal',
  'balance',
  'amount',
  'net',
];

function parseAmount(str) {
  if (!str) return null;
  let cleaned = str.trim().replace(/[^\d.,]/g, '');
  if (!cleaned) return null;

  const lastComma = cleaned.lastIndexOf(',');
  const lastPeriod = cleaned.lastIndexOf('.');

  if (lastComma > -1 && lastPeriod > -1) {
    if (lastComma > lastPeriod) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (lastComma > -1) {
    const afterComma = cleaned.substring(lastComma + 1);
    if (afterComma.length === 2 && cleaned.split(',').length === 2) {
      cleaned = cleaned.replace(',', '.');
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
  }

  const num = parseFloat(cleaned);
  return isNaN(num) ? null : Math.round(num * 100) / 100;
}

/**
 * Parse OCR text to extract cost and currency.
 */
export function parseInvoiceText(text) {
  if (!text || text.trim().length === 0) {
    return { cost: null, currency: null };
  }

  // Detect currency
  let detectedCurrency = null;
  const codeMatch = text.match(/\b(AED|USD|EUR|GBP|INR|SAR|KWD|BHD|OMR|QAR|PKR|EGP|JPY|CNY|CAD|AUD|CHF|SGD|MYR|PHP)\b/i);
  if (codeMatch) {
    detectedCurrency = codeMatch[1].toUpperCase();
  }

  if (!detectedCurrency) {
    const symbolEntries = Object.entries(CURRENCY_MAP)
      .filter(([symbol]) => !(symbol.length <= 3 && /^[A-Z]{3}$/.test(symbol)))
      .sort((a, b) => b[0].length - a[0].length);
    for (const [symbol, code] of symbolEntries) {
      if (text.includes(symbol)) {
        detectedCurrency = code;
        break;
      }
    }
  }

  if (!detectedCurrency && /\b(Dhs?|DHS|AED|dirham)/i.test(text)) {
    detectedCurrency = 'AED';
  }

  // Extract amounts
  const lines = text.split('\n');
  const totalLines = lines.length;
  const totalAmounts = [];
  const numberPattern = /(?:[$\u20ac\u00a3\u20b9\u00a5]?\s*)?(\d[\d,]*\.?\d*|\d+(?:\.\d{1,2}))/g;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const lineLower = line.toLowerCase().trim();

    let bestKeywordPriority = -1;
    for (let ki = 0; ki < TOTAL_KEYWORDS.length; ki++) {
      if (lineLower.includes(TOTAL_KEYWORDS[ki])) {
        bestKeywordPriority = TOTAL_KEYWORDS.length - ki;
        break;
      }
    }

    const nums = line.match(numberPattern) || [];
    for (const numStr of nums) {
      const cleaned = numStr.replace(/^[$\u20ac\u00a3\u20b9\u00a5\s]+/, '');
      const amount = parseAmount(cleaned);
      if (amount !== null && amount > 0 && amount < 10000000) {
        const positionBonus = totalLines > 3 ? (lineIdx / totalLines) * 3 : 0;
        totalAmounts.push({ amount, priority: bestKeywordPriority, lineIndex: lineIdx, positionBonus });
      }
    }
  }

  let bestCost = null;
  const keywordAmounts = totalAmounts
    .filter((a) => a.priority > 0)
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (b.positionBonus !== a.positionBonus) return b.positionBonus - a.positionBonus;
      return b.amount - a.amount;
    });

  if (keywordAmounts.length > 0) {
    bestCost = keywordAmounts[0].amount;
  }

  if (bestCost === null && totalAmounts.length > 0) {
    totalAmounts.sort((a, b) => b.amount - a.amount);
    bestCost = totalAmounts[0].amount;
  }

  return { cost: bestCost, currency: detectedCurrency };
}

/**
 * Run OCR on an image file in the browser using Tesseract.js.
 * Returns { cost, currency, rawText }
 */
export async function analyzeInvoiceBrowser(file) {
  // Skip non-image files
  if (!file.type?.startsWith('image/') && !/\.(jpg|jpeg|png|webp|heic)$/i.test(file.name)) {
    return { cost: null, currency: null, rawText: null };
  }

  try {
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('eng', 1, {
      // Use CDN for WASM and trained data (faster than bundling)
      workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
      corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core-simd-lstm.wasm.js',
    });

    const imageUrl = URL.createObjectURL(file);
    const { data } = await worker.recognize(imageUrl);
    URL.revokeObjectURL(imageUrl);
    await worker.terminate();

    const rawText = data.text?.trim() || '';
    if (!rawText) return { cost: null, currency: null, rawText: null };

    const { cost, currency } = parseInvoiceText(rawText);
    return { cost, currency, rawText };
  } catch (err) {
    console.error('Browser OCR failed:', err);
    return { cost: null, currency: null, rawText: null };
  }
}
