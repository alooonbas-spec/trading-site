import { PolicyError } from "@/lib/errors";

const BLOCKED_GOAL_PATTERNS: readonly RegExp[] = [
  /\bcaptcha\b/i,
  /\brecaptcha\b/i,
  /\bhcaptcha\b/i,
  /\bturnstile\b/i,
  /\bstealth\b/i,
  /\banti[- ]?detect/i,
  /\bbypass\b.{0,40}\b(bot|anti[- ]?bot|cloudflare|captcha|rate[- ]?limit)/i,
  /\b(bot|anti[- ]?bot|cloudflare|captcha|rate[- ]?limit)\b.{0,40}\bbypass\b/i,
  /\bevad(e|ing|es)\b.{0,40}\b(rate[- ]?limit|captcha|bot)/i,
  /\bignore\b.{0,40}\b(429|rate[- ]?limit)/i,
  /\bsolve\b.{0,40}\bcaptcha\b/i,
  /\bcaptcha\b.{0,40}\bsolv/i,
  /\brate[- ]?limit\b.{0,40}\b(bypass|circumvent|ignore|disable)/i,
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
