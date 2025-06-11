export interface AbiItem {
	type: "function" | "event" | "constructor" | "fallback" | "receive";
	name?: string;
	inputs?: Array<{
		name: string;
		type: string;
		indexed?: boolean;
	}>;
	outputs?: Array<{
		name: string;
		type: string;
	}>;
	stateMutability?: "pure" | "view" | "nonpayable" | "payable";
	anonymous?: boolean;
}

export type ContractAbi = AbiItem[];
export interface AddContractRequest {
	name: string;
	report_id: string;
	network: string;
	address: string;
	start_block: string;
	abi: ContractAbi | string;
}

export interface RindexerContract {
	name: string;
	details: Array<{
		network: string;
		address: string;
		start_block: string;
	}>;
	abi: string;
}

export interface RindexerConfig {
	name?: string;
	contracts?: RindexerContract[];
	storage?: {
		postgres?: {
			enabled?: boolean;
		};
	};
	[key: string]: any;
}

export interface AddContractsRequest {
	contracts: AddContractRequest[];
}

export interface BatchApiResponse {
	success: boolean;
	results: Array<{
		contract: string;
		success: boolean;
		message?: string;
		error?: string;
	}>;
	error?: string;
}

export class RindexerConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RindexerConfigError";
	}
}

export class ProjectNameMissingError extends RindexerConfigError {
	constructor() {
		super(
			"No 'name' field found in rindexer.yaml. This is required for the service to start.",
		);
		this.name = "ProjectNameMissingError";
	}
}

export class ProjectNameTooLongError extends RindexerConfigError {
	constructor(projectName: string, maxLength: number = 32) {
		super(
			`Project name '${projectName}' is too long. Maximum length is ${maxLength} characters.`,
		);
		this.name = "ProjectNameTooLongError";
	}
}

export class PostgresNotEnabledError extends RindexerConfigError {
	constructor() {
		super(
			"PostgreSQL storage is not enabled in rindexer.yaml. Please set 'storage.postgres.enabled' to true.",
		);
		this.name = "PostgresNotEnabledError";
	}
}
