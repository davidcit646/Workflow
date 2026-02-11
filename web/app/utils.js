export const sanitizeLetters = (value) => (value || "").replace(/[^a-zA-Z\s'-]/g, "");
export const sanitizeNumbers = (value) => (value || "").replace(/\D/g, "");
export const sanitizeAlphaNum = (value) => (value || "").replace(/[^a-zA-Z0-9\s-]/g, "");
export const sanitizeAlphaNumTight = (value) => (value || "").replace(/[^a-zA-Z0-9]/g, "");
export const sanitizeStateAbbrev = (value) =>
  (value || "")
    .replace(/[^a-zA-Z]/g, "")
    .slice(0, 2)
    .toUpperCase();

export const formatPhoneLike = (value) => {
  const digits = sanitizeNumbers(value).slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
};

export const formatDateLike = (value) => {
  const digits = sanitizeNumbers(value).slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
};

export const isPhoneLikeValid = (value) => /^\d{3}-\d{3}-\d{4}$/.test(value);

export const formatSsnLike = (value) => {
  const digits = sanitizeNumbers(value).slice(0, 9);
  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
};

export const isSsnLikeValid = (value) => /^\d{3}-\d{2}-\d{4}$/.test(value);

export const parseWeeklyTime = (value) => {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (!raw) return null;
  const meridiemMatch = raw.match(/\b([ap])(?:\.?m\.?)?\b/);
  const meridiem = meridiemMatch ? meridiemMatch[1] : null;
  const cleaned = raw.replace(/[^\d:]/g, "");
  if (!cleaned) return null;

  let hours = null;
  let minutes = null;

  if (cleaned.includes(":")) {
    const [h, m] = cleaned.split(":");
    if (!/^\d{1,2}$/.test(h || "") || !/^\d{1,2}$/.test(m || "")) return null;
    hours = Number(h);
    minutes = Number(m);
  } else {
    const digits = cleaned;
    if (digits.length <= 2) {
      hours = Number(digits);
      minutes = 0;
    } else if (digits.length === 3) {
      hours = Number(digits.slice(0, 1));
      minutes = Number(digits.slice(1));
    } else if (digits.length === 4) {
      hours = Number(digits.slice(0, 2));
      minutes = Number(digits.slice(2));
    } else {
      return null;
    }
  }

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (minutes < 0 || minutes > 59) return null;

  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (meridiem === "a") {
      hours = hours === 12 ? 0 : hours;
    } else {
      hours = hours === 12 ? 12 : hours + 12;
    }
  } else if (hours < 0 || hours > 23) {
    return null;
  }

  return hours * 60 + minutes;
};

export const formatWeeklyHours = (minutes) => {
  if (minutes === null || minutes === undefined) return "—";
  const hours = minutes / 60;
  return Number.isFinite(hours) ? hours.toFixed(2) : "—";
};

export const isDateLikeValid = (value) => /^\d{2}\/\d{2}\/(\d{2}|\d{4})$/.test(value);
export const isFullDateValid = (value) => /^\d{2}\/\d{2}\/\d{4}$/.test(value);

export const isoToSlashDate = (value) => {
  const parts = String(value || "").split("-");
  if (parts.length !== 3) return value;
  const [year, month, day] = parts;
  return `${month}/${day}/${year}`;
};

export const slashToIsoDate = (value) => {
  const [month, day, year] = value.split("/");
  if (!month || !day || !year) return value;
  return `${year}-${month}-${day}`;
};

export const sortByOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);

export const normalizeValue = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  return String(value);
};

export const hasValue = (value) => normalizeValue(value) !== "";

export const formatMvrFlag = (value) => {
  const text = normalizeValue(value).toLowerCase();
  if (!text) return "";
  if (["1", "true", "yes"].includes(text)) return "Yes";
  if (["0", "false", "no"].includes(text)) return "No";
  return normalizeValue(value);
};

export const sanitizeTimeInput = (input) => {
  if (!input) return "";
  const cleaned = input.value.replace(/\D/g, "").slice(0, 4);
  input.value = cleaned;
  return cleaned;
};

export const getWeekdayName = (dateString) => {
  const date = dateString ? new Date(dateString) : new Date();
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return names[date.getDay()];
};
