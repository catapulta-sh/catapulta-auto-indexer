/**
 * Helper utilities for Rindexer configuration and contract management.
 */

import { customAlphabet } from "nanoid";
import { Client } from "pg";
import * as fs from "fs-extra";
import * as path from "path";
import * as yaml from "js-yaml";
import type {
	AddContractRequest,
	AddContractsRequest,
	ContractAbi,
	RindexerConfig,
	RindexerContract,
} from "./types.js";

// ===== CONSTANTS =====

/**
 * Application constants. Database settings configurable via environment variables.
 */
export const APP_CONSTANTS = {
	CONFIG_FILE_PATH: "/workspace/rindexer.yaml",
	ABIS_DIR: "/workspace/abis",
	SERVER_PORT: 3000,
	GRAPHQL_PORT: 3001,
	MAX_CONTRACTS_PER_REQUEST: 50,
	CORS_ORIGINS: process.env.CORS_ORIGINS,
	DB: {
		HOST: process.env.POSTGRES_HOST || "localhost",
		PORT: parseInt(process.env.POSTGRES_PORT || "5432"),
		DATABASE: process.env.POSTGRES_DB || "rindexer",
		USER: process.env.POSTGRES_USER || "postgres",
		PASSWORD: process.env.POSTGRES_PASSWORD || "rindexer",
	},
} as const;

// Cached project name to avoid repeated file system reads
let cachedProjectName: string | null = null;

/**
 * Retrieves the project name from configuration with caching.
 */
export async function getProjectName(): Promise<string> {
	if (cachedProjectName === null) {
		const { projectName } = await loadRindexerConfig();
		cachedProjectName = projectName;
	}
	return cachedProjectName;
}

/**
 * Parses CORS origins from environment variables.
 * Expects a JSON array like ["*"] or ["http://localhost:3000", "https://yourdomain.com"]
 */
export function getCorsOrigins(): string[] {
	if (!APP_CONSTANTS.CORS_ORIGINS) {
		throw new Error(
			'CORS_ORIGINS environment variable is required. Please set it to a JSON array like ["*"] or ["http://localhost:3000"]',
		);
	}

	try {
		const origins = JSON.parse(APP_CONSTANTS.CORS_ORIGINS);
		if (!Array.isArray(origins)) {
			throw new Error("CORS_ORIGINS must be a valid JSON array");
		}
		return origins;
	} catch (error) {
		if (
			error instanceof Error &&
			error.message.includes("CORS_ORIGINS must be")
		) {
			throw error;
		}
		throw new Error(
			'CORS_ORIGINS must be a valid JSON array. Example: ["*"] or ["http://localhost:3000"]',
		);
	}
}

// Custom alphabet for generating unique indexer IDs
const NANOID_ALPHABET = "_abcdefghijklmnopqrstuvwxyz";
const NANOID_LENGTH = 10;

// ===== UTILITIES =====

const generateNanoid = customAlphabet(NANOID_ALPHABET, NANOID_LENGTH);

export function parseAbi(abi: ContractAbi | string): ContractAbi {
	return typeof abi === "string" ? JSON.parse(abi) : abi;
}

export function toSnakeCase(str: string): string {
	return str
		.replace(/([A-Z])/g, "_$1")
		.toLowerCase()
		.replace(/^_/, "");
}

function isValidEthereumAddress(address: string): boolean {
	return /^0x[a-fA-F0-9]{40}$/.test(address);
}

// ===== DATABASE =====

export function createDatabaseClient(): Client {
	return new Client({
		host: APP_CONSTANTS.DB.HOST,
		port: APP_CONSTANTS.DB.PORT,
		database: APP_CONSTANTS.DB.DATABASE,
		user: APP_CONSTANTS.DB.USER,
		password: APP_CONSTANTS.DB.PASSWORD,
	});
}

/**
 * Connects to PostgreSQL database. Exits process on failure.
 */
export async function connectDatabase(client: Client): Promise<void> {
	try {
		await client.connect();
		console.log("✅ Database connected successfully");
	} catch (error) {
		console.error("❌ Database connection failed:", error);
		process.exit(1);
	}
}

// ===== PROCESS MANAGEMENT =====

let globalProcess: any | undefined;

export function initializeRindexerProcess(): void {
	console.log("🚀 Starting rindexer process...");

	const proc = Bun.spawn({
		cmd: ["/app/rindexer", "start", "all"],
		stdout: "inherit",
		stderr: "inherit",
		onExit: (proc, exitCode, signalCode, error) => {
			console.log(
				`🔴 Rindexer process exited with code: ${exitCode}, signal: ${signalCode}`,
			);
			if (error) {
				console.error("❌ Rindexer process error on exit:", error);
			}
			if (globalProcess === proc) {
				globalProcess = undefined;
			}
		},
	});

	globalProcess = proc;
}

/**
 * Gracefully restarts the Rindexer process.
 */
export async function restartRindexerProcess(): Promise<void> {
	console.log("🔄 Restarting rindexer process...");

	if (globalProcess) {
		console.log("Terminating existing rindexer process...");

		globalProcess.kill("SIGTERM");

		// Force kill after 5 seconds if graceful shutdown fails
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

	await new Promise((resolve) => setTimeout(resolve, 1000));
	initializeRindexerProcess();

	console.log("✅ Rindexer process restarted successfully");
}

// ===== CONFIG MANAGEMENT =====

/**
 * Loads and validates the Rindexer configuration from rindexer.yaml.
 */
export async function loadRindexerConfig(): Promise<{
	projectName: string;
	config: RindexerConfig;
}> {
	try {
		const configContent = await fs.readFile(
			APP_CONSTANTS.CONFIG_FILE_PATH,
			"utf8",
		);
		const config = yaml.load(configContent) as RindexerConfig;

		if (!config.name) {
			throw new Error(
				"Project name is missing from rindexer.yaml configuration",
			);
		}

		// PostgreSQL has a 63-character limit for database names
		if (config.name.length > 63) {
			throw new Error("Project name must be 63 characters or less");
		}

		if (!config.storage?.postgres?.enabled) {
			throw new Error(
				"PostgreSQL must be enabled in rindexer.yaml configuration",
			);
		}

		return { projectName: config.name, config };
	} catch (error) {
		if (error instanceof Error) {
			throw error;
		}
		throw new Error("Failed to load or parse rindexer.yaml configuration file");
	}
}

/**
 * Updates the Rindexer configuration file with new contracts.
 */
export async function updateRindexerConfig(
	newContracts: RindexerContract[],
): Promise<void> {
	const { config } = await loadRindexerConfig();

	if (!config.contracts) {
		config.contracts = [];
	}

	// Use Map for efficient O(1) lookups when merging contracts
	const existingContractsMap = new Map<string, RindexerContract>();
	for (const contract of config.contracts) {
		existingContractsMap.set(contract.name, contract);
	}

	for (const newContract of newContracts) {
		existingContractsMap.set(newContract.name, newContract);
	}

	config.contracts = Array.from(existingContractsMap.values());

	const yamlStr = yaml.dump(config, { indent: 2, lineWidth: -1 });
	await fs.writeFile(APP_CONSTANTS.CONFIG_FILE_PATH, yamlStr, "utf8");
}

// ===== VALIDATION =====

export function validateBatchRequest(
	body: Partial<AddContractsRequest>,
): string | null {
	if (!body.contracts || !Array.isArray(body.contracts)) {
		return "Missing or invalid 'contracts' array";
	}
	if (body.contracts.length === 0) {
		return "Contracts array cannot be empty";
	}
	if (body.contracts.length > APP_CONSTANTS.MAX_CONTRACTS_PER_REQUEST) {
		return `Maximum ${APP_CONSTANTS.MAX_CONTRACTS_PER_REQUEST} contracts allowed per batch`;
	}
	return null;
}

export function validateContract(contract: AddContractRequest): string | null {
	if (!contract.name || typeof contract.name !== "string") {
		return "Contract name is required and must be a string";
	}

	if (!contract.report_id || typeof contract.report_id !== "string") {
		return "Report ID is required and must be a string";
	}

	if (!contract.address || typeof contract.address !== "string") {
		return "Contract address is required and must be a string";
	}

	if (!isValidEthereumAddress(contract.address)) {
		return "Invalid Ethereum address format";
	}

	if (!contract.abi) {
		return "Contract ABI is required";
	}

	try {
		parseAbi(contract.abi);
	} catch {
		return "Invalid ABI format - must be valid JSON";
	}

	return null;
}

// ===== CONTRACT PROCESSING =====

export interface ProcessedContract {
	contract: RindexerContract;
	abiFile: { filename: string; content: string };
	indexerId: string;
	isNewContract: boolean;
}

/**
 * Processes a contract request into Rindexer configuration format.
 * Creates or retrieves indexer ID and handles database mapping.
 */
export async function processContract(
	contractRequest: AddContractRequest,
	client: Client,
): Promise<ProcessedContract> {
	const abi = parseAbi(contractRequest.abi);

	// Create composite key for unique contract identification
	const nameUuid = `${contractRequest.name}_${contractRequest.report_id}`;
	console.log(`Processing contract: ${nameUuid}`);

	// Check if contract already exists in mapping table
	const existingResult = await client.query(
		"SELECT indexer_id FROM name_uuid_indexer_id_mapping WHERE name_uuid = $1",
		[nameUuid],
	);

	let indexerId: string;
	let isNewContract: boolean;

	if (existingResult.rows.length > 0) {
		indexerId = existingResult.rows[0].indexer_id;
		isNewContract = false;
	} else {
		indexerId = generateNanoid();
		await client.query(
			"INSERT INTO name_uuid_indexer_id_mapping (name_uuid, indexer_id) VALUES ($1, $2)",
			[nameUuid, indexerId],
		);
		isNewContract = true;
	}

	const abiFilename = `${indexerId}.abi.json`;

	const contract: RindexerContract = {
		name: indexerId,
		details: [
			{
				network: contractRequest.network,
				address: contractRequest.address,
				start_block: contractRequest.start_block,
			},
		],
		abi: `./${path.relative("/workspace", path.join(APP_CONSTANTS.ABIS_DIR, abiFilename))}`,
	};

	return {
		contract,
		abiFile: {
			filename: abiFilename,
			content: JSON.stringify(abi, null, 2),
		},
		indexerId,
		isNewContract,
	};
}

/**
 * Prepares processed contracts for batch operations with deduplication.
 */
export function prepareContractBatch(processedContracts: ProcessedContract[]): {
	contracts: RindexerContract[];
	abiFiles: { filename: string; content: string }[];
} {
	const contractsMap = new Map<string, RindexerContract>();
	const abiFilesMap = new Map<string, string>();

	for (const processed of processedContracts) {
		contractsMap.set(processed.contract.name, processed.contract);
		abiFilesMap.set(processed.abiFile.filename, processed.abiFile.content);
	}

	return {
		contracts: Array.from(contractsMap.values()),
		abiFiles: Array.from(abiFilesMap.entries()).map(([filename, content]) => ({
			filename,
			content,
		})),
	};
}

export async function writeAbiFiles(
	abiFiles: { filename: string; content: string }[],
): Promise<void> {
	await fs.ensureDir(APP_CONSTANTS.ABIS_DIR);

	for (const abiFile of abiFiles) {
		const filePath = path.join(APP_CONSTANTS.ABIS_DIR, abiFile.filename);
		await fs.writeFile(filePath, abiFile.content, "utf8");
	}
}

/**
 * Processes a batch of contract requests with validation and error handling.
 * Returns both API response results and successfully processed contracts.
 */
export async function processContractBatch(
	contracts: AddContractRequest[],
	client: Client,
): Promise<{
	results: import("./types.js").BatchApiResponse["results"];
	processedContracts: ProcessedContract[];
}> {
	const results: import("./types.js").BatchApiResponse["results"] = [];
	const processedContracts: ProcessedContract[] = [];

	for (const contract of contracts) {
		const nameUuid = `${contract.name}_${contract.report_id}`;

		const validationError = validateContract(contract);
		if (validationError) {
			results.push({
				contract: nameUuid,
				success: false,
				error: validationError,
			});
			continue;
		}

		try {
			const processed = await processContract(contract, client);
			processedContracts.push(processed);

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
