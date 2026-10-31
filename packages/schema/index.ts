import flowSchemaJson from "./flow.schema.json" with { type: "json" };
import runSchemaJson from "./run.schema.json" with { type: "json" };

/** The flow file JSON Schema (draft 2020-12), as a plain object ready for a validator. */
export const flowSchema: Record<string, unknown> = flowSchemaJson;

/** The canonical `$id` of the flow schema. */
export const FLOW_SCHEMA_ID: string = flowSchemaJson.$id;

/** The run document JSON Schema (draft 2020-12), as a plain object ready for a validator. */
export const runSchema: Record<string, unknown> = runSchemaJson;

/** The canonical `$id` of the run schema. */
export const RUN_SCHEMA_ID: string = runSchemaJson.$id;
