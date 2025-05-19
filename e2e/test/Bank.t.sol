// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test, console} from "forge-std/Test.sol";
import {Bank} from "../src/Bank.sol";

contract BankTest is Test {
    Bank bank;
    //TODO
        //SETUP
            //Conectarse con la base de datos
        //Contrato Desplegado
        //Contrato es añadido al rindexer mediante POST
        //Leer el YALM del contrato mediante GET
        //Evento se lanza y se detecta
        //Evento se lee mediante SQL a postgres.
    //

    function setUp() public {
        bank = new Bank();
    }

    function Contract_Deployed() public{
        //Llamada API para obtener el contrato
        //Hago el deploy de ese contrato
        //Compruebo que se ha añadido
    }
}
