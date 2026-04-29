import { useTranslation } from "react-i18next";
import shared from "./shared.module.css";
import styles from "./ScoreboardScreen.module.css";
import { displayPlayerName } from "../../../../shared/players";
import {
  SKULL_KING_TOTAL_ROUNDS,
  scoreSkullKingRound,
  type SkullKingRoundEntry,
} from "../../../../shared/scoring/skull-king";
import type { Player } from "../../../types/match";

type Props = {
  players: Player[];
  /** Per-player, per-round entries. Missing entries render as "—". */
  entries: Record<string, Record<number, SkullKingRoundEntry | undefined>>;
  /** Current round (1-based). */
  currentRound: number;
};

export function ScoreboardScreen({ players, entries, currentRound }: Props) {
  const { t } = useTranslation();

  // Per-cell: bid/tricks/total/bonus computed once.
  const cells: Record<
    string,
    Record<number, { bid: number; tricks: number; total: number; bonus: number } | null>
  > = {};
  for (const p of players) {
    cells[p.id] = {};
    for (let r = 1; r <= SKULL_KING_TOTAL_ROUNDS; r++) {
      const entry = entries[p.id]?.[r];
      if (!entry) {
        cells[p.id][r] = null;
        continue;
      }
      const s = scoreSkullKingRound(r, entry);
      cells[p.id][r] = {
        bid: entry.bid,
        tricks: entry.tricks,
        total: s.total,
        bonus: s.bonus,
      };
    }
  }

  const totals: Record<string, number> = {};
  for (const p of players) {
    let sum = 0;
    for (let r = 1; r <= SKULL_KING_TOTAL_ROUNDS; r++) {
      sum += cells[p.id][r]?.total ?? 0;
    }
    totals[p.id] = sum;
  }

  // Modified competition ranking: distinct totals get distinct ranks (1, 2,
  // 3…); ties share the lower rank and skip the next ("1, 1, 3"). Computed
  // once so every cell can render its own #N badge in the totals row.
  const ranks: Record<string, number> = {};
  {
    const sortedDescending = [...players].sort(
      (a, b) => (totals[b.id] ?? 0) - (totals[a.id] ?? 0),
    );
    let lastValue: number | null = null;
    let lastRank = 0;
    sortedDescending.forEach((p, idx) => {
      const v = totals[p.id] ?? 0;
      if (v === lastValue) {
        ranks[p.id] = lastRank;
      } else {
        ranks[p.id] = idx + 1;
        lastValue = v;
        lastRank = idx + 1;
      }
    });
  }

  // Sparkline data: cumulative per round per player.
  const cumulative: Record<string, number[]> = {};
  for (const p of players) cumulative[p.id] = [];
  let lastRoundWithAnyEntry = 0;
  for (let r = 1; r <= SKULL_KING_TOTAL_ROUNDS; r++) {
    let anyEntry = false;
    for (const p of players) {
      const c = cells[p.id][r];
      if (c) anyEntry = true;
      const prev = cumulative[p.id][r - 2] ?? 0;
      cumulative[p.id].push(prev + (c?.total ?? 0));
    }
    if (anyEntry) lastRoundWithAnyEntry = r;
  }

  return (
    <div className={`${shared.screen} ${styles.body}`} data-testid="sk-scoreboard">
      <div className={styles.header}>
        <h2 className={shared.h2}>{t("scoring.skullKing.scoreboard.title")}</h2>
        <span className={shared.caption}>
          {t("scoring.skullKing.scoreboard.currentRound", { n: currentRound })}
        </span>
      </div>

      <div className={styles.scroll}>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <colgroup>
              <col style={{ width: 36 }} />
              {players.map((p) => (
                <col key={p.id} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className={`${styles.th} ${styles.thRound}`}>
                  <span>R</span>
                </th>
                {players.map((p) => (
                  <th key={p.id} className={styles.th}>
                    {displayPlayerName(p)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: SKULL_KING_TOTAL_ROUNDS }).map((_, rIdx) => {
                const r = rIdx + 1;
                return (
                  <tr key={r}>
                    <td className={`${styles.td} ${styles.tdRound}`}>{r}</td>
                    {players.map((p) => {
                      const c = cells[p.id][r];
                      if (!c) {
                        return (
                          <td
                            key={p.id}
                            className={`${styles.td} ${styles.tdEmpty}`}
                          >
                            —
                          </td>
                        );
                      }
                      const made = c.bid === c.tricks;
                      const isZero = c.bid === 0;
                      return (
                        <td
                          key={p.id}
                          className={`${styles.td} ${
                            made ? styles.tdMade : styles.tdMissed
                          }`}
                          data-testid={`sk-scoreboard-cell-${p.id}-${r}`}
                        >
                          <div className={styles.cell}>
                            <span className={styles.cellMeta}>
                              {c.bid}/{c.tricks}
                              {isZero ? "·0" : ""}
                            </span>
                            <span
                              className={`${styles.cellValue} ${
                                c.total >= 0 ? styles.positive : styles.negative
                              }`}
                            >
                              {c.total >= 0 ? "+" : ""}
                              {c.total}
                            </span>
                            {c.bonus > 0 && (
                              <span className={styles.cellBonus}>
                                +{c.bonus} bonus
                              </span>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}

              {/* Total row */}
              <tr className={styles.totalRow}>
                <td className={`${styles.td} ${styles.totalRowLabel}`}>
                  {t("scoring.skullKing.scoreboard.totalsRowLabel")}
                </td>
                {players.map((p) => {
                  const v = totals[p.id];
                  const rank = ranks[p.id];
                  const isLeader = rank === 1 && v > 0;
                  return (
                    <td
                      key={p.id}
                      className={`${styles.td} ${isLeader ? styles.totalLeader : ""}`}
                      data-testid={`sk-scoreboard-total-${p.id}`}
                      data-rank={rank}
                    >
                      <div className={styles.totalCell}>
                        <span
                          className={`${styles.rankBadge} ${isLeader ? styles.rankBadgeLeader : ""}`}
                          data-testid={`sk-scoreboard-rank-${p.id}`}
                        >
                          #{rank}
                        </span>
                        <span
                          className={`${styles.totalValue} ${isLeader ? styles.leader : ""}`}
                        >
                          {v}
                        </span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>

        {lastRoundWithAnyEntry > 0 && (
          <div className={styles.trajectory}>
            <div className={shared.caption}>
              {t("scoring.skullKing.scoreboard.trajectoryTitle")}
            </div>
            <Sparkline
              players={players}
              cumulative={cumulative}
              roundsPlayed={lastRoundWithAnyEntry}
            />
          </div>
        )}
      </div>
    </div>
  );
}

const SPARKLINE_COLORS = [
  "var(--color-primary)",
  "var(--color-accent)",
  "var(--sk-gold)",
  "var(--sk-sea)",
  "var(--sk-blood)",
  "var(--sk-purple)",
  "var(--color-success)",
  "var(--color-warning)",
];

function Sparkline({
  players,
  cumulative,
  roundsPlayed,
}: {
  players: Player[];
  cumulative: Record<string, number[]>;
  roundsPlayed: number;
}) {
  const W = 320;
  const H = 80;

  const slice = (id: string) => cumulative[id].slice(0, roundsPlayed);

  const xs: number[] = [];
  for (let i = 0; i < roundsPlayed; i++) {
    xs.push((W * i) / Math.max(1, roundsPlayed - 1));
  }
  const allVals = players.flatMap((p) => slice(p.id));
  const minV = Math.min(0, ...allVals);
  const maxV = Math.max(10, ...allVals);
  const yFor = (v: number) => H - ((v - minV) / (maxV - minV || 1)) * H;

  return (
    <svg
      width="100%"
      height={H + 20}
      viewBox={`-4 -4 ${W + 32} ${H + 20}`}
      preserveAspectRatio="none"
      data-testid="sk-scoreboard-sparkline"
    >
      <line
        x1="0"
        y1={yFor(0)}
        x2={W}
        y2={yFor(0)}
        stroke="var(--color-border-strong)"
        strokeDasharray="2 4"
      />
      {players.map((p, idx) => {
        const data = slice(p.id);
        const pts = data
          .map((v, i) => `${xs[i]},${yFor(v)}`)
          .join(" ");
        const lastY = yFor(data[data.length - 1] ?? 0);
        const color = SPARKLINE_COLORS[idx % SPARKLINE_COLORS.length];
        return (
          <g key={p.id}>
            <polyline
              points={pts}
              fill="none"
              stroke={color}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle
              cx={xs[xs.length - 1]}
              cy={lastY}
              r="3"
              fill={color}
            />
            <text
              x={W + 2}
              y={lastY + 3}
              fontFamily="var(--font-mono)"
              fontSize="9"
              fill={color}
            >
              {displayPlayerName(p).slice(0, 3)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
