import type { Lesson } from "./curriculum";
import { curriculum } from "./curriculum";

export interface InvestigationSignal {
  method?: string;
  inputLocations: string[];
  hypothesisSignals: string[];
}

const prefixForSignal: Array<[matcher: (signal: InvestigationSignal) => boolean, prefix: string, why: string]> = [
  [(signal) => signal.hypothesisSignals.includes("object-id-in-path-or-input"), "security-02-", "This endpoint contains an object identifier that crosses an authorization boundary."],
  [(signal) => signal.inputLocations.includes("cookie"), "http-13-", "A cookie provides session context for this request."],
  [(signal) => signal.method === "POST", "http-05-", "This request uses POST and may submit or change application state."],
  [(signal) => signal.inputLocations.includes("body-json"), "javascript-16-", "This request contains a structured JSON body."],
];

export function recommendLessons(signal: InvestigationSignal): Array<{ lesson: Lesson; why: string }> {
  return prefixForSignal.flatMap(([matches, prefix, why]) => {
    const lesson = matches(signal) ? curriculum.find((item) => item.id.startsWith(prefix)) : undefined;
    return lesson ? [{ lesson, why }] : [];
  });
}
