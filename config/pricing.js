// ============================================================
// PRICING CONFIG — edit these values to set your own prices.
// Nothing on the Create screen (prompt, genre, duration) is
// ever charged. A price only exists once someone reaches the
// Generate/Payment step, and it is always computed here on the
// server — the browser never decides what something costs.
// ============================================================

module.exports = {
  // Currencies shown to the customer. All prices are calculated
  // in USD first, then converted to INR for display using the
  // rate below.
  currency: {
    base: 'USD',
    display: ['USD', 'INR'],
    usdToInr: 83 // update this periodically — it is not a live exchange rate
  },

  // Base price per second of generated audio, in USD, before any
  // multipliers below. This is the starting point for every quote.
  baseRatePerSecondUSD: 0.05,

  // Per-genre price multiplier. 1.0 = no change from the base rate.
  genreMultipliers: {
    'Lo-fi': 1.0,
    'EDM': 1.3,
    'Hip-Hop': 1.15,
    'Cinematic': 1.6,
    'Ambient': 0.9,
    'Trap': 1.2,
    'Pop': 1.25,
    'Rock': 1.2,
    'Jazz': 1.35
  },

  // Per-engine price multiplier.
  // Lyria 3 is automated, so it stays at the base rate.
  // Your Assistant is made by hand, so it costs more.
  engineMultipliers: {
    lyria: 1.0,
    assistant: 2.0
  },

  // Per-continent price multiplier, applied on top of everything
  // else. North America is the baseline (1.0); other regions are
  // priced lower by default. Adjust freely.
  continentMultipliers: {
    'North America': 1.0,
    'Europe': 0.8,
    'Oceania': 0.8,
    'South America': 0.5,
    'Asia': 0.4,
    'Africa': 0.35
  },

  // No quote is ever allowed to fall below this, regardless of
  // how short the track is.
  minimumChargeUSD: 0.5
};
