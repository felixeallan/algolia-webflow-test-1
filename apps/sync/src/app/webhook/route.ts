import { NextRequest, NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({ ok: true })
}

interface WebflowWebhookPayload {
  triggerType:
    | 'collection_item_created'
    | 'collection_item_changed'
    | 'collection_item_deleted'
    | 'collection_item_unpublished'
  payload: {
    id: string
    fieldData: Record<string, unknown>
    isDraft: boolean
    isArchived: boolean
  }
}

async function algoliaUpsert(
  appId: string,
  apiKey: string,
  indexName: string,
  objectID: string,
  fields: Record<string, unknown>
): Promise<void> {
  const res = await fetch(
    `https://${appId}.algolia.net/1/indexes/${indexName}/${encodeURIComponent(objectID)}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Algolia-Application-Id': appId,
        'X-Algolia-API-Key': apiKey,
      },
      body: JSON.stringify({ objectID, ...fields }),
    }
  )
  if (!res.ok) throw new Error(`Algolia upsert error: ${res.status}`)
}

async function algoliaDelete(
  appId: string,
  apiKey: string,
  indexName: string,
  objectID: string
): Promise<void> {
  const res = await fetch(
    `https://${appId}.algolia.net/1/indexes/${indexName}/${encodeURIComponent(objectID)}`,
    {
      method: 'DELETE',
      headers: {
        'X-Algolia-Application-Id': appId,
        'X-Algolia-API-Key': apiKey,
      },
    }
  )
  if (!res.ok) throw new Error(`Algolia delete error: ${res.status}`)
}

export async function POST(request: NextRequest) {
  let body: WebflowWebhookPayload

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  try {
    const appId = process.env.ALGOLIA_APP_ID!
    const apiKey = process.env.ALGOLIA_ADMIN_API_KEY!
    const indexName = process.env.ALGOLIA_INDEX_NAME!

    const { triggerType, payload } = body

    switch (triggerType) {
      case 'collection_item_created':
      case 'collection_item_changed':
        if (payload.isDraft || payload.isArchived) {
          await algoliaDelete(appId, apiKey, indexName, payload.id)
        } else {
          await algoliaUpsert(appId, apiKey, indexName, payload.id, payload.fieldData)
        }
        break
      case 'collection_item_deleted':
      case 'collection_item_unpublished':
        await algoliaDelete(appId, apiKey, indexName, payload.id)
        break
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
