const path = require('path');

/**
 * Process an invoice file using Tesseract.js OCR.
 * For image files, extracts text using OCR.
 * For PDFs, skips OCR and returns null (PDF text extraction not yet supported).
 *
 * @param {string} filePath - Absolute path to the file
 * @returns {Promise<string|null>} Extracted text or null if not processable
 */
async function processInvoice(filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();

    // Skip OCR for PDF files
    if (ext === '.pdf') {
      console.log(`Skipping OCR for PDF file: ${filePath}`);
      return null;
    }

    // Only process image files
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.heic'];
    if (!imageExtensions.includes(ext)) {
      console.log(`Unsupported file type for OCR: ${ext}`);
      return null;
    }

    // Lazy-load Tesseract.js to avoid slow startup
    const Tesseract = require('tesseract.js');

    console.log(`Starting OCR processing for: ${filePath}`);

    const { data } = await Tesseract.recognize(filePath, 'eng', {
      logger: (info) => {
        if (info.status === 'recognizing text') {
          // Only log progress at certain intervals to avoid spam
          const progress = Math.round(info.progress * 100);
          if (progress % 25 === 0) {
            console.log(`OCR progress: ${progress}%`);
          }
        }
      },
    });

    const extractedText = data.text ? data.text.trim() : '';
    console.log(
      `OCR complete for ${path.basename(filePath)}: extracted ${extractedText.length} characters.`
    );

    return extractedText;
  } catch (error) {
    console.error(`OCR processing failed for ${filePath}:`, error.message);
    return null;
  }
}

module.exports = { processInvoice };
