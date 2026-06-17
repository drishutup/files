import type { ServiceFormPlugin } from './_types';
import { useAuthStore } from '@/store/authStore';
/* =========================
   PLACE YOUR FIELD CODES HERE
========================= */

// Groom
const GROOM_MARITAL_STATUS = 'UK-FCL-03039_0'; // select: Unmarried / Divorced / Widower
const GROOM_COURT_DECREE = 'UK-FCL-04017_0';
const GROOM_DEATH_CERTIFICATE = 'UK-FCL-03245_0';
const GROOM_RELIGION = 'UK-FCL-03027_0';
const GROOM_DOB = 'UK-FCL-03021_0';
const GROOM_AGE_DISPLAY = 'UK-FCL-03029_0'; // "Age At Date of Marriage" - Groom

// Bride
const BRIDE_MARITAL_STATUS = 'UK-FCL-04018_0'; // select: Unmarried / Divorced / Widower
const BRIDE_COURT_DECREE = 'UK-FCL-03278_0';
const BRIDE_DEATH_CERTIFICATE = 'UK-FCL-03338_0';
const BRIDE_RELIGION = 'UK-FCL-03270_0';
const BRIDE_DOB = 'UK-FCL-03269_0';
const BRIDE_AGE_DISPLAY = 'UK-FCL-03273_0'; // "Age At Date of Marriage" - Bride

// Nikahnama
const SOLEMNIZER_RELIGION = 'UK-FCL-03045_0'; // select
const NIKAHNAMA_UPLOAD = 'UK-FCL-04019_0';
const NIKAHNAMA_TRANSLATION = 'UK-FCL-04020_0';

// Religion conversion
const CONVERSION_CERTIFICATE = 'UK-FCL-04022_0';
const ADDITIONAL_DOCUMENTS_CATEGORY = 'UK-CAT-525_0';
const WITNESS_AGE_FIELD_1 = 'UK-FCL-04295_0';
const WITNESS_AGE_FIELD_2 = 'UK-FCL-04296_0';
const WITNESS_AGE_FIELD_3 = 'UK-FCL-04297_0';
const WITNESS_AGE_FIELDS = new Set([WITNESS_AGE_FIELD_1, WITNESS_AGE_FIELD_2, WITNESS_AGE_FIELD_3]);



/* =========================
   MARRIAGE INVITATION
========================= */
const MARRIAGE_INVITATION_FIELD = 'UK-FCL-03018_0'; // Yes/No field
const UPLOAD_INVITATION_CARD_FIELD = 'UK-FCL-03019_0';
const UPLOAD_GENERAL_STAMP_PAPER_FIELD = 'UK-FCL-04077_0';
const UPLOAD_MANDAL_VALIDITY_FIELD = 'UK-FCL-04034_0';
const DEFAULT_INVITATION_YES_VALUE = '3048';
const APPLICANT_NAME_FIELD = 'UK-FCL-04059_0';

/**
 * English to Marathi Translation
 */
const englishToMarathi = async (text: string, signal?: AbortSignal): Promise<string> => {
  if (!text) return "";

  const parts = text.split(/([,])/); 

  const translatedParts = await Promise.all(
    parts.map(async (part) => {
      if (part === ",") return part;

      const url = `https://inputtools.google.com/request?text=${encodeURIComponent(
        part.trim()
      )}&itc=mr-t-i0-und&num=1`;

      try {
        const response = await fetch(url, { signal });
        const data = await response.json();

        if (data[0] === "SUCCESS") {
          return data[1][0][1][0];
        }
        return part;
      } catch {
        return part;
      }
    })
  );

  return translatedParts.join("");
};

const MARATHI_TRANSLATION_MAP: Record<string, string> = {
  'UK-FCL-03285_0': 'UK-FCL-04330_0', // Full Name -> Name in Marathi
  'UK-FCL-03050_0': 'UK-FCL-04332_0', // Residential Address -> Residential Address in Marathi
  'UK-FCL-03281_0': 'UK-FCL-04333_0', // Residential Address -> Residential Address in Marathi
  'UK-FCL-03265_0': 'UK-FCL-04331_0', // Permanent Address -> Permanent Address in Marathi
};

/**
 * Normalize select / multiselect value
 */
function normalize(value: unknown): string {
  if (value === null || value === undefined) return '';

  let v: unknown = value;
  if (Array.isArray(v)) {
    v = v.length > 0 ? v[0] : '';
  }

  if (v && typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    v = obj.value ?? obj.code ?? obj.id ?? obj.label ?? obj.name ?? '';
  }

  return String(v).trim().toLowerCase();
}

function normalizeMaritalStatus(value: unknown): 'unmarried' | 'divorced' | 'widowed' | '' {
  const token = normalize(value).replace(/\s+/g, ' ');
  if (!token) return '';

  if (
    token.includes('unmarried') ||
    token.includes('never married') ||
    ['1', '21', '412872'].includes(token)
  ) {
    return 'unmarried';
  }

  if (
    token.includes('divorc') ||
    ['2', '31', '412873'].includes(token)
  ) {
    return 'divorced';
  }

  if (
    token.includes('widow') ||
    token.includes('widower') ||
    token.includes('widow(er)') ||
    token.includes('wndower') ||
    ['3', '41', '412874'].includes(token)
  ) {
    return 'widowed';
  }

  return '';
}

function isDivorcedStatus(value: unknown): boolean {
  return normalizeMaritalStatus(value) === 'divorced';
}

function isWidowedStatus(value: unknown): boolean {
  return normalizeMaritalStatus(value) === 'widowed';
}

function isMuslim(value: unknown): boolean {
  const tokens = getReligionTokens(value);
  return tokens.includes('religion:muslim') || tokens.includes('religion:index:2');
}

function shouldShowNikahnama(values: Record<string, unknown>): boolean {
  const solemnizerReligion = values[SOLEMNIZER_RELIGION];
  const groomReligion = values[GROOM_RELIGION];
  const brideReligion = values[BRIDE_RELIGION];

  if (isMuslim(solemnizerReligion)) return true;
  if (isMuslim(groomReligion) && isMuslim(brideReligion)) return true;
  return false;
}

function shouldShowConversionCertificate(values: Record<string, unknown>): boolean {
  const groomReligion = values[GROOM_RELIGION];
  const brideReligion = values[BRIDE_RELIGION];
  if (!groomReligion || !brideReligion) return false;
  return !areReligionsEquivalent(groomReligion, brideReligion);
}

function shouldShowAdditionalDocumentsCategory(values: Record<string, unknown>): boolean {
  return shouldShowNikahnama(values) || shouldShowConversionCertificate(values);
}

function normalizeReligionAlias(token: string): string {
  const t = String(token || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!t) return '';

  if (t.includes('muslim') || t.includes('islam') || ['2', '13', '412876'].includes(t)) return 'religion:muslim';
  if (t.includes('hindu')) return 'religion:hindu';
  if (t.includes('christ')) return 'religion:christian';
  if (t.includes('sikh')) return 'religion:sikh';
  if (t.includes('jain')) return 'religion:jain';
  if (t.includes('buddh')) return 'religion:buddhist';
  if (t.includes('parsi') || t.includes('zoro')) return 'religion:parsi';
  if (t.includes('jew')) return 'religion:jewish';

  return t;
}

function getReligionIndexAliases(token: string): string[] {
  const t = String(token || '').trim().toLowerCase();
  if (!/^\d+$/.test(t)) return [];

  const n = Number(t);
  if (!Number.isInteger(n) || n <= 0) return [];

  const aliases = new Set<string>();

  if (n >= 1 && n <= 20) aliases.add(`religion:index:${n}`);
  if (n >= 12 && n <= 31) aliases.add(`religion:index:${n - 11}`);
  if (n >= 412875 && n <= 412930) aliases.add(`religion:index:${n - 412874}`);

  return Array.from(aliases);
}

function getReligionTokens(value: unknown): string[] {
  const out = new Set<string>();

  const push = (raw: unknown) => {
    if (raw === null || raw === undefined) return;
    const token = String(raw).trim().toLowerCase().replace(/\s+/g, ' ');
    if (!token) return;
    out.add(token);
    out.add(normalizeReligionAlias(token));
    getReligionIndexAliases(token).forEach((alias) => out.add(alias));
  };

  const visit = (input: unknown) => {
    if (input === null || input === undefined) return;

    if (Array.isArray(input)) {
      if (input.length > 0) visit(input[0]);
      return;
    }

    if (typeof input === 'object') {
      const obj = input as Record<string, unknown>;
      push(obj.value);
      push(obj.code);
      push(obj.id);
      push(obj.label);
      push(obj.name);
      return;
    }

    push(input);
  };

  visit(value);
  return Array.from(out).filter(Boolean);
}

function hasAnyCommonToken(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const setA = new Set(a);
  return b.some((token) => setA.has(token));
}

function areReligionsEquivalent(left: unknown, right: unknown): boolean {
  const leftTokens = getReligionTokens(left);
  const rightTokens = getReligionTokens(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) return false;
  return hasAnyCommonToken(leftTokens, rightTokens);
}

function validateSolemnizerReligionSelection(
  solemnizerReligion: unknown,
  values: Record<string, unknown>,
): string | undefined {
  const solemnizerTokens = getReligionTokens(solemnizerReligion);
  if (solemnizerTokens.length === 0) return undefined;

  const groomTokens = getReligionTokens(values?.[GROOM_RELIGION]);
  const brideTokens = getReligionTokens(values?.[BRIDE_RELIGION]);
  if (groomTokens.length === 0 || brideTokens.length === 0) return undefined;

  const isSameReligion = hasAnyCommonToken(groomTokens, brideTokens);

  if (isSameReligion) {
    const valid = hasAnyCommonToken(solemnizerTokens, groomTokens) || hasAnyCommonToken(solemnizerTokens, brideTokens);
    if (valid) return undefined;
    return 'Solemnizer religion must be the same as Bride and Groom religion';
  }

  if (hasAnyCommonToken(solemnizerTokens, groomTokens) || hasAnyCommonToken(solemnizerTokens, brideTokens)) {
    return undefined;
  }

  return "Solemnizer religion must match either bride's or groom's religion";
}

type InvitationAnswer = 'yes' | 'no' | 'unknown';

function getInvitationTokens(value: unknown): string[] {
  const tokens: string[] = [];

  const pushToken = (raw: unknown) => {
    if (raw === null || raw === undefined) return;
    const token = String(raw).trim().toLowerCase().replace(/\s+/g, ' ');
    if (token) tokens.push(token);
  };

  const visit = (input: unknown) => {
    if (input === null || input === undefined) return;

    if (Array.isArray(input)) {
      if (input.length > 0) visit(input[0]);
      return;
    }

    if (typeof input === 'object') {
      const obj = input as Record<string, unknown>;
      pushToken(obj.value);
      pushToken(obj.code);
      pushToken(obj.id);
      pushToken(obj.label);
      pushToken(obj.name);
      return;
    }

    pushToken(input);
  };

  visit(value);
  return Array.from(new Set(tokens));
}

function getInvitationAnswer(value: unknown): InvitationAnswer {
  const tokens = getInvitationTokens(value);
  if (tokens.length === 0) return 'unknown';

  if (tokens.includes('3048')) return 'yes';
  if (tokens.includes('3049')) return 'no';
  if (tokens.includes('1')) return 'yes';
  if (tokens.includes('2')) return 'no';

  const hasNoToken = tokens.some((token) =>
    token === 'no' ||
    token === 'n' ||
    token === 'false' ||
    token === 'off' ||
    token.startsWith('no') ||
    token.includes('not available') ||
    token.includes("don't have") ||
    token.includes('do not have') ||
    token.includes('dont have')
  );
  if (hasNoToken) return 'no';

  const hasYesToken = tokens.some((token) =>
    ['yes', 'y', '1', 'true', 'on'].includes(token) ||
    token.startsWith('yes') ||
    ['available', 'invitation card available'].includes(token)
  );
  if (hasYesToken) return 'yes';

  return 'unknown';
}

function isInvitationYes(value: unknown): boolean {
  return getInvitationAnswer(value) === 'yes';
}

function isInvitationNo(value: unknown): boolean {
  return getInvitationAnswer(value) === 'no';
}

function shouldShowInvitationUpload(values: Record<string, unknown>): boolean {
  if (!MARRIAGE_INVITATION_FIELD) return false;
  return getInvitationAnswer(values[MARRIAGE_INVITATION_FIELD]) === 'yes';
}

function shouldShowStampPaperUpload(values: Record<string, unknown>): boolean {
  if (!MARRIAGE_INVITATION_FIELD) return false;
  return getInvitationAnswer(values[MARRIAGE_INVITATION_FIELD]) === 'no';
}

function shouldShowMandalValidityUpload(values: Record<string, unknown>): boolean {
  if (!MARRIAGE_INVITATION_FIELD) return false;
  return getInvitationAnswer(values[MARRIAGE_INVITATION_FIELD]) === 'no';
}

function hasText(value: unknown): boolean {
  return String(value ?? '').trim().length > 0;
}

function parseWitnessAgeValue(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const candidate = String(value).trim();
  if (!candidate) return undefined;
  const numeric = parseFloat(candidate.replace(/[^0-9.+-]+/g, ''));
  return Number.isFinite(numeric) ? numeric : undefined;
}

function getFieldCodeParts(fieldCode: unknown) {
  const raw = String(fieldCode || '').trim();
  const match = raw.match(/^(.+?-)(\d+)(_0)$/);
  if (!match) return null;
  return {
    prefix: match[1],
    number: Number(match[2]),
    suffix: match[3],
    digits: match[2].length,
  };
}

function getAdjacentFieldCodes(fieldCode: unknown, offsets: number[]) {
  const parts = getFieldCodeParts(fieldCode);
  if (!parts) return [];
  return offsets
    .map((offset) => {
      const nextNumber = parts.number + offset;
      if (nextNumber <= 0) return null;
      return `${parts.prefix}${String(nextNumber).padStart(parts.digits, '0')}${parts.suffix}`;
    })
    .filter((code): code is string => Boolean(code));
}

function findNearbyDateValue(fieldCode: unknown, values: Record<string, unknown>): unknown | undefined {
  const candidates = [String(fieldCode || '')].concat(getAdjacentFieldCodes(fieldCode, [-1, -2, -3, 1, 2, 3]));
  for (const code of candidates) {
    const value = values?.[code];
    if (parseDateField(value)) {
      return value;
    }
  }
  return undefined;
}

function shouldDefaultInvitationToYes(values: Record<string, unknown> | undefined): boolean {
  const invitationAnswer = getInvitationAnswer(values?.[MARRIAGE_INVITATION_FIELD]);
  if (invitationAnswer !== 'unknown') return false;

  const hasInvitationUpload = hasText(values?.[UPLOAD_INVITATION_CARD_FIELD]);
  const hasStampPaperUpload = hasText(values?.[UPLOAD_GENERAL_STAMP_PAPER_FIELD]);
  return !hasInvitationUpload && !hasStampPaperUpload;
}

function getLoggedInApplicantName(): string {
  if (typeof window === 'undefined') return '';

  const user = useAuthStore.getState().user;
  if (!user) return '';

  const firstName = String(user.firstName || '').trim();
  const lastName = String(user.lastName || '').trim();
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();

  if (fullName) return fullName;
  if (firstName) return firstName;
  return String(user.email || '').trim();
}

/* =========================
   AGE CALCULATION
========================= */
function parseDateField(value: unknown): Date | null {
  if (!value) return null;
  const str = String(value).trim();

  // dd/mm/yyyy
  const dmyMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmyMatch) {
    const date = new Date(Number(dmyMatch[3]), Number(dmyMatch[2]) - 1, Number(dmyMatch[1]));
    if (!isNaN(date.getTime())) return date;
  }

  // yyyy-mm-dd (ISO)
  const isoMatch = str.match(/^(\d{4})[\/\-](\d{2})[\/\-](\d{2})/);
  if (isoMatch) {
    const date = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
    if (!isNaN(date.getTime())) return date;
  }

  return null;
}

function calcAgeDisplay(dobValue: unknown, refDate: Date): string {
  const dob = parseDateField(dobValue);
  if (!dob || refDate <= dob) return '';

  let years = refDate.getFullYear() - dob.getFullYear();
  let months = refDate.getMonth() - dob.getMonth();
  let days = refDate.getDate() - dob.getDate();

  if (days < 0) {
    months--;
    const prevMonthEnd = new Date(refDate.getFullYear(), refDate.getMonth(), 0);
    days += prevMonthEnd.getDate();
  }
  if (months < 0) {
    years--;
    months += 12;
  }

  return `${years} years ${months} months ${days} days`;
}

function parseAgeYears(value: unknown): number {
  const text = String(value ?? '').trim();
  if (!text) return 0;

  const match = text.match(/^(\d+)\s*Years?/i);
  if (match) return Number(match[1]);

  const fallback = parseInt(text.replace(/[^0-9+-]/g, ''), 10);
  return Number.isFinite(fallback) ? fallback : 0;
}

const plugin: ServiceFormPlugin = {
  isFieldVisible(fieldCode, values) {
    const groomStatus = values[GROOM_MARITAL_STATUS];
    const brideStatus = values[BRIDE_MARITAL_STATUS];
    const groomReligion = values[GROOM_RELIGION];
    const brideReligion = values[BRIDE_RELIGION];

    /* =========================
       Groom marital status logic
    ========================= */

    if (fieldCode === GROOM_COURT_DECREE) {
      return isDivorcedStatus(groomStatus);
    }

    if (fieldCode === GROOM_DEATH_CERTIFICATE) {
      return isWidowedStatus(groomStatus);
    }

    /* =========================
       Bride marital status logic
    ========================= */

    if (fieldCode === BRIDE_COURT_DECREE) {
      return isDivorcedStatus(brideStatus);
    }

    if (fieldCode === BRIDE_DEATH_CERTIFICATE) {
      return isWidowedStatus(brideStatus);
    }

    /* =========================
       Nikahnama logic
    ========================= */

    if (fieldCode === NIKAHNAMA_UPLOAD) {
      return shouldShowNikahnama(values);
    }

    if (fieldCode === NIKAHNAMA_TRANSLATION) {
      return shouldShowNikahnama(values) && Boolean(values[NIKAHNAMA_UPLOAD]);
    }

    /* =========================
       Religion conversion logic
    ========================= */

    if (fieldCode === CONVERSION_CERTIFICATE) {
      if (!groomReligion || !brideReligion) return false;
      return !areReligionsEquivalent(groomReligion, brideReligion);
    }

    if (fieldCode === ADDITIONAL_DOCUMENTS_CATEGORY) {
      return shouldShowAdditionalDocumentsCategory(values);
    }

    /* =========================
       Marriage invitation logic
    ========================= */
    if (
      MARRIAGE_INVITATION_FIELD &&
      UPLOAD_INVITATION_CARD_FIELD &&
      fieldCode === UPLOAD_INVITATION_CARD_FIELD
    ) {
      return shouldShowInvitationUpload(values);
    }

    if (
      MARRIAGE_INVITATION_FIELD &&
      UPLOAD_GENERAL_STAMP_PAPER_FIELD &&
      fieldCode === UPLOAD_GENERAL_STAMP_PAPER_FIELD
    ) {
      return shouldShowStampPaperUpload(values);
    }

    if (
      MARRIAGE_INVITATION_FIELD &&
      UPLOAD_MANDAL_VALIDITY_FIELD &&
      fieldCode === UPLOAD_MANDAL_VALIDITY_FIELD
    ) {
      return shouldShowMandalValidityUpload(values);
    }

    /* =========================
       Default
    ========================= */

    return true;
  },

  getFieldMeta(fieldCode, values) {
    // Display full age format as helper text
    if (fieldCode === GROOM_AGE_DISPLAY) {
      const groomDob = values?.[GROOM_DOB];
      if (groomDob) {
        const ageDisplay = calcAgeDisplay(groomDob, new Date());
        if (ageDisplay) {
          return {
            helperText: `Age: ${ageDisplay}`,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            helperTextStyle: { color: '#059669', fontSize: '0.875rem', fontWeight: 500 } as Record<string, any>,
          };
        }
      }
    }

    if (fieldCode === BRIDE_AGE_DISPLAY) {
      const brideDob = values?.[BRIDE_DOB];
      if (brideDob) {
        const ageDisplay = calcAgeDisplay(brideDob, new Date());
        if (ageDisplay) {
          return {
            helperText: `Age: ${ageDisplay}`,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            helperTextStyle: { color: '#059669', fontSize: '0.875rem', fontWeight: 500 } as Record<string, any>,
          };
        }
      }
    }

    if (WITNESS_AGE_FIELDS.has(fieldCode)) {
      const val = values?.[fieldCode];
      const dateValue = findNearbyDateValue(fieldCode, values) ?? val;
      const fullAge = calcAgeDisplay(dateValue, new Date());

      if (fullAge) {
        const years = parseAgeYears(fullAge);
        const helperText = years >= 21
          ? `Age: ${fullAge}`
          : `Age: ${fullAge}. Witness age should be above 21 at the time of marriage.`;

        return {
          helperText,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          helperTextStyle: { color: years >= 21 ? '#059669' : '#dc2626', fontSize: '0.875rem', fontWeight: 500 } as Record<string, any>,
        };
      }

      const numericYears = parseWitnessAgeValue(val);
      if (typeof numericYears === 'number' && Number.isFinite(numericYears)) {
        const helperText = numericYears >= 21
          ? `Age: ${numericYears} years 0 months 0 days`
          : `Age: ${numericYears} years 0 months 0 days. Witness age should be above 21 at the time of marriage.`;

        return {
          helperText,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          helperTextStyle: { color: numericYears >= 21 ? '#059669' : '#dc2626', fontSize: '0.875rem', fontWeight: 500 } as Record<string, any>,
        };
      }

      return {
        helperText: 'Witness age should be above 21 at the time of marriage.',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        helperTextStyle: { color: '#dc2626' } as Record<string, any>,
      };
    }

    return {};
  },

  async onFieldChange(fieldCode, value, allValues) {
    const updates: Record<string, unknown> = {};
    const nextValues = { ...(allValues || {}), [fieldCode]: value };
    const loginApplicantName = getLoggedInApplicantName();
    const applicantNameInForm = nextValues[APPLICANT_NAME_FIELD];

    // ── English to Marathi Translation ──
    if (MARATHI_TRANSLATION_MAP[fieldCode]) {
      if (typeof value === 'string' && value.trim().length > 0) {
        try {
          const translated = await englishToMarathi(value);
          if (translated) {
            updates[MARATHI_TRANSLATION_MAP[fieldCode]] = translated;
          }
        } catch (err) {
          console.error("Translation failed for", fieldCode, err);
        }
      } else {
        updates[MARATHI_TRANSLATION_MAP[fieldCode]] = "";
      }
    }

    if (fieldCode === '__INIT__') {
      if (shouldDefaultInvitationToYes(allValues)) {
        updates[MARRIAGE_INVITATION_FIELD] = DEFAULT_INVITATION_YES_VALUE;
      }
      if (loginApplicantName && !hasText(allValues?.[APPLICANT_NAME_FIELD])) {
        updates[APPLICANT_NAME_FIELD] = loginApplicantName;
      }
      // ── Populate age on form load ──
      const today = new Date();
      const groomDob = allValues?.[GROOM_DOB];
      if (groomDob) {
        const ageStr = calcAgeDisplay(groomDob, today);
        const groomYears = parseAgeYears(ageStr);
        if (groomYears > 0) updates[GROOM_AGE_DISPLAY] = groomYears;
      }
      const brideDob = allValues?.[BRIDE_DOB];
      if (brideDob) {
        const ageStr = calcAgeDisplay(brideDob, today);
        const brideYears = parseAgeYears(ageStr);
        if (brideYears > 0) updates[BRIDE_AGE_DISPLAY] = brideYears;
      }


      return Object.keys(updates).length ? updates : undefined;
    }

    if (
      fieldCode !== APPLICANT_NAME_FIELD &&
      loginApplicantName &&
      !hasText(applicantNameInForm)
    ) {
      updates[APPLICANT_NAME_FIELD] = loginApplicantName;
    }

    // Keep only the relevant upload field based on invitation answer.
    if (
      MARRIAGE_INVITATION_FIELD &&
      UPLOAD_INVITATION_CARD_FIELD &&
      UPLOAD_GENERAL_STAMP_PAPER_FIELD &&
      UPLOAD_MANDAL_VALIDITY_FIELD &&
      fieldCode === MARRIAGE_INVITATION_FIELD
    ) {
      const invitationAnswer = getInvitationAnswer(value);
      if (invitationAnswer === 'yes') {
        updates[UPLOAD_GENERAL_STAMP_PAPER_FIELD] = null;
        updates[UPLOAD_MANDAL_VALIDITY_FIELD] = null;
      }
      if (invitationAnswer === 'no') {
        updates[UPLOAD_INVITATION_CARD_FIELD] = null;
      }
      if (invitationAnswer === 'unknown') {
        updates[UPLOAD_INVITATION_CARD_FIELD] = null;
        updates[UPLOAD_GENERAL_STAMP_PAPER_FIELD] = null;
        updates[UPLOAD_MANDAL_VALIDITY_FIELD] = null;
      }
    }

    // ── Auto-calculate age when DOB is picked ──
    if (fieldCode === GROOM_DOB) {
      const ageStr = calcAgeDisplay(value, new Date());
      const years = parseAgeYears(ageStr);
      updates[GROOM_AGE_DISPLAY] = years > 0 ? years : null;
    }

    if (fieldCode === BRIDE_DOB) {
      const ageStr = calcAgeDisplay(value, new Date());
      const years = parseAgeYears(ageStr);
      updates[BRIDE_AGE_DISPLAY] = years > 0 ? years : null;
    }



    const groomStatus = fieldCode === GROOM_MARITAL_STATUS ? value : undefined;
    const brideStatus = fieldCode === BRIDE_MARITAL_STATUS ? value : undefined;

    if (fieldCode === GROOM_MARITAL_STATUS) {
      if (!isDivorcedStatus(groomStatus)) updates[GROOM_COURT_DECREE] = null;
      if (!isWidowedStatus(groomStatus)) updates[GROOM_DEATH_CERTIFICATE] = null;
      return updates;
    }

    if (fieldCode === BRIDE_MARITAL_STATUS) {
      if (!isDivorcedStatus(brideStatus)) updates[BRIDE_COURT_DECREE] = null;
      if (!isWidowedStatus(brideStatus)) updates[BRIDE_DEATH_CERTIFICATE] = null;
      return updates;
    }

    if (
      [SOLEMNIZER_RELIGION, GROOM_RELIGION, BRIDE_RELIGION].includes(fieldCode) &&
      !shouldShowNikahnama(nextValues)
    ) {
      return {
        [NIKAHNAMA_UPLOAD]: null,
        [NIKAHNAMA_TRANSLATION]: null,
      };
    }

    if (fieldCode === NIKAHNAMA_UPLOAD && !value) {
      return {
        [NIKAHNAMA_TRANSLATION]: null,
      };
    }

    return Object.keys(updates).length ? updates : undefined;
  },

  validateField(fieldCode, value, allValues) {
    const groomStatus = allValues?.[GROOM_MARITAL_STATUS];
    const brideStatus = allValues?.[BRIDE_MARITAL_STATUS];
    const invitationStatus = allValues?.[MARRIAGE_INVITATION_FIELD];

    if (fieldCode === GROOM_COURT_DECREE && isDivorcedStatus(groomStatus) && !value) {
      return 'This field is mandatory';
    }

    if (fieldCode === GROOM_DEATH_CERTIFICATE && isWidowedStatus(groomStatus) && !value) {
      return 'This field is mandatory';
    }

    if (fieldCode === BRIDE_COURT_DECREE && isDivorcedStatus(brideStatus) && !value) {
      return 'This field is mandatory';
    }

    if (fieldCode === BRIDE_DEATH_CERTIFICATE && isWidowedStatus(brideStatus) && !value) {
      return 'This field is mandatory';
    }

    if (fieldCode === UPLOAD_INVITATION_CARD_FIELD && isInvitationYes(invitationStatus) && !value) {
      return 'This field is mandatory';
    }

    if (
      fieldCode === UPLOAD_GENERAL_STAMP_PAPER_FIELD && isInvitationNo(invitationStatus) && !value
    ) {
      return 'This field is mandatory';
    }

    if (
      fieldCode === UPLOAD_MANDAL_VALIDITY_FIELD && isInvitationNo(invitationStatus) && !value
    ) {
      return 'Upload Mandal Validity is required';
    }

    if (WITNESS_AGE_FIELDS.has(fieldCode)) {
      if (value === null || value === undefined || String(value).trim() === '') {
        return undefined;
      }

      const allValuesWithCurrent = { ...(allValues || {}), [fieldCode]: value };
      const dobValue = findNearbyDateValue(fieldCode, allValuesWithCurrent);
      if (dobValue) {
        const ageStr = calcAgeDisplay(dobValue, new Date());
        const years = parseAgeYears(ageStr);
        if (years < 21) {
          return 'Witness age should be above 21 at the time of marriage.';
        }
        return undefined;
      }

      const age = parseWitnessAgeValue(value);
      if (age === undefined) {
        return 'Witness age must be a valid number.';
      }
      if (age < 21) {
        return 'Witness age should be above 21 at the time of marriage.';
      }
    }

    if (fieldCode === SOLEMNIZER_RELIGION) {
      return validateSolemnizerReligionSelection(value, allValues || {});
    }

    // ── Age validation ──
    if (fieldCode === GROOM_AGE_DISPLAY) {
      const years = parseAgeYears(value);
      if (years < 21) return 'Groom Age should be above 21 at the time of marriage';
    }

    if (fieldCode === BRIDE_AGE_DISPLAY) {
      const years = parseAgeYears(value);
      if (years < 18) return 'Bride Age should be above 18 at the time of marriage';
    }

    return undefined;
  },

  isFieldRequired(fieldCode, values) {
    if (fieldCode === UPLOAD_INVITATION_CARD_FIELD) {
      return shouldShowInvitationUpload(values);
    }
    if (fieldCode === UPLOAD_GENERAL_STAMP_PAPER_FIELD) {
      return shouldShowStampPaperUpload(values);
    }
    if (fieldCode === UPLOAD_MANDAL_VALIDITY_FIELD) {
      return shouldShowMandalValidityUpload(values);
    }
    if (fieldCode === WITNESS_AGE_FIELD_1 || fieldCode === WITNESS_AGE_FIELD_2 || fieldCode === WITNESS_AGE_FIELD_3) {
      return undefined;
    }

    return undefined;
  },
};

export default plugin;
