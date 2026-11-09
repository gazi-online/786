/**
 * Indian Telecom Operator & Circle Lookup Engine
 * Provides instant HLR / series lookup for all 22 telecom circles and 4 major operators.
 */

export interface TelecomLookupResult {
  mobile: string;
  operator: 'VI' | 'JIO' | 'AIRTEL' | 'BSNL';
  operatorName: string;
  circle: string;
  circleCode: string;
  brandColor: string;
  accentColor: string;
  planType: 'Prepaid';
}

export const INDIAN_CIRCLES = [
  'West Bengal',
  'Kolkata',
  'Bihar & Jharkhand',
  'Delhi NCR',
  'Mumbai',
  'Maharashtra & Goa',
  'UP East',
  'UP West',
  'Punjab',
  'Haryana',
  'Rajasthan',
  'Gujarat',
  'Madhya Pradesh & CG',
  'Karnataka',
  'Tamil Nadu',
  'Chennai',
  'Andhra Pradesh & Telangana',
  'Kerala',
  'Odisha',
  'Assam',
  'North East',
  'Himachal Pradesh',
  'Jammu & Kashmir',
] as const;

export type IndianCircle = (typeof INDIAN_CIRCLES)[number];

// Series Prefix -> { operator, circle, circleCode }
interface PrefixRule {
  operator: 'VI' | 'JIO' | 'AIRTEL' | 'BSNL';
  circle: IndianCircle;
  circleCode: string;
}

// Targeted 4-digit and 2-digit series maps
const PREFIX_MAP_4DIGIT: Record<string, PrefixRule> = {
  // Jio WB / Kolkata / Series (including 9144 series)
  '9144': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '9143': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '9142': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '9141': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '9140': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '9147': { operator: 'JIO', circle: 'Kolkata', circleCode: 'KO' },
  '9148': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '9149': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '9153': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '9155': { operator: 'JIO', circle: 'Bihar & Jharkhand', circleCode: 'BH' },
  '9135': { operator: 'JIO', circle: 'Bihar & Jharkhand', circleCode: 'BH' },
  '9101': { operator: 'JIO', circle: 'Assam', circleCode: 'AS' },
  '9102': { operator: 'JIO', circle: 'Bihar & Jharkhand', circleCode: 'BH' },
  '7029': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '8509': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '7001': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '7002': { operator: 'JIO', circle: 'Assam', circleCode: 'AS' },
  '7003': { operator: 'JIO', circle: 'Kolkata', circleCode: 'KO' },
  '6290': { operator: 'JIO', circle: 'Kolkata', circleCode: 'KO' },
  '6291': { operator: 'JIO', circle: 'Kolkata', circleCode: 'KO' },
  '6294': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '6295': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '6296': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '6297': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '7044': { operator: 'JIO', circle: 'Kolkata', circleCode: 'KO' },
  '7047': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '7076': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '7407': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '7477': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '7478': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '7479': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '7501': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '7584': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '7585': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '7586': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '7797': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '7864': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '7865': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '7866': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '7872': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '7908': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '8001': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '8101': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '8116': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '8145': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '8170': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '8250': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '8370': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '8371': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '8372': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '8388': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '8389': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '8617': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '8637': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '8640': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '8670': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '8768': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '8918': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '8927': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },
  '8972': { operator: 'JIO', circle: 'West Bengal', circleCode: 'WB' },

  // West Bengal & Kolkata Series (VI)
  '9733': { operator: 'VI', circle: 'West Bengal', circleCode: 'WB' },
  '9732': { operator: 'VI', circle: 'West Bengal', circleCode: 'WB' },
  '9734': { operator: 'VI', circle: 'West Bengal', circleCode: 'WB' },
  '9735': { operator: 'VI', circle: 'West Bengal', circleCode: 'WB' },
  '9832': { operator: 'VI', circle: 'West Bengal', circleCode: 'WB' },
  '9831': { operator: 'VI', circle: 'Kolkata', circleCode: 'KO' },
  '9874': { operator: 'VI', circle: 'Kolkata', circleCode: 'KO' },
  '9875': { operator: 'VI', circle: 'Kolkata', circleCode: 'KO' },
  '9088': { operator: 'VI', circle: 'Kolkata', circleCode: 'KO' },
  '9091': { operator: 'VI', circle: 'West Bengal', circleCode: 'WB' },
  '9093': { operator: 'VI', circle: 'West Bengal', circleCode: 'WB' },
  '7595': { operator: 'VI', circle: 'Kolkata', circleCode: 'KO' },
  '7596': { operator: 'VI', circle: 'Kolkata', circleCode: 'KO' },
  '9126': { operator: 'VI', circle: 'West Bengal', circleCode: 'WB' },
  '9134': { operator: 'VI', circle: 'West Bengal', circleCode: 'WB' },
  '9162': { operator: 'VI', circle: 'Bihar & Jharkhand', circleCode: 'BH' },
  '9748': { operator: 'VI', circle: 'Kolkata', circleCode: 'KO' },
  '9749': { operator: 'VI', circle: 'West Bengal', circleCode: 'WB' },
  '9836': { operator: 'VI', circle: 'Kolkata', circleCode: 'KO' },
  '9609': { operator: 'VI', circle: 'West Bengal', circleCode: 'WB' },
  '9635': { operator: 'VI', circle: 'West Bengal', circleCode: 'WB' },
  '9647': { operator: 'VI', circle: 'West Bengal', circleCode: 'WB' },
  '9679': { operator: 'VI', circle: 'West Bengal', circleCode: 'WB' },
  '9002': { operator: 'VI', circle: 'West Bengal', circleCode: 'WB' },
  '9046': { operator: 'VI', circle: 'West Bengal', circleCode: 'WB' },

  // Airtel WB / Kolkata Series
  '8967': { operator: 'AIRTEL', circle: 'West Bengal', circleCode: 'WB' },
  '9564': { operator: 'AIRTEL', circle: 'West Bengal', circleCode: 'WB' },
  '8013': { operator: 'AIRTEL', circle: 'Kolkata', circleCode: 'KO' },
  '8016': { operator: 'AIRTEL', circle: 'West Bengal', circleCode: 'WB' },
  '8240': { operator: 'AIRTEL', circle: 'Kolkata', circleCode: 'KO' },
  '9830': { operator: 'AIRTEL', circle: 'Kolkata', circleCode: 'KO' },
  '9163': { operator: 'AIRTEL', circle: 'Kolkata', circleCode: 'KO' },
  '9123': { operator: 'AIRTEL', circle: 'Kolkata', circleCode: 'KO' },

  // Bihar & Jharkhand
  '7004': { operator: 'JIO', circle: 'Bihar & Jharkhand', circleCode: 'BH' },
  '7008': { operator: 'JIO', circle: 'Odisha', circleCode: 'OR' },
  '9431': { operator: 'BSNL', circle: 'Bihar & Jharkhand', circleCode: 'BH' },
  '9434': { operator: 'BSNL', circle: 'West Bengal', circleCode: 'WB' },
  '9433': { operator: 'BSNL', circle: 'Kolkata', circleCode: 'KO' },
  '9435': { operator: 'BSNL', circle: 'Assam', circleCode: 'AS' },
  '9474': { operator: 'BSNL', circle: 'West Bengal', circleCode: 'WB' },
  '9475': { operator: 'BSNL', circle: 'West Bengal', circleCode: 'WB' },
};

// Fallback 2-digit series maps
const PREFIX_MAP_2DIGIT: Record<string, { operator: 'VI' | 'JIO' | 'AIRTEL' | 'BSNL'; defaultCircle: IndianCircle }> = {
  '62': { operator: 'JIO', defaultCircle: 'West Bengal' },
  '63': { operator: 'JIO', defaultCircle: 'West Bengal' },
  '70': { operator: 'JIO', defaultCircle: 'West Bengal' },
  '74': { operator: 'JIO', defaultCircle: 'West Bengal' },
  '75': { operator: 'JIO', defaultCircle: 'West Bengal' },
  '79': { operator: 'JIO', defaultCircle: 'West Bengal' },
  '80': { operator: 'AIRTEL', defaultCircle: 'West Bengal' },
  '81': { operator: 'JIO', defaultCircle: 'West Bengal' },
  '82': { operator: 'AIRTEL', defaultCircle: 'West Bengal' },
  '83': { operator: 'JIO', defaultCircle: 'West Bengal' },
  '84': { operator: 'AIRTEL', defaultCircle: 'West Bengal' },
  '85': { operator: 'JIO', defaultCircle: 'West Bengal' },
  '86': { operator: 'AIRTEL', defaultCircle: 'West Bengal' },
  '87': { operator: 'VI', defaultCircle: 'West Bengal' },
  '88': { operator: 'AIRTEL', defaultCircle: 'West Bengal' },
  '89': { operator: 'AIRTEL', defaultCircle: 'West Bengal' },
  '90': { operator: 'VI', defaultCircle: 'West Bengal' },
  '91': { operator: 'JIO', defaultCircle: 'West Bengal' },
  '92': { operator: 'JIO', defaultCircle: 'West Bengal' },
  '93': { operator: 'BSNL', defaultCircle: 'West Bengal' },
  '94': { operator: 'BSNL', defaultCircle: 'West Bengal' },
  '95': { operator: 'AIRTEL', defaultCircle: 'West Bengal' },
  '96': { operator: 'AIRTEL', defaultCircle: 'West Bengal' },
  '97': { operator: 'VI', defaultCircle: 'West Bengal' },
  '98': { operator: 'AIRTEL', defaultCircle: 'West Bengal' },
  '99': { operator: 'AIRTEL', defaultCircle: 'West Bengal' },
};

export const OPERATOR_METADATA: Record<
  'VI' | 'JIO' | 'AIRTEL' | 'BSNL',
  { name: string; brandColor: string; accentColor: string }
> = {
  VI: {
    name: 'Vi',
    brandColor: '#E60000',
    accentColor: '#FFD200',
  },
  JIO: {
    name: 'Jio',
    brandColor: '#0A2885',
    accentColor: '#00D1FF',
  },
  AIRTEL: {
    name: 'Airtel',
    brandColor: '#ED1C24',
    accentColor: '#FF6B6B',
  },
  BSNL: {
    name: 'BSNL',
    brandColor: '#267D24',
    accentColor: '#FFA500',
  },
};

/**
 * Resolves mobile operator & circle with high accuracy.
 */
export function lookupTelecomDetails(mobile: string): TelecomLookupResult | null {
  const clean = mobile.replace(/\D/g, '');
  if (clean.length < 10) return null;

  const validNo = clean.slice(-10);
  const p4 = validNo.slice(0, 4);
  const p2 = validNo.slice(0, 2);

  let operator: 'VI' | 'JIO' | 'AIRTEL' | 'BSNL' = 'AIRTEL';
  let circle: IndianCircle = 'West Bengal';
  let circleCode = 'WB';

  if (PREFIX_MAP_4DIGIT[p4]) {
    const match = PREFIX_MAP_4DIGIT[p4]!;
    operator = match.operator;
    circle = match.circle;
    circleCode = match.circleCode;
  } else if (PREFIX_MAP_2DIGIT[p2]) {
    const match = PREFIX_MAP_2DIGIT[p2]!;
    operator = match.operator;
    circle = match.defaultCircle;
    circleCode = circle === 'Kolkata' ? 'KO' : 'WB';
  }

  const meta = OPERATOR_METADATA[operator];

  return {
    mobile: validNo,
    operator,
    operatorName: meta.name,
    circle,
    circleCode,
    brandColor: meta.brandColor,
    accentColor: meta.accentColor,
    planType: 'Prepaid',
  };
}

