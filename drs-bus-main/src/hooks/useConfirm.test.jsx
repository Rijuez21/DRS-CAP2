import { afterEach, test, expect } from "vitest";
import { act, render, screen, cleanup, fireEvent } from "@testing-library/react";
import { useConfirm } from "./useConfirm";
import Modal from "../components/admin/Modal";

afterEach(cleanup);

// Records each answer so the test can read what `await confirm()` gave back.
function Page({ answers, inModal = false, onCloseOuter }) {
  const [confirm, confirmDialog] = useConfirm();
  const ask = async () => answers.push(await confirm({ title: "Remove bus 12?", body: "This can't be undone.", confirmLabel: "Remove bus" }));
  const content = (
    <>
      <button type="button" onClick={ask}>
        Remove
      </button>
      {confirmDialog}
    </>
  );
  return inModal ? (
    <Modal title="Pin bus stop" onClose={onCloseOuter}>
      {content}
    </Modal>
  ) : (
    content
  );
}

test("going ahead resolves true and closes the dialog", async () => {
  const answers = [];
  render(<Page answers={answers} />);
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  expect(screen.getByRole("dialog", { name: "Remove bus 12?" })).toBeTruthy();
  // The safe choice has focus, so Enter never removes anything by accident.
  expect(document.activeElement.textContent).toBe("Go back");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Remove bus" })));
  expect(answers).toEqual([true]);
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("Go back and Escape both resolve false", async () => {
  const answers = [];
  render(<Page answers={answers} />);
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Go back" })));
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  await act(async () => fireEvent.keyDown(document, { key: "Escape" }));
  expect(answers).toEqual([false, false]);
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("Escape over another dialog closes only the confirm", async () => {
  const answers = [];
  let outerClosed = 0;
  render(<Page answers={answers} inModal onCloseOuter={() => (outerClosed += 1)} />);
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  await act(async () => fireEvent.keyDown(document, { key: "Escape" }));
  expect(answers).toEqual([false]);
  expect(outerClosed).toBe(0);
  // With nothing on top any more, Escape closes the outer dialog as before.
  fireEvent.keyDown(document, { key: "Escape" });
  expect(outerClosed).toBe(1);
});
