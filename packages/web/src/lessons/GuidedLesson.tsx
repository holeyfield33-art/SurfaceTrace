import { useEffect, useRef } from "react";
import type { BeginnerLesson } from "./beginner-course";
import { beginnerLessons, type Lesson, type SkillState } from "./curriculum";

export function GuidedLesson({ lesson, state, onSkill, onOpen, onIndex, onReturn }: {
  lesson: BeginnerLesson;
  state: SkillState;
  onSkill: (state: SkillState) => void;
  onOpen: (lesson: Lesson) => void;
  onIndex: () => void;
  onReturn: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const index = beginnerLessons.findIndex((item) => item.id === lesson.id);
  const previous = beginnerLessons[index - 1];
  const next = beginnerLessons[index + 1];
  useEffect(() => { heading.current?.focus(); }, [lesson.id]);
  return (
    <main className="lesson-page guided-lesson reveal" key={lesson.id}>
      <nav className="course-navigation" aria-label="Lesson navigation">
        <button className="back" onClick={onIndex}>ALL LESSONS</button>
        <button className="back" onClick={onReturn}>RETURN TO INVESTIGATION</button>
      </nav>
      <span className="eyebrow">BEGINNER COURSE / {index + 1} OF {beginnerLessons.length} / ABOUT {lesson.minutes} MIN</span>
      <h1 ref={heading} tabIndex={-1}>{lesson.title}</h1>
      <p className="course-goal">{lesson.goal}</p>
      <section><h2>Before you begin</h2><p>{lesson.setup}</p></section>
      <section><h2>Understand the idea</h2><p>{lesson.concept}</p></section>
      <section><h2>Worked example</h2><pre>{lesson.example}</pre></section>
      <section><h2>Try it, one step at a time</h2><ol>{lesson.steps.map((step, i) => <li key={i}>{step}</li>)}</ol></section>
      <section><h2>What you should see</h2><p>{lesson.expected}</p></section>
      <section><h2>If it does not work</h2><p>{lesson.troubleshoot}</p></section>
      <section><h2>Write in your notebook</h2><p>{lesson.record}</p></section>
      <section><h2>Check your understanding</h2><p>{lesson.question}</p>
        <details><summary>Reveal the answer</summary><p>{lesson.answer}</p></details>
      </section>
      <section><h2>Ask AI for help</h2><p>Use this prompt with your own redacted notes. Try the exercise yourself first.</p><blockquote>{lesson.aiPrompt}</blockquote></section>
      {lesson.sources.length > 0 && <section><h2>Official references</h2><ul>{lesson.sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ul></section>}
      <div className="skill-actions" aria-label="Your lesson progress">
        <button onClick={() => onSkill("Practiced")}>I TRIED THE EXERCISE</button>
        <button onClick={() => onSkill("Comfortable")}>I CAN EXPLAIN IT</button>
        <button onClick={() => onSkill("Learning")}>I NEED MORE PRACTICE</button>
        <span role="status">{state}</span>
      </div>
      <nav className="course-navigation" aria-label="Course sequence">
        {previous && <button onClick={() => onOpen(previous)}>PREVIOUS LESSON</button>}
        {next ? <button className="action coral" onClick={() => onOpen(next)}>NEXT: {next.title}</button> : <button onClick={onIndex}>BACK TO ALL LESSONS</button>}
      </nav>
    </main>
  );
}
