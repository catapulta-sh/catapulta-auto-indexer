import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from '@elysiajs/swagger'
import { type AddContractsRequest, type BatchApiResponse } from "./types.js";
import {
	APP_CONSTANTS,
	loadRindexerConfig,
	createDatabaseClient,
	connectDatabase,
	initializeRindexerProcess,
	restartRindexerProcess,
	validateBatchRequest,
	writeAbiFiles,
	prepareContractBatch,
	updateRindexerConfig,
	processContractBatch,
	getProjectName,
	toSnakeCase,
	getCorsOrigins,
} from "./helpers.js";

/**
 * Rindexer API Server
 *
 * Provides REST endpoints for managing blockchain contract indexing and event querying.
 * Requires a valid rindexer.yaml configuration file to start.
 */

// Startup: Validate and load configuration
try {
	await loadRindexerConfig();
	console.log("✅ Configuration loaded successfully");
} catch (error) {
	console.error("❌", error instanceof Error ? error.message : error);
	console.error(
		"   The service cannot start without a valid rindexer.yaml configuration file.",
	);
	process.exit(1);
}

// Startup: Establish database connection and initialize rindexer
const client = createDatabaseClient();
await connectDatabase(client);
initializeRindexerProcess();

const app = new Elysia().use(
	cors({
		origin: getCorsOrigins(),
		methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
		allowedHeaders: ["Content-Type", "Authorization"],
		credentials: true,
	}),
).use(swagger({
	path: "/docs",
	documentation: {
		info: {
			title: "Catapulta Auto Indexer API",
			version: "1.0.0",
			description: "Public REST API Documentation for Rindexer",
		},
		tags: [
			{ name: 'Events', description: 'Event querying endpoints' },
			{ name: 'Contracts', description: 'Contract management endpoints' },
			{ name: 'GraphQL', description: 'GraphQL proxy endpoint' },
			{ name: 'Health', description: 'Health check endpoints' }
		]
	},
}));

/**
 * GET /event-list
 *
 * Returns all available event table names for a specific contract.
 * Uses a composite key (contract_name + report_id) to look up the internal indexer_id.
 *
 * @query contract_name - The contract name
 * @query report_id - The report identifier for this contract instance
 * @returns Array of event table names and the indexer_id
 */
app.get(
	"/event-list",
	async ({
		query,
	}: { query: { contract_name: string; report_id: string } }) => {
		const { contract_name, report_id } = query;

		try {
			// Create composite key for contract lookup
			const nameUuid = `${contract_name}_${report_id}`;

			// Resolve the internal indexer_id from the mapping table
			const mappingResult = await client.query<{ indexer_id: string }>(
				"SELECT indexer_id FROM name_uuid_indexer_id_mapping WHERE name_uuid = $1",
				[nameUuid],
			);

			if (mappingResult.rows.length === 0) {
				return {
					error: `Contract "${nameUuid}" not found`,
					contract_name,
					report_id,
					events: [],
				};
			}

			const indexerId = mappingResult.rows[0].indexer_id;
			const projectName = await getProjectName();
			// Schema naming follows convention: {project_name}_{indexer_id}
			const schema_name = `${toSnakeCase(projectName)}_${indexerId}`;

			// Query all tables in the contract's schema (each table represents an event type)
			const tablesResult = await client.query<{ table_name: string }>(
				`SELECT table_name 
                 FROM information_schema.tables 
                 WHERE table_schema = $1`,
				[schema_name],
			);

			const events = tablesResult.rows.map((row) => row.table_name);

			return {
				events,
				indexer_id: indexerId,
			};
		} catch (error) {
			console.error("Error in /event-list:", error);
			return {
				error: "Failed to retrieve event list",
				contract_name,
				report_id,
				events: [],
			};
		}
	},
	{
		query: t.Object({
			contract_name: t.String({ description: "The contract name" }),
			report_id: t.String({ description: "The report identifier for this contract instance" })
		}),
		response: {
			200: t.Object({
				events: t.Array(t.String(), { description: "List of event table names" }),
				indexer_id: t.String({ description: "Internal indexer identifier" })
			}),
			400: t.Object({
				error: t.String(),
				contract_name: t.String(),
				report_id: t.String(),
				events: t.Array(t.String())
			})
		},
		detail: {
			summary: "Get available event names for a contract",
			tags: ["Events"],
		}
	},
);

/**
 * GET /events
 *
 * Retrieves all events of a specific type for a contract, ordered by block number and log index.
 *
 * @query indexer_id - Internal indexer identifier (obtained from /event-list)
 * @query event_name - Name of the event table to query
 * @query sort_order - Optional sort direction: 1 for ASC, -1 for DESC (default: -1)
 * @returns Array of event records with all their fields
 */
app.get(
	"/events",
	async ({
		query,
	}: {
		query: {
			indexer_id: string;
			event_name: string;
			sort_order?: number;
		};
	}) => {
		const { indexer_id, event_name, sort_order = -1 } = query;

		try {
			const projectName = await getProjectName();
			const schema_name = `${toSnakeCase(projectName)}_${indexer_id}`;

			// Verify the event table exists in the schema
			const tableExistsResult = await client.query<{ exists: boolean }>(
				`SELECT EXISTS (
                    SELECT 1 
                    FROM information_schema.tables 
                    WHERE table_schema = $1 AND table_name = $2
                ) AS exists`,
				[schema_name, event_name],
			);

			if (!tableExistsResult.rows[0]?.exists) {
				return {
					error: `Event "${event_name}" not found in schema "${schema_name}"`,
					indexer_id,
					event_name,
					events: [],
				};
			}

			// Order by blockchain natural ordering: block number, then log index
			const order = sort_order === 1 ? "ASC" : "DESC";

			const result = await client.query(
				`SELECT * FROM ${schema_name}."${event_name}"
                 ORDER BY block_number ${order}, log_index ${order}`,
			);

			return {
				events: result.rows,
			};
		} catch (error) {
			console.error("Error in /events:", error);
			return {
				error: "Failed to retrieve events",
				indexer_id,
				event_name,
				events: [],
			};
		}
	},
	{
		query: t.Object({
			indexer_id: t.String({ description: "Internal indexer identifier (obtained from /event-list)" }),
			event_name: t.String({ description: "Name of the event table to query" }),
			sort_order: t.Optional(t.Number({ description: "Sort direction: 1 for ASC, -1 for DESC", default: -1 }))
		}),
		response: {
			200: t.Object({
				events: t.Array(t.Any(), { description: "Array of event records with all their fields" })
			}),
			400: t.Object({
				error: t.String(),
				indexer_id: t.String(),
				event_name: t.String(),
				events: t.Array(t.Any())
			})
		},
		detail: {
			summary: "Get contract events by type",
			tags: ["Events"],
		}
	},
);


/**
 * POST /graphql
 *
 * Proxy endpoint for GraphQL queries. Forwards requests to the internal GraphQL server.
 *
 * @body GraphQL query object with required 'query' field
 * @returns GraphQL response or error
 */
app.post("/graphql", async ({ body }: { body: { query: string; variables?: any; operationName?: string } }) => {
	if (!body?.query) {
		return { error: 'The field "query" is required.' };
	}

	const response = await fetch(
		`http://localhost:${APP_CONSTANTS.GRAPHQL_PORT}/graphql`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		},
	);

	return await response.json();
},{
	body: t.Object({
		query: t.String({ description: "GraphQL query string" }),
		variables: t.Optional(t.Any({ description: "GraphQL variables object" })),
		operationName: t.Optional(t.String({ description: "GraphQL operation name" }))
	}),
	response: {
		200: t.Any({ description: "GraphQL response" }),
		400: t.Object({
			error: t.String()
		})
	},
	detail: {
		summary: "Proxy to Rindexer's GraphQL",
		tags: ["GraphQL"],
	}
});

/**
 * POST /add-contracts
 *
 * Batch endpoint for adding multiple contracts to the indexer.
 * Validates contracts, updates configuration, writes ABI files, and restarts the indexer process.
 *
 * @body AddContractsRequest - Array of contract configurations to add
 * @returns BatchApiResponse with success status and individual contract results
 */
app.post(
	"/add-contracts",
	async ({
		body,
	}: { body: AddContractsRequest }): Promise<BatchApiResponse> => {
		try {
			// Validate the entire batch request structure
			const batchError = validateBatchRequest(body);
			if (batchError) {
				return { success: false, results: [], error: batchError };
			}

			// Process and validate each contract individually
			const { results, processedContracts } = await processContractBatch(
				body.contracts,
				client,
			);

			if (processedContracts.length === 0) {
				return { success: false, results, error: "No valid contracts to add." };
			}

			// Prepare configuration data (handles deduplication of contracts and ABIs)
			const { contracts, abiFiles } = prepareContractBatch(processedContracts);

			// Apply changes: update config file and write ABI files
			await updateRindexerConfig(contracts);
			await writeAbiFiles(abiFiles);

			// Restart the indexer to pick up new configuration
			await restartRindexerProcess();

			return { success: true, results };
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error occurred";
			console.error("Error adding contracts batch:", errorMessage);
			return {
				success: false,
				results: [],
				error: `Failed to add contracts: ${errorMessage}`,
			};
		}
	},
	{
		body: t.Object({
			contracts: t.Array(t.Object({
				name: t.String({ description: "Contract identifier" }),
				report_id: t.String({ description: "Report identifier for this contract instance" }),
				network: t.String({ description: "Blockchain network name" }),
				address: t.String({ description: "Contract address" }),
				start_block: t.String({ description: "Starting block number for indexing" }),
				abi: t.Union([
					t.String({ description: "ABI as JSON string" }),
					t.Array(t.Any(), { description: "ABI as array of objects" })
				], { description: "Contract ABI" })
			}))
		}),
		response: {
			200: t.Object({
				success: t.Boolean(),
				results: t.Array(t.Object({
					contract: t.String(),
					success: t.Boolean(),
					message: t.Optional(t.String()),
					error: t.Optional(t.String())
				})),
				error: t.Optional(t.String())
			}),
			400: t.Object({
				success: t.Boolean(),
				results: t.Array(t.Any()),
				error: t.String()
			})
		},
		detail: {
			summary: "Add multiple contracts to Rindexer (batch)",
			tags: ["Contracts"],
		}
	},
);

// Health check endpoint
app.get("/", () => "Hello Elysia", {
	detail: {
		summary: "Health check",
		tags: ["Health"],
	}
});


// Start the server
app.listen(APP_CONSTANTS.SERVER_PORT, () => {
	console.log(
		`🦊 Elysia is running at http://${app.server?.hostname}:${app.server?.port}`,
	);
	console.log(`View documentation at "${app.server!.url}docs" in your browser`);
});
