import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../../../lib/api";
import { Header } from "../../../components/layout/Header";
import { Pill } from "../../../components/ui/Pill";
import { Button } from "../../../components/ui/Button";
import { Icon } from "../../../components/ui/Icon";
import styles from "./$slug_.new.module.css";

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

  const { data: suggestions = [] } = useQuery<string[]>({
    queryKey: ["players", "suggestions"],
    queryFn: () => api<string[]>("/api/players/suggestions"),
  });

  const [names, setNames] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (game && names.length === 0) {
      setNames(Array.from({ length: game.minPlayers }, () => ""));
    }
  }, [game, names.length]);

  const createMatch = useMutation({
    mutationFn: (input: { gameId: string; players: string[] }) =>
      api<Match>("/api/matches", {
        method: "POST",
        body: JSON.stringify({
          gameId: input.gameId,
          players: input.players.map((name, i) => ({ name, position: i })),
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
  };

  const handleRemovePlayer = (index: number) => {
    if (names.length <= game.minPlayers) return;
    setNames((prev) => prev.filter((_, i) => i !== index));
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

    createMatch.mutate({ gameId: game.id, players: trimmed });
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

        <datalist id="player-suggestions">
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>

        <form onSubmit={handleSubmit} className={styles.form}>
          {names.map((value, i) => {
            const initial = value.trim().slice(0, 1).toUpperCase() || String(i + 1);
            const avatarClass = AVATAR_CLASSES[i % AVATAR_CLASSES.length];
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
                        list="player-suggestions"
                        autoComplete="off"
                        placeholder={t("matches.newMatch.playerPlaceholder")}
                        value={value}
                        onChange={(e) => {
                          setNames((prev) => {
                            const next = [...prev];
                            next[i] = e.target.value;
                            return next;
                          });
                        }}
                        className={styles.input}
                      />
                      <Icon name="pencil" size={16} />
                    </div>
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
