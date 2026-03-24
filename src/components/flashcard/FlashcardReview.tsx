import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Flashcard } from "@/components/flashcard/Flashcard";
import { useI18n } from "@/i18n";
import { buildFlashcardSenseiViewContext } from "@/services/sensei-context";
import {
  saveFlashcardReviewSession,
  getDueVocabulary,
  getVocabulary,
  updateVocabItem,
  deleteVocabItem,
} from "@/services/storage";
import { reviewVocabItem } from "@/services/srs";
import type { SenseiFlashcardResult, SenseiViewContext, VocabItem, SRSRating } from "@/types";
import { BookOpenText, ChevronDown, CircleCheckBig, PartyPopper } from "lucide-react";

// ── Shared constants ─────────────────────────────────────

const RATINGS: { value: SRSRating; labelKey: "flashcards.again" | "flashcards.hard" | "flashcards.good" | "flashcards.easy"; sublabel: string; className: string }[] = [
  { value: "again", labelKey: "flashcards.again", sublabel: "1d", className: "bg-review-again hover:bg-review-again/90 text-review-again-foreground" },
  { value: "hard", labelKey: "flashcards.hard", sublabel: "~3d", className: "bg-review-hard hover:bg-review-hard/90 text-review-hard-foreground" },
  { value: "good", labelKey: "flashcards.good", sublabel: "~7d", className: "bg-review-good hover:bg-review-good/90 text-review-good-foreground" },
  { value: "easy", labelKey: "flashcards.easy", sublabel: "~14d+", className: "bg-success hover:bg-success/90 text-success-foreground" },
];

const RATING_SHORTCUTS = ["1", "2", "3", "4"] as const;

type FlashcardTab = "review" | "all-cards";

// ── Helpers ──────────────────────────────────────────────

function getMaturity(item: VocabItem): "new" | "learning" | "mature" {
  if (item.times_reviewed <= 1) return "new";
  if (item.times_reviewed <= 5) return "learning";
  return "mature";
}

function isDue(item: VocabItem): boolean {
  return item.next_review <= new Date().toISOString().split("T")[0];
}

function formatReviewDate(dateStr: string, t: ReturnType<typeof useI18n>["t"]): string {
  const today = new Date().toISOString().split("T")[0];
  if (dateStr <= today) return t("flashcards.dueNow");
  const diff = Math.round(
    (new Date(dateStr).getTime() - new Date(today).getTime()) / 86_400_000
  );
  if (diff === 1) return t("flashcards.tomorrow");
  return t("flashcards.inDays", { count: diff });
}

// ── Main component ───────────────────────────────────────

export function FlashcardReview({ onContextChange }: { onContextChange?: (context: SenseiViewContext) => void }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<FlashcardTab>("review");
  const [vocabVersion, setVocabVersion] = useState(0);
  const [allVocab, setAllVocab] = useState<VocabItem[]>([]);

  useEffect(() => {
    getVocabulary().then(setAllVocab);
  }, [vocabVersion]);
  const dueCount = useMemo(
    () => allVocab.filter((v) => isDue(v)).length,
    [allVocab]
  );

  const stats = useMemo(() => {
    let newCount = 0;
    let learning = 0;
    let mature = 0;
    for (const v of allVocab) {
      const m = getMaturity(v);
      if (m === "new") newCount++;
      else if (m === "learning") learning++;
      else mature++;
    }
    return { total: allVocab.length, due: dueCount, new: newCount, learning, mature };
  }, [allVocab, dueCount]);

  const refreshVocab = useCallback(() => setVocabVersion((v) => v + 1), []);

  useEffect(() => {
    window.addEventListener("tama-data-changed", refreshVocab);
    return () => window.removeEventListener("tama-data-changed", refreshVocab);
  }, [refreshVocab]);

  if (stats.total === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4">
        <div className="text-center space-y-4 max-w-sm">
          <div className="flex justify-center text-muted-foreground">
            <BookOpenText className="size-14" />
          </div>
          <h2 className="text-xl font-semibold">{t("flashcards.noVocabulary")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("flashcards.noVocabularyDescription")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full max-w-3xl mx-auto flex-col px-4 py-4">
      <div className="flex flex-1 min-h-0 flex-col gap-4">
        <Card className="w-full gap-0 py-0">
          <CardContent className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="text-lg font-semibold">{t("common.flashcards")}</h1>
              <Badge variant={stats.due > 0 ? "accent" : "success"}>
                {stats.due > 0 ? `${stats.due} ${t("common.due")}` : t("flashcards.allCaughtUp")}
              </Badge>
              <p className="text-xs text-muted-foreground">
                {t("flashcards.deckSummary", {
                  newCount: stats.new,
                  learningCount: stats.learning,
                  matureCount: stats.mature,
                })}
              </p>
            </div>

            <div className="ml-auto inline-flex overflow-hidden rounded-md border bg-background shadow-xs">
              <Button
                type="button"
                size="sm"
                variant={tab === "review" ? "default" : "ghost"}
                className="rounded-none border-0 shadow-none"
                aria-pressed={tab === "review"}
                onClick={() => setTab("review")}
              >
                {t("common.review")}
              </Button>

              <Button
                type="button"
                size="sm"
                variant={tab === "all-cards" ? "default" : "ghost"}
                className="rounded-none border-0 border-l shadow-none"
                aria-pressed={tab === "all-cards"}
                onClick={() => setTab("all-cards")}
              >
                {t("common.allCards")}
              </Button>
            </div>
          </CardContent>
        </Card>

        {tab === "review" ? (
          <ReviewTab
            onReviewComplete={refreshVocab}
            onContextChange={onContextChange}
            dueCount={stats.due}
            totalCards={stats.total}
          />
        ) : (
          <AllCardsTab
            vocab={allVocab}
            onVocabChange={refreshVocab}
            onContextChange={onContextChange}
            dueCount={stats.due}
            totalCards={stats.total}
          />
        )}
      </div>
    </div>
  );
}

// ── Review tab ───────────────────────────────────────────

type ReviewState = "reviewing" | "complete";

function ReviewTab({
  onReviewComplete,
  onContextChange,
  dueCount,
  totalCards,
}: {
  onReviewComplete: () => void;
  onContextChange?: (context: SenseiViewContext) => void;
  dueCount: number;
  totalCards: number;
}) {
  const { t } = useI18n();
  const [cards, setCards] = useState<VocabItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [state, setState] = useState<ReviewState>("reviewing");
  const [results, setResults] = useState<SenseiFlashcardResult[]>([]);
  const [isAnswerVisible, setIsAnswerVisible] = useState(false);
  const [hasRevealedCurrentCard, setHasRevealedCurrentCard] = useState(false);
  const reviewStartedAtRef = useRef(Date.now());
  const sessionSavedRef = useRef(false);

  useEffect(() => {
    getDueVocabulary().then((due) => {
      setCards(due);
      setState(due.length === 0 ? "complete" : "reviewing");
    });
  }, []);

  const currentCard = cards[currentIndex] ?? null;
  const progress = cards.length > 0 ? currentIndex / cards.length : 0;

  const handleRate = useCallback(
    async (rating: SRSRating) => {
      if (!currentCard) return;

      await reviewVocabItem(currentCard, rating);
      setResults((prev) => [...prev, { word: currentCard.word, rating }]);
      setIsAnswerVisible(false);
      setHasRevealedCurrentCard(false);

      if (currentIndex + 1 >= cards.length) {
        setState("complete");
        onReviewComplete();
      } else {
        setCurrentIndex((i) => i + 1);
      }
    },
    [currentCard, currentIndex, cards.length, onReviewComplete]
  );

  useEffect(() => {
    setIsAnswerVisible(false);
    setHasRevealedCurrentCard(false);
  }, [currentCard?.id]);

  useEffect(() => {
    if (isAnswerVisible) {
      setHasRevealedCurrentCard(true);
    }
  }, [isAnswerVisible]);

  useEffect(() => {
    onContextChange?.(
      buildFlashcardSenseiViewContext({
        tab: "review",
        dueCount,
        totalCards,
        reviewState: state,
        currentCard,
        isAnswerVisible,
        recentResults: results,
      })
    );
  }, [currentCard, dueCount, isAnswerVisible, onContextChange, results, state, totalCards]);

  useEffect(() => {
    if (state !== "complete" || results.length === 0 || sessionSavedRef.current) {
      return;
    }

    sessionSavedRef.current = true;
    const durationSeconds = Math.max(1, Math.round((Date.now() - reviewStartedAtRef.current) / 1000));

    void saveFlashcardReviewSession({
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      duration_seconds: durationSeconds,
      results,
    }).catch((error) => {
      console.error("Failed to save flashcard review session:", error);
      sessionSavedRef.current = false;
    });
  }, [results, state]);

  useEffect(() => {
    function isEditableTarget(target: EventTarget | null) {
      if (!(target instanceof HTMLElement)) return false;
      return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || isEditableTarget(event.target)) {
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        setIsAnswerVisible((prev) => !prev);
        return;
      }

      if (!isAnswerVisible) return;

      const shortcutIndex =
        event.code.startsWith("Digit")
          ? Number(event.code.slice(-1)) - 1
          : event.code.startsWith("Numpad")
            ? Number(event.code.slice(-1)) - 1
            : -1;

      if (shortcutIndex < 0 || shortcutIndex >= RATINGS.length) return;

      event.preventDefault();
      void handleRate(RATINGS[shortcutIndex].value);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleRate, isAnswerVisible]);

  if (state === "complete") {
    return (
      <div className="flex flex-col items-center justify-center flex-1 p-4">
        <Card className="w-full max-w-sm !py-0 !gap-0">
          <CardContent className="py-8 space-y-4 text-center">
            {results.length === 0 ? (
              <>
                <div className="flex justify-center text-success">
                  <CircleCheckBig className="size-14" />
                </div>
                <h2 className="text-xl font-semibold">{t("flashcards.allCaughtUpTitle")}</h2>
                <p className="text-sm text-muted-foreground">
                  {t("flashcards.noCardsDue")}
                </p>
              </>
            ) : (
              <>
                <div className="flex justify-center text-primary">
                  <PartyPopper className="size-14" />
                </div>
                <h2 className="text-xl font-semibold">{t("flashcards.complete")}</h2>
                <p className="text-sm text-muted-foreground">
                  {t("flashcards.reviewedCards", {
                    count: results.length,
                    cardLabel: results.length === 1 ? t("flashcards.cardSingular") : t("flashcards.cards"),
                  })}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center flex-1 px-4 pt-5 pb-6">
      {/* Progress bar */}
      <div className="w-full max-w-sm mb-8 space-y-2">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>
            {currentIndex + 1} / {cards.length}
          </span>
          <span>{Math.round(progress * 100)}%</span>
        </div>
        <Progress value={(currentIndex / cards.length) * 100} />
      </div>

      {/* Flashcard */}
      <div className="flex flex-1 items-center justify-center w-full pb-5">
        {currentCard && (
          <Flashcard
            key={currentCard.id}
            item={currentCard}
            flipped={isAnswerVisible}
            onFlipChange={setIsAnswerVisible}
          />
        )}
      </div>

      {/* Keep the full rating block in flow so flipping the card doesn't shift the layout */}
      <div className="relative w-full max-w-sm pb-7">
        <div className="w-full space-y-3">
          <p
            className={`mb-4 text-center text-xs text-muted-foreground transition-opacity ${
              isAnswerVisible ? "opacity-100" : "opacity-0"
            }`}
          >
            {t("flashcards.howWellRemembered")}
          </p>
          <div className="grid grid-cols-4 gap-3">
            {RATINGS.map((r, index) => (
              <Button
                key={r.value}
                className={`flex h-auto flex-col py-2.5 transition-opacity ${isAnswerVisible ? "opacity-100" : "opacity-0"} ${!isAnswerVisible ? "invisible" : ""} ${r.className}`}
                onClick={() => handleRate(r.value)}
                aria-keyshortcuts={RATING_SHORTCUTS[index]}
                disabled={!isAnswerVisible}
                tabIndex={isAnswerVisible ? 0 : -1}
              >
                <span className="text-sm font-medium">
                  {RATING_SHORTCUTS[index]} {t(r.labelKey)}
                </span>
                <span className="text-[10px] opacity-80">{r.sublabel}</span>
              </Button>
            ))}
          </div>
          <p
            className={`text-center text-[11px] text-muted-foreground transition-opacity ${
              isAnswerVisible ? "opacity-100" : "opacity-0"
            }`}
          >
            {t("flashcards.pressSpaceToFlip")}
          </p>
        </div>

        {!hasRevealedCurrentCard && !isAnswerVisible && (
          <div className="absolute inset-x-0 top-0 bottom-6 flex items-center justify-center">
            <p className="text-center text-xs text-muted-foreground">
              {t("flashcards.tapOrSpace")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── All Cards tab ────────────────────────────────────────

function AllCardsTab({
  vocab,
  onVocabChange,
  onContextChange,
  dueCount,
  totalCards,
}: {
  vocab: VocabItem[];
  onVocabChange: () => void;
  onContextChange?: (context: SenseiViewContext) => void;
  dueCount: number;
  totalCards: number;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<VocabItem>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"word" | "next_review" | "times_reviewed">("next_review");

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let list = vocab;
    if (q) {
      list = vocab.filter(
        (v) =>
          v.word.toLowerCase().includes(q) ||
          v.reading.toLowerCase().includes(q) ||
          v.meaning.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      if (sortBy === "word") return a.word.localeCompare(b.word, "ja");
      if (sortBy === "times_reviewed") return b.times_reviewed - a.times_reviewed;
      return a.next_review.localeCompare(b.next_review);
    });
  }, [vocab, search, sortBy]);

  const handleToggle = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setEditingId(null);
    } else {
      setExpandedId(id);
      setEditingId(null);
      setConfirmDeleteId(null);
    }
  };

  const handleStartEdit = (item: VocabItem) => {
    setEditingId(item.id);
    setEditDraft({
      word: item.word,
      reading: item.reading,
      meaning: item.meaning,
      example: item.example,
    });
  };

  const handleSaveEdit = async (id: string) => {
    await updateVocabItem(id, editDraft);
    setEditingId(null);
    setEditDraft({});
    onVocabChange();
  };

  const handleDelete = async (id: string) => {
    await deleteVocabItem(id);
    setExpandedId(null);
    setConfirmDeleteId(null);
    onVocabChange();
  };

  useEffect(() => {
    const selectedCard = expandedId ? vocab.find((item) => item.id === expandedId) ?? null : null;
    onContextChange?.(
      buildFlashcardSenseiViewContext({
        tab: "all-cards",
        dueCount,
        totalCards,
        selectedCard,
      })
    );
  }, [dueCount, expandedId, onContextChange, totalCards, vocab]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Search + sort */}
      <div className="flex items-center gap-2 px-4 py-3">
        <Input
          placeholder={t("flashcards.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 text-sm"
        />
        <div className="relative shrink-0">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="h-8 appearance-none rounded-md border bg-background px-2 pr-7 text-xs text-muted-foreground"
          >
            <option value="next_review">{t("flashcards.sortByNextReview")}</option>
            <option value="word">{t("flashcards.sortByWord")}</option>
            <option value="times_reviewed">{t("flashcards.sortByTimesReviewed")}</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-foreground/80" />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-sm text-muted-foreground">
            {search ? t("flashcards.noMatchingCards") : t("flashcards.noVocabulary")}
          </p>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="px-4 pb-4 space-y-1.5">
            {filtered.map((item) => (
              <VocabCard
                key={item.id}
                item={item}
                isExpanded={expandedId === item.id}
                isEditing={editingId === item.id}
                editDraft={editingId === item.id ? editDraft : {}}
                confirmDelete={confirmDeleteId === item.id}
                onToggle={() => handleToggle(item.id)}
                onStartEdit={() => handleStartEdit(item)}
                onCancelEdit={() => setEditingId(null)}
                onSaveEdit={() => handleSaveEdit(item.id)}
                onEditDraftChange={setEditDraft}
                onConfirmDelete={() => setConfirmDeleteId(item.id)}
                onCancelDelete={() => setConfirmDeleteId(null)}
                onDelete={() => handleDelete(item.id)}
              />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

// ── Single vocab card row ────────────────────────────────

function VocabCard({
  item,
  isExpanded,
  isEditing,
  editDraft,
  confirmDelete,
  onToggle,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onEditDraftChange,
  onConfirmDelete,
  onCancelDelete,
  onDelete,
}: {
  item: VocabItem;
  isExpanded: boolean;
  isEditing: boolean;
  editDraft: Partial<VocabItem>;
  confirmDelete: boolean;
  onToggle: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onEditDraftChange: (d: Partial<VocabItem>) => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const maturity = getMaturity(item);
  const due = isDue(item);

  const maturityConfig = {
    new: { label: t("common.new"), variant: "accent" as const },
    learning: { label: t("common.learning"), variant: "warning" as const },
    mature: { label: t("common.mature"), variant: "success" as const },
  }[maturity];

  return (
    <div className="rounded-lg border overflow-hidden">
      {/* Summary row */}
      <button
        onClick={onToggle}
        className="w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-muted/50 transition-colors"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-medium">{item.word}</span>
            {item.reading && item.reading !== item.word && (
              <span className="text-xs text-muted-foreground">{item.reading}</span>
            )}
            <span className="text-sm text-muted-foreground">— {item.meaning}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {due && (
            <span className="h-2 w-2 rounded-full bg-review-due" title={t("flashcards.dueNow")} />
          )}
          <Badge variant={maturityConfig.variant} className="text-[10px]">
            {maturityConfig.label}
          </Badge>
          <svg
            className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Expanded detail */}
      {isExpanded && (
        <div className="border-t px-3 py-3 space-y-3 bg-muted/20">
          {isEditing ? (
            /* Edit mode */
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-medium text-muted-foreground uppercase">Word</label>
                  <Input
                    value={editDraft.word ?? ""}
                    onChange={(e) => onEditDraftChange({ ...editDraft, word: e.target.value })}
                    className="h-8 text-sm mt-0.5"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-muted-foreground uppercase">Reading</label>
                  <Input
                    value={editDraft.reading ?? ""}
                    onChange={(e) => onEditDraftChange({ ...editDraft, reading: e.target.value })}
                    className="h-8 text-sm mt-0.5"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-medium text-muted-foreground uppercase">Meaning</label>
                <Input
                  value={editDraft.meaning ?? ""}
                  onChange={(e) => onEditDraftChange({ ...editDraft, meaning: e.target.value })}
                  className="h-8 text-sm mt-0.5"
                />
              </div>
              <div>
                <label className="text-[10px] font-medium text-muted-foreground uppercase">Example</label>
                <Input
                  value={editDraft.example ?? ""}
                  onChange={(e) => onEditDraftChange({ ...editDraft, example: e.target.value })}
                  className="h-8 text-sm mt-0.5"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <Button size="sm" className="h-7 text-xs" onClick={onSaveEdit}>
                  {t("common.save")}
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onCancelEdit}>
                  {t("common.cancel")}
                </Button>
              </div>
            </div>
          ) : (
            /* Read mode */
            <>
              {item.example && (
                <p className="text-sm italic text-muted-foreground">{item.example}</p>
              )}

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>
                  Next review: <strong className={due ? "text-review-due" : "text-foreground"}>
                    {formatReviewDate(item.next_review, t)}
                  </strong>
                </span>
                <span>Interval: {item.interval}d</span>
                <span>{t("flashcards.reviewedCount", { count: item.times_reviewed })}</span>
                <span>Ease: {item.ease_factor.toFixed(2)}</span>
              </div>

              <Separator />

              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onStartEdit}>
                  {t("common.edit")}
                </Button>
                {confirmDelete ? (
                  <div className="flex items-center gap-1.5 ml-auto">
                    <span className="text-xs text-destructive">{t("flashcards.deleteCardQuestion")}</span>
                    <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={onDelete}>
                      {t("common.delete")}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onCancelDelete}>
                      {t("common.cancel")}
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-destructive hover:text-destructive ml-auto"
                    onClick={onConfirmDelete}
                  >
                    {t("common.delete")}
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
