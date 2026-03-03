import type { VocabItem, SRSRating } from "@/types";
import { updateVocabItem } from "@/services/storage";

/**
 * SM-2 quality scores mapped from our 4-point rating scale.
 *   again → 0 (complete failure, reset)
 *   hard  → 3 (correct but with serious difficulty)
 *   good  → 4 (correct with minor hesitation)
 *   easy  → 5 (perfect recall)
 */
const QUALITY: Record<SRSRating, number> = {
  again: 0,
  hard: 3,
  good: 4,
  easy: 5,
};

const MIN_EASE_FACTOR = 1.3;

interface SRSUpdate {
  interval: number;
  ease_factor: number;
  next_review: string;
  times_reviewed: number;
}

/**
 * Core SM-2 algorithm. Returns the new SRS values without side effects.
 */
export function calculateSM2(
  rating: SRSRating,
  currentInterval: number,
  currentEaseFactor: number,
  timesReviewed: number
): SRSUpdate {
  const q = QUALITY[rating];

  let interval: number;
  let ef = currentEaseFactor;

  if (q < 3) {
    // Failed recall — reset to 1 day, keep ease factor but penalize it
    interval = 1;
    ef = Math.max(MIN_EASE_FACTOR, ef - 0.2);
  } else {
    // Successful recall — update ease factor using SM-2 formula
    ef = ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
    ef = Math.max(MIN_EASE_FACTOR, ef);

    if (timesReviewed === 0) {
      interval = 1;
    } else if (timesReviewed === 1) {
      interval = 6;
    } else {
      interval = Math.round(currentInterval * ef);
    }
  }

  // Clamp to reasonable bounds
  interval = Math.max(1, Math.min(interval, 365));

  const nextReview = new Date();
  nextReview.setDate(nextReview.getDate() + interval);
  const nextReviewStr = nextReview.toISOString().split("T")[0];

  return {
    interval,
    ease_factor: Math.round(ef * 100) / 100,
    next_review: nextReviewStr,
    times_reviewed: timesReviewed + 1,
  };
}

/**
 * Apply a review rating to a vocabulary item and persist the result.
 * Returns the updated item, or null if the item wasn't found.
 */
export async function reviewVocabItem(
  item: VocabItem,
  rating: SRSRating
): Promise<VocabItem | null> {
  const update = calculateSM2(
    rating,
    item.interval,
    item.ease_factor,
    item.times_reviewed
  );

  return await updateVocabItem(item.id, update);
}
