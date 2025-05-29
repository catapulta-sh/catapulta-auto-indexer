# Catapulta Auto Indexer

This project provides a REST and GraphQL API built with [Elysia](https://elysiajs.com/) and [Bun](https://bun.sh/), designed to automate the indexing of smart contract events deployed by Catapulta users. It uses [Rindexer](https://github.com/joshstevens19/rindexer) for indexing and PostgreSQL as the database.

---

## 🚀 Features

* Automatic indexing of events from deployed contracts
* Query events by contract and event type
* Pagination, sorting and filtering support
* Proxy to Rindexer's GraphQL service
* Add new contracts and dynamically restart the indexer
* Swagger documentation available at `/docs`

---

## 🧱 Architecture

* **Backend:** Bun + Elysia + Swagger
* **Indexer:** Rindexer
* **Database:** PostgreSQL
* **Containers:** Docker + DevContainers

---

## 🛠 Requirements

* Docker and Docker Compose
* VSCode with the **Dev Containers** extension

> **Important**: create a `.env` file in the root directory with the necessary PostgreSQL and app variables:

```dotenv
POSTGRES_HOST=localhost
POSTGRES_PORT=5440
POSTGRES_USER=postgres
POSTGRES_PASSWORD=yourpassword
POSTGRES_DB=postgres

INFURA_API_KEY=your_infura_key
```

---

## 🐳 Usage Instructions

### 1. Clone the repository and enter the project folder

```bash
git clone https://github.com/catapulta-sh/catapulta-auto-indexer.git
cd catapulta-auto-indexer
```

### 2. Open in VSCode and launch Dev Container

Select "Reopen in Container" when prompted by VSCode.

### 3. Start the services

```bash
docker compose up --build
```

This will launch:

* `postgresql` on port `5440`
* `app` with Bun and Elysia on ports `3000` (REST) and `3001` (GraphQL)

---

## 🔌 Available Endpoints

### REST

| Method | Path             | Description                                                     |
| ------ | ---------------- | --------------------------------------------------------------- |
| GET    | `/event-list`    | Lists all event types indexed for a specific contract address   |
| GET    | `/events`        | Returns paginated events for a contract and specific event name |
| POST   | `/graphql`       | Proxy to Rindexer's GraphQL service                             |
| POST   | `/add-contracts` | Adds contracts to `rindexer.yaml` and restarts the indexer      |
| GET    | `/`              | Basic test route (Hello Elysia)                                 |

### Swagger

* Available at: `http://localhost:3000/docs`

---

## 📘 API Usage Examples

### `GET /event-list`

```http
GET /event-list?contract_address=0xABC123...
```
### `GET /events`

````http
GET /events?contract_address=0xABC123...&event_name=Transfer&page_length=10&page=1&sort_order=1&offset=0
````

### `POST /graphql`

```json
{
  "query": "query { allTransfers(first: 5) { nodes { txHash value } } }"
}
```

### `POST /add-contracts`

```json
{
  "contracts": [
    {
      "name": "MyContract",
      "id": "001",
      "network": "ethereum",
      "address": "0xABC123...",
      "start_block": "20000000",
      "abi": [/* ABI JSON */]
    }
  ]
}
```

---

## 📁 Project Structure

```
├── .devcontainer
│   └── devcontainer.json
│   └── docker-compose-dev.yml
├── abis/
├── node_modules/
├── src/
│   └── index.ts
├── bun.lock
├── rindexer.yaml
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── .env
└── README.md
```

---

## ⚙️ Testing & Debugging

* Open `http://localhost:3000/docs` to test endpoints with Swagger UI.
* Use tools like Postman or `curl` for manual testing.
* The `rindexer` process restarts automatically whenever a new contract is added.

---

## 📄 License

MIT © Catapulta Labs
