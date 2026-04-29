import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../../../lib/api";
import { authClient } from "../../../lib/auth-client";
import { Header } from "../../../components/layout/Header";
import { Pill } from "../../../components/ui/Pill";
import { Button } from "../../../components/ui/Button";
import { Icon } from "../../../components/ui/Icon";
import styles from "./$slug_.new.module.css";

type PlayerSuggestion = { name: string; isSelf: boolean };

export const Route = createFileRoute("/_authenticated/games/$slug_/new")({
  component: NewMatchPage,
});

type Game = {
  id: string;
  slug: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
};

type Match = {
  id: string;
};

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

function NewMatchPage() {
  const { slug } = Route.useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const { data: game, isPending } = useQuery<Game>({
    queryKey: ["games", slug],
    queryFn: () => api<Game>(`/api/games/${slug}`),
  });

  const { data: suggestions = [] } = useQuery<PlayerSuggestion[]>({
    queryKey: ["players", "suggestions"],
    queryFn: () => api<PlayerSuggestion[]>("/api/players/suggestions"),
  });

  const { data: session } = authClient.useSession();
  const myUserId = session?.user.id;

  const [names, setNames] = useState<string[]>([]);
  // Parallel array: when a slot was filled by clicking the "self"
  // suggestion, store the user's id here so we can attribute the Player
  // on submit. Typing the same name manually leaves this null — the
  // server only attaches userId on explicit chip selection to avoid
  // mis-linking friends who happen to share the user's name.
  const [userIds, setUserIds] = useState<(string | null)[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  useEffect(() => {
    if (game && names.length === 0) {
      const slots = game.minPlayers;
      setNames(Array.from({ length: slots }, () => ""));
      setUserIds(Array.from({ length: slots }, () => null));
    }
  }, [game, names.length]);

  const createMatch = useMutation({
    mutationFn: (input: {
      gameId: string;
      players: { name: string; userId: string | null }[];
    }) =>
      api<Match>("/api/matches", {
        method: "POST",
        body: JSON.stringify({
          gameId: input.gameId,
          players: input.players.map((p, i) => ({
            name: p.name,
            position: i,
            ...(p.userId ? { userId: p.userId } : {}),
          })),
        }),
      }),
    onSuccess: (match) => {
      navigate({ to: "/matches/$id", params: { id: match.id } });
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.message : "Unknown error");
    },
  });

  if (isPending || !game) {
    return (
      <>
        <Header back={{ to: "/games", label: t("nav.games") }} />
        <div className="px-5">
          <p style={{ color: "var(--color-ink-faint)" }}>{t("common.loading")}</p>
        </div>
      </>
    );
  }

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

  const handleSubmit = (e: React.FormEvent) => {
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

    createMatch.mutate({
      gameId: game.id,
      players: trimmed.map((name, i) => ({ name, userId: userIds[i] ?? null })),
    });
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
            disabled={createMatch.isPending}
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
