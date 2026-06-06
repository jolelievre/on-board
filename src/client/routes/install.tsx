import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { LanguageSelector } from "../components/LanguageSelector";
import { Icon } from "../components/ui/Icon";
import styles from "./install.module.css";

export const Route = createFileRoute("/install")({
  component: InstallPage,
});

type Platform = "ios" | "android";

function detectPlatform(): Platform | null {
  if (typeof window === "undefined") return null;
  const ua = window.navigator.userAgent;
  // iPad on iPadOS 13+ reports as MacIntel; check touch as a proxy.
  const isIpadOS =
    /Macintosh/.test(ua) && (window.navigator.maxTouchPoints ?? 0) > 1;
  if (/iPhone|iPad|iPod/.test(ua) || isIpadOS) return "ios";
  if (/Android/.test(ua)) return "android";
  return null;
}

const SCREENSHOTS = [
  { src: "/screenshots/01-games.png", key: "games" as const },
  { src: "/screenshots/02-scoring-7wd.png", key: "scoring7wd" as const },
  { src: "/screenshots/03-scoring-sk.png", key: "scoringSk" as const },
  { src: "/screenshots/04-players.png", key: "players" as const },
  { src: "/screenshots/05-profile.png", key: "profile" as const },
  { src: "/screenshots/06-studio.png", key: "studio" as const },
];

const FEATURES = ["scoring", "offline", "friends", "share"] as const;

function InstallPage() {
  const { t } = useTranslation();
  const initialPlatform = useMemo(detectPlatform, []);
  const [openIOS, setOpenIOS] = useState(initialPlatform !== "android");
  const [openAndroid, setOpenAndroid] = useState(initialPlatform !== "ios");

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Link to="/" className={styles.backLink}>
          ← {t("install.back")}
        </Link>
        <LanguageSelector />
      </div>

      <section className={styles.hero} data-testid="install-hero">
        <img
          src="/pwa-icon-192.png"
          alt=""
          width={88}
          height={88}
          className={styles.heroIcon}
        />
        <div className={styles.heroText}>
          <h1 className={styles.heroName}>{t("app.name")}</h1>
          <p className={styles.heroTagline}>{t("install.hero.tagline")}</p>
          <p className={styles.heroPitch}>{t("install.hero.pitch")}</p>
        </div>
      </section>

      <ul className={styles.features} data-testid="install-features">
        {FEATURES.map((key) => (
          <li key={key} className={styles.featureRow}>
            <Icon name="check" size={14} className={styles.featureIcon} />
            <span>{t(`install.features.${key}`)}</span>
          </li>
        ))}
      </ul>

      <section
        className={styles.screenshotStrip}
        data-testid="install-screenshots"
      >
        <h2 className={styles.sectionTitle}>{t("install.screenshotsTitle")}</h2>
        <div className={styles.screenshotScroller}>
          {SCREENSHOTS.map((shot) => (
            <figure key={shot.src} className={styles.screenshotFrame}>
              <img
                src={shot.src}
                alt={t(`install.screenshots.${shot.key}`)}
                className={styles.screenshotImg}
                // Lazy-load — the install page is the only place these
                // render in the app, and they're heavy.
                loading="lazy"
                decoding="async"
              />
              <figcaption className={styles.screenshotCaption}>
                {t(`install.screenshots.${shot.key}`)}
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <h2 className={styles.sectionTitle}>{t("install.stepsTitle")}</h2>
      <p className={styles.intro}>{t("install.intro")}</p>

      <PlatformSection
        platform="ios"
        open={openIOS}
        onToggle={() => setOpenIOS((v) => !v)}
        title={t("install.ios.title")}
      >
        <ol className={styles.steps}>
          <li>
            <Trans
              i18nKey="install.ios.step1"
              components={{ b: <strong /> }}
            />
          </li>
          <li>
            <Trans
              i18nKey="install.ios.step2"
              components={{ b: <strong /> }}
            />
          </li>
          <li>
            <Trans
              i18nKey="install.ios.step3"
              components={{ b: <strong /> }}
            />
          </li>
          <li>
            <Trans
              i18nKey="install.ios.step4"
              components={{ b: <strong /> }}
            />
          </li>
        </ol>
      </PlatformSection>

      <PlatformSection
        platform="android"
        open={openAndroid}
        onToggle={() => setOpenAndroid((v) => !v)}
        title={t("install.android.title")}
      >
        <ol className={styles.steps}>
          <li>
            <Trans
              i18nKey="install.android.step1"
              components={{ b: <strong /> }}
            />
          </li>
          <li>
            <Trans
              i18nKey="install.android.step2"
              components={{ b: <strong /> }}
            />
          </li>
          <li>
            <Trans
              i18nKey="install.android.step3"
              components={{ b: <strong /> }}
            />
          </li>
        </ol>
      </PlatformSection>

      <p className={styles.afterInstall}>
        <Trans i18nKey="install.afterInstall" components={{ b: <strong /> }} />
      </p>
    </div>
  );
}

function PlatformSection({
  platform,
  open,
  onToggle,
  title,
  children,
}: {
  platform: Platform;
  open: boolean;
  onToggle: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={styles.section}
      data-testid={`install-section-${platform}`}
      data-open={open ? "true" : "false"}
    >
      <button
        type="button"
        className={styles.sectionToggle}
        onClick={onToggle}
        aria-expanded={open}
        data-testid={`install-section-${platform}-toggle`}
      >
        <span className={styles.sectionHeading}>
          <span className={styles.platformGlyph} aria-hidden>
            <PlatformGlyph platform={platform} />
          </span>
          {title}
        </span>
        <Icon name={open ? "minus" : "plus"} size={16} />
      </button>
      {open && <div className={styles.sectionBody}>{children}</div>}
    </section>
  );
}

function PlatformGlyph({ platform }: { platform: Platform }) {
  // Inline neutral glyphs (no brand logos). Apple/Google trademark
  // guidelines forbid casual use of the bitten-apple / Play-Store icons,
  // so this stays as generic phone glyphs.
  if (platform === "ios") {
    return (
      <svg
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect
          x="5"
          y="1.75"
          width="10"
          height="16.5"
          rx="2"
          stroke="currentColor"
          strokeWidth="1.4"
        />
        <line
          x1="8.5"
          y1="15.75"
          x2="11.5"
          y2="15.75"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x="5"
        y="1.75"
        width="10"
        height="16.5"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <circle cx="10" cy="15.5" r="0.9" fill="currentColor" />
    </svg>
  );
}
