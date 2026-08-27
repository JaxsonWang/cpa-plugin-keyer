import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { listKeys, patchKey, rotateKey, resetRPM, deleteKey } from "../api/keys";
import type { KeyFormValues, KeyPublic, ModelRule } from "../types";
import KeyForm from "../components/KeyForm";
import PlainKeyModal from "../components/PlainKeyModal";
import ConfirmDialog from "../components/ConfirmDialog";
import { MobileFormHeader } from "./KeyList";
import { useT } from "../i18n";
import { clearKeyDraft, readKeyDraft, writeKeyDraft } from "../store/keyDraft";

export default function KeyEdit() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const loc = useLocation();
  const t = useT();
  const [key, setKey] = useState<KeyPublic | null>(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [loading, setLoading] = useState(true);
  const [plain, setPlain] = useState<string | null>(null);
  const [plainTitle, setPlainTitle] = useState("");
  const [pendingAction, setPendingAction] = useState<"rotate" | "delete" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const decodedID = decodeURIComponent(id ?? "");
  const draftKey = `edit:${decodedID}`;

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const all = await listKeys();
        const found = all.find((k) => k.id === decodedID);
        if (!found) setLoadError(t("keys.notFound"));
        else setKey(found);
      } catch (e) {
        setLoadError((e as Error).message ?? t("keys.loadFailed"));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // When the model-picker page returns, merge its selection into the loaded
  // key's models, preserving everything else (id/name/limits/prices). The
  // KeyForm price-map init keeps existing rows for models that survived.
  const picked = (loc.state as { pickedModels?: ModelRule[] } | null)?.pickedModels;
  const initial = useMemo<KeyPublic | KeyFormValues | null>(() => {
    if (!key) return null;
    const draft = readKeyDraft(draftKey) ?? key;
    return picked ? { ...draft, models: picked } : draft;
  }, [draftKey, key, picked]);
  const saveDraft = useCallback(
    (draft: KeyFormValues) => writeKeyDraft(draftKey, draft),
    [draftKey],
  );

  if (loading) return <div className="muted">{t("keys.loading")}</div>;
  if (loadError || !key) return <div className="error">{loadError || t("edit.notFound")}</div>;
  if (!initial) return null;

  const title = t("edit.title", { id: key.id });

  const onRotate = async () => {
    setActionError("");
    try {
      const r = await rotateKey(key.id);
      setPlain(r.plain_key);
      setPlainTitle(t("keys.rotated"));
    } catch (e) {
      setActionError((e as Error).message ?? t("keys.rotateFailed"));
    }
  };
  const onReset = async () => {
    setActionError("");
    try {
      await resetRPM(key.id);
    } catch (e) {
      setActionError((e as Error).message ?? t("keys.resetFailed"));
    }
  };
  const onDelete = async () => {
    setActionError("");
    try {
      await deleteKey(key.id);
      clearKeyDraft(draftKey);
      nav("/keys");
    } catch (e) {
      setActionError((e as Error).message ?? t("keys.deleteFailed"));
    }
  };

  const confirmPendingAction = async () => {
    if (!pendingAction) return;
    setConfirming(true);
    try {
      if (pendingAction === "rotate") await onRotate();
      if (pendingAction === "delete") await onDelete();
      setPendingAction(null);
    } finally {
      setConfirming(false);
    }
  };

  const cancel = () => {
    clearKeyDraft(draftKey);
    nav("/keys");
  };

  return (
    <div className="form-page">
      <div className="fp-head mobile-hidden">
        <div className="page-heading">
          <span>{t("edit.eyebrow")}</span>
          <h1>{t("edit.hTitle")}</h1>
          <p>{t("edit.pageHint")}</p>
        </div>
        <div className="fp-actions">
          <button className="btn sm" onClick={onReset}>{t("keys.resetRpm")}</button>
          <button className="btn sm" onClick={() => setPendingAction("rotate")}>{t("keys.rotate")}</button>
          <button className="btn sm" onClick={cancel}>{t("keyForm.cancel")}</button>
        </div>
      </div>
      <div className="fp-idline mobile-hidden">
        {key.id}<span className="fp-name">{key.name}</span>
      </div>
      <MobileFormHeader title={title} backTo="/keys" />
      <KeyForm
        initial={initial}
        idReadOnly
        pickPath={`/keys/${encodeURIComponent(key.id)}/edit/models`}
        submitLabel={t("edit.save")}
        error={actionError}
        onDraftChange={saveDraft}
        onCancel={cancel}
        dangerLabel={t("keys.delete")}
        onDanger={() => setPendingAction("delete")}
        onSubmit={async (v) => {
          await patchKey({
            id: v.id,
            name: v.name || undefined,
            enabled: v.enabled,
            rpm: v.rpm,
            models: v.models,
            daily_limit_usd: v.daily_limit_usd,
            weekly_limit_usd: v.weekly_limit_usd,
            allow_models_endpoint: v.allow_models_endpoint,
          });
          clearKeyDraft(draftKey);
          nav("/keys");
        }}
      />
      {plain && (
        <PlainKeyModal
          plainKey={plain}
          title={plainTitle}
          onClose={() => setPlain(null)}
        />
      )}
      <ConfirmDialog
        open={pendingAction !== null}
        message={pendingAction === "rotate"
          ? t("keys.rotateConfirm", { id: key.id })
          : t("keys.deleteConfirm", { id: key.id })}
        confirmLabel={pendingAction === "rotate" ? t("keys.rotate") : t("keys.delete")}
        danger={pendingAction === "delete"}
        busy={confirming}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => void confirmPendingAction()}
      />
    </div>
  );
}
