import { useTranslation } from "react-i18next";
import { updateProfile } from "../lib/auth-client";
import { PillSwitch } from "./ui/PillSwitch";

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
] as const;

type LangCode = (typeof LANGUAGES)[number]["value"];

export function LanguageSelector() {
  const { i18n, t } = useTranslation();
  const current = (LANGUAGES.find((l) => l.value === i18n.language)?.value
    ?? "en") as LangCode;

  const changeLanguage = (code: LangCode) => {
    void i18n.changeLanguage(code);
    void updateProfile({ locale: code }).catch(() => {
      /* unauthenticated / offline — local change still applies */
    });
  };

  return (
    <PillSwitch
      value={current}
      options={LANGUAGES}
      onChange={changeLanguage}
      ariaLabel={t("settings.language")}
    />
  );
}
