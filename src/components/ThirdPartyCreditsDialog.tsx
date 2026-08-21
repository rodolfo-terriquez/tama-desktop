import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SimpleMarkdown } from "@/lib/simple-markdown";
import { useI18n } from "@/i18n";
import { getVoicevoxAttribution } from "@/services/credits";
import {
  getVoicePolicy,
  type TTSEngineType,
  type VoiceOption,
} from "@/services/tts";

interface ThirdPartyCreditsDialogProps {
  ttsEngine: TTSEngineType;
  selectedVoice: VoiceOption | null;
}

type PolicyState = "idle" | "loading" | "loaded" | "unavailable";

export function ThirdPartyCreditsDialog({
  ttsEngine,
  selectedVoice,
}: ThirdPartyCreditsDialogProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [policy, setPolicy] = useState<string | null>(null);
  const [policyState, setPolicyState] = useState<PolicyState>("idle");
  const attribution = getVoicevoxAttribution(ttsEngine, selectedVoice);

  useEffect(() => {
    if (!open || ttsEngine !== "voicevox" || !selectedVoice?.speakerId) {
      setPolicy(null);
      setPolicyState("idle");
      return;
    }

    let cancelled = false;
    setPolicy(null);
    setPolicyState("loading");

    void getVoicePolicy("voicevox", selectedVoice.speakerId)
      .then((voicePolicy) => {
        if (cancelled) return;
        setPolicy(voicePolicy);
        setPolicyState(voicePolicy ? "loaded" : "unavailable");
      })
      .catch(() => {
        if (cancelled) return;
        setPolicy(null);
        setPolicyState("unavailable");
      });

    return () => {
      cancelled = true;
    };
  }, [open, selectedVoice?.speakerId, ttsEngine]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          {t("settings.viewCredits")}
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("settings.thirdPartyCredits")}</DialogTitle>
          <DialogDescription>
            {t("settings.thirdPartyCreditsDialogDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <section className="space-y-2 rounded-lg border p-4">
            <div>
              <h2 className="font-semibold">VOICEVOX</h2>
              <p className="mt-1 text-muted-foreground">
                {t("settings.voicevoxCreditDescription")}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("settings.voicevoxAttribution")}
              </p>
              <code className="mt-1 block w-fit rounded bg-muted px-2 py-1 font-mono text-sm">
                {attribution}
              </code>
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-2">
              <a
                href="https://voicevox.hiroshiba.jp/term/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4 hover:text-foreground"
              >
                {t("settings.voicevoxSoftwareTerms")}
              </a>
              <a
                href="https://voicevox.hiroshiba.jp/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4 hover:text-foreground"
              >
                {t("settings.voicevoxVoiceTerms")}
              </a>
              <a
                href="https://github.com/VOICEVOX/voicevox_engine"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4 hover:text-foreground"
              >
                {t("settings.voicevoxEngineSource")}
              </a>
            </div>
          </section>

          {ttsEngine === "voicevox" && selectedVoice ? (
            <section className="space-y-2">
              <h2 className="font-semibold">
                {t("settings.selectedVoicePolicy", {
                  name: selectedVoice.speakerName,
                })}
              </h2>
              {policyState === "loading" ? (
                <p className="text-muted-foreground">
                  {t("settings.voicePolicyLoading")}
                </p>
              ) : policyState === "loaded" && policy ? (
                <div className="max-h-72 overflow-y-auto rounded-lg border bg-muted/30 p-4 text-xs">
                  <SimpleMarkdown content={policy} />
                </div>
              ) : (
                <p className="text-muted-foreground">
                  {t("settings.voicePolicyUnavailable")}
                </p>
              )}
            </section>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
