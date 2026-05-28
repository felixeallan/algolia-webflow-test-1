import { NextRequest, NextResponse } from 'next/server'

interface WebflowItem {
  id: string
  fieldData: Record<string, unknown>
  isDraft: boolean
  isArchived: boolean
}

interface WebflowResponse {
  items: WebflowItem[]
  pagination: { limit: number; offset: number; total: number }
}

interface WebflowField {
  slug: string
  type: string
  validations?: {
    options?: { id: string; name: string }[]
    collectionId?: string
  }
}

interface WebflowSchema {
  fields: WebflowField[]
}

// name resolvers: field slug → (id → name string)
type Resolvers = Map<string, Map<string, string>>
// data resolvers: field slug → (id → full fieldData of referenced item)
type DataResolvers = Map<string, Map<string, Record<string, unknown>>>

async function fetchAllItems(token: string, collectionId: string): Promise<WebflowItem[]> {
  const all: WebflowItem[] = []
  let offset = 0
  const limit = 100

  while (true) {
    const res = await fetch(
      `https://api.webflow.com/v2/collections/${collectionId}/items?limit=${limit}&offset=${offset}`,
      { headers: { Authorization: `Bearer ${token}`, 'accept-version': '1.0.0' } }
    )
    if (!res.ok) throw new Error(`Webflow API error: ${res.status}`)
    const data: WebflowResponse = await res.json()
    all.push(...data.items)
    if (all.length >= data.pagination.total) break
    offset += limit
  }

  return all
}

async function buildResolvers(
  token: string,
  collectionId: string
): Promise<{ nameResolvers: Resolvers; dataResolvers: DataResolvers }> {
  const nameResolvers: Resolvers = new Map()
  const dataResolvers: DataResolvers = new Map()

  const res = await fetch(`https://api.webflow.com/v2/collections/${collectionId}`, {
    headers: { Authorization: `Bearer ${token}`, 'accept-version': '1.0.0' },
  })
  if (!res.ok) return { nameResolvers, dataResolvers }

  const schema: WebflowSchema = await res.json()

  for (const field of schema.fields) {
    // Option fields: resolve IDs from the schema itself
    if (field.type === 'Option' && field.validations?.options?.length) {
      const map = new Map<string, string>()
      for (const opt of field.validations.options) {
        map.set(opt.id, opt.name)
      }
      nameResolvers.set(field.slug, map)
    }

    // Reference fields: fetch the referenced collection
    if ((field.type === 'ItemRef' || field.type === 'Reference' || field.type === 'MultiReference') && field.validations?.collectionId) {
      const refItems = await fetchAllItems(token, field.validations.collectionId)
      const nameMap = new Map<string, string>()
      const dataMap = new Map<string, Record<string, unknown>>()
      for (const item of refItems) {
        const name = (item.fieldData.name ?? item.fieldData.slug ?? item.id) as string
        nameMap.set(item.id, name)
        dataMap.set(item.id, item.fieldData)
      }
      nameResolvers.set(field.slug, nameMap)
      dataResolvers.set(field.slug, dataMap)
    }
  }

  return { nameResolvers, dataResolvers }
}

function resolveFields(
  fieldData: Record<string, unknown>,
  nameResolvers: Resolvers,
  dataResolvers: DataResolvers
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(fieldData)) {
    const nameResolver = nameResolvers.get(key)
    if (nameResolver) {
      if (Array.isArray(value)) {
        resolved[key] = value.map((id) => nameResolver.get(id as string) ?? id)
      } else if (typeof value === 'string') {
        resolved[key] = nameResolver.get(value) ?? value
      } else {
        resolved[key] = value
      }

      // Also store all sub-fields as key__subfield for dot-notation binding
      const dataResolver = dataResolvers.get(key)
      if (dataResolver && typeof value === 'string') {
        const refData = dataResolver.get(value)
        if (refData) {
          for (const [subKey, subValue] of Object.entries(refData)) {
            resolved[`${key}__${subKey}`] = subValue
          }
        }
      }
    } else {
      resolved[key] = value
    }
  }

  return resolved
}

async function algoliaIndexObjects(
  appId: string,
  apiKey: string,
  indexName: string,
  objects: Record<string, unknown>[]
): Promise<void> {
  const requests = objects.map((obj) => ({ action: 'updateObject', body: obj }))
  const chunkSize = 1000
  for (let i = 0; i < requests.length; i += chunkSize) {
    const chunk = requests.slice(i, i + chunkSize)
    const res = await fetch(`https://${appId}.algolia.net/1/indexes/${indexName}/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Algolia-Application-Id': appId,
        'X-Algolia-API-Key': apiKey,
      },
      body: JSON.stringify({ requests: chunk }),
    })
    if (!res.ok) throw new Error(`Algolia batch error: ${res.status} ${await res.text()}`)
  }
}

export async function GET() {
  return NextResponse.json({ ok: true })
}

export async function PUT(request: NextRequest) {
  const syncSecret = process.env.SYNC_SECRET
  const auth = request.headers.get('authorization')
  if (!syncSecret || auth !== `Bearer ${syncSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const token = process.env.WEBFLOW_API_TOKEN!
  const collectionId = process.env.WEBFLOW_COLLECTION_ID!
  const res = await fetch(`https://api.webflow.com/v2/collections/${collectionId}`, {
    headers: { Authorization: `Bearer ${token}`, 'accept-version': '1.0.0' },
  })
  const schema = await res.json()
  return NextResponse.json(schema)
}

export async function POST(request: NextRequest) {
  const syncSecret = process.env.SYNC_SECRET
  const auth = request.headers.get('authorization')

  if (!syncSecret || auth !== `Bearer ${syncSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const webflowToken = process.env.WEBFLOW_API_TOKEN!
    const collectionId = process.env.WEBFLOW_COLLECTION_ID!
    const algoliaAppId = process.env.ALGOLIA_APP_ID!
    const algoliaKey = process.env.ALGOLIA_ADMIN_API_KEY!
    const indexName = process.env.ALGOLIA_INDEX_NAME!

    // Build resolvers for Option and Reference fields
    const { nameResolvers, dataResolvers } = await buildResolvers(webflowToken, collectionId)

    const items = await fetchAllItems(webflowToken, collectionId)
    const published = items.filter((item) => !item.isDraft && !item.isArchived)

    const records = published.map((item) => ({
      objectID: item.id,
      ...resolveFields(item.fieldData, nameResolvers, dataResolvers),
    }))

    await algoliaIndexObjects(algoliaAppId, algoliaKey, indexName, records)

    return NextResponse.json({ success: true, synced: records.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
