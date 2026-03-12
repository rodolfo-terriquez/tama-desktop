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
      const generated = await generateCustomScenarioDetails(form.title, form.description);
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
        error instanceof Error ? error.message : "Failed to generate scenario details"
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
            {editingScenario ? "Edit Scenario" : "Create Custom Scenario"}
          </DialogTitle>
          <DialogDescription>
            Define a conversation scenario for practice. Great for exam prep with specific structures.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto -mx-6 px-6">
          <div className="space-y-4 pb-2">
            <div className={`grid gap-3 ${showDetails ? "grid-cols-2" : "grid-cols-1"}`}>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Title</label>
                <Input
                  placeholder="e.g. City Hall Help"
                  value={form.title}
                  onChange={(e) => updateField("title", e.target.value)}
                />
              </div>
              {showDetails && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    Title (Japanese) <span className="text-muted-foreground font-normal">optional</span>
                  </label>
                  <Input
                    placeholder="e.g. 市役所での相談"
                    value={form.title_ja}
                    onChange={(e) => updateField("title_ja", e.target.value)}
                  />
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Description</label>
              <Textarea
                placeholder="Describe what this scenario should practice and the kind of situation you want."
                value={form.description}
                onChange={(e) => updateField("description", e.target.value)}
                rows={showDetails ? 3 : 4}
              />
            </div>

            {!showDetails && !editingScenario && (
              <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Draft the rest with AI</p>
                  <p className="text-xs text-muted-foreground">
                    Start with the scenario name and description, then let the AI fill in the setting, role, objectives, and optional conversation structure. You can edit everything afterward.
                  </p>
                </div>

                {!hasApiKey() && (
                  <Alert>
                    <AlertDescription>
                      Add an API key in Settings to use AI generation, or continue manually.
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
                        Generating...
                      </>
                    ) : (
                      <>
                        <Sparkles className="size-4 mr-1" />
                        Fill with AI
                      </>
                    )}
                  </Button>
                  <Button variant="outline" onClick={handleFillManually}>
                    Fill Manually
                  </Button>
                </div>
              </div>
            )}

            {showDetails && (
              <>
                {!editingScenario && (
                  <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
                    <div>
                      <p className="text-sm font-medium">Scenario details</p>
                      <p className="text-xs text-muted-foreground">
                        Review and tweak the generated fields before saving.
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
                          Regenerating...
                        </>
                      ) : (
                        <>
                          <Sparkles className="size-4 mr-1" />
                          Regenerate
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
                  <label className="text-sm font-medium">Setting</label>
                  <Input
                    placeholder="e.g. You are at a city hall asking for help with paperwork"
                    value={form.setting}
                    onChange={(e) => updateField("setting", e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">AI Character Role</label>
                  <Input
                    placeholder="e.g. A city hall clerk helping with the process"
                    value={form.character_role}
                    onChange={(e) => updateField("character_role", e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Objectives</label>
                  <div className="space-y-2">
                    {form.objectives.map((obj, i) => (
                      <div key={i} className="flex gap-2">
                        <Input
                          placeholder={`Objective ${i + 1}`}
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
                      Add Objective
                    </Button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    Conversation Structure / Extra Instructions{" "}
                    <span className="text-muted-foreground font-normal">optional</span>
                  </label>
                  <Textarea
                    placeholder={`Add specific instructions for how the conversation should flow. Useful for exam prep.\n\nExample:\nThis is a JLPT N3 exam roleplay. Follow this structure:\n1. Examiner greets and sets the scene\n2. Ask about the student's daily routine\n3. Follow-up: ask what they do on weekends\n4. Ask about future plans\n5. Wrap up naturally`}
                    value={form.custom_prompt}
                    onChange={(e) => updateField("custom_prompt", e.target.value)}
                    rows={6}
                  />
                  <p className="text-xs text-muted-foreground">
                    These instructions are sent to the AI to guide the conversation flow.
                  </p>
                </div>
              </>
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!isValid || !showDetails}>
            {editingScenario ? "Save Changes" : "Create Scenario"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
