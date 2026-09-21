export type ShadowProgressionPhase =
  | "playing"
  | "waiting"
  | "transcribing"
  | "result"
  | "complete";

export interface ShadowProgressionState {
  currentPairIndex: number;
  phase: ShadowProgressionPhase;
}

export type ShadowProgressionEvent = "attempt-reviewed" | "continue";

export function resolveShadowProgression(
  state: ShadowProgressionState,
  event: ShadowProgressionEvent,
  totalPairs: number
): ShadowProgressionState {
  if (event === "attempt-reviewed") {
    return {
      currentPairIndex: state.currentPairIndex,
      phase: "result",
    };
  }

  if (state.phase !== "result") {
    return state;
  }

  if (state.currentPairIndex + 1 >= totalPairs) {
    return {
      currentPairIndex: state.currentPairIndex,
      phase: "complete",
    };
  }

  return {
    currentPairIndex: state.currentPairIndex + 1,
    phase: "playing",
  };
}
