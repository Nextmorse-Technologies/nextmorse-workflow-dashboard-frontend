/* Amount in words, English — the "In Words" line on the tax
   invoice and the cash-receipt slip. A port of the server's
   AmountInWords::inEnglish: Western grouping (thousand/million),
   first letter capitalised, no hyphens, no "and" except before
   paisa ("Twenty five thousand four hundred twenty five"). */

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function below1000(n) {
  const parts = [];
  if (n >= 100) { parts.push(ONES[Math.floor(n / 100)] + ' hundred'); n %= 100; }
  if (n >= 20) { parts.push(TENS[Math.floor(n / 10)]); n %= 10; if (n) parts.push(ONES[n]); }
  else if (n > 0) { parts.push(ONES[n]); }
  return parts.join(' ');
}

export function amountInWords(amount) {
  const rounded = Math.round(Number(amount) * 100) / 100;
  const rupees = Math.floor(rounded);
  const paisa = Math.round((rounded - rupees) * 100);
  if (rupees === 0 && paisa === 0) return 'Zero';
  const parts = [];
  let rest = rupees;
  if (rest >= 1000000) { parts.push(below1000(Math.floor(rest / 1000000)) + ' million'); rest %= 1000000; }
  if (rest >= 1000) { parts.push(below1000(Math.floor(rest / 1000)) + ' thousand'); rest %= 1000; }
  if (rest > 0) { parts.push(below1000(rest)); }
  let words = parts.join(' ');
  if (words === '') words = 'zero';
  if (paisa > 0) words += ' and ' + below1000(paisa) + ' paisa';
  return words.charAt(0).toUpperCase() + words.slice(1);
}
