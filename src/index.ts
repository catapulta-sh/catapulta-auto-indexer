import { Elysia } from "elysia";
import { Client } from "pg";
import * as yaml from "js-yaml";
import * as fs from "fs-extra";
import * as path from "path";
import { type Subprocess } from "bun";

let globalProcess: Subprocess | undefined;

const startRindexerProcess = () => {
	console.log("Spawning rindexer process: rindexer start indexer");
	const proc = Bun.spawn({
		cmd: ["/app/rindexer", "start", "all"],
		stdout: "inherit", // Pipe stdout to the current process
		stderr: "inherit", // Pipe stderr to the current process
		onExit: (proc, exitCode, signalCode, error) => {
			console.log(
				`Rindexer process exited with code: ${exitCode}, signal: ${signalCode}`,
			);
			if (error) {
				console.error("Rindexer process error on exit:", error);
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

// Add contracts to rindexer.yaml
app.post(
	"/add-contract",
	async ({
		body,
	}: {
		body: {
			name: string;
			network: string;
			address: string;
			start_block: string;
			abi: any;
		};
	}) => {
		try {
			// Validate the request body
			const { name, network, address, start_block, abi } = body;

			if (!name || !network || !address || !start_block || !abi) {
				return {
					success: false,
					error:
						"Missing required fields: name, network, address, start_block, and abi are required",
				};
			}

			// Read the current rindexer.yaml
			const rindexerPath = path.join("/workspace", "rindexer.yaml");
			const rindexerContent = fs.readFileSync(rindexerPath, "utf8");
			const rindexerConfig = yaml.load(rindexerContent) as any;

			// Prepare new contract entry
			const newContract = {
				name,
				details: [
					{
						network,
						address,
						start_block,
					},
				],
				abi: `./abis/${name}.abi.json`,
			};

			// Add the new contract to the YAML structure
			if (!rindexerConfig.contracts) {
				rindexerConfig.contracts = [];
			}

			// Check if contract with the same name already exists
			const existingContractIndex = rindexerConfig.contracts.findIndex(
				(c: any) => c.name === name,
			);

			if (existingContractIndex >= 0) {
				return {
					success: false,
					error: `Contract with name "${name}" already exists`,
				};
			}

			rindexerConfig.contracts.push(newContract);

			// Write the updated YAML back to the file
			const updatedYaml = yaml.dump(rindexerConfig, {
				lineWidth: -1,
				noRefs: true,
			});

			fs.writeFileSync(rindexerPath, updatedYaml);

			// Ensure abis directory exists
			const abisDir = path.join("/workspace", "abis");
			if (!fs.existsSync(abisDir)) {
				fs.mkdirSync(abisDir, { recursive: true });
			}

			// Save the ABI to the abis folder
			const abiPath = path.join(abisDir, `${name}.abi.json`);

			// If abi is a string, parse it to ensure it's valid JSON before writing
			const abiContent = typeof abi === "string" ? JSON.parse(abi) : abi;
			fs.writeFileSync(abiPath, JSON.stringify(abiContent, null, 2));

			// Restart the rindexer process
			if (globalProcess) {
				console.log("Killing existing rindexer process...");
				globalProcess.kill();
				await globalProcess.exited; // ensure it's fully stopped
			}
			globalProcess = startRindexerProcess();

			return {
				success: true,
				message: `Contract "${name}" has been added to rindexer.yaml and ABI saved to ${abiPath}`,
			};
		} catch (error: any) {
			console.error("Error adding contract:", error);
			return {
				success: false,
				error: error.message || "Failed to add contract",
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
