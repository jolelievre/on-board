import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useTranslation } from "react-i18next";
import { createId } from "@paralleldrive/cuid2";
import { useAuthSession } from "../../../hooks/useAuthSession";
import { useGame } from "../../../hooks/data/useGame";
import {
  useProfileSuggestions,
  usePlayedWith,
  type ProfileSuggestion,
  type PlayedWithGroup,
} from "../../../hooks/data/useProfiles";
import { createMatch, createProfile } from "../../../lib/mutations";
import { db, type LocalGame } from "../../../lib/db";
import { SKULL_KING_TOTAL_ROUNDS } from "../../../../shared/scoring/skull-king";
import { Header } from "../../../components/layout/Header";
import { Pill } from "../../../components/ui/Pill";
import { Button } from "../../../components/ui/Button";
import { Icon } from "../../../components/ui/Icon";
import { Avatar } from "../../../components/ui/Avatar";
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

/** A single slot in the new-match form. `profileId` is set once the user
 * either picks an existing profile or commits an inline-created one. While
 * `profileId === null`, the slot is in free-text mode and `query` holds
 * what the user has typed (used for both filtering the picker and as the
 * alias if they submit without picking). */
type Slot = {
  profileId: string | null;
  query: string;
};

function buildInitialSlots(game: LocalGame, source: RematchSource | null): Slot[] {
  const minSlots = Array.from({ length: game.minPlayers }, () => ({
    profileId: null,
    query: "",
  }));
  if (!source) return minSlots;
  const cap = Math.min(source.players.length, game.maxPlayers);
  const seeded: Slot[] = source.players.slice(0, cap).map((p) => ({
    profileId: p.profileId,
    query: p.name,
  }));
  while (seeded.length < game.minPlayers) {
    seeded.push({ profileId: null, query: "" });
  }
  return seeded;
}

/**
 * Skull King dealer rotates one seat per round (see
 * `dealerForRound`). After a 10-round match, the player who *would*
 * have dealt round 11 — i.e. the seat one past the round-10 dealer —
 * should deal round 1 of the rematch.
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

/** Slim view of the previous match used by the rematch prefill. */
type RematchSource = {
  gameId: string;
  players: { name: string; profileId: string | null }[];
  metadata: Record<string, unknown> | null;
};

function NewMatchPage() {
  const { slug } = Route.useParams();
  const { rematchOf } = Route.useSearch();
  const { t } = useTranslation();

  const { data: game, status: gameStatus } = useGame(slug);
  const { session } = useAuthSession();

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
          profileId: p.profileId ?? null,
        })),
        metadata: (match.metadata ?? null) as Record<string, unknown> | null,
      };
    },
    [rematchOf],
  );

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

  const validRematchSource =
    rematchSource && rematchSource.gameId === game.id ? rematchSource : null;

  const sessionUser = session.user as {
    id: string;
    name: string;
    alias?: string | null;
  };
  return (
    <NewMatchForm
      slug={slug}
      game={game}
      viewerId={sessionUser.id}
      viewerName={sessionUser.name}
      viewerAlias={sessionUser.alias ?? null}
      rematchSource={validRematchSource}
    />
  );
}

function NewMatchForm({
  slug,
  game,
  viewerId,
  viewerName,
  viewerAlias,
  rematchSource,
}: {
  slug: string;
  game: LocalGame;
  viewerId: string;
  /** The viewer's auth `User.name`, used to detect typed-self
   * (when the user free-types their own name in a slot). */
  viewerName: string;
  /** The viewer's auth `User.alias` if they've set one — same
   * purpose as `viewerName`. */
  viewerAlias: string | null;
  rematchSource: RematchSource | null;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [submitting, setSubmitting] = useState(false);
  const [slots, setSlots] = useState<Slot[]>(() =>
    buildInitialSlots(game, rematchSource),
  );
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const playedWithGroups = usePlayedWith(viewerId, game.id);
  // Hide chip groups that overlap with what the user already has in
  // slots — the chip would be a no-op tap otherwise. Comparison is on
  // the *set* of profileIds; a chip that's a permutation of the
  // current state still shows so the user can re-seat.
  const usefulPlayedWith = useMemo<PlayedWithGroup[]>(() => {
    if (!playedWithGroups) return [];
    const currentIds = new Set(
      slots.map((s) => s.profileId).filter((id): id is string => id !== null),
    );
    return playedWithGroups.filter((g) => {
      const groupSet = new Set(g.profileIds);
      if (groupSet.size !== currentIds.size) return true;
      for (const id of groupSet) {
        if (!currentIds.has(id)) return true;
      }
      return false;
    });
  }, [playedWithGroups, slots]);

  const canRemove = slots.length > game.minPlayers;
  const canAdd = slots.length < game.maxPlayers;

  const handleAddPlayer = () => {
    if (!canAdd) return;
    setSlots((prev) => [...prev, { profileId: null, query: "" }]);
  };

  const handleRemovePlayer = (index: number) => {
    if (slots.length <= game.minPlayers) return;
    setSlots((prev) => prev.filter((_, i) => i !== index));
    setError(null);
    setActiveIndex((curr) => (curr === index ? null : curr));
  };

  const updateSlot = (index: number, patch: Partial<Slot>) => {
    setSlots((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  const fillFromGroup = (group: PlayedWithGroup) => {
    setSlots((prev) => {
      // Don't shrink the form below its current row count; pad if the
      // group has more profiles than slots (up to maxPlayers).
      const target = Math.min(
        Math.max(prev.length, group.profileIds.length),
        game.maxPlayers,
      );
      const next: Slot[] = [];
      for (let i = 0; i < target; i++) {
        if (i < group.profileIds.length) {
          const profile = group.profiles[i];
          next.push({ profileId: group.profileIds[i], query: profile.alias });
        } else {
          // Beyond the group: keep whatever was there.
          next.push(prev[i] ?? { profileId: null, query: "" });
        }
      }
      return next;
    });
    setActiveIndex(null);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Resolve each slot to a profileId for the create-match payload.
    // Three cases:
    //   1. profileId already set → use it.
    //   2. empty query → form error.
    //   3. query but no profileId → look up an exact-match profile;
    //      otherwise create one inline now (so the new-match POST can
    //      reference the id and the suggestions list picks it up).
    const queries = slots.map((s) => s.query.trim());
    if (queries.some((q, i) => q.length === 0 && !slots[i].profileId)) {
      setError(t("matches.newMatch.missingName"));
      return;
    }

    // Detect duplicate selections — same profileId twice, or two slots
    // about to create the same fresh alias. Both would resolve to the
    // same Profile server-side and break the picker's invariant that
    // each slot holds a distinct person.
    const seenProfileIds = new Set<string>();
    const seenAliasKeys = new Set<string>();
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const aliasKey = queries[i].toLowerCase();
      if (slot.profileId) {
        if (seenProfileIds.has(slot.profileId)) {
          setError(t("matches.newMatch.duplicateNames"));
          return;
        }
        seenProfileIds.add(slot.profileId);
      } else if (aliasKey) {
        if (seenAliasKeys.has(aliasKey)) {
          setError(t("matches.newMatch.duplicateNames"));
          return;
        }
        seenAliasKeys.add(aliasKey);
      }
    }

    setSubmitting(true);
    try {
      const visibleProfiles = await readVisibleProfiles(viewerId);
      const aliasIndex = new Map<string, string>();
      // Track which profile ids represent the viewer themselves so
      // the create-match payload can carry `userId: viewerId` on
      // that slot. The server needs `Player.userId` set on the
      // creator's seat — without it, the friend-side
      // `collectPersonPlayers` aggregation can't find the match
      // under their bilateral linked profile. The picker already
      // computes `isSelf` per suggestion; this is the submit-time
      // mirror of that signal.
      const selfProfileIds = new Set<string>();
      for (const p of visibleProfiles) {
        aliasIndex.set(p.alias.trim().toLowerCase(), p.id);
        if (p.ownerId === viewerId && p.linkedUserId === viewerId) {
          selfProfileIds.add(p.id);
        }
      }
      // Free-typed text that case-insensitively matches the
      // viewer's own User name or alias also counts as "me" — the
      // user is referring to themselves under a label that doesn't
      // happen to be their self-Profile's alias (e.g. typed full
      // name when the alias is a nickname). Keeps the form
      // forgiving without leaking alias-matching anywhere outside
      // this single client-side branch.
      const selfTypedAliases = new Set<string>();
      for (const raw of [viewerName, viewerAlias]) {
        const trimmed = raw?.trim().toLowerCase();
        if (trimmed) selfTypedAliases.add(trimmed);
      }

      const resolved = await Promise.all(
        slots.map(async (slot, i): Promise<string> => {
          if (slot.profileId) return slot.profileId;
          const alias = queries[i];
          const existing = aliasIndex.get(alias.toLowerCase());
          if (existing) return existing;
          // Inline-create. The server upserts on the supplied id, so a
          // queued POST replay stays idempotent.
          const { profileId } = await createProfile({
            ownerId: viewerId,
            alias,
            id: createId(),
          });
          // Record the just-created profile so a subsequent slot in the
          // same submit with the same alias (already caught by the dup
          // check above, but defensive) doesn't try to recreate it.
          aliasIndex.set(alias.toLowerCase(), profileId);
          return profileId;
        }),
      );

      const players = resolved.map((profileId, i) => {
        // Two ways this slot represents the viewer:
        //   1. The resolved profile *is* the self-profile.
        //   2. The user free-typed their own name/alias and the
        //      resolver mapped it to some other owned profile of
        //      theirs (or just created one). Same semantic
        //      intent.
        const typed = queries[i].toLowerCase();
        const isSelf =
          selfProfileIds.has(profileId) || selfTypedAliases.has(typed);
        return {
          profileId,
          ...(isSelf ? { userId: viewerId } : {}),
        };
      });

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

      const { matchId } = await createMatch({
        gameId: game.id,
        players,
        ...(metadata ? { metadata } : {}),
      });
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

        {usefulPlayedWith.length > 0 && (
          <div
            className={styles.playedWith}
            data-testid="new-match-played-with"
          >
            <span className={styles.playedWithLabel}>
              {t("matches.newMatch.playedWith")}
            </span>
            <div className={styles.playedWithRow}>
              {usefulPlayedWith.map((group, idx) => (
                <button
                  type="button"
                  key={group.profileIds.join("|")}
                  onClick={() => fillFromGroup(group)}
                  className={styles.playedWithChip}
                  data-testid={`new-match-played-with-${idx}`}
                  aria-label={t("matches.newMatch.playedWithFill")}
                >
                  <span className={styles.playedWithAvatars}>
                    {group.profiles.slice(0, 4).map((p) => (
                      <Avatar
                        key={p.id}
                        profile={p}
                        viewerId={viewerId}
                        size="sm"
                        className={styles.playedWithAvatar}
                      />
                    ))}
                  </span>
                  <span className={styles.playedWithNames}>
                    {group.profiles.map((p) => p.alias).join(" · ")}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className={styles.form}>
          {slots.map((slot, i) => (
            <SlotRow
              key={i}
              index={i}
              slot={slot}
              viewerId={viewerId}
              otherProfileIds={slotIdsExcluding(slots, i)}
              isActive={activeIndex === i}
              canRemove={canRemove}
              onFocus={() => setActiveIndex(i)}
              onBlur={() => setActiveIndex((curr) => (curr === i ? null : curr))}
              onChange={(value) =>
                updateSlot(i, { query: value, profileId: null })
              }
              onPick={(profileId, alias) => {
                updateSlot(i, { profileId, query: alias });
                setActiveIndex(null);
              }}
              onRemove={() => handleRemovePlayer(i)}
              fallbackAvatarClass={AVATAR_CLASSES[i % AVATAR_CLASSES.length]}
            />
          ))}

          {canAdd && (
            <button
              type="button"
              // preventDefault on mousedown keeps focus on whichever
              // input is active — without this the input would blur,
              // closing the suggestions panel, which would re-flow the
              // form upward between mousedown and mouseup. The browser
              // hit-tests the *mouseup* position when resolving the
              // click target, so the click would land on whatever
              // shifted into add-player's old position (often nothing)
              // and the add never fires.
              onMouseDown={(e) => e.preventDefault()}
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
            // Same layout-shift guard as add/remove. Without it, mousedown
            // on submit blurs the active input, the picker collapses, and
            // mouseup lands below where submit used to be — submit never
            // fires.
            onMouseDown={(e) => e.preventDefault()}
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

function slotIdsExcluding(slots: Slot[], index: number): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < slots.length; i++) {
    if (i === index) continue;
    if (slots[i].profileId) out.add(slots[i].profileId as string);
  }
  return out;
}

async function readVisibleProfiles(viewerId: string) {
  const [owned, linked] = await Promise.all([
    db.profiles.where("ownerId").equals(viewerId).toArray(),
    db.profiles.where("linkedUserId").equals(viewerId).toArray(),
  ]);
  const byId = new Map<string, (typeof owned)[number]>();
  for (const p of owned) byId.set(p.id, p);
  for (const p of linked) byId.set(p.id, p);
  return [...byId.values()];
}

function SlotRow({
  index,
  slot,
  viewerId,
  otherProfileIds,
  isActive,
  canRemove,
  onFocus,
  onBlur,
  onChange,
  onPick,
  onRemove,
  fallbackAvatarClass,
}: {
  index: number;
  slot: Slot;
  viewerId: string;
  otherProfileIds: Set<string>;
  isActive: boolean;
  canRemove: boolean;
  onFocus: () => void;
  onBlur: () => void;
  onChange: (value: string) => void;
  onPick: (profileId: string, alias: string) => void;
  onRemove: () => void;
  fallbackAvatarClass: string;
}) {
  const { t } = useTranslation();

  const pickedProfile = useLiveQuery(
    async () => (slot.profileId ? db.profiles.get(slot.profileId) : null),
    [slot.profileId],
  );

  const suggestions =
    useProfileSuggestions(viewerId, slot.query, otherProfileIds) ?? [];

  // Hide the "+ Create" row when the query is empty (nothing to create)
  // or when it matches an existing visible profile exactly — the user
  // should pick that one instead of making a duplicate.
  const trimmed = slot.query.trim();
  const exactMatch = suggestions.find(
    (s) => s.alias.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  const showCreateRow = isActive && trimmed.length > 0 && !exactMatch;
  const showSuggestions = isActive && (suggestions.length > 0 || showCreateRow);

  const displayValue =
    slot.profileId && pickedProfile ? pickedProfile.alias : slot.query;
  const initialChar =
    displayValue.trim().slice(0, 1).toUpperCase() || String(index + 1);

  return (
    <div className={styles.slot}>
      <label className={styles.label} htmlFor={`new-match-player-${index}`}>
        {t("matches.newMatch.playerLabel", { n: index + 1 })}
      </label>
      <div className={styles.row}>
        <div className={styles.fieldWrap}>
          <div className={styles.field}>
            {slot.profileId && pickedProfile ? (
              <Avatar profile={pickedProfile} viewerId={viewerId} size="sm" />
            ) : (
              <span
                className={`${styles.avatar} ${fallbackAvatarClass}`}
                aria-hidden
              >
                {initialChar}
              </span>
            )}
            <input
              id={`new-match-player-${index}`}
              type="text"
              name={`player-${index}`}
              data-testid={`new-match-player-${index}`}
              autoComplete="off"
              placeholder={t("matches.newMatch.playerPlaceholder")}
              value={displayValue}
              onFocus={onFocus}
              onBlur={(e) => {
                // Keep the picker open if focus moves into one of its
                // own buttons (suggestion or create row). Otherwise close.
                const next = e.relatedTarget;
                if (
                  next instanceof HTMLElement &&
                  next.dataset.suggestionFor === String(index)
                ) {
                  return;
                }
                onBlur();
              }}
              onChange={(e) => onChange(e.target.value)}
              className={styles.input}
            />
            <Icon name="pencil" size={16} />
          </div>
        </div>
        {canRemove && (
          <button
            type="button"
            // Same layout-shift guard as the add-player button above:
            // keep focus on the active input so the suggestions panel
            // doesn't collapse between mousedown and mouseup.
            onMouseDown={(e) => e.preventDefault()}
            onClick={onRemove}
            aria-label={t("matches.newMatch.removePlayer", { n: index + 1 })}
            data-testid={`new-match-remove-${index}`}
            className={styles.removeButton}
          >
            <Icon name="x" size={16} />
          </button>
        )}
      </div>
      {showSuggestions && (
        <div
          className={styles.suggestions}
          data-testid={`new-match-suggestions-${index}`}
        >
          {suggestions.map((s) => (
            <SuggestionChip
              key={s.id}
              index={index}
              suggestion={s}
              viewerId={viewerId}
              onPick={() => onPick(s.id, s.alias)}
            />
          ))}
          {showCreateRow && (
            <button
              type="button"
              data-suggestion-for={index}
              data-testid={`new-match-create-${index}`}
              className={styles.createChip}
              onMouseDown={(e) => {
                e.preventDefault();
              }}
              onClick={() => {
                const id = createId();
                void createProfile({ ownerId: viewerId, alias: trimmed, id });
                onPick(id, trimmed);
              }}
            >
              <Icon name="plus" size={12} />
              {t("matches.newMatch.createProfile", { alias: trimmed })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SuggestionChip({
  index,
  suggestion,
  viewerId,
  onPick,
}: {
  index: number;
  suggestion: ProfileSuggestion;
  viewerId: string;
  onPick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      data-suggestion-for={index}
      data-testid={`new-match-suggestion-${index}-${suggestion.alias}`}
      className={`${styles.suggestionChip} ${
        suggestion.isSelf ? styles.suggestionChipSelf : ""
      }`}
      onMouseDown={(e) => {
        e.preventDefault();
      }}
      onClick={onPick}
    >
      <Avatar
        profile={suggestion.profile}
        viewerId={viewerId}
        size="sm"
        className={styles.suggestionAvatar}
      />
      {suggestion.alias}
      {suggestion.isSelf && (
        <span className={styles.srOnly}>
          {" "}
          ({t("matches.newMatch.youSuffix")})
        </span>
      )}
    </button>
  );
}
