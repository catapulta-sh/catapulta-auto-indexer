import { Elysia } from "elysia";
import {
	type AddContractRequest,
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
	validateContract,
	processContract,
	writeAbiFiles,
	prepareContractBatch,
	updateRindexerConfig,
	type ProcessedContract,
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

// GET /event-list - Get all event tables for a contract address
app.get(
	"/event-list",
	async ({ query }: { query: { contract_address: string } }) => {
		const address = query.contract_address.toLowerCase();

		// Get all tables in the schema
		const result = await client.query<{ table_name: string }>(
			`SELECT table_name 
			 FROM information_schema.tables 
			 WHERE table_schema = $1`,
			[APP_CONSTANTS.SCHEMA_NAME],
		);

		const eventTables = result.rows.map((r) => r.table_name);
		const events: string[] = [];

		// Check which tables have events for this contract
		for (const table of eventTables) {
			const hasEventResult = await client.query<{ has_event: boolean }>(
				`SELECT EXISTS (
					SELECT 1 
					FROM ${APP_CONSTANTS.SCHEMA_NAME}."${table}"
					WHERE LOWER(contract_address) = $1
					LIMIT 1
				) AS has_event`,
				[address],
			);

			if (hasEventResult.rows[0]?.has_event) {
				events.push(table);
			}
		}

		return { events };
	},
);

// GET /events - Get paginated events for a specific contract and event type
app.get(
	"/events",
	async ({
		query,
	}: {
		query: {
			contract_address: string;
			event_name: string;
			page_length?: number;
			page?: number;
			sort_order?: number;
			offset?: number;
		};
	}) => {
		const {
			contract_address,
			event_name,
			page_length = 10,
			page = 1,
			sort_order = -1,
			offset,
		} = query;

		const table = event_name.toLowerCase();
		const address = contract_address.toLowerCase();
		const limit = page_length;
		const skip = offset || (page - 1) * limit;
		const order = sort_order === 1 ? "ASC" : "DESC";

		const result = await client.query(
			`SELECT * FROM ${APP_CONSTANTS.SCHEMA_NAME}."${table}"
			 WHERE LOWER(contract_address) = $1
			 ORDER BY block_number ${order}
			 LIMIT $2 OFFSET $3`,
			[address, limit, skip],
		);

		return { events: result.rows };
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

/**
 * Processes contracts and returns both validation results and successfully processed contracts
 * @param contracts - Array of contract requests to process
 * @returns Object containing validation results and successfully processed contracts
 */
async function processContractBatch(contracts: AddContractRequest[]): Promise<{
	results: BatchApiResponse["results"];
	processedContracts: ProcessedContract[];
}> {
	const results: BatchApiResponse["results"] = [];
	const processedContracts: ProcessedContract[] = [];

	for (const contract of contracts) {
		const nameUuid = `${contract.name}_${contract.report_id}`;

		// Validate contract
		const validationError = validateContract(contract);
		if (validationError) {
			results.push({
				contract: nameUuid,
				success: false,
				error: validationError,
			});
			continue;
		}

		// Process contract
		try {
			const processed = await processContract(contract, client);
			processedContracts.push(processed);

			// Determine if this was added or replaced
			const action = processed.isNewContract ? "added" : "replaced";
			results.push({
				contract: nameUuid,
				success: true,
				message: `Contract "${nameUuid}" ${action} successfully`,
			});
		} catch (error) {
			results.push({
				contract: nameUuid,
				success: false,
				error: error instanceof Error ? error.message : "Processing failed",
			});
		}
	}

	return { results, processedContracts };
}

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