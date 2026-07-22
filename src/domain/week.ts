// Pure ISO 8601 week derivation. No I/O, no libraries.

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Returns the ISO 8601 week string ('YYYY-Www') for a 'YYYY-MM-DD' date, using the ISO
// week-numbering year (which can differ from the calendar year around Jan 1 / Dec 31).
export function isoWeek(date: string): string {
  const match = DATE_RE.exec(date);
  if (!match) throw new Error(`isoWeek: malformed date "${date}", expected YYYY-MM-DD`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    throw new Error(`isoWeek: invalid calendar date "${date}"`);
  }

  // Shift to the Thursday of this ISO week (Mon=0..Sun=6), which pins the ISO week-numbering year.
  const dayNum = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - dayNum + 3);
  const isoYear = dt.getUTCFullYear();

  // Jan 4 is always in ISO week 1; shift to that week's Thursday.
  const week1Thursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNum = (week1Thursday.getUTCDay() + 6) % 7;
  week1Thursday.setUTCDate(week1Thursday.getUTCDate() - firstDayNum + 3);

  const week = 1 + Math.round((dt.getTime() - week1Thursday.getTime()) / (7 * MS_PER_DAY)); // exact in UTC; round guards float noise

  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}
