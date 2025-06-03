import * as fs from "fs-extra";
import * as yaml from "js-yaml";
import {
	type RindexerConfig,
	RindexerConfigError,
	ProjectNameMissingError,
	ProjectNameTooLongError,
	PostgresNotEnabledError,
} from "./types.js";

/**
 * Loads and validates the rindexer configuration
 * Throws an error if the configuration is invalid or missing
 */
export async function loadRindexerConfig(): Promise<{
	projectName: string;
	config: RindexerConfig;
}> {
	const configPath = "/workspace/rindexer.yaml";

	try {
		const configContent = await fs.readFile(configPath, "utf8");
		const config = yaml.load(configContent) as RindexerConfig;

		if (!config.name) {
			throw new ProjectNameMissingError();
		}

		if (config.name.length > 32) {
			throw new ProjectNameTooLongError(config.name);
		}

		if (!config.storage?.postgres?.enabled) {
			throw new PostgresNotEnabledError();
		}

		return {
			projectName: config.name,
			config,
		};
	} catch (error) {
		if (error instanceof RindexerConfigError) {
			throw error; // Re-throw our specific validation errors
		}

		throw new RindexerConfigError(
			`Could not read rindexer.yaml: ${error instanceof Error ? error.message : error}`,
		);
	}
}
