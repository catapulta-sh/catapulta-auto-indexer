import { Elysia } from "elysia";
import { Client } from "pg";
import * as yaml from "js-yaml";
import * as fs from "fs-extra";
import * as path from "path";
import { type Subprocess } from "bun";

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

// Types for better type safety
interface AddContractRequest {
	name: string;
	network: string;
	address: string;
	start_block: string;
	abi: Record<string, any> | string;
	id: string;
}

interface ApiResponse {
	success: boolean;
	message?: string;
	error?: string;
}

interface RindexerContract {
	name: string;
	details: Array<{
		network: string;
		address: string;
		start_block: string;
	}>;
	abi: string;
}

interface RindexerConfig {
	contracts?: RindexerContract[];
	[key: string]: any;
}

// Helper functions for better separation of concerns
const validateAddContractRequest = (
	body: Partial<AddContractRequest>,
): string | null => {
	const requiredFields = [
		"name",
		"network",
		"address",
		"start_block",
		"abi",
		"id",
	] as const;
	const missingFields = requiredFields.filter((field) => !body[field]);

	if (missingFields.length > 0) {
		return `Missing required fields: ${missingFields.join(", ")}`;
	}
	return null;
};

const parseAbi = (abi: Record<string, any> | string): Record<string, any> => {
	return typeof abi === "string" ? JSON.parse(abi) : abi;
};

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

// Add contracts to rindexer.yaml
app.post(
	"/add-contract",
	async ({ body }: { body: AddContractRequest }): Promise<ApiResponse> => {
		try {
			// Validate request body
			const validationError = validateAddContractRequest(body);
			if (validationError) {
				return {
					success: false,
					error: validationError,
				};
			}

			const { name, network, address, start_block, abi, id } = body;
			const contractName = `${name}_${id}`;

			// Read and parse rindexer.yaml
			const rindexerPath = path.join("/workspace", "rindexer.yaml");
			const rindexerContent = await fs.readFile(rindexerPath, "utf8");
			const rindexerConfig = yaml.load(rindexerContent) as RindexerConfig;

			// Initialize contracts array if it doesn't exist
			if (!rindexerConfig.contracts) {
				rindexerConfig.contracts = [];
			}

			// Check for duplicate contract names
			const contractExists = rindexerConfig.contracts.some(
				(contract) => contract.name === contractName,
			);

			if (contractExists) {
				return {
					success: false,
					error: `Contract with name "${contractName}" already exists`,
				};
			}

			// Create new contract entry
			const newContract: RindexerContract = {
				name: contractName,
				details: [
					{
						network,
						address,
						start_block,
					},
				],
				abi: `./abis/${contractName}.abi.json`,
			};

			// Add contract to config
			rindexerConfig.contracts.push(newContract);

			// Write updated YAML
			const updatedYaml = yaml.dump(rindexerConfig, {
				lineWidth: -1,
				noRefs: true,
			});
			await fs.writeFile(rindexerPath, updatedYaml);

			// Ensure abis directory exists and save ABI
			const abisDir = path.join("/workspace", "abis");
			await fs.ensureDir(abisDir);

			const abiPath = path.join(abisDir, `${contractName}.abi.json`);
			const abiContent = parseAbi(abi);
			await fs.writeFile(abiPath, JSON.stringify(abiContent, null, 2));

			// Restart rindexer process
			await restartRindexerProcess();

			return {
				success: true,
				message: `Contract "${contractName}" has been added successfully`,
			};
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error occurred";
			console.error("Error adding contract:", errorMessage);

			return {
				success: false,
				error: `Failed to add contract: ${errorMessage}`,
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
