import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { authClient } from "../../../lib/auth-client";
import { patchProfile, unlinkProfile } from "../../../lib/mutations";
import {
  useProfile,
  useProfileList,
  useProfileStats,
  useProfileRecentMatches,
  useHeadToHead,
} from "../../../hooks/data/useProfiles";
import type { LocalProfile } from "../../../lib/db";
import { Header } from "../../../components/layout/Header";
import { Group } from "../../../components/ui/Group";
import { Input } from "../../../components/ui/Input";
import { Pill } from "../../../components/ui/Pill";
import { Icon } from "../../../components/ui/Icon";
import { Button } from "../../../components/ui/Button";
import { EditableAvatar } from "../../../components/profiles/EditableAvatar";
import { MergeDialog } from "../../../components/profiles/MergeDialog";
import { LinkScanner } from "../../../components/profiles/LinkScanner";
import { LinkCodeDisplay } from "../../../components/profiles/LinkCodeDisplay";
import { MatchHistoryRow } from "../../../components/matches/MatchHistoryRow";
import { displayProfileName } from "../../../../shared/players";
import { useOwnedProfileIndex } from "../../../hooks/data/useOwnedProfileIndex";
import styles from "./$profileId.module.css";

export const Route = createFileRoute("/_authenticated/players/$profileId")({
  component: ProfileDetailPage,
});

function ProfileDetailPage() {
  const { profileId } = Route.useParams();
  const { t } = useTranslation();
  const { data: session } = authClient.useSession();
  const viewerId = session?.user.id ?? null;

  const { data: profile, status } = useProfile(profileId);

  if (status === "loading") {
    return (
      <>
        <Header back={{ to: "/players", label: t("nav.players") }} />
        <div className="px-5">
          <p className={styles.notFound}>{t("common.loading")}</p>
        </div>
      </>
    );
  }

  if (!profile) {
    return (
      <>
        <Header back={{ to: "/players", label: t("nav.players") }} />
        <div className="px-5">
          <p className={styles.notFound}>{t("players.notFound")}</p>
        </div>
      </>
    );
  }

  return (
    <ProfileDetailBody profile={profile} viewerId={viewerId} />
  );
}

function ProfileDetailBody({
  profile,
  viewerId,
}: {
  profile: LocalProfile;
  viewerId: string | null;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  // Owner-only page: every profile in the Players tab is one the
  // viewer owns. Direct URL navigation to a profile we don't own (or
  // the self-Profile, which is edited via Settings) sends the user
  // back to the listing. Belt-and-braces guard — the same constraint
  // is enforced server-side on every mutation.
  useEffect(() => {
    if (!viewerId) return;
    if (profile.ownerId !== viewerId) {
      navigate({ to: "/players", replace: true });
      return;
    }
    if (profile.linkedUserId === viewerId) {
      navigate({ to: "/settings", replace: true });
    }
  }, [profile.ownerId, profile.linkedUserId, viewerId, navigate]);

  // Effectively always false after the redirect above lands, but kept
  // for the brief pre-redirect render so isSelf-conditional UI doesn't
  // flash incorrect badges.
  const isSelf =
    profile.linkedUserId === viewerId && profile.ownerId === viewerId;
  const isLinked = profile.linkedUserId !== null;
  const isOwner = profile.ownerId === viewerId;
  const ownedIndex = useOwnedProfileIndex(viewerId ?? undefined);
  const name = displayProfileName(profile, ownedIndex);
  const [mergeOpen, setMergeOpen] = useState(false);

  const stats = useProfileStats(profile.id);
  const recent = useProfileRecentMatches(profile.id, 10);

  // Self-Profile id powers the head-to-head panel: only meaningful when
  // the subject is someone else AND the viewer has a self-Profile in
  // their local mirror. We pull from the visible-profiles list because
  // it's already memoised in the page tree above.
  const { data: visibleProfiles } = useProfileList(viewerId ?? undefined);
  const selfProfileId = visibleProfiles?.find(
    (p) => p.linkedUserId === viewerId && p.ownerId === viewerId,
  )?.id;
  const headToHead = useHeadToHead(
    isSelf ? undefined : profile.id,
    isSelf ? undefined : selfProfileId,
  );

  return (
    <>
      <Header back={{ to: "/players", label: t("nav.players") }} />
      <div className="px-5">
        <div className={styles.hero}>
          {viewerId && (
            <EditableAvatar
              profile={profile}
              viewerId={viewerId}
              size="xl"
              canEdit={isOwner}
            />
          )}
          <h1 className={styles.title}>{name}</h1>
          <div className={styles.heroBadges}>
            {isSelf ? (
              <Pill tone="primary">{t("players.you")}</Pill>
            ) : isLinked ? (
              <Pill tone="success">{t("players.linked")}</Pill>
            ) : (
              <Pill tone="muted">{t("players.unclaimed")}</Pill>
            )}
          </div>
        </div>

        {isOwner && (
          <Group title={t("players.alias.title")}>
            <AliasEditor profileId={profile.id} initialValue={profile.alias} />
          </Group>
        )}

        <LinkSection
          profile={profile}
          viewerId={viewerId}
          isOwner={isOwner}
          isSelf={isSelf}
          isLinked={isLinked}
          onMergedTo={(survivorId) =>
            void navigate({
              to: "/players/$profileId",
              params: { profileId: survivorId },
            })
          }
        />

        {!isSelf && headToHead && headToHead.matches > 0 && (
          <Group title={t("players.headToHead.title")}>
            <div className={styles.statsGrid}>
              <Stat
                value={headToHead.matches}
                label={t("players.stats.matches")}
              />
              <Stat
                value={headToHead.viewerWins}
                label={t("players.headToHead.yourWins")}
              />
              <Stat
                value={headToHead.subjectWins}
                label={t("players.headToHead.theirWins")}
              />
            </div>
            {headToHead.draws > 0 && (
              <p className={styles.headToHeadDraws}>
                {t("players.headToHead.draws", {
                  count: headToHead.draws,
                })}
              </p>
            )}
          </Group>
        )}

        <Group title={t("players.stats.title")}>
          {stats === undefined ? (
            <p className={styles.empty}>{t("common.loading")}</p>
          ) : stats.totalMatches === 0 ? (
            <p className={styles.empty}>{t("players.stats.empty")}</p>
          ) : (
            <>
              <div className={styles.statsGrid}>
                <Stat
                  value={stats.totalMatches}
                  label={t("players.stats.matches")}
                  testid="profile-stats-matches"
                />
                <Stat
                  value={stats.totalWins}
                  label={t("players.stats.wins")}
                  testid="profile-stats-wins"
                />
                <Stat
                  value={
                    stats.totalCompleted > 0
                      ? `${Math.round(
                          (stats.totalWins / stats.totalCompleted) * 100,
                        )}%`
                      : "—"
                  }
                  label={t("players.stats.winRate")}
                />
              </div>
              {stats.perGame.length > 0 && (
                <div style={{ marginTop: "0.75rem" }}>
                  {stats.perGame.map((g) => (
                    <div key={g.gameId} className={styles.perGameRow}>
                      <span className={styles.perGameName}>{g.gameName}</span>
                      <span className={styles.perGameStats}>
                        {t("players.stats.matchesShort", { count: g.matches })}
                        {g.wins > 0 &&
                          ` · ${g.wins}${t("players.stats.winShort")}`}
                        {g.losses > 0 &&
                          ` · ${g.losses}${t("players.stats.lossShort")}`}
                        {g.draws > 0 &&
                          ` · ${g.draws}${t("players.stats.drawShort")}`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </Group>

        {recent && recent.length > 0 && (
          <Group title={t("players.recent.title")}>
            <div
              className={styles.recentList}
              data-testid="profile-recent-list"
            >
              {recent.map((r) => (
                <div
                  key={r.match.id}
                  data-testid="profile-recent-match"
                >
                  <MatchHistoryRow
                    match={r.match}
                    gameSlug={r.gameSlug}
                    gameName={r.gameName}
                    locale={i18n.language}
                    // Phase 7 (revised): the me-highlight (teal edge
                    // tab + Highlighter swipe + accent avatar ring)
                    // ships in both surfaces — the design rule that
                    // suppressed it on profile detail was overruled
                    // during the feedback round in favour of a
                    // consistent visual language across surfaces.
                    viewerId={viewerId}
                  />
                </div>
              ))}
            </div>
          </Group>
        )}

        {isOwner && !isSelf && !isLinked && (
          <div className={styles.mergeActionRow}>
            <Button
              type="button"
              variant="ghost"
              iconBefore={<Icon name="merge" size={16} />}
              onClick={() => setMergeOpen(true)}
              data-testid="profile-merge-action"
            >
              {t("merge.title")}
            </Button>
          </div>
        )}
      </div>

      {mergeOpen && viewerId && (
        <MergeDialog
          source={profile}
          viewerId={viewerId}
          onClose={() => setMergeOpen(false)}
          onMerged={(targetId) => {
            setMergeOpen(false);
            void navigate({
              to: "/players/$profileId",
              params: { profileId: targetId },
            });
          }}
        />
      )}
    </>
  );
}

function LinkSection({
  profile,
  viewerId,
  isOwner,
  isSelf,
  isLinked,
  onMergedTo,
}: {
  profile: LocalProfile;
  viewerId: string | null;
  isOwner: boolean;
  isSelf: boolean;
  isLinked: boolean;
  onMergedTo: (survivorId: string) => void;
}) {
  const { t } = useTranslation();
  const [panel, setPanel] = useState<"none" | "show" | "scan">("none");
  const [unlinkConfirmOpen, setUnlinkConfirmOpen] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);

  // Self-profile carries no link UI under the new bilateral model —
  // the QR is anchored to a profile representing the *other* person.
  // The user gets to Show/Scan from their owned friend profiles
  // instead. Skipping the render entirely keeps the surface focused
  // on identity + alias editing.
  if (isSelf) return null;

  // Friend-profile path:
  //  - Unclaimed + viewer owns it → two-button row (Show QR / Scan QR).
  //  - Linked + viewer owns or is the linked friend → linked card +
  //    Unlink with confirm modal.
  if (!isOwner && profile.linkedUserId !== viewerId) return null;

  const closePanel = () => setPanel("none");

  // Keep the open panel sticky across the link transition. Without
  // this, the moment the bilateral link writes to Dexie and
  // `useProfile` re-fires, `isLinked` flips true and the linked-card
  // branch below swaps the scanner/QR-display out — the celebration
  // overlay never gets seen. The panel only closes when its child
  // signals success via `onDone`/`onLinked` → `closePanel()`.
  if (panel === "scan" && isOwner) {
    return (
      <Group title={t("link.unclaimedTitle")}>
        <LinkScanner
          profile={profile}
          onDone={closePanel}
          onMerged={(survivorId) => {
            closePanel();
            onMergedTo(survivorId);
          }}
        />
      </Group>
    );
  }
  if (panel === "show" && isOwner) {
    return (
      <Group title={t("link.unclaimedTitle")}>
        <LinkCodeDisplay profile={profile} onLinked={closePanel} />
        <div className={styles.linkActions}>
          <Button type="button" variant="ghost" onClick={closePanel}>
            {t("common.cancel")}
          </Button>
        </div>
      </Group>
    );
  }

  const handleUnlink = async () => {
    setUnlinkError(null);
    setUnlinking(true);
    try {
      await unlinkProfile({
        profileId: profile.id,
        // The linked friend (not the owner) loses visibility on
        // success — the mutation deletes the local mirror so the
        // Players list updates without waiting for a full re-pull.
        asLinkedUser: !isOwner && profile.linkedUserId === viewerId,
      });
      setUnlinkConfirmOpen(false);
    } catch (err) {
      setUnlinkError(
        err instanceof Error ? err.message : t("link.unlinkError"),
      );
    } finally {
      setUnlinking(false);
    }
  };

  if (isLinked) {
    const linked = profile.linkedUser;
    const friendDisplay =
      linked?.alias || linked?.name || profile.alias || t("link.linkedUnknown");
    return (
      <>
        <Group title={t("link.linkedTitle")}>
          <div className={styles.linkedCard}>
            {linked?.avatarUrl ? (
              <img
                src={linked.avatarUrl}
                alt=""
                className={styles.linkedAvatar}
              />
            ) : (
              <span className={styles.linkedAvatarFallback}>
                {(linked?.alias || linked?.name || "·")
                  .slice(0, 1)
                  .toUpperCase()}
              </span>
            )}
            <div className={styles.linkedMeta}>
              <span className={styles.linkedName}>
                {linked?.alias || linked?.name || t("link.linkedUnknown")}
              </span>
              {linked?.email && (
                <span className={styles.linkedEmail}>{linked.email}</span>
              )}
            </div>
          </div>
          {unlinkError && <p className={styles.linkError}>{unlinkError}</p>}
          <div className={styles.linkActions}>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setUnlinkError(null);
                setUnlinkConfirmOpen(true);
              }}
              data-testid="profile-unlink"
            >
              {t("link.unlink")}
            </Button>
          </div>
        </Group>
        {unlinkConfirmOpen && (
          <UnlinkConfirmDialog
            friendName={friendDisplay}
            error={unlinkError}
            submitting={unlinking}
            onCancel={() => setUnlinkConfirmOpen(false)}
            onConfirm={() => void handleUnlink()}
          />
        )}
      </>
    );
  }

  // Unclaimed + owner: two-button row + explainer.
  return (
    <Group title={t("link.unclaimedTitle")}>
      <p className={styles.linkHint}>{t("link.unclaimedExplainer")}</p>
      <div className={styles.linkButtonRow}>
        <Button
          type="button"
          variant="secondary"
          iconBefore={<Icon name="camera" size={16} />}
          onClick={() => setPanel("scan")}
          data-testid="profile-link-scan"
        >
          {t("link.scanCta")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          iconBefore={<Icon name="link" size={16} />}
          onClick={() => setPanel("show")}
          data-testid="profile-link-show"
        >
          {t("link.showCta")}
        </Button>
      </div>
    </Group>
  );
}

function UnlinkConfirmDialog({
  friendName,
  error,
  submitting,
  onCancel,
  onConfirm,
}: {
  friendName: string;
  error: string | null;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  return (
    <div
      className={styles.unlinkBackdrop}
      role="dialog"
      aria-modal="true"
      data-testid="unlink-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className={styles.unlinkSheet}>
        <h2 className={styles.unlinkTitle}>{t("link.unlinkConfirm.title")}</h2>
        <p className={styles.unlinkBody}>
          {t("link.unlinkConfirm.body", { friend: friendName })}
        </p>
        {error && <p className={styles.linkError}>{error}</p>}
        <div className={styles.unlinkActions}>
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={submitting}
            data-testid="unlink-cancel"
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={submitting}
            data-testid="unlink-confirm"
          >
            {submitting ? t("link.unlinking") : t("link.unlink")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Stat({
  value,
  label,
  testid,
}: {
  value: number | string;
  label: string;
  testid?: string;
}) {
  return (
    <div className={styles.statCard} data-testid={testid}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

function AliasEditor({
  profileId,
  initialValue,
}: {
  profileId: string;
  initialValue: string;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue);
  const [persisted, setPersisted] = useState(initialValue);
  const [showSaved, setShowSaved] = useState(false);

  // Keep local input in sync with reactive Dexie updates (e.g. when
  // pullSync brings down a server-side change made on another device).
  useEffect(() => {
    setValue(initialValue);
    setPersisted(initialValue);
  }, [initialValue]);

  const commit = () => {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      setValue(persisted);
      return;
    }
    if (trimmed === persisted) return;
    setPersisted(trimmed);
    setValue(trimmed);
    void patchProfile({ profileId, alias: trimmed }).then(() => {
      setShowSaved(true);
      window.setTimeout(() => setShowSaved(false), 1500);
    });
  };

  return (
    <div className={styles.aliasRow}>
      <Input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder={t("players.alias.placeholder")}
        data-testid="profile-alias-input"
      />
      <span
        className={`${styles.savedBadge} ${
          showSaved ? styles.savedBadgeVisible : ""
        }`}
        aria-live="polite"
        data-testid="profile-alias-saved"
      >
        <Icon name="check" size={14} />
        <span>{t("players.alias.saved")}</span>
      </span>
    </div>
  );
}
