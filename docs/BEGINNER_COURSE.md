# Your beginner learning path

Open SurfaceTrace at http://127.0.0.1:5173, choose **CLASSROOM**, then **START OR CONTINUE THE BEGINNER COURSE**. No coding or cybersecurity knowledge is assumed. The lessons live inside the app so you can keep one tab on the instructions and another on the local practice page.

Each lesson provides a goal, setup, plain-language explanation, worked example, ordered exercise, expected result, troubleshooting, notebook entry, a question with a revealable answer, and an AI tutor prompt. You can mark **I TRIED THE EXERCISE**, **I CAN EXPLAIN IT**, or **I NEED MORE PRACTICE**. Progress is stored in this browser, not synced to an account. Clearing browser storage clears it.

Work through one or two lessons per session. Estimated times are guidance, not deadlines. Start/continue opens the first lesson you have not marked Comfortable. You can also choose any lesson from the list, move next/previous, or return to all lessons. The optional reference syllabus contains short primers and unfinished topic outlines; it is not a prerequisite list.

| Lessons | What you will practice |
| --- | --- |
| 1–2 | Start your environment, understand each tool, write a small local test plan |
| 3–7 | Use DevTools Network; read URLs, methods, headers, responses, inputs, and JSON |
| 8–11 | Capture a HAR, import and inspect it, understand sessions, define access rules |
| 12–14 | Use Burp's browser, Proxy history, scope filters, and Repeater |
| 15–16 | Compare stored evidence and understand what an access-control finding needs |
| 17–20 | Read browser code clues, recognize input contexts and URL flows, choose a useful question |
| 21 | Understand and optionally use your local GitLab GDK |
| 22–24 | Use AI as a tutor, write a report, and complete the workflow with less help |

## Your first session

1. Start Docker Desktop and wait for the engine.
2. Open PowerShell in your SurfaceTrace folder.
3. Run `docker compose up -d --wait`.
4. Open http://127.0.0.1:5173 and enter Classroom.
5. Complete lessons 1 and 2. Keep a private notebook with your command, URL, goal, observations, and questions.
6. When finished, `docker compose stop` stops SurfaceTrace without deleting its data.

For native Windows development instead, stop Docker's SurfaceTrace service first and run `npm run win:dev` from the repository. The launcher selects the installed Node 22 toolchain. To select it for other commands in the current PowerShell session, run `. .\scripts\win-dev.ps1 -UseOnly`. Native Windows and Docker use separate investigation databases; they are alternatives, not two required halves of the app. See the README for installation and startup details.

## What you are learning to look for

Start with a normal action, such as opening a project. Find the request that action caused. Identify the object, input, identity, and expected rule. Write one question you can answer with a controlled comparison. Change one thing, inspect what actually changed, and record what the evidence supports. A successful investigation may show expected behavior or leave an honest unanswered question.

The tiny Alpha/Beta lab intentionally makes both records public. It teaches traffic reading and comparison; it does not demonstrate an authorization bypass. Later, a dedicated training lab or disposable GitLab project can add realistic accounts and policy. This is a foundation course, not exhaustive training in every vulnerability class.

## Working with AI

Try first. Share only a small synthetic or redacted example. Ask AI to explain one unfamiliar concept, challenge an assumption, or review your notes. Have it ask one question at a time and wait for your observation. Before using a proposed command, explain what it reads, writes, sends, and deletes. The per-lesson prompts help you practice this process.

The lesson source is `packages/web/src/lessons/beginner-course.ts`. The [Course and Run Manual](COURSE_AND_RUN_MANUAL.md) adds detailed application workflows. The [GDK guide](GDK_GUIDE.md) explains your optional target application.
