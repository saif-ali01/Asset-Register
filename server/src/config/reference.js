/**
 * Domain rules read out of the source register rather than invented.
 * Kept in one place so the importer, the seed and the data-quality report
 * all normalise identically.
 */

/**
 * Status vocabulary, taken verbatim from the register's own "Status Options"
 * list so the app doesn't ask anyone to relearn their own process.
 */
export const ASSET_STATUSES = [
  'available', 'checked_out', 'under_repair', 'leased',
  'lost_missing', 'donated', 'sold', 'disposed',
];

/**
 * Statuses where a named holder is expected. The register is strict about
 * this: all 586 checked-out rows name someone and no other row does, so
 * "has a holder" and "is checked out" mean exactly the same thing. Leased
 * assets sit with an external party and carry no internal holder.
 */
export const ASSIGNED_STATUSES = ['checked_out'];

/** Statuses that make an asset unavailable to check out. */
export const UNAVAILABLE_STATUSES = ['checked_out', 'leased', 'under_repair'];

/** Statuses that take an asset off the live register for good. */
export const CLOSED_STATUSES = ['disposed', 'sold', 'donated', 'lost_missing'];

export const ASSET_CONDITIONS = ['new', 'good', 'fair', 'poor', 'damaged'];
export const DEPRECIATION_METHODS = ['none', 'straight_line', 'wdv'];

/** Free-text status → enum. Keys are compared lowercase, punctuation stripped. */
export const STATUS_ALIASES = {
  available: 'available', instock: 'available', 'in stock': 'available', free: 'available',
  unassigned: 'available', spare: 'available',

  'checked out': 'checked_out', checkedout: 'checked_out', issued: 'checked_out',
  assigned: 'checked_out', 'in use': 'checked_out', allocated: 'checked_out',

  'under repair': 'under_repair', repair: 'under_repair', 'in repair': 'under_repair',
  servicing: 'under_repair', faulty: 'under_repair', 'not working': 'under_repair',

  leased: 'leased', rented: 'leased', 'on rent': 'leased', lease: 'leased',

  'lost missing': 'lost_missing', lost: 'lost_missing', missing: 'lost_missing',
  stolen: 'lost_missing', untraceable: 'lost_missing',

  donated: 'donated', gifted: 'donated',
  sold: 'sold',

  disposed: 'disposed', scrapped: 'disposed', 'written off': 'disposed',
  discarded: 'disposed', ewaste: 'disposed', retired: 'disposed',
};

/**
 * Category spellings that mean the same thing. The register carries several
 * casing and spacing variants that would otherwise become separate rows.
 */
export const CATEGORY_CANONICAL = {
  'bar code scanner': 'Barcode Scanner',
  'barcode scanner': 'Barcode Scanner',
  'android barcode scanner': 'Android Barcode Scanner',
  'poe switch': 'POE Switch',
  'biomatric machine': 'Biometric Machine',
  'biometric machine': 'Biometric Machine',
  'digital camera': 'Digital Camera',
  'network video recorder': 'Network Video Recorder',
  'web confrencing speaker': 'Web Conferencing Speaker',
  'wireless microphone': 'Wireless Microphone',
  router: 'Router',
  'presentation led': 'Presentation LED',
  'external hdd': 'External HDD',
  ups: 'UPS',
  dvr: 'DVR',
};

/** Department spellings that mean the same team. */
export const DEPARTMENT_CANONICAL = {
  'hr admin it': 'HR, Admin & IT',
  'hr, admin & it': 'HR, Admin & IT',
  hr: 'HR, Admin & IT',
  administration: 'HR, Admin & IT',
  production: 'Production Management',
  'production management': 'Production Management',
  'supply chain': 'Supply Chain & Logistics',
  'supply chain & logistics': 'Supply Chain & Logistics',
  logistics: 'Supply Chain & Logistics',
  warehouse: 'Supply Chain & Logistics',
  store: 'Store',
  marketing: 'Marketing & Creative',
  'marketing & creative': 'Marketing & Creative',
  accounts: 'Finance, Accounts & Legal',
  'finance, accounts & legal': 'Finance, Accounts & Legal',
  'it department': 'IT Department',
  'e commerce': 'E Commerce',
  'md office': 'MD Office',
};

/**
 * Values that appear in the Department column but are not departments.
 * Imported into notes rather than creating a bogus department record.
 */
export const NON_DEPARTMENTS = ['receipt printer', 'walnut confrenceroom', 'walnut conference room'];

/** Owning group company, taken from the tag prefix. Longest match wins. */
export const ENTITY_PREFIXES = [
  ['NUTRAJ', 'Nutraj'],
  ['AURO', 'Auro'],
  ['NL-', 'Nutlounge'],
  ['NL', 'Nutlounge'],
  ['VFI', 'VFI'],
  ['VNS', 'VNS'],
  ['RENTED', 'Rented'],
  ['VKC', 'VKC'],
];

/**
 * Type code inside the tag → category. Used only to fill a blank Category
 * cell; an explicit value in the sheet always wins.
 */
export const TAG_CODE_CATEGORY = {
  LT: 'Laptop', MLT: 'Laptop', PC: 'Desktop', PH: 'Mobile', WT: 'Walkie-Talkie',
  SW: 'Switch', POESW: 'POE Switch', BM: 'Biometric Machine', DVR: 'DVR',
  NVR: 'Network Video Recorder', BS: 'Barcode Scanner', BSC: 'Barcode Scanner',
  SCN: 'Android Barcode Scanner', PT: 'Printer', LPT: 'Printer', TPT: 'Printer',
  BPT: 'Printer', RPT: 'Barcode Printer', RTP: 'Barcode Printer', RT: 'Access Point',
  WF: 'Access Point', FW: 'Firewall', TV: 'Presentation LED', UPS: 'UPS',
  RCK: 'Server Rack', SVR: 'Server', NAS: 'Backup Device', DC: 'Data Card',
  C: 'Data Card', EXTHDD: 'External HDD', HP: 'Headphone', WCAM: 'Webcam',
  WIPCAM: 'Wireless Camera', DGTCAM: 'Digital Camera', WM: 'Wireless Microphone',
  WCS: 'Web Conferencing Speaker', TP: 'Telephone', NUTS: 'Desktop',
};

/** Serial values that are placeholders, not identifiers. */
export const PLACEHOLDER_SERIALS = [
  'assemble', 'assembled', '12345678', 'na', 'n/a', '-', 'nil', 'none', '0', '00',
];

const squash = (s) => String(s ?? '').trim().toLowerCase().replace(/[._\-/]+/g, ' ').replace(/\s+/g, ' ');

export const normaliseStatus = (raw, fallback = 'available') =>
  STATUS_ALIASES[squash(raw)] || fallback;

export const canonicalCategory = (raw) => {
  const key = squash(raw);
  if (!key) return '';
  if (CATEGORY_CANONICAL[key]) return CATEGORY_CANONICAL[key];
  // Title-case anything unrecognised so casing variants collapse together.
  return String(raw).trim().replace(/\s+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};

export const canonicalDepartment = (raw) => {
  const key = squash(raw);
  if (!key || NON_DEPARTMENTS.includes(key)) return '';
  return DEPARTMENT_CANONICAL[key] || String(raw).trim().replace(/\s+/g, ' ');
};

export const entityFromTag = (tag) => {
  const upper = String(tag || '').trim().toUpperCase();
  for (const [prefix, label] of ENTITY_PREFIXES) {
    if (upper.startsWith(prefix)) return label;
  }
  return '';
};

/** Pulls the alphabetic type code that sits between entity prefix and number. */
export const tagCodeFromTag = (tag) => {
  const upper = String(tag || '').trim().toUpperCase();
  let rest = upper;
  for (const [prefix] of ENTITY_PREFIXES) {
    if (upper.startsWith(prefix)) { rest = upper.slice(prefix.length); break; }
  }
  const match = rest.replace(/^[^A-Z]+/, '').match(/^[A-Z]+/);
  return match ? match[0] : '';
};

export const categoryFromTag = (tag) => TAG_CODE_CATEGORY[tagCodeFromTag(tag)] || '';

export const isPlaceholderSerial = (serial) =>
  PLACEHOLDER_SERIALS.includes(String(serial ?? '').trim().toLowerCase());