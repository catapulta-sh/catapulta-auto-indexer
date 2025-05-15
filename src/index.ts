import { Elysia, status } from 'elysia';
import fs from 'fs';
const YAML = require('yaml');

// Ruta de YAML y carpeta ABI
const YAML_PATH = './config/rindexer.yaml';
const ABIS_DIR = './abis';

const app = new Elysia();

app.get('/', () => 'API de Catapulta Indexer funcionando correctamente.');

app.post('/index-contracts', async ({ body }) => {
    const { contract_name, report_id, network_name, contract_address, abi, deployment_block_number } = body as any;

    if (!contract_name || !report_id || !network_name || !contract_address || !abi || !deployment_block_number) {
        return { status: 'error', message: 'Faltan parámetros' };
    }

    // Guardar ABI en carpeta abis
    const abiPath = `${ABIS_DIR}/${contract_name}.json`;
    fs.writeFileSync(abiPath, JSON.stringify(abi, null, 2));
    console.log(`ABI guardado en ${abiPath}`);

    // Leer o crear YAML
    let config = { contracts: [] as any[]};
    if (fs.existsSync(YAML_PATH)) {
        config = YAML.parse(fs.readFileSync(YAML_PATH, 'utf8'));
    }

    // Añadir contrato
    config.contracts.push({
        contract_name: contract_name,
        report_id,
        network_name: network_name,
        contract_address: contract_address,
        abi: abiPath,
        deployment_block_number: deployment_block_number
    });

    fs.writeFileSync(YAML_PATH, YAML.stringify(config), 'utf8');
    console.log(`Contrato añadido en ${YAML_PATH}`);

    // Simular reinicio Rindexer
    console.log('Ahora se debería reiniciar Rindexer...');

    return { status: 'ok', message: 'Contrato indexado y Rindexer reiniciado' };
});

// Ruta GET /event-list (simulada)
app.get('/event-list', () => {
    return {message: "Método no implementado todavía."}
});

// Ruta GET /events (simulada)
app.get('/events', () => {
    return {message: "Método no implementado todavía" };
});

// Lanzar servidor en 3000
app.listen(3000);
console.log('API Catapulta Indexer corriendo en http://localhost:3000');
