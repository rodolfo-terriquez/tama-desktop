export type TamaDataChangeReason = "account-restore" | "sensei-write" | "study-plan-write";

export function emitConfigChanged(): void {
  window.dispatchEvent(new Event("tama-config-changed"));
}

export function emitDataChanged(reason: TamaDataChangeReason): void {
  window.dispatchEvent(new CustomEvent("tama-data-changed", { detail: { reason } }));
}
