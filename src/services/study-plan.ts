import { localizeScenario } from "@/data/scenarios";
import { getAppLocale } from "@/services/app-config";
import { generateDailyStudyPlanCopy } from "@/services/claude";
import { emitDataChanged } from "@/services/app-events";
import { getRecommendedScenarios } from "@/services/scenarios";
import {
  getDueVocabulary,
  getFlashcardReviewSessions,
  getSessions,
  getStudyPlanByDate,
  getUserProfile,
  getVocabulary,
  saveStudyPlan as persistStudyPlan,
} from "@/services/storage";
import type { AppLocale, Session, StudyPlan, StudyPlanSourceSignals, StudyPlanTask } from "@/types";

type PerformanceTrend = StudyPlanSourceSignals["recentPerformance"];

interface PlanSeed {
  focusSummary: string;
  reasoningSummary: string;
  tasks: StudyPlanTask[];
  sourceSignals: StudyPlanSourceSignals;
}

function getTodayKey(): string {
  return new Date().toISOString().split("T")[0];
}

function getRecentRatedSessions(sessions: Session[]): Session[] {
  return sessions.filter((session) => Boolean(session.feedback)).slice(0, 5);
}

function derivePerformanceTrend(sessions: Session[]): PerformanceTrend {
  const ratings = getRecentRatedSessions(sessions)
    .map((session) => session.feedback?.summary.performance_rating)
    .filter((rating): rating is "needs_work" | "good" | "excellent" => Boolean(rating))
    .slice(0, 3);

  if (ratings.length === 0) return "unknown";
  const uniqueRatings = new Set(ratings);
  if (uniqueRatings.size > 1) {
    if (ratings.every((rating) => rating === "good" || rating === "excellent")) {
      return "good";
    }
    return "mixed";
  }
  return ratings[0];
}

function collectWeakWords(results: Awaited<ReturnType<typeof getFlashcardReviewSessions>>): string[] {
  return Array.from(
    new Set(
      results
        .slice(0, 3)
        .flatMap((session) =>
          session.results
            .filter((result) => result.rating === "again" || result.rating === "hard")
            .map((result) => result.word.trim())
        )
        .filter(Boolean)
    )
  ).slice(0, 3);
}

function fallbackStrings(locale: AppLocale) {
  if (locale === "es") {
    return {
      planTitleStarter: "Construye una rutina corta y constante hoy.",
      planReasonStarter: "Tu plan de hoy prioriza una practica clara y ligera para mantener el impulso.",
      planTitleRecover: "Refuerza confianza con una meta clara hoy.",
      planReasonRecover: "Tus resultados recientes sugieren enfocarte en una dificultad concreta antes de subir la exigencia.",
      planTitleSteady: "Consolida lo reciente y sigue produciendo japones.",
      planReasonSteady: "Hoy conviene combinar repaso activo con una conversacion enfocada para afianzar progreso.",
      planTitlePush: "Aprovecha el buen momento con produccion activa.",
      planReasonPush: "Vas bien, asi que el plan sube un poco la exigencia sin perder enfoque.",
      flashcardsTitle: "Repasa las tarjetas pendientes",
      flashcardsDescription: (count: number) =>
        count === 1
          ? "Haz una revision rapida de tu tarjeta vencida."
          : `Haz una revision rapida de tus ${count} tarjetas vencidas.`,
      scenarioTitle: "Haz una practica guiada",
      scenarioDescription: (title: string) =>
        title ? `Completa una conversacion corta con ${title}.` : "Completa una conversacion corta recomendada.",
      senseiTitle: "Abre Sensei para un micro-drill",
      senseiDescription: (focus: string) =>
        focus
          ? `Pidele a Tama un ejercicio corto sobre ${focus}.`
          : "Pidele a Tama una explicacion breve y un ejercicio corto.",
      flashcardsCta: "Repasar",
      scenarioCta: "Practicar",
      senseiCta: "Abrir Sensei",
    };
  }

  return {
    planTitleStarter: "Build a short, steady routine today.",
    planReasonStarter: "Today's plan keeps the workload light and practical so you can build momentum.",
    planTitleRecover: "Rebuild confidence with one clear focus today.",
    planReasonRecover: "Recent performance suggests tightening one specific weakness before adding more difficulty.",
    planTitleSteady: "Reinforce recent work and keep producing Japanese.",
    planReasonSteady: "Today is best spent mixing active review with one focused conversation.",
    planTitlePush: "Lean into your recent progress with active output.",
    planReasonPush: "You've been doing well, so today's plan raises the challenge a little without losing focus.",
    flashcardsTitle: "Review due flashcards",
    flashcardsDescription: (count: number) =>
      count === 1
        ? "Clear your one due card with a quick review."
        : `Clear your ${count} due cards with a quick review.`,
    scenarioTitle: "Do one focused scenario",
    scenarioDescription: (title: string) =>
      title ? `Complete a short conversation in ${title}.` : "Complete a short recommended conversation.",
    senseiTitle: "Open Sensei for a micro-drill",
    senseiDescription: (focus: string) =>
      focus
        ? `Ask Tama for a short drill on ${focus}.`
        : "Ask Tama for a brief explanation and a short drill.",
    flashcardsCta: "Review",
    scenarioCta: "Practice",
    senseiCta: "Open Sensei",
  };
}

function buildSeed(locale: AppLocale, input: {
  dueCount: number;
  totalVocabulary: number;
  totalSessions: number;
  recentSessionCount: number;
  recentFlashcardReviewCount: number;
  recentPerformance: PerformanceTrend;
  lastPerformanceRating?: "needs_work" | "good" | "excellent";
  recommendedScenarioId?: string;
  recommendedScenarioTitle?: string;
  topStruggle?: string;
  nextSessionHint?: string;
  weakWords: string[];
}): PlanSeed {
  const strings = fallbackStrings(locale);
  const recommendedScenarioTitle = input.recommendedScenarioTitle ?? "";
  const topStruggle = input.topStruggle ?? input.nextSessionHint ?? input.weakWords[0] ?? "";

  let focusSummary = strings.planTitleSteady;
  let reasoningSummary = strings.planReasonSteady;

  if (input.totalSessions === 0) {
    focusSummary = strings.planTitleStarter;
    reasoningSummary = strings.planReasonStarter;
  } else if (input.recentPerformance === "needs_work") {
    focusSummary = strings.planTitleRecover;
    reasoningSummary = strings.planReasonRecover;
  } else if (input.recentPerformance === "excellent") {
    focusSummary = strings.planTitlePush;
    reasoningSummary = strings.planReasonPush;
  }

  const tasks: StudyPlanTask[] = [];

  if (input.dueCount > 0) {
    tasks.push({
      id: "flashcards",
      kind: "flashcards",
      title: strings.flashcardsTitle,
      description: strings.flashcardsDescription(input.dueCount),
      ctaLabel: strings.flashcardsCta,
      target: { screen: "flashcards" },
      metadata: {
        dueCount: input.dueCount,
      },
    });
  }

  if (input.recommendedScenarioId) {
    tasks.push({
      id: "scenario",
      kind: "scenario",
      title: strings.scenarioTitle,
      description: strings.scenarioDescription(recommendedScenarioTitle),
      ctaLabel: strings.scenarioCta,
      target: {
        screen: "scenario",
        scenarioId: input.recommendedScenarioId,
      },
      metadata: {
        scenarioId: input.recommendedScenarioId,
        scenarioTitle: recommendedScenarioTitle,
      },
    });
  }

  if (topStruggle || tasks.length < 2) {
    const suggestedPrompt = topStruggle
      ? locale === "es"
        ? `Hazme un micro-drill corto para practicar ${topStruggle}.`
        : `Give me a short micro-drill to practice ${topStruggle}.`
      : locale === "es"
        ? "Hazme una explicacion breve y un micro-drill para hoy."
        : "Give me a brief explanation and a short micro-drill for today.";

    tasks.push({
      id: "sensei",
      kind: "sensei",
      title: strings.senseiTitle,
      description: strings.senseiDescription(topStruggle),
      ctaLabel: strings.senseiCta,
      target: {
        screen: "sensei",
        prompt: suggestedPrompt,
      },
      metadata: {
        topStruggle,
        suggestedPrompt,
      },
    });
  }

  const sourceSignals: StudyPlanSourceSignals = {
    dueCount: input.dueCount,
    totalVocabulary: input.totalVocabulary,
    totalSessions: input.totalSessions,
    recentSessionCount: input.recentSessionCount,
    recentFlashcardReviewCount: input.recentFlashcardReviewCount,
    recentPerformance: input.recentPerformance,
    lastPerformanceRating: input.lastPerformanceRating,
    recommendedScenarioId: input.recommendedScenarioId,
    recommendedScenarioTitle,
    topStruggle: topStruggle || undefined,
    nextSessionHint: input.nextSessionHint,
    weakWords: input.weakWords,
  };

  return {
    focusSummary,
    reasoningSummary,
    tasks: tasks.slice(0, 3),
    sourceSignals,
  };
}

function hydratePlan(seed: PlanSeed, overrides?: {
  focusSummary: string;
  reasoningSummary: string;
  tasks: Array<Pick<StudyPlanTask, "id" | "title" | "description" | "ctaLabel">>;
}): StudyPlan {
  const tasks = seed.tasks.map((task) => {
    const override = overrides?.tasks.find((candidate) => candidate.id === task.id);
    return override
      ? {
          ...task,
          title: override.title,
          description: override.description,
          ctaLabel: override.ctaLabel,
        }
      : task;
  });

  return {
    id: crypto.randomUUID(),
    date: getTodayKey(),
    generatedAt: new Date().toISOString(),
    focusSummary: overrides?.focusSummary ?? seed.focusSummary,
    reasoningSummary: overrides?.reasoningSummary ?? seed.reasoningSummary,
    tasks,
    sourceSignals: seed.sourceSignals,
  };
}

export async function getActiveStudyPlan(): Promise<StudyPlan | null> {
  return getStudyPlanByDate(getTodayKey());
}

export async function saveStudyPlan(plan: StudyPlan): Promise<void> {
  await persistStudyPlan(plan);
  emitDataChanged("study-plan-write");
}

export async function setStudyPlanTaskCompleted(taskId: string, completed: boolean): Promise<StudyPlan | null> {
  const activePlan = await getActiveStudyPlan();
  if (!activePlan) {
    return null;
  }

  const nextCompletedAt = completed ? new Date().toISOString() : undefined;
  let changed = false;
  const nextTasks = activePlan.tasks.map((task) => {
    if (task.id !== taskId) {
      return task;
    }

    changed = true;
    return {
      ...task,
      completedAt: nextCompletedAt,
    };
  });

  if (!changed) {
    return activePlan;
  }

  const updatedPlan: StudyPlan = {
    ...activePlan,
    tasks: nextTasks,
  };

  await saveStudyPlan(updatedPlan);
  return updatedPlan;
}

export async function generateDailyStudyPlan(): Promise<StudyPlan> {
  const locale = getAppLocale();
  const [profile, sessions, vocabulary, dueVocabulary, flashcardReviewSessions, rankedScenarios] = await Promise.all([
    getUserProfile(),
    getSessions(),
    getVocabulary(),
    getDueVocabulary(),
    getFlashcardReviewSessions(),
    getRecommendedScenarios(),
  ]);

  const recentRatedSessions = getRecentRatedSessions(sessions);
  const lastFeedback = recentRatedSessions[0]?.feedback ?? null;
  const topScenario = rankedScenarios[0]?.scenario;
  const localizedScenarioTitle = topScenario ? localizeScenario(topScenario, locale).title : undefined;
  const weakWords = collectWeakWords(flashcardReviewSessions);

  const seed = buildSeed(locale, {
    dueCount: dueVocabulary.length,
    totalVocabulary: vocabulary.length,
    totalSessions: profile.total_sessions,
    recentSessionCount: recentRatedSessions.length,
    recentFlashcardReviewCount: flashcardReviewSessions.slice(0, 3).length,
    recentPerformance: derivePerformanceTrend(sessions),
    lastPerformanceRating: lastFeedback?.summary.performance_rating,
    recommendedScenarioId: topScenario?.id,
    recommendedScenarioTitle: localizedScenarioTitle,
    topStruggle: profile.recent_struggles[0],
    nextSessionHint: lastFeedback?.summary.next_session_hint || undefined,
    weakWords,
  });

  let plan = hydratePlan(seed);

  try {
    const generatedCopy = await generateDailyStudyPlanCopy({
      locale,
      focusSummary: seed.focusSummary,
      reasoningSummary: seed.reasoningSummary,
      tasks: seed.tasks.map((task) => ({
        id: task.id,
        kind: task.kind,
        title: task.title,
        description: task.description,
        ctaLabel: task.ctaLabel,
        target: task.target,
      })),
      sourceSignals: seed.sourceSignals,
    });
    plan = hydratePlan(seed, generatedCopy);
  } catch (error) {
    console.warn("Falling back to heuristic daily study plan:", error);
  }

  await saveStudyPlan(plan);
  return plan;
}

export async function ensureDailyStudyPlan(): Promise<StudyPlan> {
  const existing = await getActiveStudyPlan();
  if (existing) {
    return existing;
  }
  return generateDailyStudyPlan();
}
