import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { LanguageSelector } from "../components/LanguageSelector";
import styles from "./legal.module.css";

export const Route = createFileRoute("/terms")({
  component: TermsPage,
});

const LAST_UPDATED = "2026-06-01";

function TermsPage() {
  const { t, i18n } = useTranslation();
  const isFrench = i18n.language.startsWith("fr");

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Link to="/" className={styles.backLink}>
          ← {t("legal.back")}
        </Link>
      </div>

      <h1 className={styles.title}>{t("legal.terms.title")}</h1>
      <p className={styles.lastUpdated}>
        {t("legal.terms.lastUpdated")} {LAST_UPDATED}
      </p>

      <div className={styles.body}>
        {isFrench ? <TermsFr /> : <TermsEn />}
      </div>

      <div className={styles.bottom}>
        <LanguageSelector />
      </div>
    </div>
  );
}

function TermsEn() {
  return (
    <>
      <p>
        OnBoard is a small board-game score tracker. By signing in, you agree
        to these terms. The service is provided by Jonathan Lelièvre as a
        personal project, free of charge and "as is".
      </p>

      <h2>1. Acceptable use</h2>
      <ul>
        <li>Don't use the service to harass other users.</li>
        <li>
          Don't create fake profiles to misrepresent someone else's identity.
        </li>
        <li>Don't upload content that isn't yours to share.</li>
        <li>
          Don't attempt to disrupt the service, bypass authentication, or
          access another user's data.
        </li>
      </ul>

      <h2>2. Your content</h2>
      <p>
        Match data, profiles, and avatars you create remain yours. By using
        the service, you grant us permission to store and display this content
        to you and to the friends you link with via the in-app QR flow, and to
        anyone you choose to send a public match share-link to.
      </p>

      <h2>3. Account termination</h2>
      <p>
        You can delete your account at any time per the{" "}
        <Link to="/privacy">Privacy Policy</Link>. We may suspend or terminate
        accounts that violate these terms, at our discretion.
      </p>

      <h2>4. No warranty</h2>
      <p>
        The service is provided as-is, without warranty of any kind. We don't
        guarantee uptime, data persistence, or backwards compatibility across
        versions. You should not rely on OnBoard as a system of record for
        anything important.
      </p>

      <h2>5. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, Jonathan Lelièvre is not
        liable for any direct, indirect, or consequential damages arising
        from use of the service.
      </p>

      <h2>6. Changes to these terms</h2>
      <p>
        We may update these terms over time; the "last updated" date at the
        top reflects the most recent change. Continued use after a change
        constitutes acceptance.
      </p>

      <h2>7. Governing law</h2>
      <p>
        These terms are governed by the laws of France. Disputes are subject
        to the exclusive jurisdiction of the French courts.
      </p>

      <h2>8. Contact</h2>
      <p>
        Questions:{" "}
        <a href="mailto:jo.lelievre@gmail.com">jo.lelievre@gmail.com</a>.
      </p>
    </>
  );
}

function TermsFr() {
  return (
    <>
      <p>
        OnBoard est un petit suivi de scores de jeux de société. En vous
        connectant, vous acceptez ces conditions. Le service est fourni par
        Jonathan Lelièvre à titre personnel, gratuitement et « en l'état ».
      </p>

      <h2>1. Utilisation acceptable</h2>
      <ul>
        <li>Ne pas utiliser le service pour harceler d'autres utilisateurs.</li>
        <li>
          Ne pas créer de faux profils pour usurper l'identité d'une autre
          personne.
        </li>
        <li>Ne pas téléverser de contenu qui ne vous appartient pas.</li>
        <li>
          Ne pas tenter de perturber le service, de contourner
          l'authentification ou d'accéder aux données d'un autre utilisateur.
        </li>
      </ul>

      <h2>2. Votre contenu</h2>
      <p>
        Les données de partie, les profils et les avatars que vous créez
        restent les vôtres. En utilisant le service, vous nous accordez
        l'autorisation de stocker et d'afficher ce contenu pour vous, pour
        les amis que vous liez via le QR-code intégré à l'application, et pour
        toute personne à qui vous choisissez d'envoyer un lien de partage
        public.
      </p>

      <h2>3. Résiliation du compte</h2>
      <p>
        Vous pouvez supprimer votre compte à tout moment, conformément à la{" "}
        <Link to="/privacy">Politique de confidentialité</Link>. Nous pouvons
        suspendre ou résilier des comptes qui violent ces conditions, à notre
        seule discrétion.
      </p>

      <h2>4. Aucune garantie</h2>
      <p>
        Le service est fourni « en l'état », sans garantie d'aucune sorte.
        Nous ne garantissons ni la disponibilité, ni la persistance des
        données, ni la rétrocompatibilité entre versions. OnBoard ne doit pas
        être utilisé comme système de référence pour quoi que ce soit
        d'important.
      </p>

      <h2>5. Limitation de responsabilité</h2>
      <p>
        Dans toute la mesure permise par la loi, Jonathan Lelièvre n'est
        responsable d'aucun dommage direct, indirect ou consécutif découlant
        de l'utilisation du service.
      </p>

      <h2>6. Modifications de ces conditions</h2>
      <p>
        Ces conditions peuvent être mises à jour ; la date de « dernière mise à
        jour » figurant en haut reflète le dernier changement. Toute
        utilisation continue après une modification vaut acceptation.
      </p>

      <h2>7. Droit applicable</h2>
      <p>
        Ces conditions sont régies par le droit français. Les litiges sont
        soumis à la compétence exclusive des juridictions françaises.
      </p>

      <h2>8. Contact</h2>
      <p>
        Questions :{" "}
        <a href="mailto:jo.lelievre@gmail.com">jo.lelievre@gmail.com</a>.
      </p>
    </>
  );
}
