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

      <h1 className={styles.title}>{t("install.title")}</h1>
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
