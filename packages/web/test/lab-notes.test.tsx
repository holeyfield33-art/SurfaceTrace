import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { LabNotes, notesAsText } from "../src/LabNotes";

afterEach(() => vi.restoreAllMocks());

test("lab templates preserve separate notes across reloads and export facts separately from inferences", () => {
  const { unmount } = render(<LabNotes />);
  fireEvent.change(screen.getByLabelText("Lab title"), { target: { value: "Project comparison" } });
  fireEvent.change(screen.getByLabelText("Target"), { target: { value: "Local lab only" } });
  fireEvent.change(screen.getByLabelText("Observed facts"), { target: { value: "Both records returned 200.\nNames differ." } });
  fireEvent.click(screen.getByRole("button", { name: "NEW LAB NOTE" }));
  expect((screen.getByLabelText("Target") as HTMLTextAreaElement).value).toBe("");
  const saved = JSON.parse(localStorage.getItem("surfacetrace:lab-notes:v1")!);
  fireEvent.change(screen.getByLabelText("Choose a lab"), { target: { value: saved[0].id } });
  expect((screen.getByLabelText("Target") as HTMLTextAreaElement).value).toBe("Local lab only");
  unmount();
  render(<LabNotes />);
  expect((screen.getByLabelText("Observed facts") as HTMLTextAreaElement).value).toContain("Names differ.");
  expect(notesAsText(saved[0])).toContain("Observed facts:\nBoth records returned 200.\nNames differ.\n\nInferences:\nNone yet.");
});

test("unavailable storage reports unsaved edits and retains the editable draft", () => {
  const { rerender } = render(<LabNotes />);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  fireEvent.change(screen.getByLabelText("Target"), { target: { value: "Keep this draft" } });
  expect(screen.getByRole("status").textContent).toContain("Could not save");
  rerender(<LabNotes active={false} />);
  expect(screen.queryByLabelText("Target")).toBeNull();
  rerender(<LabNotes active />);
  expect((screen.getByLabelText("Target") as HTMLTextAreaElement).value).toBe("Keep this draft");
});

test("malformed stored data is not silently overwritten on load", () => {
  localStorage.setItem("surfacetrace:lab-notes:v1", "bad-json");
  render(<LabNotes />);
  expect(screen.getByRole("status").textContent).toContain("could not be read");
  expect(localStorage.getItem("surfacetrace:lab-notes:v1")).toBe("bad-json");
});
