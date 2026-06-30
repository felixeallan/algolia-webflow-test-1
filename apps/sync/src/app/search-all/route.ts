import { NextRequest, NextResponse } from 'next/server'

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

    const carsCollectionId = process.env.WEBFLOW_CARS_COLLECTION_ID!
    const makesCollectionId = process.env.WEBFLOW_MAKES_COLLECTION_ID!
    const authorsCollectionId = process.env.WEBFLOW_AUTHORS_COLLECTION_ID!

    const records: SearchAllRecord[] = []

    // ── Cars ──────────────────────────────────────────────────────────────────
    const cars = (await fetchAllItems(webflowToken, carsCollectionId))
      .filter((i) => !i.isDraft && !i.isArchived)
    for (const item of cars) {
      records.push({
        objectID: `car__${item.id}`,
        title: String(item.fieldData.name ?? ''),
        description: String(item.fieldData.description ?? ''),
        url: `${siteUrl}/cars/${item.fieldData.slug}`,
        image: imageUrl(item.fieldData.image),
        type: 'Car',
        date: item.lastUpdated,
      })
    }

    // ── Makes ─────────────────────────────────────────────────────────────────
    const makes = (await fetchAllItems(webflowToken, makesCollectionId))
      .filter((i) => !i.isDraft && !i.isArchived)
    for (const item of makes) {
      records.push({
        objectID: `make__${item.id}`,
        title: String(item.fieldData.name ?? ''),
        description: '',
        url: `${siteUrl}/makes/${item.fieldData.slug}`,
        image: imageUrl(item.fieldData.logo),
        type: 'Make',
        date: item.lastUpdated,
      })
    }

    // ── Authors ───────────────────────────────────────────────────────────────
    const authors = (await fetchAllItems(webflowToken, authorsCollectionId))
      .filter((i) => !i.isDraft && !i.isArchived)
    for (const item of authors) {
      records.push({
        objectID: `author__${item.id}`,
        title: String(item.fieldData.name ?? ''),
        description: String(item.fieldData['bio-summary'] ?? ''),
        url: `${siteUrl}/author/${item.fieldData.slug}`,
        image: imageUrl(item.fieldData.picture),
        type: 'Author',
        date: item.lastUpdated,
      })
    }

    // ── Static pages ──────────────────────────────────────────────────────────
    const staticPages: SearchAllRecord[] = [
      { objectID: 'page__about',   title: 'About',   description: 'Learn about us',         url: `${siteUrl}/about`,   image: '', type: 'Page', date: '' },
      { objectID: 'page__pricing', title: 'Pricing', description: 'View our pricing plans',  url: `${siteUrl}/pricing`, image: '', type: 'Page', date: '' },
      { objectID: 'page__contact', title: 'Contact', description: 'Get in touch with us',    url: `${siteUrl}/contact`, image: '', type: 'Page', date: '' },
    ]
    records.push(...staticPages)

    await algoliaIndexObjects(algoliaAppId, algoliaKey, indexName, records as unknown as Record<string, unknown>[])

    return NextResponse.json({
      success: true,
      synced: records.length,
      breakdown: {
        cars: cars.length,
        makes: makes.length,
        authors: authors.length,
        pages: staticPages.length,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
