import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import shared from "./shared.module.css";
import styles from "./MatchStartScreen.module.css";
import { displayPlayerName } from "../../../../shared/players";
import type { Player } from "../../../types/match";

type Props = {
  /** Player order to render. The component reorders an internal copy and
   * surfaces commits via `onApply`. */
  players: Player[];
  /** Index of the player who deals the first round. */
  dealerStart: number;
  onDealerChange: (index: number) => void;
  /** Persisted reorder (final positions match indices in the supplied array). */
  onReorder: (orderedPlayerIds: string[]) => void;
  onStart: () => void;
  /** Disabled while a save is in flight. */
  disabled?: boolean;
};

/** Match Start screen — choose seating order and first dealer, then begin. */
export function MatchStartScreen({
  players,
  dealerStart,
  onDealerChange,
  onReorder,
  onStart,
  disabled,
}: Props) {
  const { t } = useTranslation();
  const dragIndexRef = useRef<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const handleDragStart = (index: number) => (e: React.DragEvent) => {
    if (disabled) return;
    dragIndexRef.current = index;
    setDragIndex(index);
    // Required for Firefox to actually start the drag.
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  };

  const handleDragOver = (index: number) => (e: React.DragEvent) => {
    if (dragIndexRef.current === null) return;
    e.preventDefault();
    if (hoverIndex !== index) setHoverIndex(index);
  };

  const handleDrop = (index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    const from = dragIndexRef.current;
    dragIndexRef.current = null;
    setDragIndex(null);
    setHoverIndex(null);
    if (from === null || from === index) return;

    const next = players.slice();
    const [moved] = next.splice(from, 1);
    next.splice(index, 0, moved);

    // Update dealer index so the same player keeps the role across the swap.
    const oldDealerId = players[dealerStart]?.id;
    if (oldDealerId) {
      const newDealerIdx = next.findIndex((p) => p.id === oldDealerId);
      if (newDealerIdx !== -1 && newDealerIdx !== dealerStart) {
        onDealerChange(newDealerIdx);
      }
    }
    onReorder(next.map((p) => p.id));
  };

  const handleDragEnd = () => {
    dragIndexRef.current = null;
    setDragIndex(null);
    setHoverIndex(null);
  };

  // Touch fallback: the HTML5 DnD API doesn't fire on iOS Safari for
  // arbitrary divs. Use pointer events to track the drag and decide a swap
  // on release.
  const pointerStartRef = useRef<{ index: number; y: number } | null>(null);
  const pointerSwapRef = useRef<number | null>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  const handlePointerDown =
    (index: number) => (e: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      // Only intercept primary-button presses; let other inputs (links, etc.)
      // function normally.
      if (e.pointerType === "mouse" && e.button !== 0) return;
      pointerStartRef.current = { index, y: e.clientY };
      pointerSwapRef.current = null;
      // Don't preventDefault — we want the click to still register if no
      // movement happens (so tap still selects dealer).
    };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerStartRef.current;
    if (!start) return;
    const dy = e.clientY - start.y;
    if (Math.abs(dy) < 6) return;
    // Find which row index the current Y falls into.
    let target = start.index;
    for (let i = 0; i < rowRefs.current.length; i++) {
      const el = rowRefs.current[i];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (e.clientY >= r.top && e.clientY <= r.bottom) {
        target = i;
        break;
      }
    }
    pointerSwapRef.current = target;
    setDragIndex(start.index);
    setHoverIndex(target);
  };

  const handlePointerUp = () => {
    const start = pointerStartRef.current;
    const swap = pointerSwapRef.current;
    pointerStartRef.current = null;
    pointerSwapRef.current = null;
    setDragIndex(null);
    setHoverIndex(null);
    if (start === null || swap === null || swap === start.index) return;

    const next = players.slice();
    const [moved] = next.splice(start.index, 1);
    next.splice(swap, 0, moved);
    const oldDealerId = players[dealerStart]?.id;
    if (oldDealerId) {
      const newDealerIdx = next.findIndex((p) => p.id === oldDealerId);
      if (newDealerIdx !== -1 && newDealerIdx !== dealerStart) {
        onDealerChange(newDealerIdx);
      }
    }
    onReorder(next.map((p) => p.id));
  };

  const ruleTiles: { titleKey: string; lineKey: string }[] = [
    {
      titleKey: "scoring.skullKing.matchStart.ruleBidZeroTitle",
      lineKey: "scoring.skullKing.matchStart.ruleBidZeroLine",
    },
    {
      titleKey: "scoring.skullKing.matchStart.ruleBidNTitle",
      lineKey: "scoring.skullKing.matchStart.ruleBidNLine",
    },
    {
      titleKey: "scoring.skullKing.matchStart.rule14sTitle",
      lineKey: "scoring.skullKing.matchStart.rule14sLine",
    },
    {
      titleKey: "scoring.skullKing.matchStart.ruleBlack14Title",
      lineKey: "scoring.skullKing.matchStart.ruleBlack14Line",
    },
    {
      titleKey: "scoring.skullKing.matchStart.ruleMermaidPirateTitle",
      lineKey: "scoring.skullKing.matchStart.ruleMermaidPirateLine",
    },
    {
      titleKey: "scoring.skullKing.matchStart.ruleSkMermaidTitle",
      lineKey: "scoring.skullKing.matchStart.ruleSkMermaidLine",
    },
  ];

  return (
    <div
      className={`${shared.screen} ${styles.body}`}
      data-testid="sk-match-start"
    >
      <div>
        <div className={shared.caption}>
          {t("scoring.skullKing.matchStart.caption")}
        </div>
        <h1 className={shared.h1}>
          {t("scoring.skullKing.header")}
        </h1>
        <p className={styles.summary}>
          {t("scoring.skullKing.matchStart.summary", {
            count: players.length,
          })}
        </p>
      </div>

      <div className={styles.section}>
        <div className={shared.caption}>
          {t("scoring.skullKing.matchStart.seatingTitle")}
        </div>
        <p
          className={shared.muted}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.62rem",
            letterSpacing: "0.06em",
            margin: "4px 0 0",
            color: "var(--color-ink-faint)",
          }}
        >
          {t("scoring.skullKing.matchStart.seatingHint")}
        </p>
        <div
          className={styles.seatList}
          data-testid="sk-match-start-seats"
        >
          {players.map((p, i) => {
            const isDragging = dragIndex === i;
            const isDropTarget = hoverIndex === i && dragIndex !== null && dragIndex !== i;
            const isDealer = i === dealerStart;
            return (
              <div
                key={p.id}
                ref={(el) => {
                  rowRefs.current[i] = el;
                }}
                className={`${styles.seatRow} ${isDragging ? styles.dragging : ""} ${
                  isDropTarget ? styles.dropTarget : ""
                }`}
                draggable={!disabled}
                onDragStart={handleDragStart(i)}
                onDragOver={handleDragOver(i)}
                onDrop={handleDrop(i)}
                onDragEnd={handleDragEnd}
                onPointerDown={handlePointerDown(i)}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onClick={(e) => {
                  // Skip click that resulted from a drag — pointerSwap was set.
                  if (pointerSwapRef.current !== null) return;
                  // The drag-end handler above sets dragIndex to null
                  // synchronously, so a tap with no movement reaches this
                  // handler and we treat it as a dealer-set.
                  e.preventDefault();
                  if (!disabled) onDealerChange(i);
                }}
                data-testid={`sk-seat-${i}`}
                data-dealer={isDealer ? "true" : undefined}
              >
                <span className={styles.seatHandle} aria-hidden>
                  <span />
                  <span />
                  <span />
                </span>
                <span
                  className={`${styles.seatBadge} ${isDealer ? styles.dealer : ""}`}
                >
                  {i + 1}
                </span>
                <span className={styles.seatName}>
                  {displayPlayerName(p)}
                </span>
                {isDealer && (
                  <span className={styles.dealerLabel}>
                    {t("scoring.skullKing.matchStart.dealerBadge")}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div className={shared.caption}>
          {t("scoring.skullKing.matchStart.rulesTitle")}
        </div>
        <div className={styles.rules}>
          {ruleTiles.map((tile) => (
            <div key={tile.titleKey} className={styles.ruleTile}>
              <h3>{t(tile.titleKey)}</h3>
              <p>{t(tile.lineKey)}</p>
            </div>
          ))}
        </div>
      </div>

      <button
        type="button"
        className={`${shared.btnPrimary} ${styles.cta}`}
        onClick={onStart}
        disabled={disabled}
        data-testid="sk-match-start-cta"
      >
        {t("scoring.skullKing.matchStart.startCta")}
      </button>
    </div>
  );
}
