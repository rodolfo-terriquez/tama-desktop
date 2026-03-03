import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

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
          <span
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${
              status?.running
                ? "bg-green-100 text-green-800"
                : isDownloading
                ? "bg-blue-100 text-blue-800"
                : "bg-red-100 text-red-800"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                status?.running
                  ? "bg-green-500"
                  : isDownloading
                  ? "bg-blue-500 animate-pulse"
                  : "bg-red-500"
              }`}
            />
            {isDownloading
              ? "Downloading..."
              : status?.running
              ? "Running"
              : "Stopped"}
          </span>
          {status?.running ? (
            <Button variant="outline" size="sm" onClick={stopVoicevox} disabled={loading} className="h-7 text-xs">
              {actionInProgress === "stopping" ? "..." : "Stop"}
            </Button>
          ) : status?.installed ? (
            <Button variant="default" size="sm" onClick={startVoicevox} disabled={loading} className="h-7 text-xs">
              {actionInProgress === "starting" ? "..." : "Start"}
            </Button>
          ) : isDownloading ? null : status?.can_download ? (
            <Button variant="default" size="sm" onClick={downloadVoicevox} disabled={loading} className="h-7 text-xs">
              Download
            </Button>
          ) : (
            <a href="https://voicevox.hiroshiba.jp/" target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
              Install
            </a>
          )}
        </div>
        {isDownloading && (
          <div className="space-y-1">
            <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${dlProgress}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">
              {dlStatus === "downloading" && `${dlProgress}% - ${formatBytes(downloadProgress?.downloaded_size || 0)}`}
              {dlStatus === "extracting" && "Extracting..."}
            </p>
          </div>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className={`w-3 h-3 rounded-full ${status?.running ? "bg-green-500" : isDownloading ? "bg-blue-500 animate-pulse" : "bg-red-500"}`} />
          VOICEVOX Engine
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm space-y-1">
          <p>
            <span className="font-medium">Status:</span>{" "}
            {status?.running ? (
              <span className="text-green-600">Running on localhost:50021</span>
            ) : isDownloading ? (
              <span className="text-blue-600">Downloading engine...</span>
            ) : (
              <span className="text-red-600">Not running</span>
            )}
          </p>
          {status?.installed && status.path && (
            <p className="text-muted-foreground text-xs truncate">
              <span className="font-medium">Path:</span> {status.path}
            </p>
          )}
        </div>

        {isDownloading && (
          <div className="space-y-2">
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${dlProgress}%` }} />
            </div>
            <p className="text-sm text-muted-foreground text-center">
              {dlStatus === "downloading" && <>Downloading: {dlProgress}% ({formatBytes(downloadProgress?.downloaded_size || 0)} / {formatBytes(downloadProgress?.total_size || 0)})</>}
              {dlStatus === "extracting" && "Extracting archive..."}
              {dlStatus === "starting" && "Starting download..."}
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
                <>VOICEVOX engine is not installed. Click "Download" to automatically download and set it up (~1.6GB).</>
              ) : (
                <>
                  VOICEVOX is not installed and automatic download is not available for your platform ({status.platform}).{" "}
                  <a href="https://voicevox.hiroshiba.jp/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-medium">
                    Download VOICEVOX manually
                  </a>
                </>
              )}
            </AlertDescription>
          </Alert>
        )}

        <div className="flex gap-2">
          {status?.running ? (
            <Button variant="outline" onClick={stopVoicevox} disabled={loading} className="flex-1">
              {actionInProgress === "stopping" ? "Stopping..." : "Stop VOICEVOX"}
            </Button>
          ) : status?.installed ? (
            <Button onClick={startVoicevox} disabled={loading} className="flex-1">
              {actionInProgress === "starting" ? "Starting..." : "Start VOICEVOX"}
            </Button>
          ) : isDownloading ? (
            <Button disabled className="flex-1">Downloading...</Button>
          ) : status?.can_download ? (
            <Button onClick={downloadVoicevox} disabled={loading} className="flex-1">
              Download VOICEVOX (~1.6GB)
            </Button>
          ) : (
            <Button asChild className="flex-1">
              <a href="https://voicevox.hiroshiba.jp/" target="_blank" rel="noopener noreferrer">Download VOICEVOX</a>
            </Button>
          )}
          <Button variant="ghost" onClick={checkStatus} disabled={loading || !!isDownloading}>
            Refresh
          </Button>
        </div>

        {actionInProgress === "starting" && (
          <p className="text-sm text-muted-foreground text-center">
            Starting VOICEVOX engine... This may take up to 30 seconds.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
