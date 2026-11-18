import { RULES, type RuleDefinition } from "../shared/contracts";

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function daysFromTodayUtc(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

export function isExpired(expiresOn: string): boolean {
  return expiresOn < todayUtc();
}

export function ruleById(id: string): RuleDefinition | undefined {
  return RULES.find((rule) => rule.id === id);
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "Something went wrong. Please try again.";
}

export function readString(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const field: unknown = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : undefined;
}
