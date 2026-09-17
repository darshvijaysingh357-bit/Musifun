const config = require('../config/pricing');

function computeQuote({ genre, durationSeconds, engine, continent }) {
  const genreMult = config.genreMultipliers[genre];
  const engineMult = config.engineMultipliers[engine];
  const continentMult = config.continentMultipliers[continent];

  if (genreMult === undefined) {
    throw new Error(`Unknown genre: ${genre}`);
  }
  if (engineMult === undefined) {
    throw new Error(`Unknown engine: ${engine}`);
  }
  if (continentMult === undefined) {
    throw new Error(`Unknown continent: ${continent}`);
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 184) {
    throw new Error('Duration must be between 1 and 184 seconds.');
  }

  let usd = config.baseRatePerSecondUSD * durationSeconds * genreMult * engineMult * continentMult;
  usd = Math.max(usd, config.minimumChargeUSD);
  usd = Math.round(usd * 100) / 100;
  const inr = Math.round(usd * config.currency.usdToInr);

  return {
    usd,
    inr,
    currency: config.currency,
    breakdown: {
      baseRatePerSecondUSD: config.baseRatePerSecondUSD,
      genreMultiplier: genreMult,
      engineMultiplier: engineMult,
      continentMultiplier: continentMult
    }
  };
}

module.exports = {
  computeQuote,
  genres: Object.keys(config.genreMultipliers),
  continents: Object.keys(config.continentMultipliers)
};
