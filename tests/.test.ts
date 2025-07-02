import { ethers } from "ethers";
import { beforeAll, afterAll, describe, test, expect } from "bun:test";
import { startAnvil, stopAnvil } from "../e2e/foundry/anvil";
import { deployMyContract, getContractInstance } from "../e2e/foundry/deploy";

import fs from "fs";
import yaml from "js-yaml";

let contractAddress: string;
let contractName : string;

beforeAll(async () => {
  await stopAnvil();
  await startAnvil();
   
  contractName = "Bank"
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


function containsPartial(full: any, partial: any): boolean {
  if (typeof partial !== "object" || partial === null) {
    return partial === full;
  }

  if (Array.isArray(partial)) {
    if (!Array.isArray(full)) return false;
    return partial.every((partialItem) =>
      full.some((fullItem) => containsPartial(partialItem, fullItem))
    );
  }

  return Object.entries(partial).every(([key, value]) =>
    key in full && containsPartial(value, full[key])
  );
}

describe("E2E Flow", () => {
  
  /*
    0) Prepare data to send to rindexer.
    1) Send contract to rindexer via POST.
    2) Expected successfull response. 
    3) Access to YAML created.
    4) Make sure the contract were added with the events. TODO
  */
  test("Contract added to the rindexer and YAML is correct.", async () => {
    
    //0) Prepare data to send to rindexer.
    const contractNetwork = "anvil";
    const abi = [
      {
        type: "function",
        name: "ping",
        stateMutability: "nonpayable",
        inputs: [],
        outputs: []
      },
      {
        type: "event",
        name: "Pong",
        inputs: [
          {
            name: "sender",
            type: "address",
            indexed: true
          }
        ],
        anonymous: false
      }
    ];

    //1) Send contract to rindexer via POST
    const response = await fetch("http://localhost:3000/add-contract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: contractName,
        network: contractNetwork,
        address: contractAddress,
        start_block: "0",
        abi: abi
      }),
    });

    const data = await response.json(); //DEBUG
    console.log(data); //DEBUG
    
    //2) Expected successful response.
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);

    //3) Access to YAML created
    const rindexerYamlPath = "rindexer.yaml"; 
    expect(rindexerYamlPath).not.toBe("");
    const expectedYamlPath = "/workspace/tests/expected.yaml";

    const rindexerParsedYaml = yaml.load(fs.readFileSync(rindexerYamlPath, "utf8"));
    const expectedParsedYaml = yaml.load(fs.readFileSync(expectedYamlPath, "utf8"));
    
    const matches = rindexerParsedYaml.contracts.some((contract: any) =>
      containsPartial(contract, expectedParsedYaml)
    );
    expect(matches).toBe(true);

  });

  /*
    0) Prepare data to send to rindexer.
    1) Send contract to rindexer via POST.
    2) Receive list of types of events from PostgreSQL via GET. 
    3) Expected successfull response.
    4) Make sure the types of events corresponds to the expected ones.
  */
  test("List of types of events from contract via PostgreSQL recieved correctly.", async () => {
    //0) Prepare data to send to rindexer.
    const contractNetwork = "anvil";
    const abi = [
      {
        type: "function",
        name: "ping",
        stateMutability: "nonpayable",
        inputs: [],
        outputs: []
      },
      {
        type: "event",
        name: "Pong",
        inputs: [
          {
            name: "sender",
            type: "address",
            indexed: true
          }
        ],
        anonymous: false
      }
    ];

    //1) Send contract to rindexer via POST
    const responseReindexer = await fetch("http://localhost:3000/add-contract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: contractName,
        network: contractNetwork,
        address: contractAddress,
        start_block: "0",
        abi: abi
      }),
    });
    
    //2) Receive list of types of events from PostgreSQL via GET. 
    const response = await fetch(`http://localhost:3000/events?${contractAddress}`);
    const data = await response.json(); //DEBUG
    console.log(data); //DEBUG

    //3) Expected successfull response.
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);

    //4) Make sure the types of events corresponds to the expected ones.
    const expectedEvents = ["Deposit","Withdraw", "Transfer","OwnerChanged"]; //From Bank.sol
    const actualEvents = response.json; //Array with names of the types of events. 
  
    expect(actualEvents.length == expectedEvents.length).toBe(true);
    expect(containsPartial(actualEvents, expectedEvents)).toBe(true);

  });

  /*
    0) Prepare data to send to rindexer.
    1) Send contract to rindexer via POST.
    2) Receive list of events from PostgreSQL via GET.  
    3) Expected successfull response.
    4) Make sure the events corresponds to the expected ones.
  */
  test("List of events lauched by the contract via PostgreSQL received correctly.", async () => {
    //0) Prepare data to send to rindexer.
    const contractNetwork = "anvil";
    const abi = [
      {
        type: "function",
        name: "ping",
        stateMutability: "nonpayable",
        inputs: [],
        outputs: []
      },
      {
        type: "event",
        name: "Pong",
        inputs: [
          {
            name: "sender",
            type: "address",
            indexed: true
          }
        ],
        anonymous: false
      }
    ];

    //1) Send contract to rindexer via POST
    const responseReindexer = await fetch("http://localhost:3000/add-contract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: contractName,
        network: contractNetwork,
        address: contractAddress,
        start_block: "0",
        abi: abi
      }),
    });

    //2) Receive list of events from PostgreSQL via GET.
        const params = new URLSearchParams({
      contract_address: contractAddress,
      event_name: contractName,
      page_length: "10",
      page: "1",
      sort_order: "1",
      offset: "0",
    });

    const response = await fetch(`http://localhost:3000/events?${params.toString()}`);
    const data = await response.json(); //DEBUG
    console.log(data); //DEBUG

    //3)Expected successfull response.
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);

    //4) Expected successfull response.
    
  });
  
  test("Check contains YAML partial inside YAML.", async () => {
    const rindexerYamlPath = "rindexer.yaml"; 
    expect(rindexerYamlPath).not.toBe("");
    const expectedYamlPath = "/workspace/tests/expected.yaml";
     
    const rindexerParsedYaml = yaml.load(fs.readFileSync(rindexerYamlPath, "utf8"));
    const expectedParsedYaml = yaml.load(fs.readFileSync(expectedYamlPath, "utf8"));

    const matches = rindexerParsedYaml.contracts.some((contract: any) =>
      containsPartial(contract, expectedParsedYaml)
    );

    expect(matches).toBe(true);

  });
  
});

