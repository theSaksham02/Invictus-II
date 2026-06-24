const RIDESHARE_SOURCE = 'RIDESHARE';
const LEGACY_RIDESHARE_SOURCE = 'NRC';
const RIDESHARE_ALIASES = Object.freeze([RIDESHARE_SOURCE, LEGACY_RIDESHARE_SOURCE]);

function normalizeSource(value, fallback = 'CANSAT') {
  const candidate = (value || fallback || '').toString().trim().toUpperCase();
  if (candidate === LEGACY_RIDESHARE_SOURCE) return RIDESHARE_SOURCE;
  return candidate;
}

function sourceAliases(source) {
  const normalized = normalizeSource(source);
  return normalized === RIDESHARE_SOURCE ? RIDESHARE_ALIASES : [normalized];
}

function isRideshareSource(source) {
  return sourceAliases(source).includes(RIDESHARE_SOURCE) || sourceAliases(source).includes(LEGACY_RIDESHARE_SOURCE);
}

module.exports = {
  LEGACY_RIDESHARE_SOURCE,
  RIDESHARE_ALIASES,
  RIDESHARE_SOURCE,
  isRideshareSource,
  normalizeSource,
  sourceAliases
};
