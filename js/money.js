// Amounts are stored as integer cents (a fixed scale of 100) whatever the currency,
// so switching currency only changes how numbers are shown, never the stored values.

export const CURRENCIES = [
  ['SGD', 'Singapore dollar'],
  ['USD', 'US dollar'],
  ['EUR', 'Euro'],
  ['GBP', 'British pound'],
  ['AUD', 'Australian dollar'],
  ['NZD', 'New Zealand dollar'],
  ['CAD', 'Canadian dollar'],
  ['MYR', 'Malaysian ringgit'],
  ['HKD', 'Hong Kong dollar'],
  ['CNY', 'Chinese yuan'],
  ['JPY', 'Japanese yen'],
  ['KRW', 'South Korean won'],
  ['TWD', 'New Taiwan dollar'],
  ['THB', 'Thai baht'],
  ['PHP', 'Philippine peso'],
  ['IDR', 'Indonesian rupiah'],
  ['VND', 'Vietnamese dong'],
  ['INR', 'Indian rupee'],
  ['AED', 'UAE dirham'],
  ['CHF', 'Swiss franc'],
  ['SEK', 'Swedish krona'],
  ['NOK', 'Norwegian krone'],
  ['DKK', 'Danish krone'],
  ['ZAR', 'South African rand'],
  ['BRL', 'Brazilian real'],
  ['MXN', 'Mexican peso'],
];

const REGION_CURRENCY = {
  SG: 'SGD', US: 'USD', GB: 'GBP', AU: 'AUD', NZ: 'NZD', CA: 'CAD', MY: 'MYR', HK: 'HKD',
  CN: 'CNY', JP: 'JPY', KR: 'KRW', TW: 'TWD', TH: 'THB', PH: 'PHP', ID: 'IDR', VN: 'VND',
  IN: 'INR', AE: 'AED', CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', ZA: 'ZAR', BR: 'BRL',
  MX: 'MXN', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', IE: 'EUR', AT: 'EUR',
  BE: 'EUR', FI: 'EUR', PT: 'EUR', GR: 'EUR', LU: 'EUR',
};

export function guessCurrency(language = globalThis.navigator?.language ?? 'en-US') {
  try {
    return REGION_CURRENCY[new Intl.Locale(language).maximize().region] ?? 'USD';
  } catch {
    return 'USD';
  }
}

const formatters = new Map();
function formatter(currency, options = {}) {
  const key = currency + JSON.stringify(options);
  if (!formatters.has(key)) {
    formatters.set(key, new Intl.NumberFormat(undefined, { style: 'currency', currency, currencyDisplay: 'narrowSymbol', ...options }));
  }
  return formatters.get(key);
}

export function fractionDigits(currency) {
  return formatter(currency).resolvedOptions().maximumFractionDigits;
}

export function formatMoney(cents, currency, { sign = false } = {}) {
  const text = formatter(currency).format(Math.abs(cents) / 100);
  if (cents < 0) return `−${text}`;
  return sign && cents > 0 ? `+${text}` : text;
}

export function formatCompact(cents, currency) {
  return formatter(currency, { notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(cents / 100);
}

// Short, glanceable amounts: "£971" or "£5.1K".
export function formatApprox(cents, currency) {
  if (Math.abs(cents) >= 100000) return formatCompact(cents, currency);
  return formatter(currency, { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(cents / 100);
}

// The plain number shown in an input field, e.g. 1250 -> "12.50" (or "13" for yen).
export function centsToInput(cents, currency) {
  if (fractionDigits(currency) === 0) return String(Math.round(cents / 100));
  const whole = Math.trunc(cents / 100);
  return `${whole}.${String(Math.abs(cents % 100)).padStart(2, '0')}`;
}

// Parses what someone typed into an amount field. Accepts "1,234.50", "12,5" (comma
// decimals) and stray currency symbols. Returns integer cents, or null if unreadable.
export function parseAmount(text) {
  let s = String(text ?? '').trim().replace(/[^\d.,]/g, '');
  if (!s.includes('.') && /,\d{1,2}$/.test(s)) s = s.replace(/,(?=\d{1,2}$)/, '.');
  s = s.replace(/,/g, '');
  if (!/^(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const cents = Number(whole || 0) * 100 + Number(`${frac}00`.slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : null;
}
