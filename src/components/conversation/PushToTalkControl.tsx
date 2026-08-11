import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";

interface PushToTalkControlProps {
  active: boolean;
  finalizing: boolean;
  disabled: boolean;
  onPressStart: () => void;
  onPressEnd: () => void;
}

export function PushToTalkControl({
  active,
  finalizing,
  disabled,
  onPressStart,
  onPressEnd,
}: PushToTalkControlProps) {
  const { t } = useI18n();
  const pointerPressedRef = useRef(false);
  const onPressEndRef = useRef(onPressEnd);

  useEffect(() => {
    onPressEndRef.current = onPressEnd;
  }, [onPressEnd]);

  useEffect(() => {
    return () => {
      if (pointerPressedRef.current) onPressEndRef.current();
    };
  }, []);

  const finishPointerPress = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!pointerPressedRef.current) return;
    pointerPressedRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onPressEnd();
  };

  return (
    <div className="flex flex-col items-center gap-1.5 px-4 pb-1">
      <Button
        type="button"
        size="lg"
        variant={active ? "destructive" : "default"}
        disabled={disabled || finalizing}
        aria-pressed={active}
        data-push-to-talk-control
        className="min-w-52 select-none rounded-full px-6 touch-none"
        onContextMenu={(event) => event.preventDefault()}
        onClick={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (event.code === "Space") event.preventDefault();
        }}
        onKeyUp={(event) => {
          if (event.code === "Space") event.preventDefault();
        }}
        onPointerDown={(event) => {
          if (disabled || finalizing || event.button !== 0) return;
          event.preventDefault();
          pointerPressedRef.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          onPressStart();
        }}
        onPointerUp={finishPointerPress}
        onPointerCancel={finishPointerPress}
        onLostPointerCapture={() => {
          if (!pointerPressedRef.current) return;
          pointerPressedRef.current = false;
          onPressEnd();
        }}
      >
        <Mic className={active ? "size-4 animate-pulse" : "size-4"} />
        {finalizing
          ? t("scenario.finishingRecording")
          : active
            ? t("scenario.releaseToSend")
            : t("scenario.holdToTalk")}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        {t("scenario.pushToTalkHint")}
      </p>
    </div>
  );
}
