import { ArrowLeft, CalendarBlank, CheckSquare, MagnifyingGlass } from "@phosphor-icons/react";
import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { listKeys } from "../api/keys";
import {
  createSubscriptionPlan,
  listSubscriptionPlans,
  updateSubscriptionPlan,
} from "../api/subscriptionPlans";
import KeyForm from "../components/KeyForm";
import { useT } from "../i18n";
import type { KeyFormValues, KeyPublic, SubscriptionPlan } from "../types";
import { APP_VERSION } from "../version";

/** 表示绑定 Key 选项需要的数据和选择操作。 */
type PlanKeyOptionProps = {
  /** keyConfig 是当前展示的 Key。 */
  keyConfig: KeyPublic;
  /** selected 表示当前 Key 是否已被选中。 */
  selected: boolean;
  /** editingID 是正在编辑的计划 ID，新建时为空。 */
  editingID: string;
  /** onToggle 在用户切换当前 Key 时执行。 */
  onToggle: (keyID: string) => void;
};

/**
 * 将接口时间转换为 datetime-local 使用的本地时间。
 * @param value 表示接口返回的 RFC3339 时间。
 * @returns 返回本地日期时间字符串，无有效值时返回空字符串。
 */
function toLocalDateTime(value: string | undefined): string {
  if (!value) return "";
  // date 是接口时间对应的日期对象。
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  // local 是扣除本地时区偏移后的日期对象。
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/**
 * 将 datetime-local 的本地时间转换为 RFC3339。
 * @param value 表示表单中的本地日期时间。
 * @returns 返回 UTC 时间字符串，无有效值时返回空字符串。
 */
function toRFC3339(value: string): string {
  if (!value) return "";
  // date 是表单时间对应的日期对象。
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

/**
 * 构造策略表单初始值。
 * @param plan 表示编辑时读取到的订阅计划。
 * @returns 返回 KeyForm 使用的计划策略数据。
 */
function initialValues(plan?: SubscriptionPlan): KeyFormValues {
  return {
    id: plan?.id ?? "",
    name: plan?.name ?? "",
    enabled: true,
    rpm: plan?.rpm ?? 0,
    models: plan?.models ?? [],
    daily_limit_usd: plan?.daily_limit_usd ?? 0,
    weekly_limit_usd: plan?.weekly_limit_usd ?? 0,
    allow_models_endpoint: plan?.allow_models_endpoint ?? false,
  };
}

/**
 * 渲染一个可绑定 Key 选项。
 * @param keyConfig 表示当前 Key。
 * @param selected 表示当前选择状态。
 * @param editingID 表示正在编辑的计划 ID。
 * @param onToggle 表示选择状态切换回调。
 * @returns 返回带归属提示的 Key 复选项。
 */
function PlanKeyOption({ keyConfig, selected, editingID, onToggle }: PlanKeyOptionProps) {
  // ownedByOther 表示当前 Key 是否已属于另一个计划。
  const ownedByOther = !!keyConfig.subscription_plan_id && keyConfig.subscription_plan_id !== editingID;
  // handleChange 将当前 Key ID 交给上层选择逻辑。
  const handleChange = () => onToggle(keyConfig.id);

  return (
    <label className={`plan-key-option${ownedByOther ? " disabled" : ""}`}>
      <input
        type="checkbox"
        checked={selected}
        disabled={ownedByOther}
        onChange={handleChange}
      />
      <span>
        <strong>{keyConfig.name || keyConfig.id}</strong>
        <small>{keyConfig.id} · {keyConfig.key_preview}</small>
      </span>
      {ownedByOther && <em>{keyConfig.subscription_plan_name || keyConfig.subscription_plan_id}</em>}
    </label>
  );
}

/**
 * 渲染订阅计划新建和编辑页。
 * @returns 返回到期时间、Key 绑定和计划策略表单。
 */
export default function SubscriptionPlanEdit() {
  // id 是路由中的计划 ID。
  const { id } = useParams<{ id: string }>();
  // editingID 是解码后的计划 ID。
  const editingID = id ? decodeURIComponent(id) : "";
  // editing 表示页面是否处于编辑模式。
  const editing = editingID !== "";
  // nav 负责页面跳转。
  const nav = useNavigate();
  // t 负责读取当前语言的界面文案。
  const t = useT();
  // plan 保存编辑目标；setPlan 更新编辑目标。
  const [plan, setPlan] = useState<SubscriptionPlan | undefined>();
  // keys 保存全部 Key；setKeys 更新 Key 列表。
  const [keys, setKeys] = useState<KeyPublic[]>([]);
  // selected 保存已绑定 Key ID；setSelected 更新选择集合。
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // expiresAt 保存本地到期时间；setExpiresAt 更新到期时间。
  const [expiresAt, setExpiresAt] = useState("");
  // search 保存 Key 搜索词；setSearch 更新搜索词。
  const [search, setSearch] = useState("");
  // loading 表示页面是否正在加载；setLoading 更新加载状态。
  const [loading, setLoading] = useState(true);
  // error 保存页面错误；setError 更新错误信息。
  const [error, setError] = useState("");

  // 以下副作用加载计划和 Key；回调不接收参数，cleanup 会阻止卸载后更新状态。
  useEffect(() => {
    // alive 表示当前页面仍然挂载。
    let alive = true;
    // load 负责读取并装配编辑页数据。
    const load = async () => {
      try {
        // plans 保存全部计划；nextKeys 保存全部 Key。
        const [plans, nextKeys] = await Promise.all([listSubscriptionPlans(), listKeys()]);
        if (!alive) return;
        // found 是与路由 ID 匹配的计划；查找回调中的 item 表示当前计划。
        const found = editing ? plans.find((item) => item.id === editingID) : undefined;
        if (editing && !found) {
          setError(t("plans.notFound"));
          return;
        }
        setPlan(found);
        setKeys(nextKeys);
        setSelected(new Set(found?.key_ids ?? []));
        setExpiresAt(toLocalDateTime(found?.expires_at));
      } catch (reason) {
        // reason 表示加载接口抛出的错误。
        if (alive) setError((reason as Error).message ?? t("plans.loadFailed"));
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [editing, editingID, t]);

  // visibleKeys 保存与搜索词匹配的 Key；计算回调不接收参数。
  const visibleKeys = useMemo(() => {
    // term 是标准化后的搜索词。
    const term = search.trim().toLowerCase();
    // 筛选回调中的 key 表示正在匹配的 Key。
    return keys.filter((key) => !term || `${key.name} ${key.id} ${key.key_preview}`.toLowerCase().includes(term));
  }, [keys, search]);

  // selectableKeyIDs 保存未被其他计划占用的 Key ID；计算回调不接收参数。
  const selectableKeyIDs = useMemo(() => {
    // nextIDs 收集当前页面允许绑定的 Key ID。
    const nextIDs: string[] = [];
    // key 表示正在判断归属的 Key。
    for (const key of keys) {
      if (!key.subscription_plan_id || key.subscription_plan_id === editingID) nextIDs.push(key.id);
    }
    return nextIDs;
  }, [editingID, keys]);

  // allSelectableSelected 表示全部可绑定 Key 是否已被选中；回调中的 keyID 表示待检查的 Key ID。
  const allSelectableSelected = selectableKeyIDs.length > 0 && selectableKeyIDs.every((keyID) => selected.has(keyID));
  // formInitial 保存当前接口计划对应的完整策略和模型价格。
  const formInitial = useMemo(() => initialValues(plan), [plan]);

  if (loading) return <div className="muted">{t("plans.loading")}</div>;
  if (error && editing && !plan) return <div className="error">{error}</div>;

  /**
   * 切换单个 Key 的选择状态。
   * @param keyID 表示需要切换的 Key ID。
   */
  const toggleKey = (keyID: string) => {
    // 选择更新回调中的 current 表示当前集合。
    setSelected((current) => {
      // next 是本次更新使用的新集合。
      const next = new Set(current);
      if (next.has(keyID)) next.delete(keyID);
      else next.add(keyID);
      return next;
    });
  };
  // handleToggleAll 在全选和取消全选之间切换全部可绑定 Key。
  const handleToggleAll = () => setSelected(allSelectableSelected ? new Set() : new Set(selectableKeyIDs));
  // handleCancel 返回订阅计划列表。
  const handleCancel = () => nav("/plans");
  // handleExpiryChange 同步到期时间输入；event 表示输入事件。
  const handleExpiryChange = (event: ChangeEvent<HTMLInputElement>) => setExpiresAt(event.target.value);
  // handleSearchChange 同步 Key 搜索词；event 表示输入事件。
  const handleSearchChange = (event: ChangeEvent<HTMLInputElement>) => setSearch(event.target.value);
  /**
   * 保存计划策略和完整绑定集合。
   * @param values 表示 KeyForm 返回的计划策略字段。
   */
  const handleSubmit = async (values: KeyFormValues) => {
    setError("");
    // request 是提交给计划管理接口的完整数据。
    const request = {
      id: values.id,
      name: values.name || values.id,
      rpm: values.rpm,
      models: values.models,
      daily_limit_usd: values.daily_limit_usd,
      weekly_limit_usd: values.weekly_limit_usd,
      allow_models_endpoint: values.allow_models_endpoint ?? false,
      expires_at: toRFC3339(expiresAt),
      key_ids: [...selected],
    };
    if (editing) await updateSubscriptionPlan(request);
    else await createSubscriptionPlan(request);
    nav("/plans");
  };
  // keyOptions 保存可见 Key 选项；映射回调中的 key 表示当前渲染的 Key。
  const keyOptions = visibleKeys.map((key) => (
    <PlanKeyOption
      key={key.id}
      keyConfig={key}
      selected={selected.has(key.id)}
      editingID={editingID}
      onToggle={toggleKey}
    />
  ));

  return (
    <div className="plan-edit-page form-page">
      <div className="fp-head plan-edit-head">
        <div className="page-heading">
          <span>{t("usage.eyebrow")} · v{APP_VERSION}</span>
          <div className="page-heading-title">
            <h1>{t(editing ? "plans.editTitle" : "plans.newTitle")}</h1>
          </div>
          <p>{t("plans.formHint")}</p>
        </div>
        <button className="btn sm" onClick={handleCancel}>
          <ArrowLeft aria-hidden="true" size={16} weight="bold" />
          {t("keyForm.cancel")}
        </button>
      </div>

      <section className="card plan-scope-card">
        <div className="plan-expiry-row">
          <div className="plan-section-copy">
            <span className="plan-section-icon"><CalendarBlank aria-hidden="true" size={18} weight="bold" /></span>
            <div>
              <label htmlFor="plan-expiry">{t("plans.expiryLabel")}</label>
              <p>{t("plans.expiryHint")}</p>
            </div>
          </div>
          <input
            id="plan-expiry"
            className="input"
            type="datetime-local"
            value={expiresAt}
            onChange={handleExpiryChange}
          />
        </div>

        <div className="plan-binding-section">
          <div className="plan-binding-head">
            <div className="plan-section-copy">
              <span className="plan-section-icon"><CheckSquare aria-hidden="true" size={18} weight="bold" /></span>
              <div>
                <strong>{t("plans.bindKeysLabel")}</strong>
                <p>{t("plans.selectedKeys", { count: selected.size })}</p>
              </div>
            </div>
            <button
              className="btn sm plan-select-all"
              type="button"
              disabled={selectableKeyIDs.length === 0}
              onClick={handleToggleAll}
            >
              {t(allSelectableSelected ? "plans.deselectAllKeys" : "plans.selectAllKeys")}
            </button>
          </div>
          <div className="plan-key-search">
            <MagnifyingGlass aria-hidden="true" size={17} weight="bold" />
            <input
              id="plan-key-search"
              className="input"
              value={search}
              onChange={handleSearchChange}
              placeholder={t("plans.searchKeys")}
              aria-label={t("plans.searchKeys")}
            />
          </div>
          <div className="plan-key-picker">
            {visibleKeys.length === 0 ? <span className="muted plan-key-empty">{t("plans.noMatchingKeys")}</span> : keyOptions}
          </div>
        </div>
      </section>

      <KeyForm
        key={editing ? `plan-${editingID}` : "new-plan"}
        initial={formInitial}
        idReadOnly={editing}
        entity="plan"
        policyNotice={t("plans.policyNotice")}
        submitLabel={t(editing ? "plans.save" : "plans.create")}
        error={error}
        onCancel={handleCancel}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
