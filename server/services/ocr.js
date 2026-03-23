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
// Ordered by priority: most specific first
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

/**
 * Process an invoice file using Tesseract.js OCR.
 * Configured for best possible accuracy on invoice/receipt images.
 */
async function processInvoice(filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.pdf') {
      console.log(`Skipping OCR for PDF file: ${filePath} (not supported)`);
      return null;
    }

    const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
    if (!imageExtensions.includes(ext)) {
      console.log(`Skipping OCR for unsupported file type: ${ext}`);
      return null;
    }

    const Tesseract = require('tesseract.js');
    console.log(`Starting OCR processing for: ${filePath}`);

    const { data } = await Tesseract.recognize(filePath, 'eng+ara', {
      logger: (info) => {
        if (info.status === 'recognizing text') {
          const progress = Math.round(info.progress * 100);
          if (progress % 25 === 0) {
            console.log(`OCR progress: ${progress}%`);
          }
        }
      },
      // Tesseract.js worker parameters for best accuracy
      workerParams: {
        // OEM 1 = LSTM neural net only (best accuracy)
        // OEM 2 = Legacy + LSTM combined
        // OEM 3 = Default (let Tesseract decide)
        tessedit_ocr_engine_mode: '1',
        // PSM 6 = Assume a single uniform block of text (good for invoices)
        // PSM 3 = Fully automatic page segmentation (default)
        // PSM 4 = Assume a single column of text
        tessedit_pageseg_mode: '6',
        // Preserve inter-word spaces for better number extraction
        preserve_interword_spaces: '1',
      },
    });

    const extractedText = data.text ? data.text.trim() : '';
    console.log(`OCR complete: extracted ${extractedText.length} characters.`);

    // If first pass got very little text, try again with PSM 3 (auto) as fallback
    if (extractedText.length < 20) {
      console.log('Low text yield, retrying with automatic page segmentation...');
      const { data: data2 } = await Tesseract.recognize(filePath, 'eng+ara', {
        workerParams: {
          tessedit_ocr_engine_mode: '1',
          tessedit_pageseg_mode: '3',
          preserve_interword_spaces: '1',
        },
      });
      const fallbackText = data2.text ? data2.text.trim() : '';
      if (fallbackText.length > extractedText.length) {
        console.log(`Fallback OCR yielded ${fallbackText.length} characters (better).`);
        return fallbackText;
      }
    }

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
 * 3. Give a position bonus to amounts found later in the document (invoices
 *    typically have the total at the bottom)
 * 4. If no keyword-associated amount, fall back to the largest number
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

  // Check for currency symbols if no code found (check multi-char symbols first)
  if (!detectedCurrency) {
    const symbolEntries = Object.entries(CURRENCY_MAP)
      .filter(([symbol]) => !(symbol.length <= 3 && /^[A-Z]{3}$/.test(symbol)))
      .sort((a, b) => b[0].length - a[0].length); // longer symbols first (C$ before $)
    for (const [symbol, code] of symbolEntries) {
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
  const totalLines = lines.length;
  const totalAmounts = []; // { amount, priority, lineIndex }

  // Number pattern: handles amounts like "1,234.56", "$1234", "AED 500.00",
  // currency symbol directly before digits, digits with commas/periods.
  // The pattern strips leading currency symbols/letters before matching.
  const numberPattern = /(?:[\$\u20ac\u00a3\u20b9\u00a5]?\s*)?(\d[\d,]*\.?\d*|\d+(?:\.\d{1,2}))/g;

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
      // Strip any leading currency symbols and whitespace
      const cleaned = numStr.replace(/^[\$\u20ac\u00a3\u20b9\u00a5\s]+/, '');
      const amount = parseAmount(cleaned);
      if (amount !== null && amount > 0 && amount < 10000000) {
        // Position bonus: lines in the bottom third of the document get a bonus
        // because totals are typically at the bottom of invoices
        const positionBonus = totalLines > 3 ? (lineIdx / totalLines) * 3 : 0;

        totalAmounts.push({
          amount,
          priority: bestKeywordPriority,
          lineIndex: lineIdx,
          positionBonus,
        });
      }
    }
  }

  // --- Pick the best amount ---
  let bestCost = null;

  // First try: amounts on lines with total keywords
  // Sort by priority (highest first), then by position in document (later = better),
  // then by amount (largest first) as tiebreaker
  const keywordAmounts = totalAmounts
    .filter((a) => a.priority > 0)
    .sort((a, b) => {
      // Primary: keyword priority
      if (b.priority !== a.priority) return b.priority - a.priority;
      // Secondary: position in document (later is better for totals)
      if (b.positionBonus !== a.positionBonus) return b.positionBonus - a.positionBonus;
      // Tertiary: larger amount
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
 * "1,234.56" -> 1234.56
 * "1.234,56" -> 1234.56 (European)
 * "1234"     -> 1234
 */
function parseAmount(str) {
  if (!str) return null;

  let cleaned = str.trim();

  // Remove any remaining non-numeric characters except commas, periods, and digits
  cleaned = cleaned.replace(/[^\d.,]/g, '');

  if (!cleaned || cleaned.length === 0) return null;

  // If it has both comma and period, determine which is decimal
  const lastComma = cleaned.lastIndexOf(',');
  const lastPeriod = cleaned.lastIndexOf('.');

  if (lastComma > -1 && lastPeriod > -1) {
    if (lastComma > lastPeriod) {
      // European: "1.234,56" -> comma is decimal
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      // US/UK: "1,234.56" -> period is decimal
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
