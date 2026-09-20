import { useState } from "react";

const storageKey = "surfacetrace:lab-notes:v1";
const fields = [
  ["target", "Target", "The exact application, URL, and permission for this lab."],
  ["identity", "Identity", "Anonymous, Account A, or another verified test account. No passwords or tokens."],
  ["change", "One change", "The single input you will change; for example, path ID 100 to 200."],
  ["limit", "Request limit", "Your total budget for this exercise, such as 2 requests. This note does not enforce a limit."],
  ["stop", "Stop condition", "When you will stop: an unexpected host, personal data, errors, or reaching your request limit."],
  ["expected", "Expected result", "Predict what should happen and explain which rule supports that prediction."],
  ["facts", "Observed facts", "What you actually saw: method, URL, status, meaningful response fields, and observation IDs."],
  ["inferences", "Inferences", "Your interpretation of the facts. Label uncertainty and other possible explanations. 'None yet' is fine."],
  ["next", "Next question", "What is still unknown? What is the smallest next step that could answer it?"],
] as const;
type Field = typeof fields[number][0];
export type LabNote = { id: string; title: string } & Record<Field, string>;
function blankNote(number: number): LabNote {
  return { id: crypto.randomUUID(), title: `Lab ${number}`, target: "", identity: "", change: "", limit: "", stop: "", expected: "", facts: "", inferences: "None yet.", next: "" };
}
function readNotes(): { notes: LabNote[]; message: string } {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const notes: unknown = JSON.parse(saved);
      if (!Array.isArray(notes) || notes.length === 0 || !notes.every((note) => note && typeof note.id === "string" && typeof note.title === "string" && fields.every(([key]) => typeof note[key] === "string")) || new Set(notes.map((note: LabNote) => note.id)).size !== notes.length)
        throw new Error("Invalid notes");
      return { notes, message: "Saved notes restored from this browser." };
    }
    return { notes: [blankNote(1)], message: "Your first lab template is ready. Edits save automatically in this browser." };
  } catch {
    return { notes: [blankNote(1)], message: "Saved notes could not be read. A blank draft is open; editing will attempt to replace the saved copy. Download any notes you need to keep." };
  }
}
export function notesAsText(note: LabNote): string {
  return `${note.title}\n\n${fields.map(([key, label]) => `${label}:\n${note[key] || "(not filled in)"}`).join("\n\n")}\n`;
}
export function LabNotes({ active = true }: { active?: boolean }) {
  const [loaded] = useState(readNotes);
  const [notes, setNotes] = useState(loaded.notes);
  const [selected, setSelected] = useState(loaded.notes[0]!.id);
  const [message, setMessage] = useState(loaded.message);
  const current = notes.find((note) => note.id === selected)!;
  function save(next: LabNote[]) {
    setNotes(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setMessage("Saved in this browser.");
    } catch {
      setMessage("Could not save in this browser. Keep this page open and download your notes before leaving.");
    }
  }
  function update(key: Field | "title", value: string) {
    save(notes.map((note) => note.id === selected ? { ...note, [key]: value } : note));
  }
  function download() {
    const url = URL.createObjectURL(new Blob([notesAsText(current)], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${current.title.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 60) || "lab-notes"}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (!active) return null;
  return <main className="lab-notes reveal">
    <span className="eyebrow">YOUR PERSONAL LAB NOTEBOOK</span>
    <h1>Plan. Observe. Explain.</h1>
    <p>Start a note before each lab. Facts are things you saw; inferences are what you think they mean. For example, “both records returned 200” is a fact. “Anyone can access private data” is an inference that needs a verified access rule.</p>
    <p>Notes stay in this browser on this address. They are not uploaded, synced, added to the evidence ledger, or used to configure scope. Download a copy to keep it outside this browser. Use account labels, never live credentials.</p>
    <div className="notes-toolbar">
      <label>Choose a lab<select value={selected} onChange={(event) => setSelected(event.target.value)}>{notes.map((note) => <option key={note.id} value={note.id}>{note.title || "Untitled lab"}</option>)}</select></label>
      <button className="action" onClick={() => { const note = blankNote(notes.length + 1); save([...notes, note]); setSelected(note.id); }}>NEW LAB NOTE</button>
      <button className="action" onClick={download}>DOWNLOAD THIS NOTE (.TXT)</button>
    </div>
    <p role="status">{message}</p>
    <label className="note-field">Lab title<input value={current.title} onChange={(event) => update("title", event.target.value)} /></label>
    <div className="note-fields">{fields.map(([key, label, help]) => <label className="note-field" key={key}>{label}<small id={`note-${key}-help`}>{help}</small><textarea aria-label={label} aria-describedby={`note-${key}-help`} rows={key === "facts" || key === "inferences" ? 5 : 3} value={current[key]} onChange={(event) => update(key, event.target.value)} /></label>)}</div>
  </main>;
}
