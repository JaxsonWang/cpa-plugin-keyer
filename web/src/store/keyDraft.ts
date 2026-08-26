import type { KeyFormValues } from "../types";

const drafts = new Map<string, KeyFormValues>();

function cloneDraft(draft: KeyFormValues): KeyFormValues {
  return {
    ...draft,
    models: draft.models.map((model) => ({ ...model })),
  };
}

export function readKeyDraft(key: string): KeyFormValues | null {
  const draft = drafts.get(key);
  return draft ? cloneDraft(draft) : null;
}

export function writeKeyDraft(key: string, draft: KeyFormValues): void {
  drafts.set(key, cloneDraft(draft));
}

export function clearKeyDraft(key: string): void {
  drafts.delete(key);
}

export function _resetKeyDrafts(): void {
  drafts.clear();
}
