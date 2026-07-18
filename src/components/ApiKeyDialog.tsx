import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDown, RefreshCw } from "lucide-react";
import { useI18n } from "@/i18n";
import { getAppLocale } from "@/services/app-config";
import {
  setApiKey,
  setLLMProvider,
  setOpenRouterApiKey,
  setOpenRouterModel,
  setLocalBaseUrl,
  setLocalModel,
  setLocalApiKey,
  listLocalModels,
  DEFAULT_LOCAL_BASE_URL,
  DEFAULT_LOCAL_MODEL,
  type LLMProvider,
} from "@/services/claude";
import { setOpenAIApiKey } from "@/services/openai";

interface ApiKeyDialogProps {
  open: boolean;
  onComplete: () => void;
  onSkip: () => void;
}

const SELECT_CLASSNAME =
  "h-9 w-full appearance-none rounded-md border border-input bg-transparent px-3 py-1 pr-10 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]";

export function ApiKeyDialog({ open, onComplete, onSkip }: ApiKeyDialogProps) {
  const { locale, setLocale, t } = useI18n();
  const [provider, setProvider] = useState<LLMProvider>("anthropic");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [openrouterModel, setOpenrouterModelState] = useState("anthropic/claude-sonnet-4-6");
  const [localBaseUrl, setLocalBaseUrlState] = useState(DEFAULT_LOCAL_BASE_URL);
  const [localModel, setLocalModelState] = useState(DEFAULT_LOCAL_MODEL);
  const [localApiKey, setLocalApiKeyState] = useState("");
  const [localModels, setLocalModels] = useState<string[]>([]);
  const [loadingLocalModels, setLoadingLocalModels] = useState(false);
  const [openaiKey, setOpenaiKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLocale(getAppLocale());
  }, [setLocale]);

  const handleLoadLocalModels = async () => {
    if (!localBaseUrl.trim()) {
      setError(t("api.errorLocalEndpoint"));
      return;
    }

    setLoadingLocalModels(true);
    try {
      const models = await listLocalModels(localBaseUrl, localApiKey || null);
      setLocalModels(models);
      if (models.length === 0) {
        setError(t("api.errorLocalNoModels"));
        return;
      }
      if (!models.includes(localModel)) {
        setLocalModelState(models[0]);
      }
      setError(null);
    } catch (err) {
      setError(
        t("api.errorLocalModelsFailed", {
          message: err instanceof Error ? err.message : String(err),
        })
      );
    } finally {
      setLoadingLocalModels(false);
    }
  };

  const handleSubmit = () => {
    // Validate LLM key based on provider
    if (provider === "anthropic") {
      const trimmed = anthropicKey.trim();
      if (!trimmed) {
        setError(t("api.errorAnthropicMissing"));
        return;
      }
      if (!trimmed.startsWith("sk-ant-")) {
        setError(t("api.errorAnthropicInvalid"));
        return;
      }
      setApiKey(trimmed);
    } else if (provider === "openrouter") {
      const trimmed = openrouterKey.trim();
      if (!trimmed) {
        setError(t("api.errorOpenRouterMissing"));
        return;
      }
      if (!trimmed.startsWith("sk-or-")) {
        setError(t("api.errorOpenRouterInvalid"));
        return;
      }
      setOpenRouterApiKey(trimmed);
      const model = openrouterModel.trim();
      if (model) setOpenRouterModel(model);
    } else {
      const baseUrl = localBaseUrl.trim().replace(/\/+$/, "");
      const model = localModel.trim();
      try {
        const parsed = new URL(baseUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
      } catch {
        setError(t("api.errorLocalEndpoint"));
        return;
      }
      if (!model) {
        setError(t("api.errorLocalModel"));
        return;
      }
      setLocalBaseUrl(baseUrl);
      setLocalModel(model);
      setLocalApiKey(localApiKey);
    }

    // OpenAI key is optional (needed only for OpenAI transcription engine)
    const trimmedOpenai = openaiKey.trim();
    if (trimmedOpenai && !trimmedOpenai.startsWith("sk-")) {
      setError(t("api.errorOpenAiInvalid"));
      return;
    }

    // Save everything
    setLLMProvider(provider);
    if (trimmedOpenai) {
      setOpenAIApiKey(trimmedOpenai);
    }
    setError(null);
    onComplete();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setError(null);
          onSkip();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("api.title")}</DialogTitle>
          <DialogDescription>
            {t("api.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">{t("common.language")}</label>
            <div className="relative">
              <select
                id="api-language-select"
                value={locale}
                onChange={(e) => setLocale(e.target.value as "en" | "es")}
                className={SELECT_CLASSNAME}
              >
                <option value="en">{t("common.english")}</option>
                <option value="es">{t("common.spanish")}</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-foreground/80" />
            </div>
          </div>

          {/* LLM Provider toggle */}
          <div className="space-y-2">
            <label className="text-sm font-medium">{t("api.provider")}</label>
            <div className="flex rounded-lg border overflow-hidden">
              <button
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  provider === "anthropic"
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
                onClick={() => { setProvider("anthropic"); setError(null); }}
              >
                Anthropic
              </button>
              <button
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  provider === "openrouter"
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
                onClick={() => { setProvider("openrouter"); setError(null); }}
              >
                OpenRouter
              </button>
              <button
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  provider === "local"
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
                onClick={() => { setProvider("local"); setError(null); }}
              >
                Local
              </button>
            </div>
          </div>

          {/* Provider-specific key input */}
          {provider === "anthropic" ? (
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("api.anthropicKey")}</label>
              <Input
                type="password"
                placeholder="sk-ant-..."
                value={anthropicKey}
                onChange={(e) => { setAnthropicKey(e.target.value); setError(null); }}
              />
              <p className="text-xs text-muted-foreground">
                {t("api.anthropicHelp")}{" "}
                <a
                  href="https://console.anthropic.com/settings/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground"
                >
                  {t("api.getKey")}
                </a>
              </p>
            </div>
          ) : provider === "openrouter" ? (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("api.openrouterKey")}</label>
                <Input
                  type="password"
                  placeholder="sk-or-..."
                  value={openrouterKey}
                  onChange={(e) => { setOpenrouterKey(e.target.value); setError(null); }}
                />
                <p className="text-xs text-muted-foreground">
                  {t("api.openrouterHelp")}{" "}
                  <a
                    href="https://openrouter.ai/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-foreground"
                  >
                    {t("api.getKey")}
                  </a>
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("api.model")}</label>
                <Input
                  placeholder="anthropic/claude-sonnet-4-6"
                  value={openrouterModel}
                  onChange={(e) => setOpenrouterModelState(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Model ID from{" "}
                  <a
                    href="https://openrouter.ai/models"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-foreground"
                  >
                    openrouter.ai/models
                  </a>
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("api.localEndpoint")}</label>
                <Input
                  placeholder={DEFAULT_LOCAL_BASE_URL}
                  value={localBaseUrl}
                  onChange={(e) => { setLocalBaseUrlState(e.target.value); setError(null); }}
                />
                <p className="text-xs text-muted-foreground">
                  {t("api.localHelp")}
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("api.model")}</label>
                <div className="flex gap-2">
                  <Input
                    list="onboarding-local-llm-models"
                    placeholder={DEFAULT_LOCAL_MODEL}
                    value={localModel}
                    onChange={(e) => { setLocalModelState(e.target.value); setError(null); }}
                  />
                  <datalist id="onboarding-local-llm-models">
                    {localModels.map((model) => (
                      <option key={model} value={model} />
                    ))}
                  </datalist>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => void handleLoadLocalModels()}
                    disabled={loadingLocalModels}
                    title={t("settings.loadLocalModels")}
                    aria-label={t("settings.loadLocalModels")}
                  >
                    <RefreshCw className={`size-4 ${loadingLocalModels ? "animate-spin" : ""}`} />
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("api.localApiKey")}</label>
                <Input
                  type="password"
                  placeholder={t("api.optional")}
                  value={localApiKey}
                  onChange={(e) => { setLocalApiKeyState(e.target.value); setError(null); }}
                />
              </div>
            </>
          )}

          {/* OpenAI key (optional; used for OpenAI Whisper engine) */}
          <div className="space-y-2">
            <label className="text-sm font-medium">{t("api.openAiKey")}</label>
            <Input
              type="password"
              placeholder="sk-..."
              value={openaiKey}
              onChange={(e) => {
                setOpenaiKey(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
              }}
            />
            <p className="text-xs text-muted-foreground">
              {t("api.openAiHelp")}{" "}
              <a
                href="https://platform.openai.com/api-keys"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                {t("api.getKey")}
              </a>
            </p>
          </div>

          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button variant="ghost" onClick={onSkip}>
            {t("api.skip")}
          </Button>
          <Button onClick={handleSubmit} className="w-full sm:w-auto">
            {t("api.start")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
