import { useTranslation } from "react-i18next";
import shared from "./shared.module.css";
import styles from "./BidRecapScreen.module.css";
import { displayPlayerName } from "../../../../shared/players";
import type { Player } from "../../../types/match";

type Props = {
  round: number;
  players: Player[];
  bids: Record<string, number | undefined>;
  onContinue: () => void;
  onBack: () => void;
};

/** Bid recap — shows everyone's bid + sum-vs-round commentary. */
export function BidRecapScreen({
  round,
  players,
  bids,
  onContinue,
  onBack,
}: Props) {
  const { t } = useTranslation();
  const sum = players.reduce((s, p) => s + (bids[p.id] ?? 0), 0);

  let commentary = "";
  if (sum === round) {
    commentary = t("scoring.skullKing.bidRecap.sumExact");
  } else if (sum < round) {
    commentary = t("scoring.skullKing.bidRecap.sumUnder", {
      count: round - sum,
    });
  } else {
    commentary = t("scoring.skullKing.bidRecap.sumOver", {
      count: sum - round,
    });
  }

  return (
    <div
      className={`${shared.screen}`}
      data-testid="sk-bid-recap"
      style={{ padding: 0 }}
    >
      <div className={styles.body}>
        <div className={shared.caption}>
          {t("scoring.skullKing.bidRecap.caption")}
        </div>
        <h1 className={shared.h1}>
          {t("scoring.skullKing.bidRecap.title", {
            n: round,
            sum,
            round,
          })}
        </h1>
        <p className={styles.commentary}>{commentary}</p>

        <div className={styles.list}>
          {players.map((p) => {
            const v = bids[p.id] ?? 0;
            const isZero = v === 0;
            return (
              <div
                key={p.id}
                className={styles.entry}
                data-testid={`sk-bid-recap-${p.id}`}
              >
                <span className={styles.entryName}>
                  {displayPlayerName(p)}
                </span>
                <span
                  className={`${styles.entryValue} ${isZero ? styles.zero : ""}`}
                >
                  {v}
                  {isZero && (
                    <span className={styles.entryZeroTag}>·BID·0</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={shared.btnSecondary}
            onClick={onBack}
            data-testid="sk-bid-recap-back"
          >
            {t("scoring.skullKing.bidRecap.backToBidsCta")}
          </button>
          <button
            type="button"
            className={shared.btnPrimary}
            onClick={onContinue}
            data-testid="sk-bid-recap-continue"
          >
            {t("scoring.skullKing.bidRecap.enterResultsCta")}
          </button>
        </div>
      </div>
    </div>
  );
}
