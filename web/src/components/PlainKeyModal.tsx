import { useId, useRef, useState } from "react";
import { useT } from "../i18n";
import useDialogFocus from "./useDialogFocus";

interface Props {
  plainKey: string;
  title?: string;
  onClose: () => void;
}

// Shows a freshly-issued/rotated plain key once. After closing it can never be retrieved again.
export default function PlainKeyModal({ plainKey, title, onClose }: Props) {
  const t = useT();
  const titleID = useId();
  const descriptionID = useId();
  const copyButtonRef = useRef<HTMLButtonElement>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copied = copyState === "copied";
  const dialogRef = useDialogFocus(true, copyButtonRef, copied ? onClose : undefined);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(plainKey);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };
  return (
    <div className="modal-overlay">
      <div
        ref={dialogRef}
        className="modal plain-key-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleID}
        aria-describedby={descriptionID}
        tabIndex={-1}
      >
        <h3 id={titleID}>{title ?? t("plainModal.defaultTitle")}</h3>
        <div id={descriptionID} className="error" style={{ fontWeight: 600 }}>
          {t("plainModal.warning")}
        </div>
        <code className="keybox" translate="no">{plainKey}</code>
        <div className={`copy-feedback${copyState === "failed" ? " error" : ""}`} role="status" aria-live="polite">
          {copyState === "failed" ? t("plainModal.copyFailed") : copied ? t("plainModal.copied") : ""}
        </div>
        <div className="actions">
          <button ref={copyButtonRef} className="btn primary" type="button" onClick={copy}>{copied ? t("plainModal.copied") : t("plainModal.copy")}</button>
          <button className="btn" type="button" onClick={onClose}>{t("plainModal.saved")}</button>
        </div>
      </div>
    </div>
  );
}
