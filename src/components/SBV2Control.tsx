import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useI18n } from "@/i18n";
import { getSBV2BaseUrl } from "@/services/tts";

interface SBV2Status {
  running: boolean;
  pid: number | null;
  managed_by_us: boolean;
  installed: boolean;
  python: string | null;
  has_models: boolean;
  port: number;
}

interface SBV2ControlProps {
  onStatusChange?: (running: boolean) => void;
  compact?: boolean;
}

function getSbv2Port(): number {
  try {
    const url = new URL(getSBV2BaseUrl());
    return url.port ? parseInt(url.port, 10) : 5001;
  } catch {
    return 5001;
  }
}

export function SBV2Control({ onStatusChange, compact = false }: SBV2ControlProps) {
  const { t } = useI18n();
  const [status, setStatus] = useState<SBV2Status | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<"starting" | "stopping" | null>(null);

  const checkStatus = useCallback(async () => {
    try {
      const port = getSbv2Port();
      const data = await invoke<SBV2Status>("sbv2_status", { port });
      setStatus(data);
      onStatusChange?.(data.running);
    } catch (err) {
      console.error("Failed to check SBV2 status:", err);
    }
  }, [onStatusChange]);

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, [checkStatus]);

  const startSbv2 = async () => {
    setLoading(true);
    setError(null);
    setActionInProgress("starting");

    try {
      // Stop VOICEVOX first
      await invoke("stop_voicevox").catch(() => {});

      const port = getSbv2Port();
      await invoke("start_sbv2", { port });
      await checkStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setActionInProgress(null);
    }
  };

  const stopSbv2 = async () => {
    setLoading(true);
    setError(null);
    setActionInProgress("stopping");

    try {
      const port = getSbv2Port();
      await invoke("stop_sbv2", { port });
      await checkStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setActionInProgress(null);
    }
  };

  if (compact) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Badge variant={status?.running ? "success" : "destructive-soft"} className="gap-1.5 rounded px-2 py-1 text-xs">
            <span className={`w-2 h-2 rounded-full ${status?.running ? "bg-success" : "bg-destructive"}`} />
            {status?.running ? t("sbv2.running") : t("sbv2.stopped")}
          </Badge>
          {status?.running ? (
            <Button variant="outline" size="sm" onClick={stopSbv2} disabled={loading} className="h-7 text-xs">
              {actionInProgress === "stopping" ? "..." : t("sbv2.stop")}
            </Button>
          ) : status?.installed ? (
            <Button variant="default" size="sm" onClick={startSbv2} disabled={loading} className="h-7 text-xs">
              {actionInProgress === "starting" ? "..." : t("sbv2.start")}
            </Button>
          ) : (
            <a href="https://github.com/litagin02/Style-Bert-VITS2" target="_blank" rel="noopener noreferrer" className="text-primary text-xs hover:underline">
              {t("sbv2.install")}
            </a>
          )}
        </div>
        {error && <p className="text-destructive text-xs">{error}</p>}
      </div>
    );
  }

  return (
    <Card className="gap-3 py-3">
      <CardContent className="space-y-3 px-5 pt-0">
        <div className="text-sm space-y-1">
          <p>
            <span className="font-medium">{t("sbv2.statusLabel")}</span>{" "}
            {status?.running ? (
              <span className="text-success">{t("sbv2.runningOnPort", { port: status.port })}</span>
            ) : (
              <span className="text-destructive">{t("sbv2.notRunning")}</span>
            )}
          </p>
          {status?.python && (
            <p className="text-muted-foreground text-xs">
              <span className="font-medium">{t("sbv2.pythonLabel")}</span> {status.python}
            </p>
          )}
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {status && !status.installed && !status.running && (
          <Alert>
            <AlertDescription>
              {t("sbv2.notInstalled")}{" "}
              <code className="bg-muted px-1.5 py-0.5 rounded text-xs">pip install style-bert-vits2</code>
              <br />
              <a href="https://github.com/litagin02/Style-Bert-VITS2" target="_blank" rel="noopener noreferrer" className="text-primary mt-1 inline-block text-xs font-medium hover:underline">
                {t("sbv2.installGuide")}
              </a>
            </AlertDescription>
          </Alert>
        )}

        <div className="flex gap-2">
          {status?.running ? (
            <Button variant="outline" onClick={stopSbv2} disabled={loading} className="flex-1">
              {actionInProgress === "stopping" ? t("sbv2.stopping") : t("sbv2.stopEngine")}
            </Button>
          ) : status?.installed ? (
            <Button onClick={startSbv2} disabled={loading} className="flex-1">
              {actionInProgress === "starting" ? t("sbv2.starting") : t("sbv2.startEngine")}
            </Button>
          ) : (
            <Button asChild className="flex-1">
              <a href="https://github.com/litagin02/Style-Bert-VITS2" target="_blank" rel="noopener noreferrer">
                {t("sbv2.install")}
              </a>
            </Button>
          )}
          <Button variant="ghost" onClick={checkStatus} disabled={loading}>{t("common.refresh")}</Button>
        </div>

        {actionInProgress === "starting" && (
          <p className="text-sm text-muted-foreground text-center">
            {t("sbv2.startingEngine")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
