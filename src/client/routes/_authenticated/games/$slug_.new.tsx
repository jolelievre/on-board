import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useTranslation } from "react-i18next";
import { useAuthSession } from "../../../hooks/useAuthSession";
import { useGame } from "../../../hooks/data/useGame";
import { createMatch } from "../../../lib/mutations";
import { db, type LocalGame } from "../../../lib/db";
import { SKULL_KING_TOTAL_ROUNDS } from "../../../../shared/scoring/skull-king";
import {
  usePlayerSuggestions,
  persistPlayersToLocalProfiles,
} from "../../../hooks/usePlayerSuggestions";
import { Header } from "../../../components/layout/Header";
import { Pill } from "../../../components/ui/Pill";
import { Button } from "../../../components/ui/Button";
import { Icon } from "../../../components/ui/Icon";
import styles from "./$slug_.new.module.css";

type NewMatchSearch = { rematchOf?: string };

export const Route = createFileRoute("/_authenticated/games/$slug_/new")({
  component: NewMatchPage,
  validateSearch: (search: Record<string, unknown>): NewMatchSearch => {
    const raw = search.rematchOf;
    return {
      rematchOf: typeof raw === "string" && raw.length > 0 ? raw : undefined,
    };
  },
});

function buildInitialNames(
  game: LocalGame,
  source: RematchSource | null,
): string[] {
  if (!source) return Array.from({ length: game.minPlayers }, () => "");
  // Players were sorted by `position` in the rematch loader — same
  // seating order as the just-finished match. Clamp to the game's
  // player range in case the previous match had different bounds.
  const cap = Math.min(source.players.length, game.maxPlayers);
  const seeded = source.players.slice(0, cap).map((p) => p.name);
  while (seeded.length < game.minPlayers) seeded.push("");
  return seeded;
}

function buildInitialUserIds(
  game: LocalGame,
  source: RematchSource | null,
): (string | null)[] {
  if (!source) return Array.from({ length: game.minPlayers }, () => null);
  const cap = Math.min(source.players.length, game.maxPlayers);
  const seeded = source.players.slice(0, cap).map((p) => p.userId);
  while (seeded.length < game.minPlayers) seeded.push(null);
  return seeded;
}

/**
 * Skull King dealer rotates one seat per round (see
 * `dealerForRound`). After a 10-round match, the player who *would*
 * have dealt round 11 — i.e. the seat one past the round-10 dealer —
 * should deal round 1 of the rematch.
 *
 * `dealerForRound(1, newDealerStart, n) = newDealerStart`, so we set
 * `newDealerStart = (TOTAL_ROUNDS + prevDealerStart) % n`. Player
 * order is preserved across the rematch, so the indexing is consistent.
 */
function rematchSkullKingDealerStart(
  source: RematchSource,
  playerCount: number,
): number {
  const prev = (source.metadata as { skullKing?: { dealerStart?: number } } | null)
    ?.skullKing;
  const prevDealerStart =
    typeof prev?.dealerStart === "number" ? prev.dealerStart : 0;
  if (playerCount <= 0) return 0;
  return (SKULL_KING_TOTAL_ROUNDS + prevDealerStart) % playerCount;
}

const AVATAR_CLASSES = [
  styles.avatarA,
  styles.avatarB,
  styles.avatarC,
  styles.avatarD,
  styles.avatarE,
  styles.avatarF,
  styles.avatarG,
  styles.avatarH,
];

/** Slim view of the previous match used by the rematch prefill. We read
 * Dexie directly here (rather than `useMatch`) so we can keep each
 * Player's `userId` — the cross-component `Match` type drops it. */
type RematchSource = {
  gameId: string;
  players: { name: string; userId: string | null }[];
  metadata: Record<string, unknown> | null;
};

function NewMatchPage() {
  const { slug } = Route.useParams();
  const { rematchOf } = Route.useSearch();
  const { t } = useTranslation();

  const { data: game, status: gameStatus } = useGame(slug);
  // Use the offline-aware wrapper rather than `authClient.useSession()`
  // directly. The raw hook can transiently return `undefined` during a
  // background refresh — if that happens mid-click on Start match, the
  // `!session` guard below unmounts NewMatchForm, taking the
  // `submitting` state and pending mutation with it. Symptom: the
  // offline-mode E2E suite reproducibly times out at `waitForURL` after
  // submit; passes 100% in isolation. The wrapper falls back to the
  // cached session keyed on the fetch `error`, eliminating the race.
  const { session } = useAuthSession();

  // `undefined` while loading, `null` once we know there's nothing to
  // prefill (no rematchOf, missing row, or a row from a different game).
  const rematchSource = useLiveQuery<RematchSource | null>(
    async () => {
      if (!rematchOf) return null;
      const match = await db.matches.get(rematchOf);
      if (!match) return null;
      const players = await db.players
        .where("matchId")
        .equals(rematchOf)
        .sortBy("position");
      return {
        gameId: match.gameId,
        players: players.map((p) => ({
          name: p.name,
          userId: p.userId ?? null,
        })),
        metadata: (match.metadata ?? null) as Record<string, unknown> | null,
      };
    },
    [rematchOf],
  );

  // Gate on session as well as game: the self-suggestion chip attaches
  // the current user's id to userIds[i] at click time. If session is
  // still loading when the user clicks, myUserId is undefined and the
  // Player row gets created with userId=null — silently breaking the
  // alias propagation flow downstream (refreshLocalAliases can't find
  // a row with userId === null to update).
  const waitingForPrevious =
    rematchOf !== undefined && rematchSource === undefined;
  if (gameStatus === "loading" || !game || !session || waitingForPrevious) {
    return (
      <>
        <Header back={{ to: "/games", label: t("nav.games") }} />
        <div className="px-5">
          <p style={{ color: "var(--color-ink-faint)" }}>{t("common.loading")}</p>
        </div>
      </>
    );
  }

  // Only use the previous match when its game matches the current one —
  // a stale `rematchOf` from a different game would prefill nonsense.
  const validRematchSource =
    rematchSource && rematchSource.gameId === game.id ? rematchSource : null;

  // The form is extracted so its `useState` initializers run AFTER game
  // is known — no useEffect race to populate `names`. Without this split,
  // useLiveQuery re-emits during form interaction could re-trigger the
  // init effect, and tests filling the third (added) slot intermittently
  // saw it cleared between fill and submit.
  return (
    <NewMatchForm
      slug={slug}
      game={game}
      myUserId={session.user.id}
      rematchSource={validRematchSource}
    />
  );
}

function NewMatchForm({
  slug,
  game,
  myUserId,
  rematchSource,
}: {
  slug: string;
  game: LocalGame;
  myUserId: string;
  rematchSource: RematchSource | null;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const { data: suggestions = [] } = usePlayerSuggestions();

  const [submitting, setSubmitting] = useState(false);
  const [names, setNames] = useState<string[]>(() =>
    buildInitialNames(game, rematchSource),
  );
  // Parallel array: when a slot was filled by clicking the "self"
  // suggestion, store the user's id here so we can attribute the Player
  // on submit. Typing the same name manually leaves this null — the
  // server only attaches userId on explicit chip selection to avoid
  // mis-linking friends who happen to share the user's name.
  const [userIds, setUserIds] = useState<(string | null)[]>(() =>
    buildInitialUserIds(game, rematchSource),
  );
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const canRemove = names.length > game.minPlayers;
  const canAdd = names.length < game.maxPlayers;

  const handleAddPlayer = () => {
    if (!canAdd) return;
    setNames((prev) => [...prev, ""]);
    setUserIds((prev) => [...prev, null]);
  };

  const handleRemovePlayer = (index: number) => {
    if (names.length <= game.minPlayers) return;
    setNames((prev) => prev.filter((_, i) => i !== index));
    setUserIds((prev) => prev.filter((_, i) => i !== index));
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmed = names.map((n) => n.trim());
    if (trimmed.some((n) => n.length === 0)) {
      setError(t("matches.newMatch.missingName"));
      return;
    }
    const lower = trimmed.map((n) => n.toLowerCase());
    if (new Set(lower).size !== lower.length) {
      setError(t("matches.newMatch.duplicateNames"));
      return;
    }

    const players = trimmed.map((name, i) => ({
      name,
      userId: userIds[i] ?? null,
    }));

    // Skull King rematch: seed the new match's dealerStart so round 1's
    // dealer is the seat one past round 10's dealer in the previous match.
    // MatchStartScreen reads metadata.skullKing.dealerStart on mount and
    // still lets the user override it before kicking off.
    const metadata =
      rematchSource && game.slug === "skull-king"
        ? {
            skullKing: {
              dealerStart: rematchSkullKingDealerStart(
                rematchSource,
                players.length,
              ),
            },
          }
        : undefined;

    setSubmitting(true);
    try {
      const { matchId } = await createMatch({
        gameId: game.id,
        players,
        ...(metadata ? { metadata } : {}),
      });
      void persistPlayersToLocalProfiles(players, myUserId ?? null);
      navigate({ to: "/matches/$id", params: { id: matchId } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setSubmitting(false);
    }
  };

  return (
    <>
      <Header
        back={{
          to: "/games/$slug",
          params: { slug },
          label: t(`games.catalog.${game.slug}.name`, { defaultValue: game.name }),
        }}
      />

      <div className="px-5">
        <h1 className={styles.title}>{t("matches.newMatch.title")}</h1>
        <div className={styles.range}>
          <Pill tone="muted">
            {t("matches.newMatch.playerRange", {
              min: game.minPlayers,
              max: game.maxPlayers,
            })}
          </Pill>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          {names.map((value, i) => {
            const initial = value.trim().slice(0, 1).toUpperCase() || String(i + 1);
            const avatarClass = AVATAR_CLASSES[i % AVATAR_CLASSES.length];
            const isActive = activeIndex === i;
            // Filter suggestions: exclude names already taken by other slots,
            // narrow to substring match against the current input value.
            const usedElsewhere = new Set(
              names
                .map((n, idx) => (idx === i ? "" : n.trim().toLowerCase()))
                .filter(Boolean),
            );
            const query = value.trim().toLowerCase();
            const filteredSuggestions = isActive
              ? suggestions
                  .filter((s) => !usedElsewhere.has(s.name.toLowerCase()))
                  .filter(
                    (s) => query === "" || s.name.toLowerCase().includes(query),
                  )
              : [];
            return (
              <div key={i}>
                <label className={styles.label} htmlFor={`new-match-player-${i}`}>
                  {t("matches.newMatch.playerLabel", { n: i + 1 })}
                </label>
                <div className={styles.row}>
                  <div className={styles.fieldWrap}>
                    <div className={styles.field}>
                      <span className={`${styles.avatar} ${avatarClass}`} aria-hidden>
                        {initial}
                      </span>
                      <input
                        id={`new-match-player-${i}`}
                        type="text"
                        name={`player-${i}`}
                        data-testid={`new-match-player-${i}`}
                        autoComplete="off"
                        placeholder={t("matches.newMatch.playerPlaceholder")}
                        value={value}
                        onFocus={() => setActiveIndex(i)}
                        onBlur={(e) => {
                          // Keep chips open when focus moves to a chip button
                          // inside the same suggestions row; close otherwise.
                          const next = e.relatedTarget;
                          if (
                            next instanceof HTMLElement &&
                            next.dataset.suggestionFor === String(i)
                          ) {
                            return;
                          }
                          setActiveIndex((curr) => (curr === i ? null : curr));
                        }}
                        onChange={(e) => {
                          const nextValue = e.target.value;
                          setNames((prev) => {
                            const nextNames = [...prev];
                            nextNames[i] = nextValue;
                            return nextNames;
                          });
                          // Typing breaks any prior chip-attribution: a
                          // self-linked slot must be re-confirmed by clicking
                          // the chip again, otherwise the userId stays null.
                          setUserIds((prev) => {
                            if (prev[i] === null) return prev;
                            const nextIds = [...prev];
                            nextIds[i] = null;
                            return nextIds;
                          });
                        }}
                        className={styles.input}
                      />
                      <Icon name="pencil" size={16} />
                    </div>
                    {isActive && filteredSuggestions.length > 0 && (
                      <div
                        className={styles.suggestions}
                        data-testid={`new-match-suggestions-${i}`}
                      >
                        {filteredSuggestions.map((s) => (
                          <button
                            key={s.name}
                            type="button"
                            data-suggestion-for={i}
                            data-testid={`new-match-suggestion-${i}-${s.name}`}
                            className={`${styles.suggestionChip} ${s.isSelf ? styles.suggestionChipSelf : ""}`}
                            onMouseDown={(e) => {
                              // Prevent the input from blurring before
                              // onClick fires.
                              e.preventDefault();
                            }}
                            onClick={() => {
                              setNames((prev) => {
                                const nextNames = [...prev];
                                nextNames[i] = s.name;
                                return nextNames;
                              });
                              setUserIds((prev) => {
                                const nextIds = [...prev];
                                nextIds[i] = s.isSelf ? (myUserId ?? null) : null;
                                return nextIds;
                              });
                              setActiveIndex(null);
                            }}
                          >
                            {s.isSelf && (
                              <span
                                className={styles.suggestionSelfBadge}
                                aria-hidden
                              >
                                ●
                              </span>
                            )}
                            {s.name}
                            {s.isSelf && (
                              <span className={styles.srOnly}>
                                {" "}
                                ({t("matches.newMatch.youSuffix", { defaultValue: "you" })})
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {canRemove && (
                    <button
                      type="button"
                      onClick={() => handleRemovePlayer(i)}
                      aria-label={t("matches.newMatch.removePlayer", { n: i + 1 })}
                      data-testid={`new-match-remove-${i}`}
                      className={styles.removeButton}
                    >
                      <Icon name="x" size={16} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {canAdd && (
            <button
              type="button"
              onClick={handleAddPlayer}
              data-testid="new-match-add-player"
              className={styles.addButton}
            >
              <Icon name="plus" size={14} />
              {t("matches.newMatch.addPlayer")}
            </button>
          )}

          {error && (
            <p className={styles.error} data-testid="new-match-error">
              {error}
            </p>
          )}

          <Button
            type="submit"
            disabled={submitting}
            data-testid="new-match-submit"
            variant="primary"
            size="lg"
            fullWidth
            iconBefore={<Icon name="play" size={18} />}
            className={styles.submit}
          >
            {t("matches.newMatch.start")}
          </Button>
        </form>
      </div>
    </>
  );
}
