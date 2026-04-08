import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useVADRecorder } from "@/hooks/useVADRecorder";
import { useI18n } from "@/i18n";
import { translateJapaneseText } from "@/services/claude";
import { buildShadowSessionSenseiViewContext } from "@/services/sensei-context";
import { generateDailyStudyPlan } from "@/services/study-plan";
import {
  compareShadowAttempt,
  getShadowPairs,
  summarizeShadowAttempts,
} from "@/services/shadow";
import { initializeTTS, speak, stopCurrentAudio } from "@/services/tts";
import { getTranscriptionEngine } from "@/services/transcription";
import { getUserProfile, saveSession, updateUserProfile } from "@/services/storage";
import type {
  Scenario,
  ShadowAttempt,
  ShadowScript,
  SenseiViewContext,
  Session,
} from "@/types";
import { Loader2, LogOut, Mic, RefreshCcw, SkipForward, Volume2 } from "lucide-react";

type ShadowPhase = "playing" | "waiting" | "transcribing" | "result" | "complete";

interface ShadowModeScreenProps {
  scenario: Scenario;
  script: ShadowScript;
  onRegenerateScript: () => Promise<ShadowScript>;
  onBackToPreview: () => void;
  onContextChange?: (context: SenseiViewContext) => void;
}

export function ShadowModeScreen({
  scenario,
  script,
  onRegenerateScript,
  onBackToPreview,
  onContextChange,
}: ShadowModeScreenProps) {
  const { locale, t } = useI18n();
  const pairs = useMemo(() => getShadowPairs(script), [script]);
  const [currentPairIndex, setCurrentPairIndex] = useState(0);
  const [phase, setPhase] = useState<ShadowPhase>("playing");
  const [attempts, setAttempts] = useState<ShadowAttempt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isReplayingLine, setIsReplayingLine] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [ttsChecked, setTtsChecked] = useState(false);
  const [ttsReady, setTtsReady] = useState(false);
  const [showTranslations, setShowTranslations] = useState(false);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [isTranslatingAll, setIsTranslatingAll] = useState(false);

  const currentPairIndexRef = useRef(0);
  const phaseRef = useRef<ShadowPhase>("playing");
  const sessionStartedAtRef = useRef(Date.now());
  const sessionSavedRef = useRef(false);
  const isListeningRef = useRef(false);
  const startVADRef = useRef<((options?: { requireWhisperLoaded?: boolean }) => Promise<void>) | null>(null);
  const pauseVADRef = useRef<() => void>(() => {});
  const resumeVADRef = useRef<() => void>(() => {});

  const currentPair = pairs[currentPairIndex] ?? null;
  const lastAttempt = attempts.at(-1) ?? null;
  const summary = useMemo(() => summarizeShadowAttempts(attempts), [attempts]);
  const passCount = useMemo(
    () => attempts.filter((attempt) => attempt.result === "close").length,
    [attempts]
  );
  const needsWorkCount = useMemo(
    () => attempts.filter((attempt) => attempt.result === "partial" || attempt.result === "off").length,
    [attempts]
  );
  const attemptByTurn = useMemo(
    () =>
      attempts.reduce<Record<number, ShadowAttempt>>((accumulator, attempt) => {
        accumulator[attempt.turnIndex] = attempt;
        return accumulator;
      }, {}),
    [attempts]
  );
  const progressValue = pairs.length > 0 ? ((Math.min(currentPairIndex + 1, pairs.length)) / pairs.length) * 100 : 0;
  const translationKey = useCallback(
    (turnIndex: number) => `${script.id}:${locale}:${turnIndex}`,
    [locale, script.id]
  );
  const assistantTranslation = translations[translationKey(currentPairIndex * 2)];
  const userTranslation = translations[translationKey(currentPairIndex * 2 + 1)];
  const assistantLineLabel = currentPair?.assistant.speakerLabel?.trim() || t("shadow.otherSpeakerLine");

  const {
    isListening,
    isSpeaking: userIsSpeaking,
    isLoading: vadLoading,
    error: vadError,
    start: startVAD,
    stop: stopVAD,
    pause: pauseVAD,
    resume: resumeVAD,
  } = useVADRecorder({
    onSpeechEnd: () => {
      if (phaseRef.current === "waiting") {
        setPhase("transcribing");
      }
    },
    onTranscription: (text) => {
      const pair = pairs[currentPairIndexRef.current];
      if (!pair || (phaseRef.current !== "waiting" && phaseRef.current !== "transcribing")) {
        return;
      }

      pauseVADRef.current();
      const comparison = compareShadowAttempt(pair.user.text, text);
      setAttempts((prev) => [
        ...prev,
        {
          turnIndex: currentPairIndexRef.current,
          expectedText: pair.user.text,
          transcript: text.trim(),
          result: comparison.result,
          similarity: comparison.similarity,
          manualAdvance: false,
          timestamp: new Date().toISOString(),
        },
      ]);
      setPhase("result");
    },
    onAmplitude: () => {},
    onError: (message) => {
      setError(message);
      setPhase((prev) => (prev === "transcribing" ? "waiting" : prev));
    },
  });

  useEffect(() => {
    currentPairIndexRef.current = currentPairIndex;
  }, [currentPairIndex]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  useEffect(() => {
    startVADRef.current = startVAD;
  }, [startVAD]);

  useEffect(() => {
    pauseVADRef.current = pauseVAD;
  }, [pauseVAD]);

  useEffect(() => {
    resumeVADRef.current = resumeVAD;
  }, [resumeVAD]);

  const ensureTTSReady = useCallback(
    async (surfaceError: boolean = true): Promise<boolean> => {
      try {
        const result = await initializeTTS();
        setTtsChecked(true);
        setTtsReady(result.available);
        if (!result.available && surfaceError) {
          setError(t("shadow.voiceUnavailable"));
        }
        return result.available;
      } catch (err) {
        setTtsChecked(true);
        setTtsReady(false);
        if (surfaceError) {
          setError(err instanceof Error ? err.message : t("shadow.voiceUnavailable"));
        }
        return false;
      }
    },
    [t]
  );

  useEffect(() => {
    void ensureTTSReady(false);
  }, [ensureTTSReady]);

  useEffect(() => {
    if (!showTranslations) {
      return;
    }

    const missingTurns = script.turns
      .map((turn, index) => ({ turn, index }))
      .filter(({ index }) => !translations[translationKey(index)]);

    if (missingTurns.length === 0) {
      return;
    }

    let cancelled = false;
    setIsTranslatingAll(true);

    void Promise.allSettled(
      missingTurns.map(async ({ turn, index }) => {
        const translated = await translateJapaneseText(turn.text, locale);
        return { index, translated };
      })
    ).then((results) => {
      if (cancelled) {
        return;
      }

      setTranslations((prev) => {
        const next = { ...prev };
        results.forEach((result, resultIndex) => {
          const { index } = missingTurns[resultIndex];
          next[translationKey(index)] =
            result.status === "fulfilled"
              ? result.value.translated
              : t("message.failedToTranslate");
        });
        return next;
      });
      setIsTranslatingAll(false);
    });

    return () => {
      cancelled = true;
    };
  }, [locale, script.turns, showTranslations, t, translationKey, translations]);

  const beginListening = useCallback(async () => {
    try {
      if (!isListeningRef.current) {
        await startVADRef.current?.({
          requireWhisperLoaded: getTranscriptionEngine() === "local",
        });
      } else {
        resumeVADRef.current();
      }
      setPhase("waiting");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("shadow.voiceUnavailable"));
      setPhase("waiting");
    }
  }, [t]);

  const playAssistantLine = useCallback(
    async (line: string) => {
      pauseVADRef.current();
      setPhase("playing");
      stopCurrentAudio();
      try {
        const canPlayAudio = await ensureTTSReady();
        if (canPlayAudio) {
          await speak(line);
        }
      } catch (err) {
        console.error("Shadow TTS error:", err);
        setError(err instanceof Error ? err.message : t("shadow.replayFailed"));
      }
      await beginListening();
    },
    [beginListening, ensureTTSReady, t]
  );

  const startPair = useCallback(
    async (index: number) => {
      const pair = pairs[index];
      if (!pair) {
        setPhase("complete");
        return;
      }

      setCurrentPairIndex(index);
      setError(null);
      await playAssistantLine(pair.assistant.text);
    },
    [pairs, playAssistantLine]
  );

  const moveToNextTurn = useCallback(async () => {
    stopCurrentAudio();
    if (currentPairIndex + 1 >= pairs.length) {
      pauseVADRef.current();
      setPhase("complete");
      return;
    }

    await startPair(currentPairIndex + 1);
  }, [currentPairIndex, pairs.length, startPair]);

  const handleManualAdvance = useCallback(async () => {
    if (!currentPair) return;

    pauseVADRef.current();
    setAttempts((prev) => [
      ...prev,
      {
        turnIndex: currentPairIndex,
        expectedText: currentPair.user.text,
        transcript: "",
        result: "skipped",
        similarity: 0,
        manualAdvance: true,
        timestamp: new Date().toISOString(),
      },
    ]);

    if (currentPairIndex + 1 >= pairs.length) {
      setPhase("complete");
      return;
    }

    await startPair(currentPairIndex + 1);
  }, [currentPair, currentPairIndex, pairs.length, startPair]);

  const replayAssistantAudio = useCallback(async () => {
    if (!currentPair) return;

    const shouldResumeListening = phaseRef.current === "waiting";
    pauseVADRef.current();
    setIsReplayingLine(true);
    try {
      stopCurrentAudio();
      const canPlayAudio = await ensureTTSReady();
      if (!canPlayAudio) {
        return;
      }
      await speak(currentPair.assistant.text);
    } catch (err) {
      console.error("Replay error:", err);
      setError(err instanceof Error ? err.message : t("shadow.replayFailed"));
    } finally {
      if (shouldResumeListening) {
        resumeVADRef.current();
      }
      setIsReplayingLine(false);
    }
  }, [currentPair, ensureTTSReady, t]);

  const resetSession = useCallback(async () => {
    sessionStartedAtRef.current = Date.now();
    sessionSavedRef.current = false;
    setAttempts([]);
    setCurrentPairIndex(0);
    setPhase("playing");
    setError(null);
    await startPair(0);
  }, [startPair]);

  useEffect(() => {
    void resetSession();

    return () => {
      stopCurrentAudio();
      void stopVAD();
    };
  }, [resetSession, script.id, stopVAD]);

  useEffect(() => {
    const activeAttempt = lastAttempt?.turnIndex === currentPairIndex ? lastAttempt : null;
    if (phase !== "result" || !activeAttempt) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void moveToNextTurn();
    }, 500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [currentPairIndex, lastAttempt, moveToNextTurn, phase]);

  useEffect(() => {
    const pair = pairs[currentPairIndex] ?? null;

    if (phase === "complete") {
      onContextChange?.(
        buildShadowSessionSenseiViewContext({
          scenario,
          locale,
          script,
          currentTurnNumber: pairs.length,
          totalTurns: pairs.length,
          phase: "complete",
        })
      );
      return;
    }

    if (!pair) return;

    onContextChange?.(
      buildShadowSessionSenseiViewContext({
        scenario,
        locale,
        script,
        currentTurnNumber: currentPairIndex + 1,
        totalTurns: pairs.length,
        phase,
        currentAssistantLine: pair.assistant.text,
        currentUserLine: pair.user.text,
        lastAttempt:
          lastAttempt?.turnIndex === currentPairIndex ? lastAttempt : null,
      })
    );
  }, [currentPairIndex, lastAttempt, locale, onContextChange, pairs, phase, scenario, script]);

  useEffect(() => {
    if (phase !== "complete" || sessionSavedRef.current) {
      return;
    }

    sessionSavedRef.current = true;
    void (async () => {
      const endTime = Date.now();
      const durationSeconds = Math.max(1, Math.round((endTime - sessionStartedAtRef.current) / 1000));
      const startedAt = new Date(sessionStartedAtRef.current);
      const messages = script.turns.map((turn, index) => ({
        id: `${script.id}-${index}`,
        role: turn.speaker,
        content: turn.text,
        timestamp: new Date(startedAt.getTime() + index * 1000).toISOString(),
      }));

      const session: Session = {
        id: crypto.randomUUID(),
        date: new Date().toISOString(),
        scenario,
        messages,
        feedback: null,
        duration_seconds: durationSeconds,
        run_mode: "shadow",
      };

      await saveSession(session);
      const profile = await getUserProfile();
      await updateUserProfile({
        total_sessions: profile.total_sessions + 1,
      });
      void generateDailyStudyPlan().catch((error) => {
        console.error("Failed to refresh daily study plan after shadow session:", error);
      });
    })().catch((err) => {
      console.error("Failed to save shadow session:", err);
      setError(err instanceof Error ? err.message : t("shadow.saveFailed"));
    });
  }, [phase, scenario, script, t]);

  const handleRegenerate = async () => {
    setIsRegenerating(true);
    setError(null);
    try {
      await onRegenerateScript();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("shadow.generateFailed"));
    } finally {
      setIsRegenerating(false);
    }
  };

  if (phase === "complete") {
    return (
      <div className="h-full overflow-y-auto p-4">
        <div className="mx-auto flex min-h-full w-full max-w-2xl items-start justify-center py-4">
          <Card className="w-full">
            <CardHeader>
              <CardTitle>{t("shadow.summaryTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-4">
                <SummaryMetric label={t("shadow.linesCompleted")} value={String(pairs.length)} />
                <SummaryMetric label={t("shadow.resultPass")} value={String(passCount)} />
                <SummaryMetric label={t("shadow.needsWorkCount")} value={String(needsWorkCount)} />
                <SummaryMetric label={t("shadow.skippedLines")} value={String(summary.skipped)} />
              </div>

              <div className="space-y-3">
                <p className="text-sm font-medium">{t("shadow.dialogueReviewTitle")}</p>
                <div className="space-y-3">
                  {pairs.map((pair, index) => {
                    const attempt = attemptByTurn[index];
                    const reviewResult = getReviewResult(attempt);
                    const assistantLabel = pair.assistant.speakerLabel?.trim() || t("shadow.otherSpeakerLine");

                    return (
                      <div key={`${script.id}-review-${index}`} className="rounded-lg border bg-muted/20 p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-muted-foreground">
                            {t("shadow.progressLabel", { current: index + 1, total: pairs.length })}
                          </span>
                          <Badge variant={getReviewBadgeVariant(reviewResult)}>
                            {reviewResult === "pass"
                              ? t("shadow.resultPass")
                              : reviewResult === "skipped"
                                ? t("shadow.summarySkipped")
                                : t("shadow.needsWorkBadge")}
                          </Badge>
                        </div>
                        <div className="space-y-2 text-sm leading-relaxed">
                          <p>
                            <span className="font-medium">{assistantLabel}:</span>{" "}
                            {pair.assistant.text}
                          </p>
                          <p>
                            <span className="font-medium">{t("shadow.yourLine")}:</span>{" "}
                            {pair.user.text}
                          </p>
                          {attempt?.manualAdvance ? (
                            <p className="text-muted-foreground">{t("shadow.summarySkippedLine")}</p>
                          ) : attempt && reviewResult !== "pass" ? (
                            <div className="rounded-md bg-background/80 px-3 py-2 text-muted-foreground">
                              {attempt.transcript && (
                                <p>
                                  <span className="font-medium text-foreground">{t("shadow.youSaidLabel")}:</span>{" "}
                                  {attempt.transcript}
                                </p>
                              )}
                              <p>
                                <span className="font-medium text-foreground">{t("shadow.tryInsteadLabel")}:</span>{" "}
                                {pair.user.text}
                              </p>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void resetSession()}>
                  <RefreshCcw className="mr-1 size-4" />
                  {t("shadow.replayScript")}
                </Button>
                <Button variant="outline" onClick={handleRegenerate} disabled={isRegenerating}>
                  {isRegenerating ? <Loader2 className="mr-1 size-4 animate-spin" /> : <RefreshCcw className="mr-1 size-4" />}
                  {t("shadow.regenerateScript")}
                </Button>
                <Button variant="ghost" onClick={onBackToPreview}>
                  {t("shadow.backToScenario")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!currentPair) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertDescription>{t("shadow.invalidScript")}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={onBackToPreview}>
            <LogOut className="mr-1 size-4" />
            {t("shadow.endSession")}
          </Button>
          <Badge variant="accent">
            {t("shadow.progressLabel", { current: currentPairIndex + 1, total: pairs.length })}
          </Badge>
          <label className="ml-auto inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium">
            <input
              type="checkbox"
              className="size-4"
              checked={showTranslations}
              onChange={(event) => setShowTranslations(event.target.checked)}
            />
            <span>{t("shadow.showTranslations")}</span>
            {showTranslations && isTranslatingAll && (
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
            )}
          </label>
          {(vadError || error) && (
            <span className="text-xs text-destructive">{vadError || error}</span>
          )}
        </div>

        <Progress value={progressValue} />

        <Card className="py-0">
          <CardHeader className="px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base">{assistantLineLabel}</CardTitle>
              <div className="flex items-center gap-2">
                {ttsChecked && !ttsReady && (
                  <Badge variant="destructive-soft">{t("shadow.voiceUnavailable")}</Badge>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={replayAssistantAudio}
                  disabled={isReplayingLine}
                >
                  {isReplayingLine ? <Loader2 className="mr-1 size-4 animate-spin" /> : <Volume2 className="mr-1 size-4" />}
                  {t("shadow.replayAudio")}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 px-4 pb-4 pt-0">
            <p className="text-base leading-relaxed sm:text-lg">{currentPair.assistant.text}</p>
            {showTranslations && assistantTranslation && (
              <div className="rounded-md bg-muted/25 px-3 py-2 text-sm leading-relaxed text-muted-foreground">
                <p>
                  {assistantTranslation}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="py-0">
          <CardHeader className="px-4 py-3">
            <CardTitle className="text-base">{t("shadow.yourLine")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5 px-4 pb-4 pt-0">
            <p className="text-lg font-medium leading-relaxed sm:text-xl">{currentPair.user.text}</p>
            {currentPair.user.reading && currentPair.user.reading.trim() !== currentPair.user.text.trim() && (
              <div className="rounded-md bg-muted/25 px-3 py-2 text-sm leading-relaxed text-muted-foreground">
                <p>
                  {currentPair.user.reading}
                </p>
              </div>
            )}
            {showTranslations && userTranslation && (
              <div className="rounded-md bg-muted/25 px-3 py-2 text-sm leading-relaxed text-muted-foreground">
                <p>
                  {userTranslation}
                </p>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Badge variant={phase === "transcribing" ? "accent" : phase === "waiting" ? "review" : "outline"}>
                {phase === "playing"
                  ? t("shadow.phasePlaying")
                  : phase === "waiting"
                    ? (userIsSpeaking ? t("shadow.phaseListening") : t("shadow.phaseReady"))
                    : phase === "transcribing"
                      ? t("shadow.phaseTranscribing")
                      : t("shadow.phaseReviewed")}
              </Badge>
              {isListening && (
                <Badge variant="secondary">
                  <Mic className="mr-1 size-3" />
                  {vadLoading ? t("shadow.voiceStarting") : t("shadow.voiceLive")}
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => void handleManualAdvance()}>
            <SkipForward className="mr-1 size-4" />
            {phase === "result" && currentPairIndex + 1 >= pairs.length
              ? t("shadow.finishSession")
              : phase === "result"
                ? t("shadow.nextTurn")
                : t("shadow.advanceManually")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

type ShadowReviewResult = "pass" | "needs_work" | "skipped";

function getReviewResult(attempt: ShadowAttempt | undefined): ShadowReviewResult {
  if (!attempt) {
    return "needs_work";
  }

  if (attempt.manualAdvance || attempt.result === "skipped") {
    return "skipped";
  }

  return attempt.result === "close" ? "pass" : "needs_work";
}

function getReviewBadgeVariant(result: ShadowReviewResult): "success" | "destructive-soft" | "outline" {
  switch (result) {
    case "pass":
      return "success";
    case "skipped":
      return "outline";
    case "needs_work":
    default:
      return "destructive-soft";
  }
}
