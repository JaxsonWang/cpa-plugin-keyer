import type { UsageFilters, UsageRange } from "../types";
import { useT } from "../i18n";

interface UsageControlsProps {
  range: UsageRange;
  keyID: string;
  filters?: UsageFilters;
  disabled?: boolean;
  onRangeChange: (range: UsageRange) => void;
  onKeyChange: (keyID: string) => void;
  onRefresh: () => void;
  children?: React.ReactNode;
}

export default function UsageControls({
  range,
  keyID,
  filters,
  disabled,
  onRangeChange,
  onKeyChange,
  onRefresh,
  children,
}: UsageControlsProps) {
  const t = useT();
  return (
    <div className="usage-controls">
      <label>
        <span>{t("usage.range")}</span>
        <select
          aria-label={t("usage.range")}
          value={range}
          disabled={disabled}
          onChange={(event) => onRangeChange(event.target.value as UsageRange)}
        >
          <option value="24h">{t("usage.range24h")}</option>
          <option value="7d">{t("usage.range7d")}</option>
          <option value="30d">{t("usage.range30d")}</option>
          <option value="90d">{t("usage.range90d")}</option>
        </select>
      </label>
      <label>
        <span>{t("usage.key")}</span>
        <select
          aria-label={t("usage.key")}
          value={keyID}
          disabled={disabled}
          onChange={(event) => onKeyChange(event.target.value)}
        >
          <option value="">{t("usage.allKeys")}</option>
          {(filters?.key_ids ?? []).map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
      </label>
      {children}
      <button className="btn sm usage-refresh" type="button" disabled={disabled} onClick={onRefresh}>
        {t("usage.refresh")}
      </button>
    </div>
  );
}
