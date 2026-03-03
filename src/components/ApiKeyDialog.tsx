import { useState } from "react";
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
import {
  setApiKey,
  setLLMProvider,
  setOpenRouterApiKey,
  setOpenRouterModel,
  type LLMProvider,
} from "@/services/claude";
import { setOpenAIApiKey } from "@/services/openai";

interface ApiKeyDialogProps {
  open: boolean;
  onComplete: () => void;
}

export function ApiKeyDialog({ open, onComplete }: ApiKeyDialogProps) {
  const [provider, setProvider] = useState<LLMProvider>("anthropic");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [openrouterModel, setOpenrouterModelState] = useState("anthropic/claude-sonnet-4-6");
  const [openaiKey, setOpenaiKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    // Validate LLM key based on provider
    if (provider === "anthropic") {
      const trimmed = anthropicKey.trim();
      if (!trimmed) {
        setError("Please enter your Anthropic API key");
        return;
      }
      if (!trimmed.startsWith("sk-ant-")) {
        setError("Invalid Anthropic API key format. It should start with 'sk-ant-'");
        return;
      }
      setApiKey(trimmed);
    } else {
      const trimmed = openrouterKey.trim();
      if (!trimmed) {
        setError("Please enter your OpenRouter API key");
        return;
      }
      if (!trimmed.startsWith("sk-or-")) {
        setError("Invalid OpenRouter API key format. It should start with 'sk-or-'");
        return;
      }
      setOpenRouterApiKey(trimmed);
      const model = openrouterModel.trim();
      if (model) setOpenRouterModel(model);
    }

    // Validate OpenAI key (required for Whisper)
    const trimmedOpenai = openaiKey.trim();
    if (!trimmedOpenai) {
      setError("Please enter your OpenAI API key for speech recognition");
      return;
    }
    if (!trimmedOpenai.startsWith("sk-")) {
      setError("Invalid OpenAI API key format. It should start with 'sk-'");
      return;
    }

    // Save everything
    setLLMProvider(provider);
    setOpenAIApiKey(trimmedOpenai);
    setError(null);
    onComplete();
  };

  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Welcome to Tama</DialogTitle>
          <DialogDescription>
            Enter your API keys to start practicing Japanese conversation.
            Keys are stored locally in your browser only.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* LLM Provider toggle */}
          <div className="space-y-2">
            <label className="text-sm font-medium">LLM Provider</label>
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
            </div>
          </div>

          {/* Provider-specific key input */}
          {provider === "anthropic" ? (
            <div className="space-y-2">
              <label className="text-sm font-medium">Anthropic API Key</label>
              <Input
                type="password"
                placeholder="sk-ant-..."
                value={anthropicKey}
                onChange={(e) => { setAnthropicKey(e.target.value); setError(null); }}
              />
              <p className="text-xs text-muted-foreground">
                For conversation AI (Claude).{" "}
                <a
                  href="https://console.anthropic.com/settings/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground"
                >
                  Get key
                </a>
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">OpenRouter API Key</label>
                <Input
                  type="password"
                  placeholder="sk-or-..."
                  value={openrouterKey}
                  onChange={(e) => { setOpenrouterKey(e.target.value); setError(null); }}
                />
                <p className="text-xs text-muted-foreground">
                  Use any model via OpenRouter.{" "}
                  <a
                    href="https://openrouter.ai/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-foreground"
                  >
                    Get key
                  </a>
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Model</label>
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
          )}

          {/* OpenAI Key (always needed for Whisper) */}
          <div className="space-y-2">
            <label className="text-sm font-medium">OpenAI API Key</label>
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
              For speech recognition (Whisper).{" "}
              <a
                href="https://platform.openai.com/api-keys"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                Get key
              </a>
            </p>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} className="w-full">
            Start Practicing
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
