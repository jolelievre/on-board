import { useTranslation } from "react-i18next";
import { useTheme, type Theme } from "../../contexts/ThemeContext";
import { PillSwitch } from "./PillSwitch";

const THEME_LABEL_KEYS: Record<Theme, { key: string; fallback: string }> = {
  parchment: { key: "settings.theme.parchment", fallback: "Parchment" },
  candlelit: { key: "settings.theme.candlelit", fallback: "Candlelit" },
};

export function ThemeToggle() {
  const { t } = useTranslation();
  const { theme, setTheme, themes } = useTheme();

  const options = themes.map((value) => ({
    value,
    label: t(THEME_LABEL_KEYS[value].key, {
      defaultValue: THEME_LABEL_KEYS[value].fallback,
    }),
  }));

  return (
    <PillSwitch
      value={theme}
      options={options}
      onChange={setTheme}
      ariaLabel={t("settings.theme.title", { defaultValue: "Theme" })}
    />
  );
}
