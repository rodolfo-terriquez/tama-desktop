import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
          <span
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${
              status?.running ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${status?.running ? "bg-green-500" : "bg-red-500"}`} />
            {status?.running ? "Running" : "Stopped"}
          </span>
          {status?.running ? (
            <Button variant="outline" size="sm" onClick={stopSbv2} disabled={loading} className="h-7 text-xs">
              {actionInProgress === "stopping" ? "..." : "Stop"}
            </Button>
          ) : status?.installed ? (
            <Button variant="default" size="sm" onClick={startSbv2} disabled={loading} className="h-7 text-xs">
              {actionInProgress === "starting" ? "..." : "Start"}
            </Button>
          ) : (
            <a href="https://github.com/litagin02/Style-Bert-VITS2" target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
              Install
            </a>
          )}
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className={`w-3 h-3 rounded-full ${status?.running ? "bg-green-500" : "bg-red-500"}`} />
          Style-Bert-VITS2
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm space-y-1">
          <p>
            <span className="font-medium">Status:</span>{" "}
            {status?.running ? (
              <span className="text-green-600">Running on port {status.port}</span>
            ) : (
              <span className="text-red-600">Not running</span>
            )}
          </p>
          {status?.python && (
            <p className="text-muted-foreground text-xs">
              <span className="font-medium">Python:</span> {status.python}
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
              Style-Bert-VITS2 is not installed. Install it with:{" "}
              <code className="bg-muted px-1.5 py-0.5 rounded text-xs">pip install style-bert-vits2</code>
              <br />
              <a href="https://github.com/litagin02/Style-Bert-VITS2" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-medium text-xs mt-1 inline-block">
                View installation guide
              </a>
            </AlertDescription>
          </Alert>
        )}

        <div className="flex gap-2">
          {status?.running ? (
            <Button variant="outline" onClick={stopSbv2} disabled={loading} className="flex-1">
              {actionInProgress === "stopping" ? "Stopping..." : "Stop SBV2"}
            </Button>
          ) : status?.installed ? (
            <Button onClick={startSbv2} disabled={loading} className="flex-1">
              {actionInProgress === "starting" ? "Starting..." : "Start SBV2"}
            </Button>
          ) : (
            <Button asChild className="flex-1">
              <a href="https://github.com/litagin02/Style-Bert-VITS2" target="_blank" rel="noopener noreferrer">
                Install Style-Bert-VITS2
              </a>
            </Button>
          )}
          <Button variant="ghost" onClick={checkStatus} disabled={loading}>Refresh</Button>
        </div>

        {actionInProgress === "starting" && (
          <p className="text-sm text-muted-foreground text-center">
            Starting Style-Bert-VITS2... This may take up to 30 seconds while models load.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
