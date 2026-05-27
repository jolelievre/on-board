import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { authClient } from "../../../lib/auth-client";
import { useProfileList } from "../../../hooks/data/useProfiles";
import type { LocalProfile3 } from "../../../lib/db";
import { Header } from "../../../components/layout/Header";
import { Avatar } from "../../../components/ui/Avatar";
import { Pill } from "../../../components/ui/Pill";
import { Icon } from "../../../components/ui/Icon";
import { displayProfileName } from "../../../../shared/players";
import styles from "./index.module.css";

export const Route = createFileRoute("/_authenticated/players/")({
  component: PlayersPage,
});

function PlayersPage() {
  const { t } = useTranslation();
  const { data: session } = authClient.useSession();
  const viewerId = session?.user.id;
  const { data: profiles, status } = useProfileList(viewerId);

  return (
    <>
      <Header />
      <div className="px-5">
        <h1 className={styles.title}>{t("players.title")}</h1>
        <p className={styles.subtitle}>{t("players.subtitle")}</p>

        {status === "loading" && (
          <p className={styles.empty}>{t("common.loading")}</p>
        )}

        {profiles && profiles.length === 0 && (
          <p className={styles.empty}>{t("players.empty")}</p>
        )}

        {profiles && profiles.length > 0 && (
          <div className={styles.list} data-testid="players-list">
            {profiles.map((profile) => (
              <ProfileRow
                key={profile.id}
                profile={profile}
                viewerId={viewerId ?? null}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function ProfileRow({
  profile,
  viewerId,
}: {
  profile: LocalProfile3;
  viewerId: string | null;
}) {
  const { t } = useTranslation();
  // Self-Profile and profiles representing me are excluded upstream by
  // `useProfileList`. Every row here is a friend the viewer owns —
  // either unclaimed (no link yet) or claimed (linked to a real user).
  const isLinked = profile.linkedUserId !== null;
  const name = displayProfileName(profile, viewerId);

  return (
    <Link
      to="/players/$profileId"
      params={{ profileId: profile.id }}
      className={styles.row}
      data-testid="player-row"
      data-profile-id={profile.id}
    >
      <Avatar profile={profile} viewerId={viewerId} size="md" />
      <div className={styles.rowBody}>
        <p className={styles.alias}>{name}</p>
        <div className={styles.meta}>
          {isLinked ? (
            <Pill tone="success">{t("players.linked")}</Pill>
          ) : (
            <Pill tone="muted">{t("players.unclaimed")}</Pill>
          )}
        </div>
      </div>
      <span className={styles.chevron}>
        <Icon name="arrow-left" size={18} />
      </span>
    </Link>
  );
}
