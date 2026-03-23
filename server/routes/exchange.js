const express = require('express');
const router = express.Router();

// Fixed rates to AED (as of common reference, AED is pegged to USD)
const FIXED_RATES_TO_AED = {
  AED: 1,
  USD: 3.6725, // pegged
  EUR: 4.02,
  GBP: 4.65,
  INR: 0.044,
  SAR: 0.979,
  KWD: 11.95,
  BHD: 9.74,
  OMR: 9.54,
  QAR: 1.009,
  JPY: 0.024,
  CNY: 0.505,
  CAD: 2.68,
  AUD: 2.38,
  CHF: 4.15,
  SGD: 2.75,
  MYR: 0.82,
  PKR: 0.013,
  PHP: 0.064,
  EGP: 0.075,
};

/**
 * GET /rate?from=USD&to=AED&date=2024-01-15
 * Returns the exchange rate. Uses a free API for historical rates,
 * falls back to fixed rates.
 */
router.get('/rate', async (req, res) => {
  try {
    const { from = 'USD', to = 'AED', date } = req.query;

    if (from === to) {
      return res.json({ rate: 1, source: 'identity' });
    }

    // Try to fetch from a free API for historical rates
    // Using exchangerate-api.com free endpoint via frankfurter + USD peg
    if (date) {
      try {
        const usdToAed = 3.6725;

        if (from === 'USD') {
          // No API call needed -- USD is our pivot currency
          if (to === 'AED') {
            return res.json({ rate: usdToAed, source: 'fixed', date });
          }
          // USD -> other: fetch USD->to directly
          const response = await fetch(
            `https://api.frankfurter.app/${date}?from=USD&to=${to}`
          );
          if (response.ok) {
            const data = await response.json();
            if (data.rates && data.rates[to]) {
              return res.json({ rate: Math.round(data.rates[to] * 10000) / 10000, source: 'frankfurter', date: data.date });
            }
          }
        } else {
          // Frankfurter provides ECB rates. Get from->USD rate, then multiply by USD->AED
          const response = await fetch(
            `https://api.frankfurter.app/${date}?from=${from}&to=USD`
          );
          if (response.ok) {
            const data = await response.json();
            if (data.rates && data.rates.USD) {
              const fromToUsd = data.rates.USD;
              if (to === 'AED') {
                const rate = fromToUsd * usdToAed;
                return res.json({ rate: Math.round(rate * 10000) / 10000, source: 'frankfurter', date: data.date });
              }
              // from -> USD -> to: need a second lookup
              const response2 = await fetch(
                `https://api.frankfurter.app/${date}?from=USD&to=${to}`
              );
              if (response2.ok) {
                const data2 = await response2.json();
                if (data2.rates && data2.rates[to]) {
                  const rate = fromToUsd * data2.rates[to];
                  return res.json({ rate: Math.round(rate * 10000) / 10000, source: 'frankfurter', date: data.date });
                }
              }
            }
          }
        }
      } catch (e) {
        // API failed, fall back to fixed rates
      }
    }

    // Fallback: use fixed rates
    // Convert: from -> AED
    if (to === 'AED' && FIXED_RATES_TO_AED[from]) {
      return res.json({ rate: FIXED_RATES_TO_AED[from], source: 'fixed' });
    }

    // Convert via AED
    const fromRate = FIXED_RATES_TO_AED[from];
    const toRate = FIXED_RATES_TO_AED[to];
    if (fromRate && toRate) {
      const rate = fromRate / toRate;
      return res.json({ rate: Math.round(rate * 10000) / 10000, source: 'fixed' });
    }

    res.status(400).json({ error: `Unsupported currency: ${from} or ${to}` });
  } catch (error) {
    console.error('Exchange rate error:', error.message);
    res.status(500).json({ error: 'Failed to get exchange rate.' });
  }
});

/**
 * GET /currencies - List supported currencies
 */
router.get('/currencies', (req, res) => {
  const currencies = Object.keys(FIXED_RATES_TO_AED).map(code => ({
    code,
    rateToAed: FIXED_RATES_TO_AED[code],
  }));
  res.json(currencies);
});

module.exports = router;
