import { useCallback, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { createKey } from "../api/keys";
import KeyForm from "../components/KeyForm";
import PlainKeyModal from "../components/PlainKeyModal";
import { MobileFormHeader } from "./KeyList";
import { useT } from "../i18n";
import type { KeyFormValues, ModelRule } from "../types";
import { clearKeyDraft, readKeyDraft, writeKeyDraft } from "../store/keyDraft";
import { APP_VERSION } from "../version";

const DRAFT_KEY = "new";

function emptyDraft(): KeyFormValues {
  return {
    id: "",
    name: "",
    enabled: true,
    rpm: 0,
    models: [],
    daily_limit_usd: 0,
    weekly_limit_usd: 0,
    allow_models_endpoint: false,
  };
}

export default function KeyNew() {
  const nav = useNavigate();
  const loc = useLocation();
  const t = useT();
  const [plain, setPlain] = useState<string | null>(null);

  const title = t("new.title");

  // The in-memory draft survives the standalone model-picker route. This keeps
  // every field (including limits and manually edited prices), not just models.
  const picked = (loc.state as { pickedModels?: ModelRule[] } | null)?.pickedModels;
  const initial = useMemo<KeyFormValues>(() => {
    const draft = readKeyDraft(DRAFT_KEY) ?? emptyDraft();
    return picked ? { ...draft, models: picked } : draft;
  },
    [picked],
  );
  const saveDraft = useCallback((draft: KeyFormValues) => writeKeyDraft(DRAFT_KEY, draft), []);

  return (
    <div className="form-page">
      <div className="fp-head mobile-hidden">
        <div className="page-heading">
          <span>{t("new.eyebrow")} · v{APP_VERSION}</span>
          <h1>{title}</h1>
          <p>{t("new.pageHint")}</p>
        </div>
      </div>
      <MobileFormHeader title={title} backTo="/keys" />
      <KeyForm
        initial={initial}
        pickPath="/keys/new/models"
        submitLabel={t("new.create")}
        onDraftChange={saveDraft}
        onCancel={() => {
          clearKeyDraft(DRAFT_KEY);
          nav("/keys");
        }}
        onSubmit={async (v) => {
          const r = await createKey({
            id: v.id,
            name: v.name || undefined,
            enabled: v.enabled,
            rpm: v.rpm,
            models: v.models,
            daily_limit_usd: v.daily_limit_usd,
            weekly_limit_usd: v.weekly_limit_usd,
            allow_models_endpoint: v.allow_models_endpoint,
          });
          clearKeyDraft(DRAFT_KEY);
          setPlain(r.plain_key);
        }}
      />
      <p className="fp-note mobile-hidden">{t("login.memoryNote")}</p>
      {plain && (
        <PlainKeyModal
          plainKey={plain}
          title={t("plainModal.created")}
          onClose={() => {
            setPlain(null);
            nav("/keys");
          }}
        />
      )}
    </div>
  );
}
