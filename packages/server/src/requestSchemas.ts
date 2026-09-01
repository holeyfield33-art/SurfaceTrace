import type { FastifySchema } from "fastify";

type JsonSchema = Record<string, unknown>;

const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;
const IDENTITY_ROLES = [
  "anonymous",
  "user",
  "admin",
  "service",
  "unknown",
] as const;
const ASSET_CATEGORIES = [
  "pii",
  "account_data",
  "payment_data",
  "credentials_secrets",
  "documents_files",
  "administrative_function",
  "internal_service_data",
  "custom",
] as const;
const BOUNDARY_TYPES = [
  "browser_api",
  "public_authenticated",
  "user_privileged",
  "application_third_party",
  "application_internal_service",
  "custom",
] as const;
const HYPOTHESIS_STATUSES = [
  "open",
  "investigating",
  "supported",
  "not_supported",
  "needs_more_evidence",
  "closed",
] as const;
const EXPERIMENT_STATUSES = [
  "open",
  "investigating",
  "same",
  "different",
  "needs_review",
  "candidate_finding",
  "closed",
] as const;
const TESTER_CONCLUSIONS = [
  "no_meaningful_difference",
  "expected_difference",
  "unexpected_difference",
  "needs_more_testing",
  "potential_security_issue",
  "not_reproducible",
] as const;
const EVIDENCE_READINESS = [
  "incomplete_evidence",
  "needs_reproduction",
  "ready_for_peer_review",
] as const;

function objectSchema(
  properties: Record<string, JsonSchema>,
  required: string[] = [],
  constraints: JsonSchema = {},
): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    ...(required.length ? { required } : {}),
    ...constraints,
  };
}

function enumString(values: readonly string[]): JsonSchema {
  return { type: "string", enum: [...values] };
}

function text(maxLength: number, allowBlank = true): JsonSchema {
  return {
    type: "string",
    maxLength,
    ...(allowBlank ? {} : { minLength: 1, pattern: "\\S" }),
  };
}

function nullable(schema: JsonSchema): JsonSchema {
  return { anyOf: [schema, { type: "null" }] };
}

function stringArray(maxItems = 5000): JsonSchema {
  return {
    type: "array",
    items: id,
    maxItems,
    uniqueItems: true,
  };
}

const id = {
  type: "string",
  minLength: 1,
  maxLength: 128,
  pattern: "^[A-Za-z0-9._:-]+$",
} satisfies JsonSchema;
const notes = nullable(text(10_000));
const label = {
  type: "string",
  minLength: 1,
  maxLength: 200,
  pattern: "^(?=.*\\S)[^\\u0000\\r\\n]*$",
} satisfies JsonSchema;
const params = (name: string) => objectSchema({ [name]: id }, [name]);
const recordOfStrings = {
  type: "object",
  propertyNames: { type: "string", minLength: 1, maxLength: 256 },
  additionalProperties: { type: "string", maxLength: 8192 },
  maxProperties: 200,
} satisfies JsonSchema;
const cookieRecord = {
  type: "object",
  propertyNames: {
    type: "string",
    minLength: 1,
    maxLength: 256,
    pattern: "^[!#$%&'*+\\-.^_`|~0-9A-Za-z]+$",
  },
  additionalProperties: {
    type: "string",
    maxLength: 4096,
    pattern: "^[\\x21\\x23-\\x2B\\x2D-\\x3A\\x3C-\\x5B\\x5D-\\x7E]*$",
  },
  maxProperties: 200,
} satisfies JsonSchema;

const pathMutation = objectSchema(
  { name: label, from: text(8192), to: text(8192) },
  ["name", "from", "to"],
);
const nullableMutationValue = nullable(text(8192));
const namedNullableMutation = objectSchema(
  { name: label, from: nullableMutationValue, to: nullableMutationValue },
  ["name", "from", "to"],
);
const bodyMutation = objectSchema(
  { path: label, from: {}, to: {} },
  ["path", "from", "to"],
);
const identityMutation = objectSchema(
  {
    fromRole: enumString(IDENTITY_ROLES),
    toRole: enumString(IDENTITY_ROLES),
  },
  ["fromRole", "toRole"],
);
const mutation = {
  oneOf: [
    objectSchema({ pathParam: pathMutation }, ["pathParam"]),
    objectSchema({ queryParam: namedNullableMutation }, ["queryParam"]),
    objectSchema({ header: namedNullableMutation }, ["header"]),
    objectSchema({ bodyField: bodyMutation }, ["bodyField"]),
    objectSchema({ identity: identityMutation }, ["identity"]),
  ],
} satisfies JsonSchema;

const scopeStopConditions = objectSchema(
  {
    manualStop: { type: "boolean" },
    maxRequestCount: nullable({ type: "integer", minimum: 1 }),
    repeatedServerErrors: { type: "boolean" },
    authenticationLost: { type: "boolean" },
    customNote: notes,
  },
  ["manualStop", "maxRequestCount"],
);

const structuredConclusion = objectSchema(
  {
    whatChanged: notes,
    whatRemainedConstant: notes,
    expectedPolicy: notes,
    supportingEvidence: notes,
    unknowns: notes,
    reproduced: nullable({ type: "boolean" }),
    realUserDataEncountered: nullable({ type: "boolean" }),
    shouldStopTesting: nullable({ type: "boolean" }),
    evidenceReadiness: nullable(enumString(EVIDENCE_READINESS)),
  },
  [],
  { minProperties: 1 },
);

export const requestSchemas = {
  createProject: {
    body: objectSchema({ name: text(200) }),
  },
  projectParams: { params: params("projectId") },
  importHar: {
    body: objectSchema(
      { har: text(10 * 1024 * 1024, false), sourceLabel: text(512) },
      ["har"],
    ),
  },
  updateScope: {
    body: objectSchema(
      {
        active: { type: "boolean" },
        allowedHosts: {
          type: "array",
          items: text(253, false),
          minItems: 1,
          maxItems: 100,
          uniqueItems: true,
        },
        allowedProtocols: {
          type: "array",
          items: enumString(["http", "https"]),
          minItems: 1,
          maxItems: 2,
          uniqueItems: true,
        },
        allowedPorts: {
          type: "array",
          items: { type: "integer", minimum: 1, maximum: 65535 },
          minItems: 1,
          maxItems: 128,
          uniqueItems: true,
        },
        allowedPathPrefixes: {
          type: "array",
          items: { ...text(2048, false), pattern: "^/" },
          minItems: 1,
          maxItems: 200,
          uniqueItems: true,
        },
        excludedPathPrefixes: {
          type: "array",
          items: { ...text(2048, false), pattern: "^/" },
          maxItems: 200,
          uniqueItems: true,
        },
        allowedMethods: {
          type: "array",
          items: enumString(HTTP_METHODS),
          minItems: 1,
          maxItems: HTTP_METHODS.length,
          uniqueItems: true,
        },
        maxRequestsPerMinute: { type: "integer", minimum: 1, maximum: 10_000 },
        stopConditions: scopeStopConditions,
        notes,
      },
      [
        "active",
        "allowedHosts",
        "allowedProtocols",
        "allowedPorts",
        "allowedPathPrefixes",
        "excludedPathPrefixes",
        "allowedMethods",
        "maxRequestsPerMinute",
        "stopConditions",
      ],
    ),
  },
  scopePreview: {
    body: objectSchema(
      { method: enumString(HTTP_METHODS), url: text(8192, false), body: {} },
      ["method", "url"],
    ),
  },
  redirectPreview: {
    body: objectSchema(
      { method: enumString(HTTP_METHODS), redirectUrl: text(8192, false) },
      ["method", "redirectUrl"],
    ),
  },
  resetScopeStop: {
    body: objectSchema(
      {
        condition: enumString([
          "repeatedServerErrors",
          "authenticationLost",
        ]),
      },
      ["condition"],
    ),
  },
  runtimeCredential: {
    params: params("identityId"),
    body: objectSchema(
      {
        headers: recordOfStrings,
        cookies: cookieRecord,
        approvedApiKeyHeaderNames: {
          type: "array",
          items: {
            ...text(256, false),
            pattern: "^[!#$%&'*+\\-.^_`|~0-9A-Za-z]+$",
          },
          maxItems: 100,
          uniqueItems: true,
        },
      },
      [],
      {
        anyOf: [
          {
            required: ["headers"],
            properties: { headers: { type: "object", minProperties: 1 } },
          },
          {
            required: ["cookies"],
            properties: { cookies: { type: "object", minProperties: 1 } },
          },
        ],
      },
    ),
  },
  replayPrepare: {
    body: objectSchema(
      {
        baselineObservationId: id,
        hypothesisId: nullable(id),
        mutation,
        targetIdentityId: nullable(id),
      },
      ["baselineObservationId", "mutation"],
    ),
  },
  replayTokenParams: { params: params("token") },
  replaySend: {
    params: params("token"),
    body: objectSchema({ approval: { const: true } }, ["approval"]),
  },
  observationIdentity: {
    params: params("observationId"),
    body: objectSchema({ identityId: id }, ["identityId"]),
  },
  createAsset: {
    body: objectSchema(
      {
        label,
        category: enumString(ASSET_CATEGORIES),
        notes,
        linkedEndpointIds: stringArray(),
        linkedObservationIds: stringArray(),
      },
      ["label", "category"],
    ),
  },
  updateAsset: {
    params: params("assetId"),
    body: objectSchema(
      {
        label,
        category: enumString(ASSET_CATEGORIES),
        notes,
        linkedEndpointIds: stringArray(),
        linkedObservationIds: stringArray(),
      },
      [],
      { minProperties: 1 },
    ),
  },
  assetParams: { params: params("assetId") },
  createBoundary: {
    body: objectSchema(
      {
        label,
        type: enumString(BOUNDARY_TYPES),
        notes,
        sourceRef: id,
        destinationRef: id,
      },
      ["label", "type", "sourceRef", "destinationRef"],
    ),
  },
  updateBoundary: {
    params: params("boundaryId"),
    body: objectSchema(
      {
        label,
        type: enumString(BOUNDARY_TYPES),
        notes,
        sourceRef: id,
        destinationRef: id,
      },
      [],
      { minProperties: 1 },
    ),
  },
  boundaryParams: { params: params("boundaryId") },
  updateHypothesis: {
    params: params("hypothesisId"),
    body: objectSchema(
      {
        status: enumString(HYPOTHESIS_STATUSES),
        observationIds: stringArray(),
        experimentIds: stringArray(),
        assetIds: stringArray(),
        trustBoundaryIds: stringArray(),
        evidenceIds: stringArray(10_000),
        notes,
      },
      [],
      { minProperties: 1 },
    ),
  },
  experimentQuery: {
    querystring: objectSchema({
      status: enumString(EXPERIMENT_STATUSES),
      endpointId: id,
      identityId: id,
    }),
  },
  experimentParams: { params: params("experimentId") },
  updateExperiment: {
    params: params("experimentId"),
    body: objectSchema(
      {
        status: enumString(EXPERIMENT_STATUSES),
        conclusion: nullable(enumString(TESTER_CONCLUSIONS)),
        structuredConclusion: nullable(structuredConclusion),
        notes: text(10_000),
      },
      [],
      { minProperties: 1 },
    ),
  },
  createExperiment: {
    body: objectSchema(
      {
        endpointId: id,
        hypothesisId: id,
        baselineObservationId: id,
        resultObservationId: id,
        inputId: id,
        mutation,
        notes: text(10_000),
      },
      [
        "endpointId",
        "hypothesisId",
        "baselineObservationId",
        "resultObservationId",
        "mutation",
      ],
    ),
  },
} satisfies Record<string, FastifySchema>;
