export interface AlgoliaInstance {
  appId: string
  apiKey: string
  indexName: string
  hitsPerPage: number
  query: string
  page: number
  // { category: Set(['shoes', 'bags']), brand: Set(['nike']) }
  filters: Map<string, Set<string>>
  // { price: { min: 1000, max: 50000 } }
  ranges: Map<string, { min?: number; max?: number }>
  sortIndex: string
  urlState: boolean
  filterAttributes: Set<string>
  hasRendered: boolean
  wrapper: HTMLElement
}

export interface Hit {
  objectID: string
  [key: string]: unknown
}

export interface SearchResults {
  hits: Hit[]
  nbHits: number
  page: number
  nbPages: number
}
