import { useEffect, useRef } from "react";

interface UsePushToTalkHotkeyOptions {
  enabled: boolean;
  disabled?: boolean;
  onPressStart: () => void;
  onPressEnd: () => void;
}

function shouldIgnoreSpaceTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  if (target.closest("input, textarea, select, [contenteditable='true'], [role='textbox']")) {
    return true;
  }

  const button = target.closest("button");
  return Boolean(button && !button.hasAttribute("data-push-to-talk-control"));
}

export function usePushToTalkHotkey({
  enabled,
  disabled = false,
  onPressStart,
  onPressEnd,
}: UsePushToTalkHotkeyOptions): void {
  const pressedRef = useRef(false);
  const onPressStartRef = useRef(onPressStart);
  const onPressEndRef = useRef(onPressEnd);

  useEffect(() => {
    onPressStartRef.current = onPressStart;
    onPressEndRef.current = onPressEnd;
  }, [onPressEnd, onPressStart]);

  useEffect(() => {
    if (!enabled || disabled) return;

    const finishPress = () => {
      if (!pressedRef.current) return;
      pressedRef.current = false;
      onPressEndRef.current();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.code !== "Space" ||
        event.repeat ||
        pressedRef.current ||
        shouldIgnoreSpaceTarget(event.target)
      ) {
        return;
      }

      event.preventDefault();
      pressedRef.current = true;
      onPressStartRef.current();
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space" || !pressedRef.current) return;
      event.preventDefault();
      finishPress();
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", finishPress);

    return () => {
      finishPress();
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", finishPress);
    };
  }, [disabled, enabled]);
}
