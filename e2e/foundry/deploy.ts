import { ethers } from "ethers";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";


export async function deployMyContract(contractName: string): Promise<string> {
  const provider = new ethers.JsonRpcProvider("http://localhost:8545");
  const signer = await provider.getSigner(0);

  const artifactPath = resolve(`e2e/foundry/out/${contractName}.sol/${contractName}.json`);
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
  const contract = await factory.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("Contract deployed at:", address);
  return address;
}

export async function getContractInstance(address: string, contractName: string) {
  const provider = new ethers.JsonRpcProvider("http://localhost:8545");
  const signer = await provider.getSigner(0);

  const artifactPath = resolve(`e2e/foundry/out/${contractName}.sol/${contractName}.json`);
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));

  return new ethers.Contract(address, artifact.abi, signer);
}
