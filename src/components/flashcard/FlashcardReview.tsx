import { useState, useCallback, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Flashcard } from "@/components/flashcard/Flashcard";
import { useI18n } from "@/i18n";
import {
  getDueVocabulary,
  getVocabulary,
  updateVocabItem,
  deleteVocabItem,
} from "@/services/storage";
import { reviewVocabItem } from "@/services/srs";
import type { VocabItem, SRSRating } from "@/types";
import { format } from "date-fns";
import { BookOpenText, ChevronDown, CircleCheckBig, PartyPopper } from "lucide-react";

// ── Shared constants ─────────────────────────────────────

const RATINGS: { value: SRSRating; labelKey: "flashcards.again" | "flashcards.hard" | "flashcards.good" | "flashcards.easy"; sublabel: string; className: string }[] = [
  { value: "again", labelKey: "flashcards.again", sublabel: "1d", className: "bg-red-500 hover:bg-red-600 text-white" },
  { value: "hard", labelKey: "flashcards.hard", sublabel: "~3d", className: "bg-orange-500 hover:bg-orange-600 text-white" },
  { value: "good", labelKey: "flashcards.good", sublabel: "~7d", className: "bg-blue-500 hover:bg-blue-600 text-white" },
  { value: "easy", labelKey: "flashcards.easy", sublabel: "~14d+", className: "bg-green-500 hover:bg-green-600 text-white" },
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

async function exportAnki(vocab: VocabItem[]) {
  if (vocab.length === 0) return false;

  const header = "#separator:tab\n#html:false\n#columns:Front\tBack\tReading\tExample\n";
  const rows = vocab
    .map((v) => `${v.word}\t${v.meaning}\t${v.reading}\t${v.example}`)
    .join("\n");

  const blob = new Blob([header + rows], { type: "text/tab-separated-values" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tama-vocabulary-${format(new Date(), "yyyy-MM-dd")}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

// ── Main component ───────────────────────────────────────

export function FlashcardReview() {
  const { t } = useI18n();
  const [tab, setTab] = useState<FlashcardTab>("review");
  const [vocabVersion, setVocabVersion] = useState(0);
  const [allVocab, setAllVocab] = useState<VocabItem[]>([]);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

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
  const showMessage = useCallback((type: "success" | "error", text: string, duration = 3000) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), duration);
  }, []);
  const handleExportAnki = useCallback(async () => {
    try {
      const exported = await exportAnki(allVocab);
      if (exported) {
        showMessage("success", t("flashcards.ankiDownloaded"));
      }
    } catch (error) {
      console.error("Failed to export Anki file:", error);
      showMessage("error", t("flashcards.ankiDownloadFailed"), 5000);
    }
  }, [allVocab, showMessage, t]);

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
    <div className="flex flex-col h-full max-w-2xl mx-auto">
      {message && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div
            className={`px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium ${
              message.type === "success"
                ? "bg-green-600 text-white"
                : "bg-red-600 text-white"
            }`}
          >
            {message.text}
          </div>
        </div>
      )}

      {/* Stats strip */}
      <div className="flex items-center gap-3 px-4 py-3 border-b text-xs text-muted-foreground flex-wrap">
        <span>
          <strong className="text-foreground">{stats.total}</strong> {t("flashcards.cards")}
        </span>
        <Separator orientation="vertical" className="h-3.5" />
        {stats.due > 0 ? (
          <span className="text-orange-600 font-medium">{stats.due} {t("common.due")}</span>
        ) : (
          <span className="text-green-600">{t("flashcards.allCaughtUp")}</span>
        )}
        <Separator orientation="vertical" className="h-3.5" />
        <span>{stats.new} {t("common.new")}</span>
        <span>·</span>
        <span>{stats.learning} {t("common.learning")}</span>
        <span>·</span>
        <span>{stats.mature} {t("common.mature")}</span>
        <Separator orientation="vertical" className="h-3.5 ml-auto" />
        <Button
          variant="outline"
          size="sm"
          className="h-6 text-[11px] px-2.5"
          onClick={() => void handleExportAnki()}
        >
          {t("common.exportAnki")}
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex border-b">
        <button
          onClick={() => setTab("review")}
          className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
            tab === "review"
              ? "text-foreground border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t("common.review")}
          {stats.due > 0 && (
            <Badge variant="secondary" className="ml-1.5 text-[10px] h-4 px-1.5 bg-orange-100 text-orange-700">
              {stats.due}
            </Badge>
          )}
        </button>
        <button
          onClick={() => setTab("all-cards")}
          className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
            tab === "all-cards"
              ? "text-foreground border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t("common.allCards")}
        </button>
      </div>

      {/* Tab content */}
      {tab === "review" ? (
        <ReviewTab onReviewComplete={refreshVocab} />
      ) : (
        <AllCardsTab vocab={allVocab} onVocabChange={refreshVocab} />
      )}
    </div>
  );
}

// ── Review tab ───────────────────────────────────────────

type ReviewState = "reviewing" | "complete";

function ReviewTab({ onReviewComplete }: { onReviewComplete: () => void }) {
  const { t } = useI18n();
  const [cards, setCards] = useState<VocabItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [state, setState] = useState<ReviewState>("reviewing");
  const [results, setResults] = useState<{ word: string; rating: SRSRating }[]>([]);
  const [isAnswerVisible, setIsAnswerVisible] = useState(false);
  const [hasRevealedCurrentCard, setHasRevealedCurrentCard] = useState(false);

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

  const handleRestart = useCallback(async () => {
    const due = await getDueVocabulary();
    setCards(due);
    setCurrentIndex(0);
    setResults([]);
    setIsAnswerVisible(false);
    setHasRevealedCurrentCard(false);
    setState(due.length === 0 ? "complete" : "reviewing");
  }, []);

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
    const againCount = results.filter((r) => r.rating === "again").length;
    const goodCount = results.filter((r) => r.rating === "good" || r.rating === "easy").length;

    return (
      <div className="flex flex-col items-center justify-center flex-1 p-4">
        <Card className="w-full max-w-sm !py-0 !gap-0">
          <CardContent className="py-8 space-y-5 text-center">
            {results.length === 0 ? (
              <>
                <div className="flex justify-center text-green-600">
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
                <div className="flex justify-center gap-3 text-sm">
                  {goodCount > 0 && (
                    <Badge variant="secondary" className="bg-green-100 text-green-800">
                      {goodCount} {t("flashcards.correct")}
                    </Badge>
                  )}
                  {againCount > 0 && (
                    <Badge variant="secondary" className="bg-red-100 text-red-800">
                      {againCount} {t("flashcards.toRedo")}
                    </Badge>
                  )}
                </div>
              </>
            )}
            <Button onClick={handleRestart} variant="outline" className="w-full">
              {t("flashcards.checkAgain")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center flex-1 p-4">
      {/* Progress bar */}
      <div className="w-full max-w-sm mb-6 space-y-1.5">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>
            {currentIndex + 1} / {cards.length}
          </span>
          <span>{Math.round(progress * 100)}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${(currentIndex / cards.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Flashcard */}
      <div className="flex-1 flex items-center justify-center w-full">
        {currentCard && (
          <Flashcard
            key={currentCard.id}
            item={currentCard}
            flipped={isAnswerVisible}
            onFlipChange={setIsAnswerVisible}
          />
        )}
      </div>

      {/* Reserve rating area height so flipping the card doesn't shift the layout */}
      <div className="w-full max-w-sm pb-6 min-h-[108px] flex items-end">
        {isAnswerVisible || hasRevealedCurrentCard ? (
          <div className="w-full space-y-2">
            <p
              className={`text-xs text-center text-muted-foreground mb-3 transition-opacity ${
                isAnswerVisible ? "opacity-100" : "opacity-0"
              }`}
            >
              {t("flashcards.howWellRemembered")}
            </p>
            <div className="grid grid-cols-4 gap-2">
              {RATINGS.map((r, index) => (
                <Button
                  key={r.value}
                  className={`flex flex-col h-auto py-2 ${r.className}`}
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
              className={`text-[11px] text-center text-muted-foreground transition-opacity ${
                isAnswerVisible ? "opacity-100" : "opacity-0"
              }`}
            >
              {t("flashcards.pressSpaceToFlip")}
            </p>
          </div>
        ) : (
          <div className="w-full flex items-center justify-center">
            <p className="text-xs text-center text-muted-foreground">
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
}: {
  vocab: VocabItem[];
  onVocabChange: () => void;
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
    new: { label: t("common.new"), class: "bg-blue-100 text-blue-700" },
    learning: { label: t("common.learning"), class: "bg-yellow-100 text-yellow-700" },
    mature: { label: t("common.mature"), class: "bg-green-100 text-green-700" },
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
            <span className="h-2 w-2 rounded-full bg-orange-500" title={t("flashcards.dueNow")} />
          )}
          <Badge variant="secondary" className={`text-[10px] ${maturityConfig.class}`}>
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
                  Next review: <strong className={due ? "text-orange-600" : "text-foreground"}>
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
