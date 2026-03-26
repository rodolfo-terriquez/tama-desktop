import { format } from "date-fns";
import { getFlashcardReviewSessions, getOngoingChats, getQuizzes, getSessions } from "@/services/storage";

function addActivityCount(counts: Map<string, number>, rawDate: string | undefined): void {
  if (!rawDate) {
    return;
  }

  const date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) {
    return;
  }

  const key = format(date, "yyyy-MM-dd");
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

export async function getStudyActivityCountsByDate(): Promise<Map<string, number>> {
  const [sessions, flashcardReviews, quizzes, ongoingChats] = await Promise.all([
    getSessions(),
    getFlashcardReviewSessions(),
    getQuizzes(),
    getOngoingChats(),
  ]);

  const counts = new Map<string, number>();

  for (const session of sessions) {
    addActivityCount(counts, session.date);
  }

  for (const review of flashcardReviews) {
    addActivityCount(counts, review.date);
  }

  for (const quiz of quizzes) {
    addActivityCount(counts, quiz.latestAttempt?.completedAt);
  }

  for (const chat of ongoingChats) {
    if (chat.totalMessages > 0 || chat.messages.length > 0) {
      addActivityCount(counts, chat.lastActiveAt);
    }
  }

  return counts;
}
