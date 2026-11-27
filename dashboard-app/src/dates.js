/* Shared Nepali-date helpers for the dashboard tabs.
   The API returns BS dates in three shapes: ISO (2083-08-07),
   written out (4 Mangsir 2083 BS) and slashed (16/04/2083 BS).
   The fiscal year starts in Shrawan (month 4), so Baisakh–Ashadh
   belong to the previous fiscal year. Dates are shown BS first
   with AD after, as on the Laravel pages. */

export const BS_MONTHS = [
  'Baisakh', 'Jestha', 'Ashadh', 'Shrawan', 'Bhadra', 'Ashwin',
  'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra',
];

export function parseBs(bs) {
  if (!bs) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(bs);
  if (m) return { y: +m[1], mo: +m[2], d: +m[3] };
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(bs);
  if (m) return { y: +m[3], mo: +m[2], d: +m[1] };
  m = /^(\d{1,2}) (\w+) (\d{4})/.exec(bs);
  if (m) {
    const mo = BS_MONTHS.indexOf(m[2]) + 1;
    if (mo) return { y: +m[3], mo, d: +m[1] };
  }
  return null;
}

/* Fiscal year a BS date belongs to — the starting BS year. */
export function fyOfBs(bs) {
  const p = parseBs(bs);
  if (!p) return null;
  return p.mo >= 4 ? p.y : p.y - 1;
}

/* Fiscal year an AD date belongs to — the starting BS year.
   Approximate: 1 Shrawan falls on 16–17 July, so a date on or
   after 17 July belongs to the BS year starting that AD year + 57,
   and anything earlier to the year + 56. Only a fallback when no
   BS date exists — the BS date is authoritative where present. */
export function fyOfAd(ad) {
  if (!ad) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ad);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo > 7 || (mo === 7 && d >= 17)) return y + 57;
  return y + 56;
}

export function fyLabel(fy) {
  return 'FY ' + fy + '/' + String(fy + 1).slice(2);
}

/* 2083 => '2083/84' — the fiscal-year label the API uses. */
export function fyString(fyStart) {
  return fyStart + '/' + String(fyStart + 1).slice(2);
}

export function bsLabel(bs) {
  const p = parseBs(bs);
  if (!p) return '';
  return p.d + ' ' + BS_MONTHS[p.mo - 1] + ' ' + p.y;
}

export function adLabel(ad) {
  if (!ad) return '';
  const d = new Date(ad + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return ad;
  return d.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

/* Same date line as the Laravel pages: BS first, AD after. */
export function dateLabel(ad, bs) {
  const b = bsLabel(bs);
  const a = adLabel(ad);
  if (b && a) return b + ' (' + a + ')';
  return b || a || '—';
}
