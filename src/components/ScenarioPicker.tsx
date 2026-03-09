import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CustomScenarioForm } from "@/components/CustomScenarioForm";
import { getRecommendedScenarios, pickBestScenario } from "@/services/scenarios";
import {
  getCustomScenarios,
  addCustomScenario,
  updateCustomScenario,
  deleteCustomScenario,
} from "@/services/storage";
import type { Scenario } from "@/types";
import { Plus, Pencil, Trash2 } from "lucide-react";

interface ScenarioPickerProps {
  onSelect: (scenario: Scenario) => void;
}

export function ScenarioPicker({ onSelect }: ScenarioPickerProps) {
  const [ranked, setRanked] = useState<Awaited<ReturnType<typeof getRecommendedScenarios>>>([]);
  const [customScenarios, setCustomScenarios] = useState<Scenario[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingScenario, setEditingScenario] = useState<Scenario | null>(null);

  useEffect(() => {
    getRecommendedScenarios().then(setRanked);
  }, []);
  useEffect(() => {
    getCustomScenarios().then(setCustomScenarios);
  }, []);

  const handleSurpriseMe = async () => {
    const scenario = await pickBestScenario();
    onSelect(scenario);
  };

  const handleCreateScenario = async (data: Omit<Scenario, "id" | "isCustom">) => {
    if (editingScenario) {
      await updateCustomScenario(editingScenario.id, data);
    } else {
      await addCustomScenario(data);
    }
    const updated = await getCustomScenarios();
    setCustomScenarios(updated);
    setEditingScenario(null);
  };

  const handleEdit = (e: React.MouseEvent, scenario: Scenario) => {
    e.stopPropagation();
    setEditingScenario(scenario);
    setFormOpen(true);
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await deleteCustomScenario(id);
    const updated = await getCustomScenarios();
    setCustomScenarios(updated);
  };

  const handleOpenForm = () => {
    setEditingScenario(null);
    setFormOpen(true);
  };

  return (
    <div className="flex flex-col h-full max-w-2xl mx-auto p-4">
      <div className="flex items-center justify-end mb-4">
        <Button size="sm" onClick={handleSurpriseMe}>
          Random
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="grid gap-3 pb-4">
          {/* Custom scenarios section */}
          {customScenarios.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Custom Scenarios
                </h2>
              </div>
              {customScenarios.map((scenario) => (
                <Card
                  key={scenario.id}
                  className="cursor-pointer transition-colors hover:border-primary/50 py-0 gap-0"
                  onClick={() => onSelect(scenario)}
                >
                  <CardContent className="py-2.5 px-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <h3 className="font-medium">{scenario.title}</h3>
                          {scenario.title_ja && (
                            <span className="text-sm text-muted-foreground">
                              {scenario.title_ja}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          {scenario.description}
                        </p>
                        {scenario.custom_prompt && (
                          <Badge variant="secondary" className="mt-2 text-xs">
                            Has conversation structure
                          </Badge>
                        )}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={(e) => handleEdit(e, scenario)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-destructive hover:text-destructive"
                          onClick={(e) => handleDelete(e, scenario.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </>
          )}

          {/* Create custom scenario button */}
          <Card
            className="cursor-pointer border-dashed transition-colors hover:border-primary/50 py-0 gap-0"
            onClick={handleOpenForm}
          >
            <CardContent className="py-2.5 px-5 flex items-center gap-3 text-muted-foreground">
              <Plus className="size-5" />
              <div>
                <h3 className="font-medium text-foreground">Create Custom Scenario</h3>
                <p className="text-sm">
                  Define your own scenario for exam prep or specific practice
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Built-in scenarios */}
          {customScenarios.length > 0 && (
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mt-2">
              Built-in Scenarios
            </h2>
          )}
          {ranked.map(({ scenario, reason }, i) => (
            <Card
              key={scenario.id}
              className="cursor-pointer transition-colors hover:border-primary/50 py-0 gap-0"
              onClick={() => onSelect(scenario)}
            >
              <CardContent className="py-2.5 px-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <h3 className="font-medium">{scenario.title}</h3>
                      <span className="text-sm text-muted-foreground">
                        {scenario.title_ja}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {scenario.description}
                    </p>
                    {reason && i < 3 && (
                      <Badge variant="secondary" className="mt-2 text-xs">
                        {reason}
                      </Badge>
                    )}
                  </div>
                  {i === 0 && (
                    <Badge className="shrink-0 text-xs">
                      Recommended
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>

      <CustomScenarioForm
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditingScenario(null);
        }}
        onSave={handleCreateScenario}
        editingScenario={editingScenario}
      />
    </div>
  );
}
