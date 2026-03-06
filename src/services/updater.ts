import { check } from "@tauri-apps/plugin-updater";

const SKIPPED_VERSION_KEY = "tama.skippedUpdateVersion";

let hasCheckedThisRun = false;

export async function checkForAppUpdatesOnLaunch(): Promise<void> {
  if (hasCheckedThisRun || import.meta.env.DEV) return;
  hasCheckedThisRun = true;

  let update: Awaited<ReturnType<typeof check>> = null;

  try {
    update = await check();
    if (!update) return;

    const skippedVersion = localStorage.getItem(SKIPPED_VERSION_KEY);
    if (skippedVersion === update.version) {
      return;
    }

    const shouldInstall = window.confirm(
      `A new Tama update is available (v${update.version}).\n\nInstall it now?`
    );

    if (!shouldInstall) {
      localStorage.setItem(SKIPPED_VERSION_KEY, update.version);
      return;
    }

    await update.downloadAndInstall();
    localStorage.removeItem(SKIPPED_VERSION_KEY);

    window.alert("Update installed. Please restart Tama to finish applying it.");
  } catch (error) {
    // Keep startup resilient if the updater is misconfigured or offline.
    console.error("[updater] Failed to check for updates:", error);
  } finally {
    if (update) {
      await update.close().catch(() => {
        // no-op: resource might already be released
      });
    }
  }
}
