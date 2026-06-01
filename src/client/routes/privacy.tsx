import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { LanguageSelector } from "../components/LanguageSelector";
import styles from "./legal.module.css";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
});

const LAST_UPDATED = "2026-06-01";

function PrivacyPage() {
  const { t, i18n } = useTranslation();
  const isFrench = i18n.language.startsWith("fr");

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Link to="/" className={styles.backLink}>
          ← {t("legal.back")}
        </Link>
      </div>

      <h1 className={styles.title}>{t("legal.privacy.title")}</h1>
      <p className={styles.lastUpdated}>
        {t("legal.privacy.lastUpdated")} {LAST_UPDATED}
      </p>

      <div className={styles.body}>
        {isFrench ? <PrivacyFr /> : <PrivacyEn />}
      </div>

      <div className={styles.bottom}>
        <LanguageSelector />
      </div>
    </div>
  );
}

function PrivacyEn() {
  return (
    <>
      <p>
        OnBoard is a small board-game score tracker shared with friends. This
        page describes what data it collects and how it's used. The service is
        operated as a personal project, not by a company.
      </p>

      <h2>1. Data we collect</h2>
      <ul>
        <li>
          <strong>Account data</strong> — when you sign in with Google,
          Facebook, or Apple, we receive your email address, display name, and
          profile photo URL from the chosen provider. We do not receive your
          password.
        </li>
        <li>
          <strong>Match data</strong> — the games you play, the players in each
          match, scores, and timestamps. Friend profiles you create live under
          your account.
        </li>
        <li>
          <strong>Uploaded avatars</strong> — if you replace the default avatar
          with a custom photo, the photo is stored on our server.
        </li>
        <li>
          <strong>Preferences</strong> — your chosen language and theme.
        </li>
      </ul>

      <h2>2. How we use it</h2>
      <p>
        We use this data only to provide the service: identify you across
        devices, render your matches and friends, and let you share read-only
        match links with people outside the app.
      </p>

      <h2>3. Storage</h2>
      <p>
        All data is stored on a private server. Uploaded avatars live on the
        same server's filesystem. We do not use third-party analytics,
        tracking pixels, or advertising networks.
      </p>

      <h2>4. Third parties</h2>
      <p>
        We share data with the OAuth provider you signed in with (Google,
        Facebook, or Apple) so the sign-in flow can complete. Those providers
        operate under their own privacy policies. We do not sell or share data
        with anyone else.
      </p>

      <h2>5. Cookies and sessions</h2>
      <p>
        We use a session cookie to keep you signed in. We do not use cookies
        for tracking or advertising.
      </p>

      <h2>6. Your rights</h2>
      <p>
        You can request deletion of your account and all related data at any
        time by contacting the service owner through the channel by which you
        received access to this app. Account deletion removes your User row,
        all profiles you own, all matches you created, and all avatars you
        uploaded.
      </p>

      <h2>7. Contact</h2>
      <p>
        Questions about this policy can be sent through the same channel by
        which you received access to this app.
      </p>
    </>
  );
}

function PrivacyFr() {
  return (
    <>
      <p>
        OnBoard est un petit suivi de scores de jeux de société partagé entre
        amis. Cette page décrit les données collectées et leur utilisation. Le
        service est exploité à titre personnel, et non par une entreprise.
      </p>

      <h2>1. Données collectées</h2>
      <ul>
        <li>
          <strong>Données de compte</strong> — lorsque vous vous connectez via
          Google, Facebook ou Apple, nous recevons votre adresse e-mail, votre
          nom affiché et l'URL de votre photo de profil. Nous ne recevons pas
          votre mot de passe.
        </li>
        <li>
          <strong>Données de partie</strong> — les jeux joués, les joueurs de
          chaque partie, les scores et les horodatages. Les profils d'amis
          que vous créez sont rattachés à votre compte.
        </li>
        <li>
          <strong>Avatars téléchargés</strong> — si vous remplacez l'avatar
          par défaut par une photo personnalisée, celle-ci est stockée sur
          notre serveur.
        </li>
        <li>
          <strong>Préférences</strong> — votre langue et votre thème.
        </li>
      </ul>

      <h2>2. Utilisation</h2>
      <p>
        Nous utilisons ces données uniquement pour fournir le service :
        vous identifier entre vos appareils, afficher vos parties et vos
        amis, et vous permettre de partager des liens de partie en lecture
        seule avec des personnes extérieures à l'application.
      </p>

      <h2>3. Stockage</h2>
      <p>
        Toutes les données sont stockées sur un serveur privé. Les avatars
        téléchargés sont stockés sur le système de fichiers du même serveur.
        Nous n'utilisons ni outils d'analyse tiers, ni pixels de suivi, ni
        régies publicitaires.
      </p>

      <h2>4. Tiers</h2>
      <p>
        Nous partageons des données avec le fournisseur OAuth utilisé pour
        votre connexion (Google, Facebook ou Apple) afin de compléter le flux
        d'authentification. Ces fournisseurs ont leurs propres politiques de
        confidentialité. Nous ne vendons ni ne partageons vos données avec
        d'autres tiers.
      </p>

      <h2>5. Cookies et sessions</h2>
      <p>
        Nous utilisons un cookie de session pour vous maintenir connecté(e).
        Nous n'utilisons pas de cookies à des fins de suivi ou de publicité.
      </p>

      <h2>6. Vos droits</h2>
      <p>
        Vous pouvez demander la suppression de votre compte et de toutes les
        données associées à tout moment en contactant la personne qui gère le
        service par le canal via lequel vous avez reçu l'accès à cette
        application. La suppression du compte efface votre ligne utilisateur,
        tous les profils que vous possédez, toutes les parties que vous avez
        créées ainsi que tous les avatars que vous avez téléchargés.
      </p>

      <h2>7. Contact</h2>
      <p>
        Toute question sur cette politique peut être envoyée par le même
        canal via lequel vous avez reçu l'accès à cette application.
      </p>
    </>
  );
}
