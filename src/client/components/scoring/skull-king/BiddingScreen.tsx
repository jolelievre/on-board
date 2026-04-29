import { useTranslation } from "react-i18next";
import shared from "./shared.module.css";
import styles from "./BiddingScreen.module.css";
import { DigitGrid } from "../../ui/sk/DigitGrid";
import { displayPlayerName } from "../../../../shared/players";
import type { Player } from "../../../types/match";

type Props = {
  round: number;
  players: Player[];
  /** Bids keyed by playerId. Undefined entries are unbid. */
  bids: Record<string, number | undefined>;
  /** Index of the row currently bound to the digit picker. */
  activeIndex: number;
  onActiveIndexChange: (i: number) => void;
  onBid: (playerId: string, value: number) => void;
  onReveal: () => void;
};

/**
 * Bottom-sheet bid picker. Top half lists every player; bottom half is a
 * fixed digit grid bound to the active row. Auto-advances to the next unbid
 * player on tap; tap any row to re-edit.
 */
export function BiddingScreen({
  round,
  players,
  bids,
  activeIndex,
  onActiveIndexChange,
  onBid,
  onReveal,
}: Props) {
  const { t } = useTranslation();
  const active = players[activeIndex];
  const bidCount = players.filter((p) => bids[p.id] != null).length;
  const allDone = bidCount === players.length;

  const handlePick = (n: number) => {
    if (!active) return;
    onBid(active.id, n);
    // Auto-advance to the next *unbid* player; if all subsequent players
    // already have a bid, stay on the current row so the user notices the
    // round is fully bid.
    const start = activeIndex + 1;
    for (let off = 0; off < players.length - 1; off++) {
      const idx = (start + off) % players.length;
      if (idx === activeIndex) continue;
      const p = players[idx];
      const isAlreadyBid = bids[p.id] != null;
      // Treat the row we *just* edited as bid (the local `bids` map hasn't
      // been updated yet — it'll arrive on the next render).
      if (!isAlreadyBid) {
        onActiveIndexChange(idx);
        return;
      }
    }
    // Everyone else already has a bid — leave focus where it is.
  };

  return (
    <div className={`${shared.screen} ${styles.body}`} data-testid="sk-bid">
      <div className={styles.headerStrip}>
        <div>
          <div className={shared.caption}>{t("scoring.skullKing.bid.caption")}</div>
          <h1>{t("scoring.skullKing.round", { n: round })}</h1>
        </div>
        <span className={styles.progress}>
          {t("scoring.skullKing.bid.progress", {
            done: bidCount,
            total: players.length,
          })}
        </span>
      </div>

      <div className={styles.list} data-testid="sk-bid-rows">
        {players.map((p, i) => {
          const isActive = i === activeIndex;
          const v = bids[p.id];
          return (
            <button
              key={p.id}
              type="button"
              className={`${styles.row} ${isActive ? styles.active : ""}`}
              onClick={() => onActiveIndexChange(i)}
              data-testid={`sk-bid-row-${i}`}
              data-active={isActive ? "true" : undefined}
              aria-pressed={isActive}
            >
              <span className={styles.rowLeft}>
                <span className={styles.posBadge}>{i + 1}</span>
                <span className={styles.rowName}>{displayPlayerName(p)}</span>
              </span>
              {v != null ? (
                <span
                  className={styles.rowBid}
                  data-testid={`sk-bid-row-${i}-value`}
                >
                  {v}
                </span>
              ) : (
                <span className={`${styles.rowBid} ${styles.empty}`}>
                  {t("scoring.skullKing.bid.bidPrompt")}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className={styles.sheet}>
        <div className={styles.sheetHeader}>
          <span className={styles.sheetTitle}>
            {active
              ? t("scoring.skullKing.bid.playerBid", {
                  name: displayPlayerName(active),
                })
              : null}
          </span>
        </div>
        <DigitGrid
          max={round}
          selected={active ? bids[active.id] : undefined}
          onPick={handlePick}
          big
          data-testid="sk-bid-digit-grid"
        />
        <button
          type="button"
          className={`${shared.btnPrimary} ${styles.revealCta}`}
          onClick={onReveal}
          disabled={!allDone}
          data-testid="sk-bid-reveal"
        >
          {t("scoring.skullKing.bid.revealCta")}
        </button>
      </div>
    </div>
  );
}
