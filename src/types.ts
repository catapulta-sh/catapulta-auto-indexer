// More specific ABI types
export interface AbiItem {
    type: 'function' | 'event' | 'constructor' | 'fallback' | 'receive';
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
    stateMutability?: 'pure' | 'view' | 'nonpayable' | 'payable';
    anonymous?: boolean;
}

export type ContractAbi = AbiItem[];

// Contract-related interfaces
export interface AddContractRequest {
    name: string;
    network: string;
    address: string;
    start_block: string;
    abi: ContractAbi | string;
    id: string;
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
    contracts?: RindexerContract[];
    [key: string]: any;
}

// API-related interfaces
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


