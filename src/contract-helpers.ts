import type {
    AddContractRequest,
    AddContractsRequest,
    RindexerContract,
    RindexerConfig,
    ContractAbi
} from './types.js';
import * as yaml from 'js-yaml';
import * as fs from 'fs-extra';
import * as path from 'path';

// Simple validation functions
export function validateBatchRequest(body: Partial<AddContractsRequest>): string | null {
    if (!body.contracts || !Array.isArray(body.contracts)) {
        return "Missing or invalid 'contracts' array";
    }
    if (body.contracts.length === 0) {
        return "Contracts array cannot be empty";
    }
    if (body.contracts.length > 50) {
        return "Maximum 50 contracts allowed per batch";
    }
    return null;
}

export function validateContract(contract: Partial<AddContractRequest>): string | null {
    const required = ['name', 'network', 'address', 'start_block', 'abi', 'id'] as const;
    const missing = required.filter(field => !contract[field]);

    if (missing.length > 0) {
        return `Missing required fields: ${missing.join(', ')}`;
    }

    // Basic address validation
    if (contract.address && !/^0x[a-fA-F0-9]{40}$/.test(contract.address)) {
        return 'Invalid Ethereum address format';
    }

    return null;
}

export function parseAbi(abi: ContractAbi | string): ContractAbi {
    return typeof abi === 'string' ? JSON.parse(abi) : abi;
}

// Contract processing
export function processContract(contract: AddContractRequest) {
    const contractName = `${contract.name}_${contract.id}`;

    const rindexerContract: RindexerContract = {
        name: contractName,
        details: [{
            network: contract.network,
            address: contract.address,
            start_block: contract.start_block,
        }],
        abi: `./abis/${contractName}.abi.json`,
    };

    const abiFile = {
        path: path.join('/workspace', 'abis', `${contractName}.abi.json`),
        content: parseAbi(contract.abi),
    };

    return { contractName, rindexerContract, abiFile };
}

// Configuration management
export async function updateRindexerConfig(
    newContracts: RindexerContract[],
    contractsToRemove: string[] = []
): Promise<void> {
    const configPath = '/workspace/rindexer.yaml';
    const content = await fs.readFile(configPath, 'utf8');
    const config = yaml.load(content) as RindexerConfig;

    if (!config.contracts) {
        config.contracts = [];
    }

    // Remove contracts that will be replaced
    if (contractsToRemove.length > 0) {
        config.contracts = config.contracts.filter(c => !contractsToRemove.includes(c.name));
    }

    // Add new contracts
    config.contracts.push(...newContracts);

    // Write back
    const updatedYaml = yaml.dump(config, { lineWidth: -1, noRefs: true });
    await fs.writeFile(configPath, updatedYaml);
}

export async function writeAbiFiles(abiFiles: Array<{ path: string; content: any }>): Promise<void> {
    await fs.ensureDir('/workspace/abis');

    await Promise.all(
        abiFiles.map(({ path, content }) =>
            fs.writeFile(path, JSON.stringify(content, null, 2))
        )
    );
}
