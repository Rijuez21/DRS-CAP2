import { useCallback, useState } from "react";
import ConfirmDialog from "../components/common/ConfirmDialog";

// The in-app ConfirmDialog, asked the way window.confirm() was:
//
//   const [confirm, confirmDialog] = useConfirm();
//   if (!(await confirm({ title: "Remove bus 12?", body: "This can't be undone.", confirmLabel: "Remove bus" }))) return;
//   ...
//   return <>{page}{confirmDialog}</>;
//
// Resolves true when they go ahead, false when they back out (button,
// Escape or a click outside). `tone: "primary"` for a non-destructive yes.
export function useConfirm() {
  const [asking, setAsking] = useState(null);
  const confirm = useCallback((options) => new Promise((resolve) => setAsking({ ...options, resolve })), []);

  function answer(ok) {
    asking.resolve(ok);
    setAsking(null);
  }

  const confirmDialog = asking && (
    <ConfirmDialog
      title={asking.title}
      confirmLabel={asking.confirmLabel}
      cancelLabel={asking.cancelLabel}
      tone={asking.tone}
      onConfirm={() => answer(true)}
      onCancel={() => answer(false)}
    >
      {asking.body}
    </ConfirmDialog>
  );
  return [confirm, confirmDialog];
}
