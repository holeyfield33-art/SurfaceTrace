import Fastify from "fastify";
import cors from "@fastify/cors";
import {
  parseHarJson,
  importHar,
  buildGraph,
  generateHypotheses,
  EvidenceLedger,
} from "@surfacetrace/core";

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

const ledger = new EvidenceLedger();

// In-memory store for v0.1 scaffold (SQLite comes next)
let lastImport: ReturnType<typeof importHar> | null = null;
let lastGraph: ReturnType<typeof buildGraph> | null = null;
let lastHypotheses: ReturnType<typeof generateHypotheses> | null = null;

app.get("/health", async () => ({
  ok: true,
  service: "surfacetrace-server",
  version: "0.1.0",
  ledgerTip: ledger.tipHash(),
  ledgerValid: ledger.verify(),
}));

app.post<{ Body: { har: string } }>("/import/har", async (req, reply) => {
  const { har: raw } = req.body ?? {};
  if (!raw || typeof raw !== "string") {
    return reply.status(400).send({ error: "body.har (string) required" });
  }

  let har;
  try {
    har = parseHarJson(raw);
  } catch (e) {
    return reply.status(400).send({
      error: "Invalid HAR JSON",
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  const result = importHar(har);
  const graph = buildGraph(result);
  const hypotheses = generateHypotheses(result.endpoints, result.inputs);

  lastImport = result;
  lastGraph = graph;
  lastHypotheses = hypotheses;

  ledger.append("observation", {
    count: result.observations.length,
    endpoints: result.endpoints.length,
  });

  return {
    observations: result.observations.length,
    endpoints: result.endpoints.length,
    inputs: result.inputs.length,
    hypotheses: hypotheses.length,
    graph: {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
    },
    evidenceTip: ledger.tipHash(),
  };
});

app.get("/graph", async (_req, reply) => {
  if (!lastGraph) {
    return reply.status(404).send({ error: "No graph yet — import a HAR first" });
  }
  return lastGraph;
});

app.get("/endpoints", async (_req, reply) => {
  if (!lastImport) {
    return reply.status(404).send({ error: "No import yet" });
  }
  return lastImport.endpoints;
});

app.get("/hypotheses", async (_req, reply) => {
  if (!lastHypotheses) {
    return reply.status(404).send({ error: "No hypotheses yet" });
  }
  return lastHypotheses;
});

app.get("/evidence", async () => ({
  records: ledger.all(),
  valid: ledger.verify(),
  tip: ledger.tipHash(),
}));

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";

try {
  await app.listen({ port, host });
  console.log(`SurfaceTrace server listening on http://${host}:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
