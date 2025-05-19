// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

contract Bank {
    address public owner;
    uint256 public balance;

    // Eventos
    event Deposit(address from, uint256 amount);
    event Withdraw(address to, uint256 amount);
    event Transfer(address from, address to, uint256 amount);
    event OwnerChanged(address oldOwner, address newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can execute.");
        _;
    }

    constructor() {
        owner = msg.sender;
        balance = 0;
    }

    function deposit() external payable {
        require(msg.value > 0, "Cannot deposit 0 ETH");
        balance += msg.value;
        emit Deposit(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external onlyOwner {
        require(amount <= balance, "Insufficient funds");
        balance -= amount;
        payable(owner).transfer(amount);
        emit Withdraw(owner, amount);
    }

    function transferFunds(address adr, uint256 amount) external onlyOwner {
        require(amount <= balance, "Insufficient funds");
        balance -= amount;
        payable(adr).transfer(amount);
        emit Transfer(owner, adr, amount);
    }

    function changeOwner(address newOwner) external onlyOwner {
        address oldOwner = owner;
        owner = newOwner;
        emit OwnerChanged(oldOwner, newOwner);
    }

    function getBalance() public view returns (uint256) {
        return balance;
    }


}
