// Edit this file to configure which Webflow collections and static pages
// are included in the federated search_all index.
//
// Each collection maps to the normalized search schema:
//   objectID | title | description | url | image | type | date
//
// Collection IDs are not secrets — find them in your Webflow project URL
// when browsing the CMS collection: /sites/<site-id>/collections/<collection-id>

export interface CollectionConfig {
  collectionId: string
  type: string          // label stored as "type" in Algolia, e.g. "Car"
  prefix: string        // objectID prefix, e.g. "car" → "car__<webflow-item-id>"
  urlPattern: string    // {slug} is replaced with the item's slug field value
  titleField: string    // Webflow field slug for the title
  descriptionField?: string  // Webflow field slug for the description (omit if none)
  imageField?: string   // Webflow field slug for the image (omit if none)
}

export interface StaticPage {
  objectID: string      // unique ID, convention: "page__<slug>"
  title: string
  description: string
  urlPath: string       // relative path, e.g. "/about"
}

// ── Collections ───────────────────────────────────────────────────────────────
// Add one entry per CMS collection you want searchable.
// titleField defaults to "name" — override if your collection uses a different slug.

export const collections: CollectionConfig[] = [
  {
    collectionId: '6a175881c1be529d353e08ff',
    type: 'Car',
    prefix: 'car',
    urlPattern: '/cars/{slug}',
    titleField: 'name',
    descriptionField: 'description',
    imageField: 'image',
  },
  {
    collectionId: '6a175881c1be529d353e0918',
    type: 'Make',
    prefix: 'make',
    urlPattern: '/makes/{slug}',
    titleField: 'name',
    imageField: 'logo',
  },
  {
    collectionId: '6a188a5fc0a7c87ef5442c33',
    type: 'Author',
    prefix: 'author',
    urlPattern: '/author/{slug}',
    titleField: 'name',
    descriptionField: 'bio-summary',
    imageField: 'picture',
  },
]

// ── Static pages ──────────────────────────────────────────────────────────────
// Pages that aren't Webflow CMS items. Add, remove, or edit freely.

export const staticPages: StaticPage[] = [
  { objectID: 'page__about',   title: 'About',   description: 'Learn about us',        urlPath: '/about'   },
  { objectID: 'page__pricing', title: 'Pricing', description: 'View our pricing plans', urlPath: '/pricing' },
  { objectID: 'page__contact', title: 'Contact', description: 'Get in touch with us',  urlPath: '/contact' },
]
