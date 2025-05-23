import { ethers } from "ethers";
import { beforeAll, afterAll, describe, test, expect } from "bun:test";
import { startAnvil, stopAnvil } from "../e2e/foundry/anvil";
import { deployMyContract, getContractInstance } from "../e2e/foundry/deploy";
let contractAddress: string;

beforeAll(async () => {
  await stopAnvil();
  await startAnvil(); //Start Anvil in that port.
  const contractName = "Bank"
  contractAddress = await deployMyContract(contractName); //Deploy contract and get its address.

  //Call some functions (with events).
  const contract = await getContractInstance(contractAddress, contractName);
  let tx1 = await contract.deposit({ value: ethers.parseEther("5.0") });
  await tx1.wait();
  console.log("Transaction deposit made, balance:", await contract.getBalance());
  let tx2 = await contract.deposit({ value: ethers.parseEther("5.0") });
  await tx2.wait();
  console.log("Transaction deposit made, balance:", await contract.getBalance());
  let tx3 = await contract.withdraw(ethers.parseEther("3.0"));
  await tx3.wait();
  console.log("Transaction withdraw made, balance:", await contract.getBalance());

});

afterAll(() => {
  stopAnvil();
});

describe("E2E Blockchain Flow", () => {
  test("Contract added to the rindexer", async () => {
    //const result = await addToRindexer(contractAddress);
    //expect(result.ok).toBe(true);
  });

  test("Contract YAML readed", async () => {
    //const yaml = await getYaml(contractAddress);
    //expect(yaml).toContain("contract:");
  });

  test("Event Detected", async () => {
    // Lógica para emitir eventos (llamar método del contrato)
    // Espera un poco, luego lee de PostgreSQL
    //const events = await readFromPostgres(contractAddress);
    //expect(events.length).toBeGreaterThan(0);
  });
});
