import { Elysia } from "elysia";
import {
	type AddContractsRequest,
	type BatchApiResponse,
} from "./types.js";
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
} from "./helpers.js";

// Validate and load rindexer configuration
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

// Setup database connection
const client = createDatabaseClient();
await connectDatabase(client);

// Initialize the rindexer process
initializeRindexerProcess();

const app = new Elysia();

// GET /event-list - Get all event tables for a contract
app.get(
	"/event-list",
	async ({ query }: { query: { contract_name: string; report_id: string } }) => {
		const { contract_name, report_id } = query;

		try {
			// Create the composite key from contract_name and report_id (same as in helpers.ts)
			const nameUuid = `${contract_name}_${report_id}`;

			// Look up the indexer_id from the mapping table
			const mappingResult = await client.query<{ indexer_id: string }>(
				"SELECT indexer_id FROM name_uuid_indexer_id_mapping WHERE name_uuid = $1",
				[nameUuid],
			);

			if (mappingResult.rows.length === 0) {
				return {
					error: `Contract "${nameUuid}" not found`,
					contract_name,
					report_id,
					events: []
				};
			}

			const indexerId = mappingResult.rows[0].indexer_id;
			const projectName = await getProjectName();
			// Convert project name to snake_case for PostgreSQL schema naming
			const schema_name = `${toSnakeCase(projectName)}_${indexerId}`;

			// Get all tables in the schema
			const tablesResult = await client.query<{ table_name: string }>(
				`SELECT table_name 
				 FROM information_schema.tables 
				 WHERE table_schema = $1`,
				[schema_name],
			);

			// All tables in the schema are events for this contract
			const events = tablesResult.rows.map(row => row.table_name);

			return {
				events,
				schema: schema_name,
				contract_name,
				report_id,
				indexer_id: indexerId
			};
		} catch (error) {
			console.error("Error in /event-list:", error);
			return {
				error: "Failed to retrieve event list",
				contract_name,
				report_id,
				events: []
			};
		}
	},
);

// GET /events - Get paginated events for a specific contract and event type
app.get(
	"/events",
	async ({
		query,
	}: {
		query: {
			contract_name: string;
			report_id: string;
			event_name: string;
			sort_order?: number;
		};
	}) => {
		const {
			contract_name,
			report_id,
			event_name,
			sort_order = -1,
		} = query;

		try {
			// Create the composite key from contract_name and report_id (same as in helpers.ts)
			const nameUuid = `${contract_name}_${report_id}`;

			// Look up the indexer_id from the mapping table
			const mappingResult = await client.query<{ indexer_id: string }>(
				"SELECT indexer_id FROM name_uuid_indexer_id_mapping WHERE name_uuid = $1",
				[nameUuid],
			);

			if (mappingResult.rows.length === 0) {
				return {
					error: `Contract "${nameUuid}" not found`,
					contract_name,
					report_id,
					events: []
				};
			}

			const indexerId = mappingResult.rows[0].indexer_id;
			const projectName = await getProjectName();
			// Convert project name to snake_case for PostgreSQL schema naming
			const schema_name = `${toSnakeCase(projectName)}_${indexerId}`;

			// Validate event_name exists in the schema
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
					error: `Event "${event_name}" not found for contract "${nameUuid}"`,
					contract_name,
					report_id,
					event_name,
					events: []
				};
			}

			// Setup ordering
			const order = sort_order === 1 ? "ASC" : "DESC";

			// Query all events from the specific table
			const result = await client.query(
				`SELECT * FROM ${schema_name}."${event_name}"
				 ORDER BY block_number ${order}, log_index ${order}`,
			);

			return {
				events: result.rows,
				schema: schema_name,
				contract_name,
				report_id,
				event_name,
				indexer_id: indexerId
			};
		} catch (error) {
			console.error("Error in /events:", error);
			return {
				error: "Failed to retrieve events",
				contract_name,
				report_id,
				event_name,
				events: []
			};
		}
	},
);

// GraphQL proxy endpoint
app.post("/graphql", async ({ request }) => {
	const body = await request.json();

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
});

// Batch add contracts endpoint
app.post(
	"/add-contracts",
	async ({
		body,
	}: { body: AddContractsRequest }): Promise<BatchApiResponse> => {
		try {
			// 1. Validate batch request
			const batchError = validateBatchRequest(body);
			if (batchError) {
				return { success: false, results: [], error: batchError };
			}

			// 2. Process all contracts (includes validation, processing, and message generation)
			const { results, processedContracts } = await processContractBatch(
				body.contracts,
				client,
			);

			if (processedContracts.length === 0) {
				return { success: false, results, error: "No valid contracts to add." };
			}

			// 3. Prepare data for configuration updates (handles deduplication)
			const { contracts, abiFiles } =
				prepareContractBatch(processedContracts);

			// 4. Update configuration and write files
			await updateRindexerConfig(contracts);
			await writeAbiFiles(abiFiles);

			// 5. Restart rindexer process
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
);

// Ruta base
app.get("/", () => "Hello Elysia");

// Iniciar servidor
app.listen(APP_CONSTANTS.SERVER_PORT, () => {
	console.log(
		`🦊 Elysia is running at http://${app.server?.hostname}:${app.server?.port}`,
	);
});