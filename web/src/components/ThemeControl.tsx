import { Desktop, Moon, Sun } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import {
  getThemePreference,
  setThemePreference,
  subscribeTheme,
  type ThemePreference,
} from "../store/themeSync";
import { useT } from "../i18n";

/** 表示单个主题选项的取值、图标和文案。 */
type ThemeOption = {
  /** value 是写入主题状态的偏好值。 */
  value: ThemePreference;
  /** icon 是当前主题对应的 Phosphor 图标。 */
  icon: typeof Desktop;
  /** label 是当前主题文案的 i18n key。 */
  label: string;
};

/** 表示主题控制组件的展示位置。 */
type ThemeControlProps = {
  /** floating 表示控件是否脱离导航并固定在页面角落。 */
  floating?: boolean;
};

// OPTIONS 保存自动、白天和黑夜三种主题偏好。
const OPTIONS: ThemeOption[] = [
  { value: "auto", icon: Desktop, label: "theme.auto" },
  { value: "light", icon: Sun, label: "theme.light" },
  { value: "dark", icon: Moon, label: "theme.dark" },
];

/**
 * 渲染独立页可用的主题切换控件。
 * @param floating 表示控件是否使用固定定位。
 * @returns 返回自动、白天和黑夜三个选项。
 */
export default function ThemeControl({ floating = false }: ThemeControlProps) {
  // t 负责读取当前语言的界面文案。
  const t = useT();
  // value 保存当前主题偏好；setValue 同步主题状态变化。
  const [value, setValue] = useState(getThemePreference());

  // 以下副作用订阅全局主题偏好变化；订阅回调读取最新值，返回值负责取消订阅。
  useEffect(() => subscribeTheme(() => setValue(getThemePreference())), []);

  return (
    <div className={`theme-control${floating ? " floating" : ""}`} role="group" aria-label={t("theme.label")}>
      {/* option 表示当前渲染的主题选项。 */}
      {OPTIONS.map((option) => {
        // Icon 是当前主题选项对应的图标组件。
        const Icon = option.icon;
        // label 是当前语言下的主题名称。
        const label = t(option.label);
        // handleSelect 将当前选项写入全局主题偏好。
        const handleSelect = () => setThemePreference(option.value);
        return (
          <button
            key={option.value}
            type="button"
            className={value === option.value ? "active" : ""}
            aria-label={label}
            aria-pressed={value === option.value}
            title={label}
            onClick={handleSelect}
          >
            <Icon size={15} weight={value === option.value ? "fill" : "regular"} aria-hidden />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
