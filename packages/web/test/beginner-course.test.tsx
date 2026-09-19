import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { beginnerCourse } from "../src/lessons/beginner-course";
import { beginnerLessons, curriculum, lessonById } from "../src/lessons/curriculum";
import { GuidedLesson } from "../src/lessons/GuidedLesson";

test("every guided lesson is reachable, sequenced, and contains a complete practice workflow", () => {
  expect(beginnerCourse).toHaveLength(24);
  const ids = [...curriculum, ...beginnerLessons].map((lesson) => lesson.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const [index, lesson] of beginnerCourse.entries()) {
    expect(lessonById(lesson.id)?.guided).toBe(lesson);
    expect(beginnerLessons[index]!.prerequisites).toEqual(index ? [beginnerCourse[index - 1]!.id] : []);
    for (const value of [lesson.goal, lesson.setup, lesson.concept, lesson.example, lesson.expected, lesson.troubleshoot, lesson.record, lesson.question, lesson.answer, lesson.aiPrompt]) {
      expect(value.trim().length).toBeGreaterThan(20);
    }
    expect(lesson.steps.length).toBeGreaterThanOrEqual(4);
    for (const source of lesson.sources) expect(new URL(source.url).protocol).toBe("https:");
  }
});

test("learner can reveal an answer, record practice, and navigate without losing lesson context", async () => {
  const user = userEvent.setup();
  const onSkill = vi.fn();
  const onOpen = vi.fn();
  const onIndex = vi.fn();
  const onReturn = vi.fn();
  const props = { state: "Learning" as const, onSkill, onOpen, onIndex, onReturn };
  const { rerender } = render(<GuidedLesson lesson={beginnerCourse[0]!} {...props} />);
  const answer = screen.getByText(beginnerCourse[0]!.answer);
  expect(answer.closest("details")?.open).toBe(false);
  await user.click(screen.getByText("Reveal the answer"));
  expect(answer.closest("details")?.open).toBe(true);
  await user.click(screen.getByRole("button", { name: "I TRIED THE EXERCISE" }));
  expect(onSkill).toHaveBeenCalledWith("Practiced");
  await user.click(screen.getByRole("button", { name: /^NEXT:/ }));
  expect(onOpen).toHaveBeenCalledWith(beginnerLessons[1]);
  rerender(<GuidedLesson lesson={beginnerCourse[1]!} {...props} />);
  expect(screen.getByText(beginnerCourse[1]!.answer).closest("details")?.open).toBe(false);
  expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 }));
  await user.click(screen.getByRole("button", { name: "PREVIOUS LESSON" }));
  expect(onOpen).toHaveBeenLastCalledWith(beginnerLessons[0]);
  await user.click(screen.getByRole("button", { name: "ALL LESSONS" }));
  expect(onIndex).toHaveBeenCalledOnce();
  await user.click(screen.getByRole("button", { name: "RETURN TO INVESTIGATION" }));
  expect(onReturn).toHaveBeenCalledOnce();
});
