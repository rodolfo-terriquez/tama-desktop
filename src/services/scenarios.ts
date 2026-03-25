import { SCENARIOS } from "@/data/scenarios";
import { getSessions, getDueVocabulary, getCustomScenarios, getUserProfile } from "@/services/storage";
import type { Scenario } from "@/types";

export interface ScoredScenario {
  scenario: Scenario;
  score: number;
  reasonKey: string;
}

/**
 * Score and rank scenarios for the current user.
 * Higher score = better recommendation.
 * Includes both built-in and custom scenarios.
 */
export async function getRecommendedScenarios(): Promise<ScoredScenario[]> {
  const sessions = await getSessions();
  const profile = await getUserProfile();
  const dueVocab = profile.include_flashcard_vocab_in_conversations
    ? await getDueVocabulary()
    : [];
  const allScenarios = [...SCENARIOS, ...(await getCustomScenarios())];

  const recentScenarioIds = sessions
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5)
    .map((s) => s.scenario.id);

  const lastFeedback = sessions
    .filter((s) => s.feedback)
    .sort((a, b) => b.date.localeCompare(a.date))[0]?.feedback;

  const lastRating = lastFeedback?.summary.performance_rating;

  const scored: ScoredScenario[] = allScenarios.map((scenario) => {
    let score = 50;
    let reasonKey = "";

    // Penalize recently used scenarios
    const recentIndex = recentScenarioIds.indexOf(scenario.id);
    if (recentIndex === 0) {
      score -= 30;
      reasonKey = "scenario.reason.justPracticed";
    } else if (recentIndex > 0) {
      score -= 15 / (recentIndex + 1);
    }

    // Bonus for never-tried scenarios
    const everUsed = sessions.some((s) => s.scenario.id === scenario.id);
    if (!everUsed) {
      score += 15;
      reasonKey = reasonKey || "scenario.reason.newScenario";
    }

    // Favor simpler scenarios for struggling users
    const simpleScenarios = ["intro", "weather", "convenience", "hobbies"];
    const challengingScenarios = ["doctor", "phone", "hotel"];

    if (lastRating === "needs_work" && simpleScenarios.includes(scenario.id)) {
      score += 10;
      reasonKey = reasonKey || "scenario.reason.buildConfidence";
    }
    if (lastRating === "excellent" && challengingScenarios.includes(scenario.id)) {
      score += 10;
      reasonKey = reasonKey || "scenario.reason.challenge";
    }

    // Boost if due vocabulary words relate to scenario keywords
    if (dueVocab.length > 0) {
      const scenarioText = `${scenario.title} ${scenario.description} ${scenario.setting} ${scenario.objectives.join(" ")}`.toLowerCase();
      const vocabMatches = dueVocab.filter(
        (v) =>
          scenarioText.includes(v.meaning.toLowerCase()) ||
          scenarioText.includes(v.word)
      ).length;
      if (vocabMatches > 0) {
        score += vocabMatches * 5;
        reasonKey = reasonKey || "scenario.reason.reviewVocab";
      }
    }

    // Slight randomness to keep things fresh
    score += Math.random() * 8;

    return { scenario, score: Math.round(score), reasonKey };
  });

  scored.sort((a, b) => b.score - a.score);

  return scored;
}

/**
 * Pick the single best scenario automatically.
 */
export async function pickBestScenario(): Promise<Scenario> {
  const ranked = await getRecommendedScenarios();
  return ranked[0].scenario;
}
