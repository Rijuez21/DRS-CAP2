import { afterEach, beforeEach, test, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import EmailCodeForm from "./EmailCodeForm";
import * as api from "../../lib/api";

vi.mock("../../lib/api", () => ({ verifyEmail: vi.fn(), resendVerification: vi.fn() }));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

function setup() {
  const onVerified = vi.fn();
  render(<EmailCodeForm email="ana@example.com" inputClass="" onVerified={onVerified} onBack={() => {}} />);
  const input = screen.getByLabelText(/6-digit code/i);
  const submit = screen.getByRole("button", { name: /confirm & sign in/i });
  return { onVerified, input, submit };
}

test("only digits are kept, up to six", () => {
  const { input } = setup();
  fireEvent.change(input, { target: { value: "12a 34-5678" } });
  expect(input.value).toBe("123456");
});

test("an incomplete code is caught before anything is sent", () => {
  const { input, submit } = setup();
  fireEvent.change(input, { target: { value: "123" } });
  fireEvent.click(submit);
  expect(screen.getByRole("alert").textContent).toMatch(/6-digit code/);
  expect(api.verifyEmail).not.toHaveBeenCalled();
});

test("the right code signs the passenger in", async () => {
  api.verifyEmail.mockResolvedValue({ token: "t", user: { id: 1, role: "passenger" } });
  const { input, submit, onVerified } = setup();
  fireEvent.change(input, { target: { value: "654321" } });
  fireEvent.click(submit);
  await waitFor(() => expect(onVerified).toHaveBeenCalledWith({ token: "t", user: { id: 1, role: "passenger" } }));
  expect(api.verifyEmail).toHaveBeenCalledWith({ email: "ana@example.com", code: "654321" });
});

test("a wrong code shows the server's message", async () => {
  api.verifyEmail.mockRejectedValue(new Error("That code isn't right. 4 attempts left."));
  const { input, submit } = setup();
  fireEvent.change(input, { target: { value: "000000" } });
  fireEvent.click(submit);
  expect((await screen.findByRole("alert")).textContent).toMatch(/4 attempts left/);
});
