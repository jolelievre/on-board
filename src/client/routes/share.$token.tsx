import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LanguageSelector } from "../components/LanguageSelector";
import styles from "./share.$token.module.css";

export const Route = createFileRoute("/share/$token")({
  component: SharePage,
});

type SharePayload = {
  game: { name: string; slug: string };
  completedAt: string | null;
  victoryType: string | null;
  players: { alias: string; score: number; isWinner: boolean }[];
};

type LoadState =
  | { kind: "loading" }
  | { kind: "ok"; data: SharePayload }
  | { kind: "missing" }
  | { kind: "error" };

function SharePage() {
  const { token } = Route.useParams();
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    fetch(`/api/share/${token}`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) {
          setState({ kind: "missing" });
          return;
        }
        if (!res.ok) {
          setState({ kind: "error" });
          return;
        }
        const data = (await res.json()) as SharePayload;
        setState({ kind: "ok", data });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/" className={styles.brand}>
          OnBoard
        </Link>
        <LanguageSelector />
      </header>

      <main className={styles.main}>
        {state.kind === "loading" && (
          <p className={styles.status}>{t("common.loading")}</p>
        )}

        {state.kind === "missing" && (
          <div className={styles.statusBlock} data-testid="share-not-found">
            <h1 className={styles.notFoundTitle}>
              {t("share.notFound.title")}
            </h1>
            <p className={styles.notFoundBody}>
              {t("share.notFound.body")}
            </p>
          </div>
        )}

        {state.kind === "error" && (
          <p className={styles.status} data-testid="share-error">
            {t("share.loadError")}
          </p>
        )}

        {state.kind === "ok" && (
          <ShareSummary data={state.data} locale={i18n.language} />
        )}

        {/* Install CTA is shown alongside any state — even an expired
            link is a good moment to nudge a friend toward the app. The
            target swaps to `/install` in PR 8-E. */}
        <section className={styles.installCta} data-testid="share-install-cta">
          <h2 className={styles.installTitle}>{t("share.install.title")}</h2>
          <p className={styles.installBody}>{t("share.install.body")}</p>
          <Link to="/" className={styles.installButton}>
            {t("share.install.cta")}
          </Link>
        </section>
      </main>
    </div>
  );
}

function ShareSummary({
  data,
  locale,
}: {
  data: SharePayload;
  locale: string;
}) {
  const { t } = useTranslation();
  const completedLabel = data.completedAt
    ? formatDate(data.completedAt, locale)
    : null;
  const winner = data.players.find((p) => p.isWinner);
  const ordered = [...data.players].sort((a, b) => b.score - a.score);

  return (
    <article className={styles.card} data-testid="share-summary">
      <p className={styles.eyebrow}>{t("share.summary.eyebrow")}</p>
      <h1 className={styles.gameName}>{data.game.name}</h1>
      {completedLabel && (
        <p className={styles.completedAt}>{completedLabel}</p>
      )}

      {winner && (
        <p className={styles.winnerLine} data-testid="share-winner-line">
          {t("share.summary.winnerLine", {
            alias: winner.alias,
            score: winner.score,
          })}
        </p>
      )}

      <ol className={styles.playerList} data-testid="share-player-list">
        {ordered.map((p, i) => (
          <li
            key={`${p.alias}-${i}`}
            className={`${styles.playerRow} ${
              p.isWinner ? styles.playerRowWinner : ""
            }`}
            data-testid="share-player-row"
          >
            <span className={styles.playerPos}>{i + 1}</span>
            <span className={styles.playerAlias}>{p.alias}</span>
            <span className={styles.playerScore}>{p.score}</span>
          </li>
        ))}
      </ol>

      {data.victoryType && (
        <p className={styles.victoryType}>
          {t(`share.summary.victoryType.${data.victoryType}`, {
            defaultValue: data.victoryType,
          })}
        </p>
      )}
    </article>
  );
}

function formatDate(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}
