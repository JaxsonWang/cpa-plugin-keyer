import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  deleteKey,
  listKeys,
  resetAllUsage,
  resetKeyLimits,
  resetRPM,
  rotateKey,
  setKeyEnabled,
} from "../api/keys";
import { listSubscriptionPlans, setKeySubscriptionPlan } from "../api/subscriptionPlans";
import type { KeyPublic, SubscriptionPlan } from "../types";
import PlainKeyModal from "../components/PlainKeyModal";
import ConfirmDialog from "../components/ConfirmDialog";
import { useT } from "../i18n";
import { formatUSD } from "../utils/usageFormat";
import { APP_VERSION } from "../version";

function errorMessage(error: unknown, fallback: string): string {
  const typed = error as {
    response?: { data?: { error?: { message?: string } } };
    message?: string;
  };
  return typed.response?.data?.error?.message ?? typed.message ?? fallback;
}

function replaceKey(keys: KeyPublic[], updated: KeyPublic): KeyPublic[] {
  return keys.map((key) => (key.id === updated.id ? updated : key));
}

/**
 * 判断 Key 绑定的订阅计划是否已经到期。
 * @param key 表示需要检查的 Key。
 * @returns 返回计划是否存在有效到期时间且已经过期。
 */
function subscriptionExpired(key: KeyPublic): boolean {
  if (!key.subscription_expires_at) return false;
  // expiresAt 是计划到期时间对应的毫秒时间戳。
  const expiresAt = new Date(key.subscription_expires_at).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

export default function KeyList() {
  const t = useT();
  const [keys, setKeys] = useState<KeyPublic[]>([]);
  // plans 保存 Key 列表可绑定的全部订阅计划；setPlans 更新计划列表。
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [selectedIDs, setSelectedIDs] = useState<Set<string>>(new Set());
  const [updatingIDs, setUpdatingIDs] = useState<Set<string>>(new Set());
  const [resettingUsage, setResettingUsage] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [plain, setPlain] = useState<string | null>(null);
  const [plainTitle, setPlainTitle] = useState<string>("");
  const [pendingAction, setPendingAction] = useState<
    { type: "rotate" | "delete" | "resetUsage" | "resetLimits" | "batchResetLimits"; id?: string; ids?: string[] } | null
  >(null);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // nextKeys 保存最新 Key；nextPlans 保存最新订阅计划。
      const [nextKeys, nextPlans] = await Promise.all([listKeys(), listSubscriptionPlans()]);
      const liveIDs = new Set(nextKeys.map((key) => key.id));
      setKeys(nextKeys);
      setPlans(nextPlans);
      setSelectedIDs((current) => new Set([...current].filter((id) => liveIDs.has(id))));
    } catch (error) {
      setError(errorMessage(error, t("keys.loadFailed")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const rotate = async (id: string) => {
    try {
      const result = await rotateKey(id);
      setPlain(result.plain_key);
      setPlainTitle(t("keys.rotated"));
      void load();
    } catch (error) {
      setError(errorMessage(error, t("keys.rotateFailed")));
    }
  };

  const onReset = async (id: string) => {
    try {
      await resetRPM(id);
      void load();
    } catch (error) {
      setError(errorMessage(error, t("keys.resetFailed")));
    }
  };

  const resetUsage = async () => {
    setResettingUsage(true);
    setError("");
    try {
      await resetAllUsage();
      await load();
    } catch (error) {
      setError(errorMessage(error, t("keys.resetUsageFailed")));
    } finally {
      setResettingUsage(false);
    }
  };

  const onResetLimits = async (ids: string[], batch: boolean) => {
    if (ids.length === 0) return;

    setError("");
    setUpdatingIDs((current) => new Set([...current, ...ids]));
    const results = await Promise.allSettled(ids.map((id) => resetKeyLimits(id)));
    const updatedByID = new Map<string, KeyPublic>();
    const failedIDs: string[] = [];
    let firstFailure: unknown;

    results.forEach((result, index) => {
      const id = ids[index];
      if (result.status === "fulfilled") updatedByID.set(id, result.value);
      else {
        failedIDs.push(id);
        firstFailure ??= result.reason;
      }
    });

    setKeys((current) => current.map((key) => updatedByID.get(key.id) ?? key));
    if (batch) setSelectedIDs(new Set(failedIDs));
    setUpdatingIDs((current) => {
      const next = new Set(current);
      ids.forEach((id) => next.delete(id));
      return next;
    });

    if (failedIDs.length > 0) {
      setError(batch
        ? t("keys.batchResetLimitsFailed", { count: failedIDs.length })
        : `${failedIDs[0]}: ${errorMessage(firstFailure, t("keys.resetLimitsFailed"))}`);
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteKey(id);
      setSelectedIDs((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      void load();
    } catch (error) {
      setError(errorMessage(error, t("keys.deleteFailed")));
    }
  };

  const confirmPendingAction = async () => {
    if (!pendingAction) return;
    setConfirming(true);
    try {
      if (pendingAction.type === "rotate" && pendingAction.id) await rotate(pendingAction.id);
      if (pendingAction.type === "delete" && pendingAction.id) await remove(pendingAction.id);
      if (pendingAction.type === "resetUsage") await resetUsage();
      if (pendingAction.type === "resetLimits" && pendingAction.id) {
        await onResetLimits([pendingAction.id], false);
      }
      if (pendingAction.type === "batchResetLimits") {
        await onResetLimits(pendingAction.ids ?? [], true);
      }
      setPendingAction(null);
    } finally {
      setConfirming(false);
    }
  };

  const confirmMessage = pendingAction?.type === "rotate"
    ? t("keys.rotateConfirm", { id: pendingAction.id ?? "" })
    : pendingAction?.type === "delete"
      ? t("keys.deleteConfirm", { id: pendingAction.id ?? "" })
      : pendingAction?.type === "resetLimits"
        ? t("keys.resetLimitsConfirm", { id: pendingAction.id ?? "" })
        : pendingAction?.type === "batchResetLimits"
          ? t("keys.batchResetLimitsConfirm", { count: pendingAction.ids?.length ?? 0 })
          : t("keys.resetUsageConfirm");

  const confirmLabel = pendingAction?.type === "rotate"
    ? t("keys.rotate")
    : pendingAction?.type === "delete"
      ? t("keys.delete")
      : pendingAction?.type === "resetLimits"
        ? t("keys.resetLimits")
        : pendingAction?.type === "batchResetLimits"
          ? t("keys.batchResetLimits")
          : t("keys.resetUsage");

  const onSetEnabled = async (id: string, enabled: boolean) => {
    setError("");
    setUpdatingIDs((current) => new Set(current).add(id));
    try {
      const updated = await setKeyEnabled(id, enabled);
      setKeys((current) => replaceKey(current, updated));
    } catch (error) {
      setError(`${id}: ${errorMessage(error, t("keys.statusUpdateFailed"))}`);
    } finally {
      setUpdatingIDs((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };

  /**
   * 从 Key 列表修改一个 Key 的订阅计划并更新当前行。
   * @param id 表示待修改的 Key ID。
   * @param planID 表示目标计划 ID，空字符串表示解除绑定。
   */
  const onSetSubscriptionPlan = async (id: string, planID: string) => {
    setError("");
    setUpdatingIDs((current) => new Set(current).add(id));
    try {
      const updated = await setKeySubscriptionPlan(id, planID);
      setKeys((current) => replaceKey(current, updated));
    } catch (error) {
      setError(`${id}: ${errorMessage(error, t("keys.planUpdateFailed"))}`);
    } finally {
      setUpdatingIDs((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };

  const onBatchSetEnabled = async (enabled: boolean) => {
    const ids = keys.filter((key) => selectedIDs.has(key.id)).map((key) => key.id);
    if (ids.length === 0) return;

    setError("");
    setUpdatingIDs((current) => new Set([...current, ...ids]));
    const results = await Promise.allSettled(ids.map((id) => setKeyEnabled(id, enabled)));
    const updatedByID = new Map<string, KeyPublic>();
    const failedIDs: string[] = [];

    results.forEach((result, index) => {
      const id = ids[index];
      if (result.status === "fulfilled") updatedByID.set(id, result.value);
      else failedIDs.push(id);
    });

    setKeys((current) => current.map((key) => updatedByID.get(key.id) ?? key));
    setSelectedIDs(new Set(failedIDs));
    setUpdatingIDs((current) => {
      const next = new Set(current);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    if (failedIDs.length > 0) {
      setError(t("keys.batchUpdateFailed", { count: failedIDs.length }));
    }
  };

  const allSelected = keys.length > 0 && selectedIDs.size === keys.length;
  const partiallySelected = selectedIDs.size > 0 && !allSelected;
  const busy = updatingIDs.size > 0 || resettingUsage;
  // selectedKeys 保存当前批量操作选中的 Key。
  const selectedKeys = keys.filter((key) => selectedIDs.has(key.id));
  // selectedHasPlan 表示选中项中是否存在由计划统一管理限额的 Key。
  const selectedHasPlan = selectedKeys.some((key) => !!key.subscription_plan_id);
  const enabledCount = keys.filter((key) => key.enabled).length;
  const modelCount = new Set(keys.flatMap((key) => key.models.map((model) => model.model.toLowerCase()))).size;
  const dailySpend = keys.reduce((total, key) => total + (key.usage.daily_usd ?? 0), 0);

  const onToggleAll = () => {
    setSelectedIDs(allSelected ? new Set() : new Set(keys.map((key) => key.id)));
  };

  const onToggleSelected = (id: string) => {
    setSelectedIDs((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="key-list-page">
      <div className="mobile-only mobile-list-head">
        <div><span>Keyer</span><strong>{t("header.keyList")}</strong></div>
      </div>
      <div className="fp-head mobile-hidden">
        <div className="page-heading">
          <span>{t("keys.eyebrow")} · v{APP_VERSION}</span>
          <div className="page-heading-title">
            <h1>{t("header.keyList")}</h1>
          </div>
          <p>{t("keys.pageHint")}</p>
        </div>
        <div className="fp-actions">
          <button className="btn sm" disabled={loading || busy} onClick={load}>
            {t("keys.refresh")}
          </button>
          <button
            className="btn sm danger-outline"
            disabled={loading || busy || keys.length === 0}
            onClick={() => setPendingAction({ type: "resetUsage" })}
          >
            {resettingUsage ? t("keys.resettingUsage") : t("keys.resetUsage")}
          </button>
        </div>
      </div>

      {!loading && (
        <div className="key-overview-grid mobile-hidden">
          <div className="overview-card primary"><span>{t("keys.statTotal")}</span><strong>{keys.length}</strong><small>{t("keys.statTotalHint")}</small></div>
          <div className="overview-card"><span>{t("keys.statEnabled")}</span><strong>{enabledCount}</strong><small>{t("keys.statEnabledHint", { total: keys.length })}</small></div>
          <div className="overview-card"><span>{t("keys.statModels")}</span><strong>{modelCount}</strong><small>{t("keys.statModelsHint")}</small></div>
          <div className="overview-card spend"><span>{t("keys.statSpend")}</span><strong>{formatUSD(dailySpend)}</strong><small>{t("keys.statSpendHint")}</small></div>
        </div>
      )}

      {error && <div className="error">{error}</div>}

      {!loading && keys.length > 0 && (
        <div className={`key-bulkbar${selectedIDs.size > 0 ? " active" : ""}`}>
          <label className="key-select-all">
            <SelectionCheckbox
              checked={allSelected}
              indeterminate={partiallySelected}
              ariaLabel={t("keys.selectAll")}
              onChange={onToggleAll}
            />
            <span>{selectedIDs.size > 0
              ? t("keys.selectedCount", { count: selectedIDs.size })
              : t("keys.selectAll")}</span>
          </label>
          <div className="key-bulk-actions">
            <button
              className="btn sm"
              disabled={selectedIDs.size === 0 || busy}
              onClick={() => void onBatchSetEnabled(true)}
            >
              {t("keys.batchEnable")}
            </button>
            <button
              className="btn sm danger-outline"
              disabled={selectedIDs.size === 0 || busy}
              onClick={() => void onBatchSetEnabled(false)}
            >
              {t("keys.batchDisable")}
            </button>
            <button
              className="btn sm danger-outline"
              disabled={selectedIDs.size === 0 || busy || selectedHasPlan}
              title={selectedHasPlan ? t("keys.planControlsLimits") : undefined}
              onClick={() => setPendingAction({
                type: "batchResetLimits",
                ids: selectedKeys.map((key) => key.id),
              })}
            >
              {t("keys.batchResetLimits")}
            </button>
            <button className="btn sm mobile-only" disabled={loading || busy} onClick={load}>
              {t("keys.refresh")}
            </button>
            <button
              className="btn sm danger-outline mobile-only"
              disabled={loading || busy}
              onClick={() => setPendingAction({ type: "resetUsage" })}
            >
              {resettingUsage ? t("keys.resettingUsage") : t("keys.resetUsage")}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="muted">{t("keys.loading")}</div>
      ) : keys.length === 0 ? (
        <div className="card muted">{t("keys.empty")}</div>
      ) : (
        <>
          <KeyTable
            keys={keys}
            selectedIDs={selectedIDs}
            updatingIDs={updatingIDs}
            plans={plans}
            allSelected={allSelected}
            partiallySelected={partiallySelected}
            onToggleAll={onToggleAll}
            onToggleSelected={onToggleSelected}
            onSetEnabled={onSetEnabled}
            onSetSubscriptionPlan={onSetSubscriptionPlan}
            onDelete={(id) => setPendingAction({ type: "delete", id })}
            onRotate={(id) => setPendingAction({ type: "rotate", id })}
            onResetRPM={onReset}
            onResetLimits={(id) => setPendingAction({ type: "resetLimits", id })}
          />
          <div className="card-stack mobile-only">
            {keys.map((key) => (
              <KeyCard
                key={key.id}
                item={key}
                selected={selectedIDs.has(key.id)}
                updating={updatingIDs.has(key.id)}
                plans={plans}
                onToggleSelected={onToggleSelected}
                onSetEnabled={onSetEnabled}
                onSetSubscriptionPlan={onSetSubscriptionPlan}
                onDelete={(id) => setPendingAction({ type: "delete", id })}
              />
            ))}
          </div>
        </>
      )}


      {plain && (
        <PlainKeyModal
          plainKey={plain}
          title={plainTitle}
          onClose={() => setPlain(null)}
        />
      )}
      <ConfirmDialog
        open={pendingAction !== null}
        message={confirmMessage}
        confirmLabel={confirmLabel}
        danger={pendingAction?.type === "delete"
          || pendingAction?.type === "resetUsage"
          || pendingAction?.type === "resetLimits"
          || pendingAction?.type === "batchResetLimits"}
        busy={confirming}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => void confirmPendingAction()}
      />
    </div>
  );
}

function SelectionCheckbox({
  checked,
  indeterminate = false,
  ariaLabel,
  onChange,
}: {
  checked: boolean;
  indeterminate?: boolean;
  ariaLabel: string;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      className="key-checkbox"
      type="checkbox"
      checked={checked}
      aria-label={ariaLabel}
      onChange={onChange}
    />
  );
}

function KeyStatusSwitch({
  item,
  updating,
  onChange,
}: {
  item: KeyPublic;
  updating: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const t = useT();
  // expired 表示当前 Key 绑定的订阅计划是否已到期。
  const expired = subscriptionExpired(item);
  return (
    <label
      className="switch key-status-switch"
      title={t("keys.statusToggle", { id: item.id })}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <input
        type="checkbox"
        checked={item.enabled}
        disabled={updating}
        aria-label={t("keys.statusToggle", { id: item.id })}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="track"><span className="thumb" /></span>
      <span className="key-status-label">
        {updating ? t("keys.updating") : t(expired ? "keys.expired" : item.enabled ? "keys.enabled" : "keys.disabled")}
      </span>
    </label>
  );
}

function KeyTable({
  keys,
  selectedIDs,
  updatingIDs,
  plans,
  allSelected,
  partiallySelected,
  onToggleAll,
  onToggleSelected,
  onSetEnabled,
  onSetSubscriptionPlan,
  onDelete,
  onRotate,
  onResetRPM,
  onResetLimits,
}: {
  keys: KeyPublic[];
  selectedIDs: Set<string>;
  updatingIDs: Set<string>;
  plans: SubscriptionPlan[];
  allSelected: boolean;
  partiallySelected: boolean;
  onToggleAll: () => void;
  onToggleSelected: (id: string) => void;
  onSetEnabled: (id: string, enabled: boolean) => void;
  onSetSubscriptionPlan: (id: string, planID: string) => void;
  onDelete: (id: string) => void;
  onRotate: (id: string) => void;
  onResetRPM: (id: string) => void;
  onResetLimits: (id: string) => void;
}) {
  const t = useT();
  return (
    <div className="card table-wrap key-table mobile-hidden">
      <table>
        <thead>
          <tr>
            <th className="key-select-col">
              <SelectionCheckbox
                checked={allSelected}
                indeterminate={partiallySelected}
                ariaLabel={t("keys.selectAll")}
                onChange={onToggleAll}
              />
            </th>
            <th>{t("keys.colIdName")}</th>
            <th>{t("keys.colPreview")}</th>
            <th>{t("keys.colPlan")}</th>
            <th>{t("keys.colStatus")}</th>
            <th className="num">{t("keys.colRpm")}</th>
            <th>{t("keys.colUsage")}</th>
            <th className="num">{t("keys.colModels")}</th>
            <th>{t("keys.colActions")}</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => (
            <tr key={key.id} className={key.enabled ? "" : "is-disabled"}>
              <td className="key-select-col">
                <SelectionCheckbox
                  checked={selectedIDs.has(key.id)}
                  ariaLabel={t("keys.selectKey", { id: key.id })}
                  onChange={() => onToggleSelected(key.id)}
                />
              </td>
              <td>
                <Link className="key-name-link" to={`/keys/${encodeURIComponent(key.id)}/usage`}>
                  {key.name || key.id}
                </Link>
                <div className="mono key-id">{key.id}</div>
              </td>
              <td><span className="mono key-preview">{key.key_preview}</span></td>
              <td>
                <select
                  className="key-plan-select"
                  aria-label={t("keys.planSelect", { id: key.id })}
                  value={key.subscription_plan_id ?? ""}
                  disabled={updatingIDs.has(key.id)}
                  onChange={(event) => void onSetSubscriptionPlan(key.id, event.target.value)}
                >
                  <option value="">{t("keys.noPlan")}</option>
                  {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name || plan.id}</option>)}
                </select>
              </td>
              <td>
                <KeyStatusSwitch
                  item={key}
                  updating={updatingIDs.has(key.id)}
                  onChange={(enabled) => void onSetEnabled(key.id, enabled)}
                />
              </td>
              <td className="num strong">{key.rpm > 0 ? key.rpm : "∞"}</td>
              <td><UsageCell item={key} /></td>
              <td className="num strong">{key.models?.length ?? 0}</td>
              <td>
                <div className="key-table-actions">
                  <Link className="btn sm" to={`/keys/${encodeURIComponent(key.id)}/usage`}>
                    {t("keys.detail")}
                  </Link>
                  <Link className="btn sm" to={`/keys/${encodeURIComponent(key.id)}/edit`}>
                    {t("keys.edit")}
                  </Link>
                  <button className="btn sm" onClick={() => onResetRPM(key.id)}>{t("keys.resetRpm")}</button>
                  <button
                    className="btn sm danger-outline"
                    disabled={!!key.subscription_plan_id}
                    title={key.subscription_plan_id ? t("keys.planControlsLimits") : undefined}
                    onClick={() => onResetLimits(key.id)}
                  >
                    {t("keys.resetLimits")}
                  </button>
                  <button className="btn sm" onClick={() => onRotate(key.id)}>{t("keys.rotate")}</button>
                  <button className="btn sm danger-outline" onClick={() => onDelete(key.id)}>{t("keys.delete")}</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UsageCell({ item }: { item: KeyPublic }) {
  const t = useT();
  const dailyLimit = item.usage.daily_limit_usd;
  const weeklyLimit = item.usage.weekly_limit_usd;
  const value = (used: number, limit: number) => (
    `${formatUSD(used)} / ${limit > 0 ? formatUSD(limit) : t("usage.unlimited")}`
  );
  return (
    <div className="key-usage-cell">
      <span><b>{t("usage.today")}</b>{value(item.usage.daily_usd, dailyLimit)}</span>
      <span><b>{t("usage.thisWeek")}</b>{value(item.usage.weekly_usd, weeklyLimit)}</span>
    </div>
  );
}

function KeyCard({
  item,
  selected,
  updating,
  plans,
  onToggleSelected,
  onSetEnabled,
  onSetSubscriptionPlan,
  onDelete,
}: {
  item: KeyPublic;
  selected: boolean;
  updating: boolean;
  plans: SubscriptionPlan[];
  onToggleSelected: (id: string) => void;
  onSetEnabled: (id: string, enabled: boolean) => void;
  onSetSubscriptionPlan: (id: string, planID: string) => void;
  onDelete: (id: string) => void;
}) {
  const t = useT();

  const limit = item.usage.daily_limit_usd > 0 ? item.usage.daily_limit_usd : 0;
  const pct = limit > 0 ? Math.min(100, (item.usage.daily_usd / limit) * 100) : 0;
  const over = limit > 0 && item.usage.daily_usd >= limit;
  const modelNames = (item.models ?? []).map((model) => model.model);
  const shownChips = modelNames.slice(0, 2);
  const moreCount = Math.max(0, modelNames.length - 2);

  return (
    <article className={`keycard${item.enabled ? "" : " disabled"}${over ? " over" : ""}${selected ? " selected" : ""}`}>
      <div className="kc-head">
        <span className="kc-select">
          <SelectionCheckbox
            checked={selected}
            ariaLabel={t("keys.selectKey", { id: item.id })}
            onChange={() => onToggleSelected(item.id)}
          />
        </span>
        <span className="kc-dot" />
        <Link className="kc-name" to={`/keys/${encodeURIComponent(item.id)}/usage`}>{item.name || item.id}</Link>
        <KeyStatusSwitch
          item={item}
          updating={updating}
          onChange={(enabled) => onSetEnabled(item.id, enabled)}
        />
      </div>
      <div className="kc-preview">{item.key_preview}</div>
      <label className="kc-plan-field">
        <span>{t("keys.colPlan")}</span>
        <select
          aria-label={t("keys.planSelect", { id: item.id })}
          value={item.subscription_plan_id ?? ""}
          disabled={updating}
          onChange={(event) => onSetSubscriptionPlan(item.id, event.target.value)}
        >
          <option value="">{t("keys.noPlan")}</option>
          {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name || plan.id}</option>)}
        </select>
      </label>
      {limit > 0 && (
        <>
          <div className="kc-bar"><span style={{ width: `${pct}%` }} /></div>
          <div className="kc-meta">
            <span>{formatUSD(item.usage.daily_usd)} / {formatUSD(limit)}</span>
            <span>{modelNames.length} {t("keys.mobile.modelsSuffix")}</span>
          </div>
        </>
      )}
      {limit === 0 && (
        <div className="kc-meta">
          <span>{formatUSD(item.usage.daily_usd)} · {t("keys.mobile.noLimit")}</span>
          <span>{modelNames.length} {t("keys.mobile.modelsSuffix")}</span>
        </div>
      )}
      {shownChips.length > 0 && (
        <div className="kc-chips">
          {shownChips.map((model) => <span key={model} className="chip">{model}</span>)}
          {moreCount > 0 && <span className="chip more">+{moreCount}</span>}
        </div>
      )}
      <div className="kc-actions">
        <Link className="btn sm" to={`/keys/${encodeURIComponent(item.id)}/usage`}>{t("keys.detail")}</Link>
        <Link className="btn sm" to={`/keys/${encodeURIComponent(item.id)}/edit`}>{t("keys.edit")}</Link>
        <button className="btn sm danger-outline" type="button" onClick={() => onDelete(item.id)}>{t("keys.delete")}</button>
      </div>
    </article>
  );
}

export function MobileFormHeader({ title, backTo }: { title: string; backTo: string }) {
  const t = useT();
  return (
    <div className="mobile-form-header mobile-only">
      <Link to={backTo} className="mfb-back">
        {t("keyUsage.back")}
      </Link>
      <h2 className="mfb-title">{title}</h2>
    </div>
  );
}
