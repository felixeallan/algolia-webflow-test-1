import { algoliasearch } from 'algoliasearch'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'edge'

const {
  WEBFLOW_API_TOKEN,
  WEBFLOW_COLLECTION_ID,
  ALGOLIA_APP_ID,
  ALGOLIA_ADMIN_API_KEY,
  ALGOLIA_INDEX_NAME,
  SYNC_SECRET,
} = process.env

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

async function fetchAllItems(): Promise<WebflowItem[]> {
  const all: WebflowItem[] = []
  let offset = 0
  const limit = 100

  while (true) {
    const res = await fetch(
      `https://api.webflow.com/v2/collections/${WEBFLOW_COLLECTION_ID}/items?limit=${limit}&offset=${offset}`,
      {
        headers: {
          Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
          'accept-version': '1.0.0',
        },
      }
    )

    if (!res.ok) throw new Error(`Webflow API error: ${res.status}`)

    const data: WebflowResponse = await res.json()
    all.push(...data.items)

    if (all.length >= data.pagination.total) break
    offset += limit
  }

  return all
}

export async function POST(request: NextRequest) {
  const auth = request.headers.get('authorization')
  if (!SYNC_SECRET || auth !== `Bearer ${SYNC_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const items = await fetchAllItems()

    // Skip drafts and archived items
    const published = items.filter((item) => !item.isDraft && !item.isArchived)

    const records = published.map((item) => ({
      objectID: item.id,
      ...item.fieldData,
    }))

    const client = algoliasearch(ALGOLIA_APP_ID!, ALGOLIA_ADMIN_API_KEY!)
    await client.saveObjects({ indexName: ALGOLIA_INDEX_NAME!, objects: records })

    return NextResponse.json({ success: true, synced: records.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
