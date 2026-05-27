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

async function algoliaIndexObjects(
  appId: string,
  apiKey: string,
  indexName: string,
  objects: Record<string, unknown>[]
): Promise<void> {
  const requests = objects.map((obj) => ({ action: 'updateObject', body: obj }))
  // Algolia batch endpoint accepts max 1000 objects per request
  const chunkSize = 1000
  for (let i = 0; i < requests.length; i += chunkSize) {
    const chunk = requests.slice(i, i + chunkSize)
    const res = await fetch(
      `https://${appId}.algolia.net/1/indexes/${indexName}/batch`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Algolia-Application-Id': appId,
          'X-Algolia-API-Key': apiKey,
        },
        body: JSON.stringify({ requests: chunk }),
      }
    )
    if (!res.ok) throw new Error(`Algolia batch error: ${res.status} ${await res.text()}`)
  }
}

export async function GET() {
  return NextResponse.json({ ok: true })
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

    const items = await fetchAllItems(webflowToken, collectionId)
    const published = items.filter((item) => !item.isDraft && !item.isArchived)
    const records = published.map((item) => ({ objectID: item.id, ...item.fieldData }))

    await algoliaIndexObjects(algoliaAppId, algoliaKey, indexName, records)

    return NextResponse.json({ success: true, synced: records.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
