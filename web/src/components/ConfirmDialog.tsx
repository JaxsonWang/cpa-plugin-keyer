import { useRef } from "react";
import { useT } from "../i18n";
import useDialogFocus from "./useDialogFocus";

interface Props {
  open: boolean;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({ open, message, confirmLabel, danger, busy, onConfirm, onCancel }: Props) {
  const t = useT();
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialogFocus(open, danger ? cancelButtonRef : confirmButtonRef, busy ? undefined : onCancel);
  if (!open) return null;

  return (
    <div className="modal-overlay dialog-overlay" onMouseDown={busy ? undefined : onCancel}>
      <div
        className="modal confirm-dialog"
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={"dialog-mark" + (danger ? " danger" : "")}>!</div>
        <div className="dialog-copy">
          <h3 id="confirm-dialog-title">{t("dialog.confirmTitle")}</h3>
          <p id="confirm-dialog-message">{message}</p>
        </div>
        <div className="actions dialog-actions">
          <button ref={cancelButtonRef} className="btn" type="button" disabled={busy} onClick={onCancel}>{t("dialog.cancel")}</button>
          <button
            ref={confirmButtonRef}
            className={danger ? "btn danger" : "btn primary"}
            type="button"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? t("dialog.processing") : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
