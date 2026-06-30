import { NextRequest, NextResponse } from 'next/server'
import { collections, staticPages } from '../../search-all-config'

interface WebflowItem {
  id: string
  fieldData: Record<string, unknown>
  isDraft: boolean
  isArchived: boolean
  lastUpdated: string
  createdOn: string
}

interface WebflowResponse {
  items: WebflowItem[]
  pagination: { limit: number; offset: number; total: number }
}

interface SearchAllRecord {
  objectID: string
  title: string
  description: string
  url: string
  image: string
  type: string
  date: string
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
    if (!res.ok) throw new Error(`Webflow API error ${res.status} for collection ${collectionId}`)
    const data: WebflowResponse = await res.json()
    all.push(...data.items)
    if (all.length >= data.pagination.total) break
    offset += limit
  }

  return all
}

function imageUrl(field: unknown): string {
  if (!field) return ''
  if (typeof field === 'string') return field
  if (typeof field === 'object' && 'url' in (field as object)) {
    return String((field as Record<string, unknown>).url ?? '')
  }
  return ''
}

async function algoliaIndexObjects(
  appId: string,
  apiKey: string,
  indexName: string,
  objects: Record<string, unknown>[]
): Promise<void> {
  const chunkSize = 1000
  for (let i = 0; i < objects.length; i += chunkSize) {
    const chunk = objects.slice(i, i + chunkSize)
    const res = await fetch(`https://${appId}.algolia.net/1/indexes/${indexName}/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Algolia-Application-Id': appId,
        'X-Algolia-API-Key': apiKey,
      },
      body: JSON.stringify({ requests: chunk.map((obj) => ({ action: 'updateObject', body: obj })) }),
    })
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
    const algoliaAppId = process.env.ALGOLIA_APP_ID!
    const algoliaKey = process.env.ALGOLIA_ADMIN_API_KEY!
    const indexName = process.env.ALGOLIA_SEARCH_ALL_INDEX!
    const siteUrl = (process.env.SITE_URL ?? '').replace(/\/$/, '')

    const records: SearchAllRecord[] = []
    const breakdown: Record<string, number> = {}

    for (const col of collections) {
      const items = (await fetchAllItems(webflowToken, col.collectionId))
        .filter((i) => !i.isDraft && !i.isArchived)

      for (const item of items) {
        const slug = String(item.fieldData.slug ?? '')
        records.push({
          objectID: `${col.prefix}__${item.id}`,
          title: String(item.fieldData[col.titleField] ?? ''),
          description: col.descriptionField ? String(item.fieldData[col.descriptionField] ?? '') : '',
          url: `${siteUrl}${col.urlPattern.replace('{slug}', slug)}`,
          image: col.imageField ? imageUrl(item.fieldData[col.imageField]) : '',
          type: col.type,
          date: item.lastUpdated,
        })
      }

      breakdown[col.type] = items.length
    }

    for (const page of staticPages) {
      records.push({
        objectID: page.objectID,
        title: page.title,
        description: page.description,
        url: `${siteUrl}${page.urlPath}`,
        image: '',
        type: 'Page',
        date: '',
      })
    }
    breakdown['Page'] = staticPages.length

    await algoliaIndexObjects(algoliaAppId, algoliaKey, indexName, records as unknown as Record<string, unknown>[])

    return NextResponse.json({
      success: true,
      synced: records.length,
      breakdown,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
