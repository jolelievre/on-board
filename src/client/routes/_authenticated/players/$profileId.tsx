import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { authClient } from "../../../lib/auth-client";
import { patchProfile } from "../../../lib/mutations";
import { useProfile, useProfileStats, useProfileRecentMatches } from "../../../hooks/data/useProfiles";
import type { LocalProfile3 } from "../../../lib/db";
import { Header } from "../../../components/layout/Header";
import { Avatar } from "../../../components/ui/Avatar";
import { Group } from "../../../components/ui/Group";
import { Input } from "../../../components/ui/Input";
import { Pill } from "../../../components/ui/Pill";
import { Icon } from "../../../components/ui/Icon";
import { displayProfileName } from "../../../../shared/players";
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
  profile: LocalProfile3;
  viewerId: string | null;
}) {
  const { t } = useTranslation();
  const isSelf = profile.linkedUserId === viewerId;
  const isLinked = profile.linkedUserId !== null;
  const isOwner = profile.ownerId === viewerId;
  const name = displayProfileName(profile, viewerId);

  const stats = useProfileStats(profile.id);
  const recent = useProfileRecentMatches(profile.id, 10);

  return (
    <>
      <Header back={{ to: "/players", label: t("nav.players") }} />
      <div className="px-5">
        <div className={styles.hero}>
          <Avatar profile={profile} viewerId={viewerId} size="lg" />
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
                />
                <Stat
                  value={stats.totalWins}
                  label={t("players.stats.wins")}
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
            <div className={styles.recentList}>
              {recent.map((m) => (
                <Link
                  key={m.matchId}
                  to="/matches/$id"
                  params={{ id: m.matchId }}
                  className={styles.recentRow}
                >
                  <div className={styles.recentMeta}>
                    <span className={styles.recentTitle}>{m.gameName}</span>
                    <span className={styles.recentSub}>
                      {new Date(m.startedAt).toLocaleDateString()}
                      {m.status === "IN_PROGRESS" &&
                        ` · ${t("matches.history.inProgress")}`}
                    </span>
                  </div>
                  {m.status === "COMPLETED" && m.isWinner === true && (
                    <Icon name="trophy" size={18} title={t("players.recent.win")} />
                  )}
                </Link>
              ))}
            </div>
          </Group>
        )}
      </div>
    </>
  );
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className={styles.statCard}>
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
