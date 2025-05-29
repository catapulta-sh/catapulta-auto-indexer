import { Elysia } from "elysia";
import { Client } from "pg";
import { type Subprocess } from "bun";
import * as fs from "fs-extra";
import * as yaml from "js-yaml";
import {
	type AddContractsRequest,
	type BatchApiResponse,
	type RindexerConfig,
} from "./types.js";
import {
	validateBatchRequest,
	validateContract,
	processContract,
	updateRindexerConfig,
	writeAbiFiles,
} from "./contract-helpers.js";

let globalProcess: Subprocess | undefined;

const startRindexerProcess = () => {
	console.log("Spawning rindexer process: rindexer start all");
	const proc = Bun.spawn({
		cmd: ["/app/rindexer", "start", "all"],
		stdout: "inherit",
		stderr: "inherit",
		onExit: (proc, exitCode, signalCode, error) => {
			console.log(
				`Rindexer process exited with code: ${exitCode}, signal: ${signalCode}`,
			);
			if (error) {
				console.error("Rindexer process error on exit:", error);
			}
			// Clean up the global reference when process exits
			if (globalProcess === proc) {
				globalProcess = undefined;
			}
		},
	});
	return proc;
};

const app = new Elysia();

// Configuración de PostgreSQL
const client = new Client({
	host: process.env.POSTGRES_HOST || "localhost",
	port: Number(process.env.POSTGRES_PORT) || 5432,
	user: process.env.POSTGRES_USER || "postgres",
	password: process.env.POSTGRES_PASSWORD || "password",
	database: process.env.POSTGRES_DB || "postgres",
});

await client.connect();

// Start the rindexer process initially
globalProcess = startRindexerProcess();

// GET /event-list
app.get(
	"/event-list",
	async ({ query }: { query: { contract_address: string } }) => {
		const address = query.contract_address.toLowerCase();

		const schema = "catapulta_auto_indexer_rocket_pool_eth";

		// Obtener todas las tablas del esquema
		const result = await client.query<{ table_name: string }>(
			`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = $1
    `,
			[schema],
		);

		const eventTables = result.rows.map((r) => r.table_name);

		const events: string[] = [];

		for (const table of eventTables) {
			const result = await client.query<{ has_event: boolean }>(
				`
        SELECT EXISTS (
          SELECT 1 
          FROM ${schema}."${table}"
          WHERE LOWER(contract_address) = $1
          LIMIT 1
        ) AS has_event
      `,
				[address],
			);

			if (result.rows[0]?.has_event) {
				events.push(table);
			}
		}

		return { events };
	},
);

app.get(
	"/events",
	async ({
		query,
	}: {
		query: {
			contract_address: string;
			event_name: string;
			page_length: number;
			page: number;
			sort_order: number;
			offset: number;
		};
	}) => {
		const {
			contract_address,
			event_name,
			page_length,
			page,
			sort_order,
			offset,
		} = query;

		const schema = "catapulta_auto_indexer_rocket_pool_eth";
		const table = event_name.toLowerCase();
		const address = contract_address.toLowerCase();

		const limit = page_length || 10;
		const skip = offset || (page - 1) * limit;
		const order = sort_order === 1 ? "ASC" : "DESC";

		const result = await client.query(
			`
      SELECT * FROM ${schema}."${table}"
      WHERE LOWER(contract_address) = $1
      ORDER BY block_number ${order}
      LIMIT $2 OFFSET $3
    `,
			[address, limit, skip],
		);

		return {
			events: result.rows,
		};
	},
);

// Proxy a graphql
app.post("/graphql", async ({ request }) => {
	const body = await request.json();

	if (!body?.query) {
		return { error: 'The field "query" is required.' };
	}

	const response = await fetch("http://localhost:3001/graphql", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});

	return await response.json();
});

// Helper functions for batch operations
const restartRindexerProcess = async (): Promise<void> => {
	if (globalProcess) {
		console.log("Terminating existing rindexer process...");

		// Try graceful termination first
		globalProcess.kill("SIGTERM");

		// Wait a bit for graceful shutdown
		const timeout = setTimeout(() => {
			console.log("Force killing rindexer process...");
			globalProcess?.kill("SIGKILL");
		}, 5000);

		try {
			await globalProcess.exited;
			clearTimeout(timeout);
			console.log("Rindexer process terminated successfully");
		} catch (error) {
			console.error("Error waiting for process termination:", error);
		}

		globalProcess = undefined;
	}

	// Wait a moment before starting new process
	await new Promise((resolve) => setTimeout(resolve, 1000));
	globalProcess = startRindexerProcess();
};

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

			const { contracts } = body;
			const results: BatchApiResponse["results"] = [];
			const validContracts: ReturnType<typeof processContract>[] = [];

			// 2. Process and validate each contract
			for (const contract of contracts) {
				const contractName = `${contract.name}_${contract.id}`;
				const validationError = validateContract(contract);

				if (validationError) {
					results.push({
						contract: contractName,
						success: false,
						error: validationError,
					});
					continue;
				}

				try {
					const processed = processContract(contract);
					validContracts.push(processed);
					results.push({
						contract: contractName,
						success: true,
						message: "Validated successfully",
					});
				} catch (error) {
					results.push({
						contract: contractName,
						success: false,
						error:
							error instanceof Error ? error.message : "Invalid ABI format",
					});
				}
			}

			if (validContracts.length === 0) {
				return { success: false, results, error: "No valid contracts to add." };
			}

			// 3. Read existing config to identify replacements
			const configPath = "/workspace/rindexer.yaml";
			let existingConfig: RindexerConfig = { contracts: [] };
			try {
				const content = await fs.readFile(configPath, "utf8");
				existingConfig = yaml.load(content) as RindexerConfig;
			} catch (error) {
				// Config file doesn't exist or is invalid, use default
			}

			const existingContractNames = new Set(
				(existingConfig.contracts || []).map((c) => c.name),
			);

			// 4. Deduplicate and prepare for updates
			const contractMap = new Map();
			const abiFileMap = new Map();
			const duplicateContracts = new Set();
			const replacedContracts = new Set();

			for (const contract of validContracts) {
				if (contractMap.has(contract.contractName)) {
					duplicateContracts.add(contract.contractName);
				}
				if (existingContractNames.has(contract.contractName)) {
					replacedContracts.add(contract.contractName);
				}
				contractMap.set(contract.contractName, contract.rindexerContract);
				abiFileMap.set(contract.contractName, contract.abiFile);
			}

			const uniqueContracts = Array.from(contractMap.values());
			const abiFiles = Array.from(abiFileMap.values());
			const contractNames = Array.from(contractMap.keys());

			// 5. Update configuration and write files
			await updateRindexerConfig(uniqueContracts, contractNames);
			await writeAbiFiles(abiFiles);

			// 6. Restart process
			await restartRindexerProcess();

			// 7. Update success messages
			const finalResults = results.map((r) => ({
				...r,
				message: r.success
					? `Contract "${r.contract}" ${replacedContracts.has(r.contract) ? "replaced" : "added"} successfully`
					: r.message,
			}));

			return { success: true, results: finalResults };
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
app.listen(3000, () => {
	console.log(
		`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
	);
});
