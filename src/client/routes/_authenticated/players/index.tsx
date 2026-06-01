import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRequiredViewerId } from "../../../hooks/useRequiredViewerId";
import { useProfileList } from "../../../hooks/data/useProfiles";
import { createProfile } from "../../../lib/mutations";
import type { LocalProfile } from "../../../lib/db";
import { Header } from "../../../components/layout/Header";
import { Avatar } from "../../../components/ui/Avatar";
import { Button } from "../../../components/ui/Button";
import { Input } from "../../../components/ui/Input";
import { Pill } from "../../../components/ui/Pill";
import { Icon } from "../../../components/ui/Icon";
import { displayProfileName } from "../../../../shared/players";
import { useOwnedProfileIndex } from "../../../hooks/data/useOwnedProfileIndex";
import styles from "./index.module.css";

export const Route = createFileRoute("/_authenticated/players/")({
  component: PlayersPage,
});

function PlayersPage() {
  const { t } = useTranslation();
  const viewerId = useRequiredViewerId();
  const { data: profiles, status } = useProfileList(viewerId);

  return (
    <>
      <Header />
      <div className="px-5">
        <div className={styles.titleRow}>
          <div>
            <h1 className={styles.title}>{t("players.title")}</h1>
            <p className={styles.subtitle}>{t("players.subtitle")}</p>
          </div>
          <AddProfileTrigger viewerId={viewerId} />
        </div>

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
                viewerId={viewerId}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/**
 * "+ Add profile" entry point. Opens an inline form for a friend's
 * alias, creates an unclaimed Profile owned by the viewer, and jumps
 * straight to the new profile's detail page so the user can immediately
 * scan a friend's link code without having to start a match first.
 */
function AddProfileTrigger({ viewerId }: { viewerId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [alias, setAlias] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const trimmed = alias.trim();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      const { profileId } = await createProfile({
        ownerId: viewerId,
        alias: trimmed,
      });
      setAlias("");
      setOpen(false);
      void navigate({
        to: "/players/$profileId",
        params: { profileId },
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        iconBefore={<Icon name="plus" size={14} />}
        onClick={() => setOpen(true)}
        data-testid="players-add-profile"
      >
        {t("players.addProfile")}
      </Button>
    );
  }

  return (
    <form
      className={styles.addProfileForm}
      onSubmit={(e) => void handleSubmit(e)}
      data-testid="players-add-profile-form"
    >
      <Input
        type="text"
        autoFocus
        value={alias}
        onChange={(e) => setAlias(e.target.value)}
        placeholder={t("players.addProfileForm.placeholder")}
        data-testid="players-add-profile-input"
        disabled={submitting}
      />
      <div className={styles.addProfileActions}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setAlias("");
            setOpen(false);
          }}
          disabled={submitting}
        >
          {t("common.cancel")}
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={!trimmed || submitting}
          data-testid="players-add-profile-submit"
        >
          {t("players.addProfileForm.submit")}
        </Button>
      </div>
    </form>
  );
}

function ProfileRow({
  profile,
  viewerId,
}: {
  profile: LocalProfile;
  viewerId: string;
}) {
  const { t } = useTranslation();
  // Self-Profile and profiles representing me are excluded upstream by
  // `useProfileList`. Every row here is a friend the viewer owns —
  // either unclaimed (no link yet) or claimed (linked to a real user).
  const isLinked = profile.linkedUserId !== null;
  const ownedIndex = useOwnedProfileIndex(viewerId);
  const name = displayProfileName(profile, ownedIndex);

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
