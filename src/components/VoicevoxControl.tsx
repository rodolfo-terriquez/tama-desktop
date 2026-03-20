import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/i18n";

interface DownloadState {
  in_progress: boolean;
  progress: number;
  total_size: number;
  downloaded_size: number;
  status: string;
  error: string | null;
}

interface VoicevoxStatus {
  running: boolean;
  installed: boolean;
  path: string | null;
  pid: number | null;
  managed_by_us: boolean;
  can_download: boolean;
  platform: string;
  download: DownloadState;
}

interface VoicevoxControlProps {
  onStatusChange?: (running: boolean) => void;
  compact?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export function VoicevoxControl({ onStatusChange, compact = false }: VoicevoxControlProps) {
  const { t } = useI18n();
  const [status, setStatus] = useState<VoicevoxStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<"starting" | "stopping" | "downloading" | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadState | null>(null);

  const checkStatus = useCallback(async () => {
    try {
      const data = await invoke<VoicevoxStatus>("voicevox_status");
      setStatus(data);
      onStatusChange?.(data.running);

      if (actionInProgress === "downloading" && !data.download.in_progress && downloadProgress?.status === "complete") {
        setActionInProgress(null);
        setLoading(false);
        setDownloadProgress(null);
      }
    } catch (err) {
      console.error("Failed to check VOICEVOX status:", err);
    }
  }, [onStatusChange, actionInProgress, downloadProgress?.status]);

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, actionInProgress === "downloading" ? 1000 : 5000);
    return () => clearInterval(interval);
  }, [checkStatus, actionInProgress]);

  // Listen for download progress events
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    listen<DownloadState>("voicevox-download-progress", (event) => {
      setDownloadProgress(event.payload);
      if (event.payload.status === "complete") {
        setActionInProgress(null);
        setLoading(false);
      }
      if (event.payload.error) {
        setError(event.payload.error);
        setActionInProgress(null);
        setLoading(false);
      }
    }).then((fn) => { unlisten = fn; });

    return () => { unlisten?.(); };
  }, []);

  const downloadVoicevox = async () => {
    setLoading(true);
    setError(null);
    setActionInProgress("downloading");

    try {
      await invoke("download_voicevox");
      await checkStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionInProgress(null);
      setLoading(false);
    }
  };

  const startVoicevox = async () => {
    setLoading(true);
    setError(null);
    setActionInProgress("starting");

    try {
      // Stop SBV2 first
      await invoke("stop_sbv2", { port: 5001 }).catch(() => {});
      await invoke("start_voicevox");
      await checkStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setActionInProgress(null);
    }
  };

  const stopVoicevox = async () => {
    setLoading(true);
    setError(null);
    setActionInProgress("stopping");

    try {
      await invoke("stop_voicevox");
      await checkStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setActionInProgress(null);
    }
  };

  const isDownloading = actionInProgress === "downloading" || downloadProgress?.in_progress;
  const dlProgress = downloadProgress?.progress || 0;
  const dlStatus = downloadProgress?.status || "idle";

  if (compact) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Badge
            variant={
              status?.running ? "success" : isDownloading ? "info" : "destructive-soft"
            }
            className="gap-1.5 rounded px-2 py-1 text-xs"
          >
            <span
              className={`w-2 h-2 rounded-full ${
                status?.running
                  ? "bg-success"
                  : isDownloading
                  ? "bg-info animate-pulse"
                  : "bg-destructive"
              }`}
            />
            {isDownloading
              ? t("voicevox.downloading")
              : status?.running
              ? t("voicevox.running")
              : t("voicevox.stopped")}
          </Badge>
          {status?.running ? (
            <Button variant="outline" size="sm" onClick={stopVoicevox} disabled={loading} className="h-7 text-xs">
              {actionInProgress === "stopping" ? "..." : t("voicevox.stop")}
            </Button>
          ) : status?.installed ? (
            <Button variant="default" size="sm" onClick={startVoicevox} disabled={loading} className="h-7 text-xs">
              {actionInProgress === "starting" ? "..." : t("voicevox.start")}
            </Button>
          ) : isDownloading ? null : status?.can_download ? (
            <Button variant="default" size="sm" onClick={downloadVoicevox} disabled={loading} className="h-7 text-xs">
              {t("voicevox.download")}
            </Button>
          ) : (
            <a href="https://voicevox.hiroshiba.jp/" target="_blank" rel="noopener noreferrer" className="text-primary text-xs hover:underline">
              {t("voicevox.install")}
            </a>
          )}
        </div>
        {isDownloading && (
          <div className="space-y-1">
            <Progress size="sm" tone="info" value={dlProgress} />
            <p className="text-xs text-muted-foreground">
              {dlStatus === "downloading" && `${dlProgress}% - ${formatBytes(downloadProgress?.downloaded_size || 0)}`}
              {dlStatus === "extracting" && t("voicevox.extracting")}
            </p>
          </div>
        )}
        {error && <p className="text-destructive text-xs">{error}</p>}
      </div>
    );
  }

  return (
    <Card className="gap-3 py-3">
      <CardContent className="space-y-3 px-5 pt-0">
        <div className="text-sm space-y-1">
          <p>
            <span className="font-medium">{t("voicevox.statusLabel")}</span>{" "}
            {status?.running ? (
              <span className="text-success">{t("voicevox.runningOnHost")}</span>
            ) : isDownloading ? (
              <span className="text-info">{t("voicevox.downloadingEngine")}</span>
            ) : (
              <span className="text-destructive">{t("voicevox.notRunning")}</span>
            )}
          </p>
          {status?.installed && status.path && (
            <p className="text-muted-foreground text-xs truncate">
              <span className="font-medium">{t("voicevox.pathLabel")}</span> {status.path}
            </p>
          )}
        </div>

        {isDownloading && (
          <div className="space-y-2">
            <Progress tone="info" value={dlProgress} />
            <p className="text-sm text-muted-foreground text-center">
              {dlStatus === "downloading" && <>Downloading: {dlProgress}% ({formatBytes(downloadProgress?.downloaded_size || 0)} / {formatBytes(downloadProgress?.total_size || 0)})</>}
              {dlStatus === "extracting" && t("voicevox.extractingArchive")}
              {dlStatus === "starting" && t("voicevox.startingDownload")}
            </p>
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {status && !status.installed && !status.running && !isDownloading && (
          <Alert>
            <AlertDescription>
              {status.can_download ? (
                <>{t("voicevox.notInstalledDownload")}</>
              ) : (
                <>
                  {t("voicevox.notInstalledManual", { platform: status.platform })}{" "}
                  <a href="https://voicevox.hiroshiba.jp/" target="_blank" rel="noopener noreferrer" className="text-primary font-medium hover:underline">
                    {t("voicevox.downloadManual")}
                  </a>
                </>
              )}
            </AlertDescription>
          </Alert>
        )}

        <div className="flex gap-2">
          {status?.running ? (
            <Button variant="outline" onClick={stopVoicevox} disabled={loading} className="flex-1">
              {actionInProgress === "stopping" ? t("voicevox.stopping") : t("voicevox.stopEngine")}
            </Button>
          ) : status?.installed ? (
            <Button onClick={startVoicevox} disabled={loading} className="flex-1">
              {actionInProgress === "starting" ? t("voicevox.starting") : t("voicevox.startEngine")}
            </Button>
          ) : isDownloading ? (
            <Button disabled className="flex-1">{t("voicevox.downloading")}</Button>
          ) : status?.can_download ? (
            <Button onClick={downloadVoicevox} disabled={loading} className="flex-1">
              {t("voicevox.downloadEngineSize")}
            </Button>
          ) : (
            <Button asChild className="flex-1">
              <a href="https://voicevox.hiroshiba.jp/" target="_blank" rel="noopener noreferrer">{t("voicevox.downloadEngine")}</a>
            </Button>
          )}
          <Button variant="ghost" onClick={checkStatus} disabled={loading || !!isDownloading}>
            {t("common.refresh")}
          </Button>
        </div>

        {actionInProgress === "starting" && (
          <p className="text-sm text-muted-foreground text-center">
            {t("voicevox.startingEngine")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
