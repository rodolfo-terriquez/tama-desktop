import { useState, useEffect } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useI18n } from "@/i18n";
import { generateCustomScenarioDetails, hasApiKey } from "@/services/claude";
import type { Scenario } from "@/types";
import { Loader2, Sparkles, Plus, Trash2 } from "lucide-react";

interface CustomScenarioFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (scenario: Omit<Scenario, "id" | "isCustom">) => void;
  editingScenario?: Scenario | null;
}

const EMPTY_FORM = {
  title: "",
  title_ja: "",
  description: "",
  setting: "",
  character_role: "",
  objectives: [""],
  custom_prompt: "",
};

export function CustomScenarioForm({
  open,
  onOpenChange,
  onSave,
  editingScenario,
}: CustomScenarioFormProps) {
  const { locale, t } = useI18n();
  const [form, setForm] = useState(EMPTY_FORM);
  const [detailsReady, setDetailsReady] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  useEffect(() => {
    if (editingScenario) {
      setForm({
        title: editingScenario.title,
        title_ja: editingScenario.title_ja,
        description: editingScenario.description,
        setting: editingScenario.setting,
        character_role: editingScenario.character_role,
        objectives: editingScenario.objectives.length > 0 ? editingScenario.objectives : [""],
        custom_prompt: editingScenario.custom_prompt || "",
      });
      setDetailsReady(true);
    } else {
      setForm(EMPTY_FORM);
      setDetailsReady(false);
    }
    setGenerationError(null);
    setIsGenerating(false);
  }, [editingScenario, open]);

  const updateField = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const updateObjective = (index: number, value: string) => {
    setForm((prev) => {
      const objectives = [...prev.objectives];
      objectives[index] = value;
      return { ...prev, objectives };
    });
  };

  const addObjective = () => {
    setForm((prev) => ({ ...prev, objectives: [...prev.objectives, ""] }));
  };

  const removeObjective = (index: number) => {
    if (form.objectives.length <= 1) return;
    setForm((prev) => ({
      ...prev,
      objectives: prev.objectives.filter((_, i) => i !== index),
    }));
  };

  const isValid =
    form.title.trim() &&
    form.description.trim() &&
    form.setting.trim() &&
    form.character_role.trim() &&
    form.objectives.some((o) => o.trim());
  const canGenerate = form.title.trim() && form.description.trim();
  const showDetails = !!editingScenario || detailsReady;

  const handleGenerate = async () => {
    if (!canGenerate || isGenerating) return;

    setGenerationError(null);
    setIsGenerating(true);

    try {
      const generated = await generateCustomScenarioDetails(form.title, form.description, locale);
      setForm((prev) => ({
        ...prev,
        title_ja: generated.title_ja || prev.title_ja,
        setting: generated.setting,
        character_role: generated.character_role,
        objectives: generated.objectives.length > 0 ? generated.objectives : prev.objectives,
        custom_prompt: generated.custom_prompt || "",
      }));
      setDetailsReady(true);
    } catch (error) {
      setGenerationError(
        error instanceof Error ? error.message : t("custom.generateFailed")
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleFillManually = () => {
    setGenerationError(null);
    setDetailsReady(true);
  };

  const handleSave = () => {
    if (!isValid) return;
    onSave({
      title: form.title.trim(),
      title_ja: form.title_ja.trim(),
      description: form.description.trim(),
      setting: form.setting.trim(),
      character_role: form.character_role.trim(),
      objectives: form.objectives.filter((o) => o.trim()),
      custom_prompt: form.custom_prompt.trim() || undefined,
    });
    setForm(EMPTY_FORM);
    setDetailsReady(false);
    setGenerationError(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] !flex !flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {editingScenario ? t("custom.editTitle") : t("custom.createTitle")}
          </DialogTitle>
          <DialogDescription>{t("custom.description")}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto -mx-6 px-6">
          <div className="space-y-4 pb-2">
            <div className={`grid gap-3 ${showDetails ? "grid-cols-2" : "grid-cols-1"}`}>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t("custom.titleLabel")}</label>
                <Input
                  placeholder={t("custom.titlePlaceholder")}
                  value={form.title}
                  onChange={(e) => updateField("title", e.target.value)}
                />
              </div>
              {showDetails && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    {t("custom.titleJaLabel")}{" "}
                    <span className="text-muted-foreground font-normal">
                      {t("custom.optional")}
                    </span>
                  </label>
                  <Input
                    placeholder={t("custom.titleJaPlaceholder")}
                    value={form.title_ja}
                    onChange={(e) => updateField("title_ja", e.target.value)}
                  />
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t("custom.descriptionLabel")}</label>
              <Textarea
                placeholder={t("custom.descriptionPlaceholder")}
                value={form.description}
                onChange={(e) => updateField("description", e.target.value)}
                rows={showDetails ? 3 : 4}
              />
            </div>

            {!showDetails && !editingScenario && (
              <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium">{t("custom.aiDraftTitle")}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("custom.aiDraftDescription")}
                  </p>
                </div>

                {!hasApiKey() && (
                  <Alert>
                    <AlertDescription>
                      {t("custom.addApiKey")}
                    </AlertDescription>
                  </Alert>
                )}

                {generationError && (
                  <Alert variant="destructive">
                    <AlertDescription>{generationError}</AlertDescription>
                  </Alert>
                )}

                <div className="flex gap-2">
                  <Button
                    onClick={() => void handleGenerate()}
                    disabled={!canGenerate || isGenerating || !hasApiKey()}
                    className="flex-1"
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="size-4 mr-1 animate-spin" />
                        {t("custom.generating")}
                      </>
                    ) : (
                      <>
                        <Sparkles className="size-4 mr-1" />
                        {t("custom.fillWithAi")}
                      </>
                    )}
                  </Button>
                  <Button variant="outline" onClick={handleFillManually}>
                    {t("custom.fillManually")}
                  </Button>
                </div>
              </div>
            )}

            {showDetails && (
              <>
                {!editingScenario && (
                  <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
                    <div>
                      <p className="text-sm font-medium">{t("custom.detailsTitle")}</p>
                      <p className="text-xs text-muted-foreground">
                        {t("custom.detailsDescription")}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleGenerate()}
                      disabled={!canGenerate || isGenerating || !hasApiKey()}
                    >
                      {isGenerating ? (
                        <>
                          <Loader2 className="size-4 mr-1 animate-spin" />
                          {t("custom.regenerating")}
                        </>
                      ) : (
                        <>
                          <Sparkles className="size-4 mr-1" />
                          {t("custom.regenerate")}
                        </>
                      )}
                    </Button>
                  </div>
                )}

                {generationError && (
                  <Alert variant="destructive">
                    <AlertDescription>{generationError}</AlertDescription>
                  </Alert>
                )}

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">{t("custom.settingLabel")}</label>
                  <Input
                    placeholder={t("custom.settingPlaceholder")}
                    value={form.setting}
                    onChange={(e) => updateField("setting", e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">{t("custom.roleLabel")}</label>
                  <Input
                    placeholder={t("custom.rolePlaceholder")}
                    value={form.character_role}
                    onChange={(e) => updateField("character_role", e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">{t("custom.objectivesLabel")}</label>
                  <div className="space-y-2">
                    {form.objectives.map((obj, i) => (
                      <div key={i} className="flex gap-2">
                        <Input
                          placeholder={t("custom.objectivePlaceholder", { number: i + 1 })}
                          value={obj}
                          onChange={(e) => updateObjective(i, e.target.value)}
                        />
                        {form.objectives.length > 1 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="shrink-0"
                            onClick={() => removeObjective(i)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={addObjective}
                      className="w-full"
                    >
                      <Plus className="size-4 mr-1" />
                      {t("custom.addObjective")}
                    </Button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    {t("custom.structureLabel")}{" "}
                    <span className="text-muted-foreground font-normal">
                      {t("custom.optional")}
                    </span>
                  </label>
                  <Textarea
                    placeholder={t("custom.structurePlaceholder")}
                    value={form.custom_prompt}
                    onChange={(e) => updateField("custom_prompt", e.target.value)}
                    rows={6}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("custom.structureHelp")}
                  </p>
                </div>
              </>
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={!isValid || !showDetails}>
            {editingScenario ? t("custom.saveChanges") : t("custom.createScenario")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
