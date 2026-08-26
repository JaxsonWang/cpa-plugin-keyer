import { useT } from "../i18n";

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
  if (!open) return null;

  return (
    <div className="modal-overlay dialog-overlay" onMouseDown={busy ? undefined : onCancel}>
      <div
        className="modal confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={"dialog-mark" + (danger ? " danger" : "")}>!</div>
        <div className="dialog-copy">
          <h3 id="confirm-dialog-title">{t("dialog.confirmTitle")}</h3>
          <p id="confirm-dialog-message">{message}</p>
        </div>
        <div className="actions dialog-actions">
          <button className="btn" type="button" disabled={busy} onClick={onCancel}>{t("dialog.cancel")}</button>
          <button
            className={danger ? "btn danger" : "btn primary"}
            type="button"
            disabled={busy}
            autoFocus
            onClick={onConfirm}
          >
            {busy ? t("dialog.processing") : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
