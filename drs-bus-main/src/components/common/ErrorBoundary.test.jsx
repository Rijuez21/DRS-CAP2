import { afterEach, test, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import ErrorBoundary from "./ErrorBoundary";

afterEach(cleanup);

function Broken() {
  throw new Error("boom");
}

test("a crashing page shows a Reload screen instead of a blank app", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  render(
    <ErrorBoundary resetKey="/a">
      <Broken />
    </ErrorBoundary>
  );
  expect(screen.getByRole("alert").textContent).toMatch(/Something went wrong/);
  expect(screen.getByRole("button", { name: /reload/i })).toBeTruthy();
});

test("moving to another page clears the error", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { rerender } = render(
    <ErrorBoundary resetKey="/a">
      <Broken />
    </ErrorBoundary>
  );
  rerender(
    <ErrorBoundary resetKey="/b">
      <p>Working page</p>
    </ErrorBoundary>
  );
  expect(screen.getByText("Working page")).toBeTruthy();
});

test("a page whose code failed to download says so", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  function ChunkFail() {
    throw new TypeError("Failed to fetch dynamically imported module: /assets/Page-abc.js");
  }
  render(
    <ErrorBoundary resetKey="/a">
      <ChunkFail />
    </ErrorBoundary>
  );
  expect(screen.getByRole("alert").textContent).toMatch(/didn't finish loading/);
});
