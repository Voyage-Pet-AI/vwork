import type { ReportKind } from "../report/types.js";

export interface ReportIntentMatch {
  matched: boolean;
  ambiguous: boolean;
  kind?: ReportKind;
  lookbackDays?: number;
  label?: string;
}

const NEGATIVE_PATTERNS = [
  /\bbug report\b/i,
  /\berror report\b/i,
  /\bincident report\b/i,
  /\breport an issue\b/i,
  /\breport (a|an|the)?\s?bug\b/i,
];

const POSITIVE_PATTERNS = [
  /\bdaily report\b/i,
  /\bweekly report\b/i,
  /\bgenerate (my |a )?(work )?report\b/i,
  /\bwork report\b/i,
  /\bstatus report\b/i,
  /\breport for last week\b/i,
];

export function detectReportIntent(text: string): ReportIntentMatch {
  const input = text.trim();
  if (!input) return { matched: false, ambiguous: false };

  const hasNegative = NEGATIVE_PATTERNS.some((p) => p.test(input));
  const hasPositive = POSITIVE_PATTERNS.some((p) => p.test(input));
  if (hasNegative && !/\b(work|daily|weekly)\b/i.test(input)) {
    return { matched: false, ambiguous: false };
  }
  if (!hasPositive && !/\breport\b/i.test(input)) {
    return { matched: false, ambiguous: false };
  }

  const explicitDays = input.match(/\blast\s+(\d+)\s+days?\b/i);
  if (explicitDays) {
    const n = Math.max(1, parseInt(explicitDays[1], 10));
    return {
      matched: true,
      ambiguous: false,
      kind: "custom",
      lookbackDays: n,
      label: `last ${n} day${n > 1 ? "s" : ""}`,
    };
  }

  if (/\b(last week|weekly)\b/i.test(input)) {
    return {
      matched: true,
      ambiguous: false,
      kind: "weekly",
      lookbackDays: 7,
      label: "weekly",
    };
  }

  if (/\b(today|daily)\b/i.test(input)) {
    return {
      matched: true,
      ambiguous: false,
      kind: "daily",
      lookbackDays: 1,
      label: "daily",
    };
  }

  if (/\bgenerate (my |a )?(work )?report\b/i.test(input) || /\bwork report\b/i.test(input) || /\bstatus report\b/i.test(input)) {
    return { matched: true, ambiguous: true };
  }

  return { matched: false, ambiguous: false };
}
