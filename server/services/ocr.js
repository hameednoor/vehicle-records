const path = require('path');

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

// Keywords that typically precede the total amount on invoices
const TOTAL_KEYWORDS = [
  'grand total',
  'total amount',
  'amount due',
  'balance due',
  'total due',
  'net total',
  'total payable',
  'amount payable',
  'invoice total',
  'total',
  'net amount',
  'subtotal',
  'sub total',
  'gross total',
  'balance',
  'amount',
  'net',
];

/**
 * Process an invoice file using Tesseract.js OCR.
 */
async function processInvoice(filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.pdf') return null;

    const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.heic'];
    if (!imageExtensions.includes(ext)) return null;

    const Tesseract = require('tesseract.js');
    console.log(`Starting OCR processing for: ${filePath}`);

    const { data } = await Tesseract.recognize(filePath, 'eng', {
      logger: (info) => {
        if (info.status === 'recognizing text') {
          const progress = Math.round(info.progress * 100);
          if (progress % 25 === 0) {
            console.log(`OCR progress: ${progress}%`);
          }
        }
      },
    });

    const extractedText = data.text ? data.text.trim() : '';
    console.log(`OCR complete: extracted ${extractedText.length} characters.`);
    return extractedText;
  } catch (error) {
    console.error(`OCR processing failed for ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Analyze invoice text to extract total cost and currency.
 *
 * Strategy:
 * 1. Detect currency from symbols/codes anywhere in the text
 * 2. Find amounts associated with "total" keywords (prefer the last/largest)
 * 3. If no keyword-associated amount, fall back to the largest number
 *
 * @param {string} text - OCR-extracted text
 * @returns {{ cost: number|null, currency: string|null }}
 */
function parseInvoiceText(text) {
  if (!text || text.trim().length === 0) {
    return { cost: null, currency: null };
  }

  // --- Detect currency ---
  let detectedCurrency = null;

  // Check for 3-letter currency codes first (most reliable)
  const codeMatch = text.match(/\b(AED|USD|EUR|GBP|INR|SAR|KWD|BHD|OMR|QAR|PKR|EGP|JPY|CNY|CAD|AUD|CHF|SGD|MYR|PHP)\b/i);
  if (codeMatch) {
    detectedCurrency = codeMatch[1].toUpperCase();
  }

  // Check for currency symbols if no code found
  if (!detectedCurrency) {
    for (const [symbol, code] of Object.entries(CURRENCY_MAP)) {
      if (symbol.length <= 3 && /^[A-Z]{3}$/.test(symbol)) continue; // skip codes already checked
      if (text.includes(symbol)) {
        detectedCurrency = code;
        break;
      }
    }
  }

  // Check for AED-specific patterns (common in UAE invoices)
  if (!detectedCurrency) {
    if (/\b(Dhs?|DHS|AED|dirham)/i.test(text)) {
      detectedCurrency = 'AED';
    }
  }

  // --- Extract amounts ---
  const lines = text.split('\n');
  const totalAmounts = []; // { amount, priority, lineIndex }

  // Number pattern: optional currency symbol, then digits with commas/periods
  // e.g., "1,234.56", "1234.56", "1.234,56", "1234"
  const numberPattern = /[\d][,.\d]*[\d](?:\.\d{1,2})?|\d+(?:\.\d{1,2})?/g;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const lineLower = line.toLowerCase().trim();

    // Check if this line contains a total keyword
    let bestKeywordPriority = -1;
    for (let ki = 0; ki < TOTAL_KEYWORDS.length; ki++) {
      if (lineLower.includes(TOTAL_KEYWORDS[ki])) {
        // Lower index = higher priority (grand total > total > subtotal)
        bestKeywordPriority = TOTAL_KEYWORDS.length - ki;
        break;
      }
    }

    // Extract numbers from this line
    const nums = line.match(numberPattern) || [];
    for (const numStr of nums) {
      const amount = parseAmount(numStr);
      if (amount !== null && amount > 0 && amount < 10000000) {
        totalAmounts.push({
          amount,
          priority: bestKeywordPriority,
          lineIndex: lineIdx,
        });
      }
    }
  }

  // --- Pick the best amount ---
  let bestCost = null;

  // First try: amounts on lines with total keywords, pick highest priority then largest amount
  const keywordAmounts = totalAmounts
    .filter((a) => a.priority > 0)
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return b.amount - a.amount;
    });

  if (keywordAmounts.length > 0) {
    bestCost = keywordAmounts[0].amount;
  }

  // Fallback: largest number in the document (likely the total)
  if (bestCost === null && totalAmounts.length > 0) {
    totalAmounts.sort((a, b) => b.amount - a.amount);
    bestCost = totalAmounts[0].amount;
  }

  return { cost: bestCost, currency: detectedCurrency };
}

/**
 * Parse a number string that may use different decimal/thousand conventions.
 * "1,234.56" → 1234.56
 * "1.234,56" → 1234.56 (European)
 * "1234"     → 1234
 */
function parseAmount(str) {
  if (!str) return null;

  let cleaned = str.trim();

  // If it has both comma and period, determine which is decimal
  const lastComma = cleaned.lastIndexOf(',');
  const lastPeriod = cleaned.lastIndexOf('.');

  if (lastComma > -1 && lastPeriod > -1) {
    if (lastComma > lastPeriod) {
      // European: "1.234,56" → comma is decimal
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      // US/UK: "1,234.56" → period is decimal
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (lastComma > -1) {
    // Only commas: check if it looks like a decimal (e.g., "123,45") or thousand sep (e.g., "1,234")
    const afterComma = cleaned.substring(lastComma + 1);
    if (afterComma.length === 2 && cleaned.split(',').length === 2) {
      // Likely decimal: "123,45"
      cleaned = cleaned.replace(',', '.');
    } else {
      // Likely thousand separator: "1,234" or "1,234,567"
      cleaned = cleaned.replace(/,/g, '');
    }
  }
  // If only periods: if it ends with .XX and there's only one period, it's decimal
  // Otherwise periods are thousand separators

  const num = parseFloat(cleaned);
  return isNaN(num) ? null : Math.round(num * 100) / 100;
}

/**
 * Full invoice analysis: OCR + text parsing.
 * Returns { cost, currency, rawText }
 */
async function analyzeInvoice(filePath) {
  const rawText = await processInvoice(filePath);
  if (!rawText) {
    return { cost: null, currency: null, rawText: null };
  }

  const { cost, currency } = parseInvoiceText(rawText);
  return { cost, currency, rawText };
}

module.exports = { processInvoice, analyzeInvoice, parseInvoiceText };
