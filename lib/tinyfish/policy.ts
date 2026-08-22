import { PolicyError } from "@/lib/errors";

// Circumvention verbs and the protections they might target, matched in
// either word order ("bypass the rate limit" and "rate limit bypass" alike)
// so rephrasing alone cannot slip past the filter.
const CIRCUMVENTION_VERBS = "bypass|circumvent(?:ing|ed|ion)?|evad(?:e|ing|es)|evasion|ignore|disable";
const PROTECTION_TARGETS = "bot|anti[- ]?bot|cloudflare|captcha|rate[- ]?limit|429";

const BLOCKED_GOAL_PATTERNS: readonly RegExp[] = [
  /\bcaptcha\b/i,
  /\brecaptcha\b/i,
  /\bhcaptcha\b/i,
  /\bturnstile\b/i,
  /\bstealth\b/i,
  /\banti[- ]?detect/i,
  new RegExp(`\\b(?:${CIRCUMVENTION_VERBS})\\b.{0,40}\\b(?:${PROTECTION_TARGETS})\\b`, "i"),
  new RegExp(`\\b(?:${PROTECTION_TARGETS})\\b.{0,40}\\b(?:${CIRCUMVENTION_VERBS})\\b`, "i"),
  /\bsolve\b.{0,40}\bcaptcha\b/i,
  /\bcaptcha\b.{0,40}\bsolv/i,
];

export function isTinyFishGoalAllowed(goal: string): boolean {
  const text = goal.trim();
  if (text.length === 0) {
    return false;
  }

  return !BLOCKED_GOAL_PATTERNS.some((pattern) => pattern.test(text));
}

export function assertTinyFishGoalAllowed(goal: string): void {
  if (!isTinyFishGoalAllowed(goal)) {
    throw new PolicyError(
      "This TinyFish goal is blocked. Captcha solving, stealth, and rate-limit bypass are not allowed.",
    );
  }
}

export function assertAgentAutomationSafe(input: {
  goal: string;
  browserProfile?: string | null;
}): void {
  assertTinyFishGoalAllowed(input.goal);
  if (input.browserProfile && input.browserProfile !== "lite") {
    throw new PolicyError(
      "Stealth and custom TinyFish browser profiles are not allowed. Captcha and anti-bot bypass are disabled.",
    );
  }
}
