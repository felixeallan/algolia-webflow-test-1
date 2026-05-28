async function algoliaUpsert(appId, apiKey, indexName, objectID, fields) {
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

async function algoliaDelete(appId, apiKey, indexName, objectID) {
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

export default {
  async fetch(request, env) {
    if (request.method === 'GET') {
      return Response.json({ ok: true })
    }

    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 })
    }

    let body
    try {
      body = await request.json()
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    try {
      const { ALGOLIA_APP_ID, ALGOLIA_ADMIN_API_KEY, ALGOLIA_INDEX_NAME } = env
      const { triggerType, payload } = body

      // Full re-sync on site publish
      if (triggerType === 'site_publish') {
        await fetch(env.SYNC_ENDPOINT, {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.SYNC_SECRET}` },
        })
        return Response.json({ success: true, action: 'full_sync_triggered' })
      }

      // Ignore items from other collections
      const itemCollectionId = payload._cid || payload.collectionId
      if (env.WEBFLOW_COLLECTION_ID && itemCollectionId && itemCollectionId !== env.WEBFLOW_COLLECTION_ID) {
        return Response.json({ success: true, action: 'ignored' })
      }

      switch (triggerType) {
        case 'collection_item_created':
        case 'collection_item_changed':
          if (payload.isDraft || payload.isArchived) {
            await algoliaDelete(ALGOLIA_APP_ID, ALGOLIA_ADMIN_API_KEY, ALGOLIA_INDEX_NAME, payload.id)
          } else {
            await algoliaUpsert(ALGOLIA_APP_ID, ALGOLIA_ADMIN_API_KEY, ALGOLIA_INDEX_NAME, payload.id, payload.fieldData)
          }
          break

        case 'collection_item_deleted':
        case 'collection_item_unpublished':
          await algoliaDelete(ALGOLIA_APP_ID, ALGOLIA_ADMIN_API_KEY, ALGOLIA_INDEX_NAME, payload.id)
          break
      }

      return Response.json({ success: true })
    } catch (err) {
      return Response.json({ error: err.message || 'Unknown error' }, { status: 500 })
    }
  },
}
