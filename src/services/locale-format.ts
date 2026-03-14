import { getAppLocale } from "@/services/app-config";
import type { AppLocale } from "@/types";

const INTL_LOCALES: Record<AppLocale, string> = {
  en: "en-US",
  es: "es-ES",
};

function resolveDate(date: Date | string): Date {
  return date instanceof Date ? date : new Date(date);
}

export function getIntlLocale(locale: AppLocale = getAppLocale()): string {
  return INTL_LOCALES[locale];
}

export function formatRelativeTime(date: Date | string, locale: AppLocale = getAppLocale()): string {
  const target = resolveDate(date).getTime();
  const now = Date.now();
  const diffSeconds = Math.round((target - now) / 1000);
  const absSeconds = Math.abs(diffSeconds);
  const formatter = new Intl.RelativeTimeFormat(getIntlLocale(locale), { numeric: "auto" });

  if (absSeconds < 60) return formatter.format(diffSeconds, "second");

  const diffMinutes = Math.round(diffSeconds / 60);
  if (Math.abs(diffMinutes) < 60) return formatter.format(diffMinutes, "minute");

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return formatter.format(diffHours, "hour");

  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 7) return formatter.format(diffDays, "day");

  const diffWeeks = Math.round(diffDays / 7);
  if (Math.abs(diffWeeks) < 5) return formatter.format(diffWeeks, "week");

  const diffMonths = Math.round(diffDays / 30);
  if (Math.abs(diffMonths) < 12) return formatter.format(diffMonths, "month");

  const diffYears = Math.round(diffDays / 365);
  return formatter.format(diffYears, "year");
}

export function formatMonthYear(date: Date | string, locale: AppLocale = getAppLocale()): string {
  return new Intl.DateTimeFormat(getIntlLocale(locale), {
    month: "long",
    year: "numeric",
  }).format(resolveDate(date));
}

export function formatDateTime(date: Date | string, locale: AppLocale = getAppLocale()): string {
  return new Intl.DateTimeFormat(getIntlLocale(locale), {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(resolveDate(date));
}

export function formatTime(date: Date | string, locale: AppLocale = getAppLocale()): string {
  return new Intl.DateTimeFormat(getIntlLocale(locale), {
    hour: "numeric",
    minute: "2-digit",
  }).format(resolveDate(date));
}

export function formatWeekdayMonthDay(date: Date | string, locale: AppLocale = getAppLocale()): string {
  return new Intl.DateTimeFormat(getIntlLocale(locale), {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(resolveDate(date));
}

export function getWeekdayLabels(locale: AppLocale = getAppLocale()): string[] {
  const baseMonday = new Date(Date.UTC(2024, 0, 1));
  return Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(getIntlLocale(locale), { weekday: "narrow" }).format(
      new Date(baseMonday.getTime() + index * 86_400_000)
    )
  );
}
