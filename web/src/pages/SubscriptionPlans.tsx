import { ArrowClockwise, CalendarCheck, Key, PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listKeys } from "../api/keys";
import { deleteSubscriptionPlan, listSubscriptionPlans } from "../api/subscriptionPlans";
import ConfirmDialog from "../components/ConfirmDialog";
import { useT } from "../i18n";
import type { KeyPublic, SubscriptionPlan } from "../types";
import { formatUSD } from "../utils/usageFormat";
import { APP_VERSION } from "../version";

/** 表示管理接口返回的错误结构。 */
type ApiErrorShape = {
  /** response 保存服务端响应。 */
  response?: {
    /** data 保存响应数据。 */
    data?: {
      /** error 保存结构化错误。 */
      error?: {
        /** message 保存面向用户的错误说明。 */
        message?: string;
      };
    };
  };
  /** message 保存客户端错误说明。 */
  message?: string;
};

/** 表示订阅计划卡片需要的数据和删除操作。 */
type SubscriptionPlanCardProps = {
  /** plan 是当前展示的订阅计划。 */
  plan: SubscriptionPlan;
  /** keys 是用于计算绑定关系的全部 Key。 */
  keys: KeyPublic[];
  /** onDelete 在用户请求删除当前计划时执行。 */
  onDelete: (plan: SubscriptionPlan) => void;
};

/**
 * 从未知错误中提取可展示信息。
 * @param error 表示请求过程中捕获的未知错误。
 * @param fallback 表示接口没有提供信息时使用的文案。
 * @returns 返回最终展示给用户的错误信息。
 */
function errorMessage(error: unknown, fallback: string): string {
  // typed 是按管理接口错误结构读取的错误对象。
  const typed = error as ApiErrorShape;
  return typed.response?.data?.error?.message ?? typed.message ?? fallback;
}

/**
 * 格式化计划到期时间。
 * @param value 表示接口返回的 RFC3339 时间。
 * @param neverLabel 表示永久有效时展示的文案。
 * @returns 返回适合当前语言环境的日期时间。
 */
function formatExpiry(value: string | undefined, neverLabel: string): string {
  if (!value) return neverLabel;
  // date 是用于本地化格式化的到期日期。
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/**
 * 渲染单个订阅计划卡片。
 * @param plan 表示当前计划。
 * @param keys 表示全部 Key。
 * @param onDelete 表示删除请求回调。
 * @returns 返回计划摘要、绑定关系和操作入口。
 */
function SubscriptionPlanCard({ plan, keys, onDelete }: SubscriptionPlanCardProps) {
  // t 负责读取当前语言的界面文案。
  const t = useT();
  // expired 表示当前计划是否已经超过到期时间。
  const expired = !!plan.expires_at && new Date(plan.expires_at).getTime() <= Date.now();
  // boundKeys 保存绑定当前计划的 Key；筛选回调中的 key 表示正在检查的 Key。
  const boundKeys = keys.filter((key) => key.subscription_plan_id === plan.id);
  // boundKeyBadges 保存绑定 Key 标签；映射回调中的 key 表示当前标签对应的 Key。
  const boundKeyBadges = boundKeys.map((key) => (
    <span key={key.id} title={key.id}>{key.name || key.id}</span>
  ));
  // handleDelete 将当前计划交给上层删除确认框。
  const handleDelete = () => onDelete(plan);

  return (
    <article className={`plan-card${expired ? " expired" : ""}`}>
      <div className="plan-card-head">
        <div className="plan-title-block">
          <span className="mono plan-id">{plan.id}</span>
          <h2>{plan.name || plan.id}</h2>
        </div>
        <span className={`plan-state${expired ? " expired" : ""}`}>
          {t(expired ? "plans.expired" : "plans.active")}
        </span>
      </div>

      <dl className="plan-metrics">
        <div><dt>{t("plans.rpm")}</dt><dd>{plan.rpm > 0 ? plan.rpm : "∞"}</dd></div>
        <div><dt>{t("plans.daily")}</dt><dd>{plan.daily_limit_usd > 0 ? formatUSD(plan.daily_limit_usd) : t("usage.unlimited")}</dd></div>
        <div><dt>{t("plans.weekly")}</dt><dd>{plan.weekly_limit_usd > 0 ? formatUSD(plan.weekly_limit_usd) : t("usage.unlimited")}</dd></div>
        <div><dt>{t("plans.models")}</dt><dd>{plan.models.length}</dd></div>
      </dl>

      <div className="plan-details">
        <div className="plan-detail-row">
          <span>{t("plans.expiry")}</span>
          <strong>{formatExpiry(plan.expires_at, t("plans.neverExpires"))}</strong>
        </div>
        <div className="plan-detail-row">
          <span>{t("plans.modelsEndpoint")}</span>
          <strong>{t(plan.allow_models_endpoint ? "plans.allowed" : "plans.blocked")}</strong>
        </div>
      </div>

      <div className="plan-bindings">
        <div className="plan-bindings-title">
          <Key aria-hidden="true" size={15} weight="bold" />
          <span>{t("plans.boundKeys", { count: boundKeys.length })}</span>
        </div>
        <div className="plan-key-pills">
          {boundKeys.length === 0 ? <em>{t("plans.noBoundKeys")}</em> : boundKeyBadges}
        </div>
      </div>

      <div className="plan-actions">
        <Link className="btn sm" to={`/plans/${encodeURIComponent(plan.id)}/edit`}>
          <PencilSimple aria-hidden="true" size={15} weight="bold" />
          {t("plans.edit")}
        </Link>
        <button className="btn sm danger-outline" onClick={handleDelete}>
          <Trash aria-hidden="true" size={15} weight="bold" />
          {t("plans.delete")}
        </button>
      </div>
    </article>
  );
}

/**
 * 渲染订阅计划管理页。
 * @returns 返回计划列表、空状态和删除确认框。
 */
export default function SubscriptionPlans() {
  // t 负责读取当前语言的界面文案。
  const t = useT();
  // plans 保存订阅计划；setPlans 更新订阅计划列表。
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  // keys 保存全部 Key；setKeys 更新 Key 列表。
  const [keys, setKeys] = useState<KeyPublic[]>([]);
  // loading 表示列表是否正在加载；setLoading 更新加载状态。
  const [loading, setLoading] = useState(true);
  // error 保存页面错误；setError 更新错误信息。
  const [error, setError] = useState("");
  // pending 保存待删除计划；setPending 更新确认框目标。
  const [pending, setPending] = useState<SubscriptionPlan | null>(null);
  // deleting 表示删除请求是否进行中；setDeleting 更新删除状态。
  const [deleting, setDeleting] = useState(false);

  // load 同时读取计划和 Key，确保绑定数量来自同一轮页面刷新。
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // nextPlans 保存最新计划；nextKeys 保存最新 Key。
      const [nextPlans, nextKeys] = await Promise.all([listSubscriptionPlans(), listKeys()]);
      setPlans(nextPlans);
      setKeys(nextKeys);
    } catch (reason) {
      // reason 表示加载接口抛出的错误。
      setError(errorMessage(reason, t("plans.loadFailed")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  // 以下副作用在页面进入或语言变化后加载数据；回调不接收参数。
  useEffect(() => {
    void load();
  }, [load]);

  // remove 删除确认框中的计划并重新读取列表。
  const remove = async () => {
    if (!pending) return;
    setDeleting(true);
    setError("");
    try {
      await deleteSubscriptionPlan(pending.id);
      setPending(null);
      await load();
    } catch (reason) {
      // reason 表示删除接口抛出的错误。
      setError(errorMessage(reason, t("plans.deleteFailed")));
    } finally {
      setDeleting(false);
    }
  };
  // handleRefresh 将刷新按钮动作转为异步加载。
  const handleRefresh = () => void load();
  // handleCancelDelete 关闭删除确认框。
  const handleCancelDelete = () => setPending(null);
  // handleConfirmDelete 执行已确认的删除请求。
  const handleConfirmDelete = () => void remove();
  // hasPlans 表示当前是否已有可展示计划。
  const hasPlans = plans.length > 0;
  // planCards 保存计划卡片；映射回调中的 plan 表示当前渲染的计划。
  const planCards = plans.map((plan) => (
    <SubscriptionPlanCard key={plan.id} plan={plan} keys={keys} onDelete={setPending} />
  ));

  return (
    <div className="plans-page">
      <div className="fp-head plans-page-head">
        <div className="page-heading">
          <span>{t("usage.eyebrow")} · v{APP_VERSION}</span>
          <div className="page-heading-title">
            <h1>{t("plans.title")}</h1>
          </div>
          <p>{t("plans.pageHint")}</p>
        </div>
        <div className="fp-actions plans-page-actions">
          <button className="btn sm plans-refresh" disabled={loading} onClick={handleRefresh}>
            <ArrowClockwise aria-hidden="true" size={16} weight="bold" />
            {t("keys.refresh")}
          </button>
          {!loading && hasPlans && (
            <Link className="btn primary sm" to="/plans/new">
              <Plus aria-hidden="true" size={16} weight="bold" />
              {t("plans.new")}
            </Link>
          )}
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {loading ? (
        <div className="plans-status" aria-live="polite">
          <span className="plans-loading-indicator" aria-hidden="true" />
          <strong>{t("plans.loading")}</strong>
        </div>
      ) : !hasPlans ? (
        <section className="plans-empty">
          <div className="plans-empty-mark">
            <CalendarCheck aria-hidden="true" size={29} weight="duotone" />
          </div>
          <span className="plans-empty-kicker">{t("usage.eyebrow")}</span>
          <h2>{t("plans.emptyTitle")}</h2>
          <p>{t("plans.emptyHint")}</p>
          <Link className="btn primary plans-empty-action" to="/plans/new">
            <Plus aria-hidden="true" size={17} weight="bold" />
            {t("plans.new")}
          </Link>
        </section>
      ) : (
        <div className="plan-grid">{planCards}</div>
      )}

      <ConfirmDialog
        open={pending !== null}
        message={t("plans.deleteConfirm", {
          name: pending?.name || pending?.id || "",
          count: pending?.key_ids.length ?? 0,
        })}
        confirmLabel={t("plans.delete")}
        danger
        busy={deleting}
        onCancel={handleCancelDelete}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
