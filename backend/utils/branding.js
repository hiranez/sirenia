// Product name used in text the backend writes into exports. Set PRODUCT_NAME to rebrand a build.
const MAX_LENGTH = 80;
const PRODUCT_NAME = (process.env.PRODUCT_NAME || '').trim() || 'Sirenia';

if (PRODUCT_NAME.length > MAX_LENGTH) {
  throw new Error(`PRODUCT_NAME must be at most ${MAX_LENGTH} characters`);
}
if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(PRODUCT_NAME)) {
  throw new Error('PRODUCT_NAME must not contain control characters');
}

module.exports = { PRODUCT_NAME };
