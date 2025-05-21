import { Elysia } from 'elysia'
import { Client } from 'pg'

const app = new Elysia()

// Configuración de PostgreSQL
const client = new Client({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: Number(process.env.POSTGRES_PORT) || 5432,
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'password',
  database: process.env.POSTGRES_DB || 'postgres',
})

await client.connect()

// GET /event-list
app.get('/event-list', async ({ query }: {query: { contract_address: string }}) => {
    const address = query.contract_address.toLowerCase()

    const schema = 'catapulta_auto_indexer_rocket_pool_eth'

    // Obtener todas las tablas del esquema
   const result = await client.query<{ table_name: string }>(
      `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = $1
    `,
      [schema]
    )

    const eventTables = result.rows.map((r) => r.table_name)

    const events: string[] = []

    for (const table of eventTables) {
      const result = await client.query<{ has_event: boolean }>(
        `
        SELECT EXISTS (
          SELECT 1 
          FROM ${schema}."${table}"
          WHERE LOWER(contract_address) = $1
          LIMIT 1
        ) AS has_event
      `,
        [address]
      )

      if (result.rows[0]?.has_event) {
        events.push(table)
      }
    }

    return { events }
  }
)

app.get('/events', async ({ query }: { query: {
      contract_address: string
      event_name: string
      page_length: number
      page: number
      sort_order: number
      offset: number
    }}) => {
    const {
      contract_address,
      event_name,
      page_length,
      page,
      sort_order,
      offset
    } = query

    const schema = 'catapulta_auto_indexer_rocket_pool_eth'
    const table = event_name.toLowerCase()
    const address = contract_address.toLowerCase()

    const limit = page_length || 10
    const skip = offset || (page - 1) * limit
    const order = sort_order === 1 ? 'ASC' : 'DESC'

    const result = await client.query(
      `
      SELECT * FROM ${schema}."${table}"
      WHERE LOWER(contract_address) = $1
      ORDER BY block_number ${order}
      LIMIT $2 OFFSET $3
    `,
      [address, limit, skip]
    )

    return {
      events: result.rows
    }
  }
)

// Proxy a graphql
app.post('/graphql', async ({ request }) => {
  const body = await request.json()

  if (!body?.query) {
    return { error: 'The field "query" is required.' }
  }

  const response = await fetch('http://localhost:3001/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })

  return await response.json()
})


// Ruta base
app.get('/', () => 'Hello Elysia')

// Iniciar servidor
app.listen(3000, () => {
  console.log(
    `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
  )
})
